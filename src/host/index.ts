// DSH Visual Workflow —— Host 半区插件入口。
//
// T-002 建立最小可加载骨架；T-015 完成装配（FlowStore 初始化、事件观察挂载、
// dispose 清理幂等）；T-021 装配编排运行时（运行锁/快照/状态机/wait 阻塞/暂停门/
// 看护/陈旧记录对账）；T-022 装配节点子代理执行引擎（startContinuable 创建/签名
// 复用/白名单解析）与护栏（ReAct 软截停、思考强度注入、wf_* 可见性双保险）。
// wf_* 工具（T-023）、GUI API（T-026）、服务管理器（T-031）在后续阶段接入。
//
// 装配原则（SKILL §4.3 Effect 所有权）：所有长生命周期资源（事件监听、定时器、
// 存储句柄）都归当前 fiber——ctx.on 随 fiber 自动反注册，显式清理经 ctx.effect
// 返回的 disposer 执行；Service.init 失败让 fiber 失败（不吞错）。
//
// 取证结论（T-002/T-015/T-021/T-022）：
//   - z 来自 @deepseek-ai/schemastery（默认导出）；Service/Context 来自
//     @deepseek-ai/cordis（官方 packages/host/webserver/src/index.ts 同款）。
//   - cordis 4.x 内置 Events 无 dispose 事件 → 清理归 ctx.effect（SKILL §4.3）。
//   - 事件名/服务名见本地 events.d.ts 与 agent/runner.ts 的结构适配（W-05，
//     payload 按官方 §8 #1/#4/#5/#21/#22 取证收窄）。
//   - 官方 services 一律经 ctx.get() 运行时解析（零官方包运行时依赖）；本文件
//     CordisAgentHost 是 agents 服务的最小结构适配，子代理服务适配在
//     agent/runner.ts（SubagentsServiceLike）。

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FlowStore } from './storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type OrchestratorLogger,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from './orchestrator/runtime.js'
import { reconcileStaleRuns, scheduleIdleWatchdog } from './orchestrator/watchdog.js'
import {
  CordisToolsView,
  NodeAgentRunner,
  childVisibilityContribution,
  type AgentsServiceLike,
  type SubagentsServiceLike,
} from './agent/runner.js'
import { createReactGuard } from './agent/guards.js'
import { createModelSelectionSetup } from './agent/model-selection.js'

// 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。
export const name = 'dsh-visual-workflow'

// 必需 service 声明（W-05：所有 @deepseek-ai/* 服务经 ctx.get() 运行时解析）。
// 宿主插件不声明强依赖官方 service（inject 为空）：数据层自持，事件经 ctx.on
// 订阅——任何缺失的官方能力都在 Service.init 内以运行时解析+明确报错处理。
export const inject: string[] = []

// ── Config schema ────────────────────────────────────────────────────────
// 与 cordis.patch.yml 的 13 个配置键一一对应，默认值与 patch 逐字一致。
// 默认值收敛在 schema（SKILL §4.1：任何部署可能需要改变的值都应成为配置而非源码常量）。

/** Host 插件的全部可配置键（已含默认值，应用后为必填）。 */
export interface Config {
  /** 数据根目录（工作流/服务/模板/运行历史/断点的落盘目录）。 */
  dataDir: string
  /** 模式二服务端口池起始值（向上探测空闲端口）。 */
  servicePortBase: number
  /** 模式二 REST API 鉴权密钥；null 表示鉴权关闭。 */
  apiKey: string | null
  /** 模式二单服务并发请求上限。 */
  maxConcurrentPerService: number
  /** wf_ask_agent 阻塞通信超时毫秒数。 */
  wfAskAgentTimeoutMs: number
  /** 运行空闲超时毫秒数（无 in-flight 看护门限）。 */
  runIdleTimeoutMs: number
  /** 运行状态回显轮询间隔毫秒数。 */
  runPollMs: number
  /** ReAct 迭代次数默认上限（软截停强制收尾）。 */
  reactIterationLimitDefault: number
  /** 单节点回流重试次数默认上限。 */
  retryLimitDefault: number
  /** 节点完整输出持久化字节上限。 */
  outputFullLimit: number
  /** 文本文件内容注入上下文字符上限。 */
  documentTextLimit: number
  /** 本地嵌入模型资产目录；null 用随包分发资产。 */
  embeddingModelDir: string | null
  /** 外部 OpenAI 兼容 /embeddings 端点；null 优先本地嵌入。 */
  embeddingEndpoint: string | null
}

/** 导出的 Config schema，供 Loader 校验与默认值填充（与官方 tool-fs L36 同款 `z<Config>`）。 */
export const Config: z<Config> = z.object({
  dataDir: z.string().default(''),
  servicePortBase: z.natural().default(7860),
  apiKey: z.union([z.string(), z.const(null)]).default(null),
  maxConcurrentPerService: z.natural().default(50),
  wfAskAgentTimeoutMs: z.natural().default(120000),
  runIdleTimeoutMs: z.natural().default(1800000),
  runPollMs: z.natural().default(2000),
  reactIterationLimitDefault: z.natural().default(50),
  retryLimitDefault: z.natural().default(3),
  outputFullLimit: z.natural().default(102400),
  documentTextLimit: z.natural().default(20000),
  embeddingModelDir: z.union([z.string(), z.const(null)]).default(null),
  embeddingEndpoint: z.union([z.string(), z.const(null)]).default(null),
})

// ── Cordis agents 服务适配（T-021）───────────────────────────────────────
// 会话根 Agent（父代理）服务的最小结构适配：零官方类型依赖，全部运行时守卫。
// 官方取证：agents 服务提供 get(sessionId) → Agent（含 followup/status/session）；
// 消息必须带 id 与 source（缺 source 父回合以 UNKNOWN 失败——旧项目根因复盘）。
// subagents 服务（子代理创建/followup/interrupt）由 T-022 的 agent-runner 适配。

/** agents 服务注册表的最小结构（运行时守卫后收窄）。 */
interface AgentsRegistryLike {
  get(id: string): unknown
}

class CordisAgentHost implements AgentHost {
  constructor(private readonly ctx: Context) {}

  /** 解析 agents 服务（缺省/不可用时返回 null，调用方给明确错误）。 */
  private agentsService(): AgentsRegistryLike | null {
    const service: unknown = this.ctx.get('agents')
    if (service !== null && typeof service === 'object' && typeof (service as { get?: unknown }).get === 'function') {
      return service as AgentsRegistryLike
    }
    return null
  }

  available(): boolean {
    return this.agentsService() !== null
  }

  getRootAgent(sessionId: string): RootAgentLike | null {
    const service = this.agentsService()
    if (!service) return null
    const raw = service.get(sessionId)
    if (raw === null || typeof raw !== 'object') return null
    return raw as RootAgentLike
  }

  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    if (typeof agent.followup !== 'function') {
      throw new Error('当前会话 Agent 未激活；请先在对话区发送一条消息后重试')
    }
    agent.followup(message)
  }

  latestTurnEnd(sessionId: string, afterMs: number): TurnEndInfo | null {
    const root = this.getRootAgent(sessionId)
    if (!root) return null
    const events = root.session?.events
    if (!Array.isArray(events)) return null
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as { type?: unknown; time?: unknown; data?: { reason?: { kind?: unknown; error?: unknown } } } | null
      if (!event || event.type !== 'turn/end') continue
      // 最新回合在运行开始前结束 → 运行发起回合尚未结束，不判终态
      if ((Number(event.time) || 0) < afterMs) return null
      const kind = event.data?.reason?.kind
      if (kind === 'error') return { kind: 'error', error: event.data?.reason?.error ?? {} }
      if (kind === 'aborted') return { kind: 'aborted' }
      return null
    }
    return null
  }

  childRunning(childId: string): boolean {
    const service = this.agentsService()
    if (!service) return false
    try {
      const agent = service.get(childId)
      if (agent === null || typeof agent !== 'object') return false
      return (agent as { status?: unknown }).status === 'running'
    } catch {
      return true // 查询失败保守视为仍在运行
    }
  }
}

/** 占位节点执行引擎已删除——T-022 起使用真实 NodeAgentRunner（见下）。 */

/** agents 服务惰性解析（子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
function agentsServiceLike(ctx: Context): AgentsServiceLike | null {
  const service: unknown = ctx.get('agents')
  if (service !== null && typeof service === 'object' && typeof (service as { get?: unknown }).get === 'function') {
    return service as AgentsServiceLike
  }
  return null
}

/** subagents 服务惰性解析（子代理执行引擎用；官方 SubagentRuntime 使用面）。 */
function subagentsServiceLike(ctx: Context): SubagentsServiceLike | null {
  const service: unknown = ctx.get('subagents')
  if (
    service !== null && typeof service === 'object'
    && typeof (service as { list?: unknown }).list === 'function'
    && typeof (service as { startContinuable?: unknown }).startContinuable === 'function'
    && typeof (service as { followup?: unknown }).followup === 'function'
    && typeof (service as { interrupt?: unknown }).interrupt === 'function'
    && typeof (service as { registerContinuableSetup?: unknown }).registerContinuableSetup === 'function'
  ) {
    return service as SubagentsServiceLike
  }
  return null
}

// ── visualWorkflowHost Service ────────────────────────────────────────────
// 提供 `visualWorkflowHost` 稳定 service；编排运行时随 service 生命周期管理。

/** 提供给 ctx 的宿主 service 名称。 */
export const VisualWorkflowHostServiceName = 'visualWorkflowHost'

/**
 * 宿主 service：持有解析后的 config、FlowStore 与编排运行时，挂载事件观察、
 * 看护定时器与清理。内存运行态（运行锁/快照/子代理表）由编排运行时与节点
 * 执行引擎（NodeAgentRunner）接管。
 */
export class VisualWorkflowHost extends Service {
  /** FlowStore 实例（dataDir 落盘数据层）。 */
  readonly store: FlowStore
  /** 编排运行时（运行锁/快照/状态机/wait 阻塞/暂停门）。 */
  readonly orchestrator: OrchestratorRuntime
  /** 节点子代理执行引擎（T-022；startContinuable 创建/签名复用/白名单解析）。 */
  readonly runner: NodeAgentRunner
  /** ReAct 软截停护栏（guards.ts；桥供 runner/编排器，贡献注入子代理）。 */
  private readonly reactGuard = createReactGuard()
  /** 思考强度模型选择装配（model-selection.ts）。 */
  private readonly modelSelection = createModelSelectionSetup()
  /** 是否已清理（dispose 幂等标记；私有实现，经 getter 暴露供测试断言）。 */
  private _disposed = false

  /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
  get disposed(): boolean {
    return this._disposed
  }

  constructor(
    ctx: Context,
    public readonly config: Config,
  ) {
    super(ctx, VisualWorkflowHostServiceName)
    this.store = new FlowStore(config.dataDir)
    this.runner = new NodeAgentRunner({
      store: this.store,
      agents: () => agentsServiceLike(ctx),
      subagents: () => subagentsServiceLike(ctx),
      toolsView: new CordisToolsView(ctx),
      react: this.reactGuard.bridge,
      modelSelection: this.modelSelection,
      logger: cordisLogger(ctx),
    })
    this.orchestrator = new OrchestratorRuntime({
      store: this.store,
      runner: this.runner,
      agents: new CordisAgentHost(ctx),
      config: {
        outputFullLimit: config.outputFullLimit,
        documentTextLimit: config.documentTextLimit,
        runIdleTimeoutMs: config.runIdleTimeoutMs,
        retryLimitDefault: config.retryLimitDefault,
        reactIterationLimitDefault: config.reactIterationLimitDefault,
      },
      logger: cordisLogger(ctx),
    })
  }

  /** 启动装配（Service.init 语义：初始化失败让 fiber 失败，不吞错）。 */
  async [Service.init](): Promise<void> {
    // dataDir 必须非空：真实运行由 cordis.patch.yml 的 dshHomePath 在 Loader 求值期
    // 解析为绝对路径；单测/独立嵌入需显式传入（不静默回退 cwd——SKILL §4.6）。
    if (!this.config.dataDir || !this.config.dataDir.trim()) {
      throw new Error('[visual-workflow] 配置缺失：dataDir 未指定（cordis.patch.yml 未加载？）')
    }

    // 数据目录结构初始化（幂等；§6 目录规划）
    await this.store.init()

    // 陈旧记录对账（§4.7 规则 5）：上次宿主异常关闭残留的 running/paused → interrupted
    await reconcileStaleRuns(this.store)

    // 事件观察（官方 seam 语义，架构文档 §8 #21/#22）：
    //   - subagent/end：节点子代理结束回写（ok/fail/react-capped + output + wait 唤醒）
    //   - agent/error：父代理回合错误快速终止（看护 latestTurnEnd 为兜底权威检测）
    // ctx.on 随本 fiber 自动反注册（SKILL §4.3），无需手动 removeListener。
    this.ctx.on('subagent/end', (payload) => this.onSubagentEnd(payload))
    this.ctx.on('agent/error', (payload) => this.onAgentError(payload))

    // 子代理护栏贡献（官方 registerContinuableSetup，§8 #7）：每个未发布子代理
    // 创建时注入——wf_* 可见性双保险 + ReAct 软截停 + 思考强度模型选择。
    // 返回的 disposers 归 ctx.effect（服务卸载时撤销贡献，官方契约）。
    const subagents = subagentsServiceLike(this.ctx)
    if (subagents) {
      this.ctx.effect(() => {
        const disposers: Array<() => void> = []
        disposers.push(subagents.registerContinuableSetup(childVisibilityContribution()))
        disposers.push(subagents.registerContinuableSetup(this.reactGuard.contribution))
        disposers.push(subagents.registerContinuableSetup(this.modelSelection.contribution))
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // 撤销尽力而为
            }
          }
        }
      }, 'visualWorkflowHost.childSetup')
    } else {
      this.ctx.logger.warn('[visual-workflow] subagents 服务不可用：子代理护栏与思考强度注入未启用')
    }

    // 看护定时器：空闲超时自动停止 / 父代理回合终态收尾（ctx.effect 持有 disposer）
    this.ctx.effect(() => scheduleIdleWatchdog(this.orchestrator), 'visualWorkflowHost.watchdog')

    // 显式清理通道：fiber 卸载时执行（中止运行/阻塞等待 reject/停止看护）。
    this.ctx.effect(() => () => this.dispose(), 'visualWorkflowHost.dispose')

    this.ctx.logger.info(`[visual-workflow] host service ready at ${this.config.dataDir}`)
  }

  /** subagent/end 观察：回写 run 节点状态（ok/fail + output）并唤醒 wait 阻塞。 */
  onSubagentEnd(payload: {
    runId?: unknown
    provider?: unknown
    id?: unknown
    local?: unknown
    stopReason?: unknown
    lastAssistantMessage?: unknown
  }): void {
    if (this._disposed) return
    void this.orchestrator.handleSubagentEnd(payload).catch((error) => {
      this.ctx.logger.warn(`[visual-workflow] subagent/end handling failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** agent/error 观察：匹配父代理会话 → 快速标记失败并释放运行锁（看护兜底）。 */
  onAgentError(payload: { agent?: { id?: unknown }; turn?: unknown; step?: unknown; error?: unknown }): void {
    if (this._disposed) return
    const sessionId = String(payload?.agent?.id ?? '')
    if (!sessionId) return
    const entry = this.orchestrator.activeRunForSession(sessionId)
    if (!entry) return
    void this.orchestrator.failRunForParentError(entry, payload?.error).catch((error) => {
      this.ctx.logger.warn(`[visual-workflow] parent-error handling failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * 清理运行时资源（幂等）。
   * fiber 卸载时需尽力中止全部运行（abort controller + 阻塞等待 reject）、清理
   * 子代理表与护栏登记；运行中的子代理由编排运行时统一中止后由官方 seam 收尾；
   * 模式二服务进程由 T-031 追加停止逻辑。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.orchestrator.dispose()
    this.runner.dispose()
    this.ctx.logger.info('[visual-workflow] host disposed')
  }
}

/** cordis ctx.logger 适配为编排器日志缝（结构化参数收敛为字符串，语义不丢）。 */
function cordisLogger(ctx: Context): OrchestratorLogger {
  return {
    warn: (message, ...args) => ctx.logger.warn(message, ...args),
    info: (message, ...args) => ctx.logger.info(message, ...args),
    debug: (message, ...args) => ctx.logger.debug(message, ...args),
  }
}

// ── 插件入口 ────────────────────────────────────────────────────────────

/** 插件 apply 入口：实例化并注册 visualWorkflowHost service（随 fiber 自动注销）。 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(VisualWorkflowHost, config)
}

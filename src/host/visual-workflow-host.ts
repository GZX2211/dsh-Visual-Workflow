// src/host/visual-workflow-host.ts
//
// Host Service（visualWorkflowHost）：装配 FlowStore、编排运行时、节点子代理
// 执行引擎、护栏/提示词/模型选择贡献、wf_* 工具与路由挂载；承载体持解析后的
// config 与全部质检组件，随 fiber 生命周期管理（init 失败让 fiber 失败）。

import { Context, Service } from '@deepseek-ai/cordis'
import type { Config } from './config.js'
import { FlowStore } from './storage/flow-store.js'
import {
  OrchestratorRuntime,
  type OrchestratorLogger,
  type RootAgentLike,
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
import { createChildPromptSetup } from './agent/prompt-setup.js'
import { CordisAgentHost, agentsServiceLike, subagentsServiceLike } from './agent/agents-host.js'
import { registerWfTools } from './tools/wf-tools.js'
import { registerWfAskAgent } from './tools/wf-ask-agent.js'
import { registerDataTools } from './tools/data-tools.js'
import { registerRoutes } from './remote/api.js'
import { registerDownloadRoute } from './remote/download.js'
import { EmbeddingService } from './embedding/engine.js'
import { ServiceManager } from './service/manager.js'

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
  /** 节点子代理执行引擎（startContinuable 创建/签名复用/白名单解析）。 */
  readonly runner: NodeAgentRunner
  /** 会话根 Agent 宿主能力（wf_* 工具层归属校验/提问借 root 身份）。 */
  readonly agents: CordisAgentHost
  /** 模式二服务管理器（fork 子进程生命周期/端口池/自动恢复）。 */
  readonly serviceManager: ServiceManager
  /** ReAct 软截停护栏（桥供 runner/编排器，贡献注入子代理）。 */
  private readonly reactGuard = createReactGuard()
  /** 思考强度模型选择装配。 */
  private readonly modelSelection = createModelSelectionSetup()
  /** 子代理系统提示词与协作 Prompt 注入装配。 */
  private readonly childPrompt = createChildPromptSetup()
  /** 本地嵌入引擎（外部端点 > 本地资产 > BM25 降级；惰性加载）。 */
  private readonly embedding: EmbeddingService
  /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
  private _disposed = false
  /** 跳过磁盘对账（服务进程装配用：运行记录对账属主进程职责）。 */
  private readonly skipReconcile: boolean

  /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
  get disposed(): boolean {
    return this._disposed
  }

  constructor(
    ctx: Context,
    public readonly config: Config,
    options: { skipReconcile?: boolean } = {},
  ) {
    super(ctx, VisualWorkflowHostServiceName)
    this.skipReconcile = options.skipReconcile === true
    this.store = new FlowStore(config.dataDir)
    this.agents = new CordisAgentHost(ctx)
    this.embedding = new EmbeddingService({
      modelDir: config.embeddingModelDir,
      endpoint: config.embeddingEndpoint,
      logger: { warn: (message) => ctx.logger.warn(message) },
    })
    this.runner = new NodeAgentRunner({
      store: this.store,
      agents: () => agentsServiceLike(ctx),
      subagents: () => subagentsServiceLike(ctx),
      toolsView: new CordisToolsView(ctx),
      react: this.reactGuard.bridge,
      modelSelection: this.modelSelection,
      promptSetup: this.childPrompt,
      logger: cordisLogger(ctx),
    })
    this.orchestrator = new OrchestratorRuntime({
      store: this.store,
      runner: this.runner,
      agents: this.agents,
      promptSetup: this.childPrompt,
      modelSelection: this.modelSelection,
      config: {
        outputFullLimit: config.outputFullLimit,
        documentTextLimit: config.documentTextLimit,
        runIdleTimeoutMs: config.runIdleTimeoutMs,
        retryLimitDefault: config.retryLimitDefault,
        reactIterationLimitDefault: config.reactIterationLimitDefault,
        wfAskAgentTimeoutMs: config.wfAskAgentTimeoutMs,
      },
      dbIndexer: { dataDir: config.dataDir, engine: this.embedding },
      logger: cordisLogger(ctx),
    })
    this.serviceManager = new ServiceManager({
      store: this.store,
      dataDir: config.dataDir,
      config: {
        servicePortBase: config.servicePortBase,
        apiKey: config.apiKey,
        maxConcurrentPerService: config.maxConcurrentPerService,
      },
      logger: {
        info: (message) => ctx.logger.info(message),
        warn: (message) => ctx.logger.warn(message),
        error: (message) => ctx.logger.error(message),
      },
    })
  }

  /** 按会话取根 Agent（wf_* 工具层提问/校验用；转发至 agents 适配）。 */
  getRootAgent(sessionId: string): RootAgentLike | null {
    return this.agents.getRootAgent(sessionId)
  }

  /** 按会话 id 取子代理 agent（wf_ask_agent 投递缝用；转发至 agents 适配）。 */
  getChildAgent(childId: string): RootAgentLike | null {
    return this.agents.getChildAgent(childId)
  }

  /** 冷态投递：复用子代理派发协作消息（subagents 服务惰性解析；缺失报明确错误）。 */
  async followupChild(
    parent: RootAgentLike,
    childId: string,
    content: unknown[],
    options: { source: unknown; signal?: AbortSignal },
  ): Promise<unknown> {
    const subagents = subagentsServiceLike(this.ctx)
    if (!subagents) {
      throw new Error('subagents 服务不可用，无法冷恢复目标子代理')
    }
    return subagents.followup(parent, childId, content, options)
  }

  /** 数据根目录（数据工具索引落盘位置）。 */
  get dataDir(): string {
    return this.config.dataDir
  }

  /** 服务 apiKey（调试流式代理鉴权用；密钥仅 Host 持有，不下发浏览器）。 */
  get apiKey(): string | null {
    return this.config.apiKey
  }

  /** 嵌入引擎（数据工具向量检索用）。 */
  get engine(): EmbeddingService {
    return this.embedding
  }

  /** 启动装配（Service.init 语义：初始化失败让 fiber 失败，不吞错）。 */
  async [Service.init](): Promise<void> {
    // dataDir 必须非空：真实运行由 patch 层的 dshHomePath 在 Loader 求值期解析为
    // 绝对路径；单测/独立嵌入需显式传入（不静默回退 cwd）。
    if (!this.config.dataDir || !this.config.dataDir.trim()) {
      throw new Error('[visual-workflow] 配置缺失：dataDir 未指定（cordis.patch.yml 未加载？）')
    }

    // 数据目录结构初始化（幂等）
    await this.store.init()

    // 陈旧记录对账与模式二服务自动恢复（上次运行中 status=running 的服务重启）。
    // 服务进程装配（skipReconcile）整块跳过：磁盘运行记录与服务状态属主进程，
    // 服务进程不接管——否则服务进程启动后会扫描到「自己」（主进程 fork 前已把
    // 该服务置为 running）并再次 start 自身 -> 自我 fork，子进程无限复制。
    // 自动恢复失败仅告警，不阻断主进程启动。
    if (!this.skipReconcile) {
      await reconcileStaleRuns(this.store)
      try {
        await this.serviceManager.autoRecover()
      } catch (error) {
        this.ctx.logger.warn(`[visual-workflow] 服务自动恢复失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 事件观察：
    //   - subagent/end：节点子代理结束回写（ok/fail/react-capped + output + wait 唤醒）
    //   - agent/error：父代理回合错误快速终止（看护 latestTurnEnd 为兜底权威检测）
    // ctx.on 随本 fiber 自动反注册，无需手动 removeListener。
    this.ctx.on('subagent/end', (payload) => this.onSubagentEnd(payload))
    this.ctx.on('agent/error', (payload) => this.onAgentError(payload))

    // 子代理护栏贡献：每个未发布子代理创建时注入——wf_* 可见性双保险 +
    // ReAct 软截停 + 思考强度模型选择。返回的 disposers 归 ctx.effect
    // （服务卸载时撤销贡献）。
    const subagents = subagentsServiceLike(this.ctx)
    if (subagents) {
      this.ctx.effect(() => {
        const disposers: Array<() => void> = []
        disposers.push(subagents.registerContinuableSetup(childVisibilityContribution()))
        disposers.push(subagents.registerContinuableSetup(this.reactGuard.contribution))
        disposers.push(subagents.registerContinuableSetup(this.modelSelection.contribution))
          disposers.push(subagents.registerContinuableSetup(this.childPrompt.contribution))
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

    // wf_* 工具注册：全局层注册 wf_run_node/wf_finish/wf_ask；子代理侧可见性由
    // 白名单解析 + tools.restrict 双保险控制。注册返回的 disposer 归 ctx.effect
    // ——服务卸载时工具随 fiber 注销。
    try {
      this.ctx.effect(() => registerWfTools(this.ctx, this), 'visualWorkflowHost.wfTools')
    } catch (error) {
      this.ctx.logger.warn(`[visual-workflow] wf_* 工具注册失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // wf_ask_agent 注册（Agent 间通信三态协议；父代理 resolve 能力内聚，子代理可选注入）。
    try {
      this.ctx.effect(() => registerWfAskAgent(this.ctx, this), 'visualWorkflowHost.wfAskAgent')
    } catch (error) {
      this.ctx.logger.warn(`[visual-workflow] wf_ask_agent 注册失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // 数据工具注册：wf_db_query（单工具三模式）。子代理侧可见性由白名单按
    // db-in 连线注入（有连线才进工具集）；执行期再做归属与连线双校验兜底。
    try {
      this.ctx.effect(() => registerDataTools(this.ctx, this), 'visualWorkflowHost.dataTools')
    } catch (error) {
      this.ctx.logger.warn(`[visual-workflow] 数据工具注册失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // 看护定时器：空闲超时自动停止 / 父代理回合终态收尾（ctx.effect 持有 disposer）
    this.ctx.effect(() => scheduleIdleWatchdog(this.orchestrator), 'visualWorkflowHost.watchdog')

    // GUI API 路由：webServer 可用时挂载端点白名单分发与受管文件下载路由
    // （webServer 缺失时 register 内部告警降级；disposer 随 fiber 注销）
    try {
      this.ctx.effect(() => registerRoutes(this.ctx, this), 'visualWorkflowHost.routes')
    } catch (error) {
      this.ctx.logger.warn(`[visual-workflow] GUI API 路由挂载失败：${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      this.ctx.effect(() => registerDownloadRoute(this.ctx, this.config.dataDir), 'visualWorkflowHost.downloadRoute')
    } catch (error) {
      this.ctx.logger.warn(`[visual-workflow] 受管文件下载路由挂载失败：${error instanceof Error ? error.message : String(error)}`)
    }

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
   * 模式二服务进程的停止逻辑在服务管理阶段接入。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.orchestrator.dispose()
    this.runner.dispose()
    this.embedding.dispose()
    this.serviceManager.dispose()
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

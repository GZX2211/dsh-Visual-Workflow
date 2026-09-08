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
import { createChildPromptSetup, type ChildPromptState } from './agent/prompt-setup.js'
import { CordisAgentHost, agentsServiceLike, subagentsServiceLike } from './agent/agents-host.js'
import { systemLanguageOf, type SettingsServiceLike } from './system-language.js'
import { registerWfTools } from './tools/wf-tools.js'
import { registerWfAskAgent } from './tools/wf-ask-agent.js'
import { registerDataTools } from './tools/data-tools.js'
import { registerRoutes } from './remote/api.js'
import { registerDownloadRoute } from './remote/download.js'
import { EmbeddingService } from './embedding/engine.js'
import { ServiceManager } from './service/manager.js'
import { SchedulerEngine } from './scheduler/engine.js'
import { SchedulerTaskStore } from './scheduler/task-store.js'
import { CordisSessionProvider, sessionCwdResolver } from './scheduler/session-provider.js'
import { registerToolSwitchFilter, ToolSwitchStore } from './tools/tool-switches.js'

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
  /** 定时任务引擎（触发/窗口挂起/续跑；新功能本阶段）。 */
  readonly scheduler: SchedulerEngine
  /** 定时任务存储（scheduler-tasks.json）。 */
  readonly schedulerTaskStore: SchedulerTaskStore
  /** 全局工具开关存储（tool-switches.json；父代理工具白名单「关闭」侧，全局即时生效）。 */
  readonly toolSwitches: ToolSwitchStore
  /** 新会话创建缝（「开启新会话」一次性动作：创建实例时新建主会话；API 端点使用）。 */
  readonly sessionProvider: CordisSessionProvider
  /** 会话工作目录解析（新会话继承创建者 cwd 用；API 端点使用）。 */
  readonly sessionCwdOf: (sessionId: string) => Promise<string | undefined>
  /** ReAct 软截停护栏（桥供 runner/编排器，贡献注入子代理）。 */
  private readonly reactGuard = createReactGuard()
  /** 思考强度模型选择装配。 */
  private readonly modelSelection = createModelSelectionSetup()
  /** 子代理系统提示词与协作 Prompt 注入装配。 */
  private readonly childPrompt = createChildPromptSetup()
  /**
   * 每子代理作用域装配撤销表（agentId → disposer）：由 `agent/session-start` 处理器在
   * 子代理创建窗口内安装四类贡献（角色提示词/工具可见性/模型选择/软截停），
   * `agent/disposed` 或宿主 dispose 时撤销。持 key 的是 agent id（而非 childId）。
   */
  private readonly childScopeDisposers = new Map<string, () => void>()
  /**
   * 每个视觉工作流子代理的提示词状态（agentId → ChildPromptState）。在首次 `agent/session-start`
   * 时写入；此后即使子代理被重发布/恢复（`agent/session-start` 再次触发、但不在 withPending
   * 作用域内）也能据此状态重新安装四类贡献——避免「第二轮被官方提示词顶替、贡献被卸载」的
   * 二次重置 BUG。`agent/disposed` 或宿主 dispose 时清理。
   */
  private readonly childPromptStates = new Map<string, ChildPromptState>()
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
    this.toolSwitches = new ToolSwitchStore(config.dataDir)
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
      toolSwitches: () => this.toolSwitches.currentDisabled(),
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
      // 系统语言名：从 DSH 用户设置（locale.preference）读取，供提示词注入语言规则
      systemLanguage: () => systemLanguageOf(ctx.get('settings') as SettingsServiceLike | null),
      logger: cordisLogger(ctx),
    })
    // 新会话创建缝：装配到宿主（API createSession 端点使用；运行器不再消费——
    // 工作台全局化改版后运行只认实例绑定的会话，新会话仅在创建实例时创建）。
    this.sessionProvider = new CordisSessionProvider(ctx)
    this.sessionCwdOf = sessionCwdResolver(ctx)
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
    this.schedulerTaskStore = new SchedulerTaskStore(config.dataDir)
    this.scheduler = new SchedulerEngine({
      taskStore: this.schedulerTaskStore,
      flowStore: this.store,
      orchestrator: this.orchestrator,
      sessionProvider: new CordisSessionProvider(ctx),
      sessionCwdOf: sessionCwdResolver(ctx),
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

  // ---- 每子代理作用域装配（agent/session-start 创建窗口内提前安装） ----------------

  /**
   * 在子代理创建窗口内安装四类每子代理作用域贡献，返回合并 disposer（host 管理生命周期）。
   * 与官方 installModelSelection(agentCtx) 的「拿到 child 的 ctx 后安装」范式一致：
   *   - wf_* 可见性双保险（wf_run_node/wf_finish deny）；
   *   - ReAct 软截停护栏；
   *   - 模型选择（provider/model/reasoning）；
   *   - 角色提示词段 + 开关过滤。
   * 因在 `agent/session-start`（agents.create 发布、首轮组装之前同步触发）执行，
   * 四类贡献在首轮即可见——修复「系统提示词/工具第二轮才更新」的同源时序 BUG。
   * 单个贡献失败则跳过（其余照装），返回的 disposer 为已成功安装贡献的合并撤销。
   */
  private installChildScope(childCtx: unknown): () => void {
    const contributions: Array<(context: unknown) => () => void> = [
      childVisibilityContribution(),
      this.reactGuard.contribution,
      this.modelSelection.contribution,
      this.childPrompt.contribution,
    ]
    const disposers: Array<() => void> = []
    for (const contribution of contributions) {
      try {
        const dispose = contribution(childCtx)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch {
        // 单个贡献因 childCtx 形状不符失败：跳过（其余照装），功能局部降级
      }
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 撤销尽力而为
        }
      }
    }
  }

  /** 撤销某 child 已安装的作用域装配（幂等；agent/disposed / 重建路径用）。 */
  private dropChildScope(agentId: string): void {
    const dispose = this.childScopeDisposers.get(agentId)
    if (!dispose) return
    this.childScopeDisposers.delete(agentId)
    try {
      dispose()
    } catch {
      // 撤销尽力而为
    }
  }

  /**
   * 监听官方 `agent/session-start`：子代理创建/重发布窗口（startContinuable 内部、first assembly
   * 之前）同步触发。
   *   - 首建：此时 `withPending` 状态仍在作用域内 → `peekPending()` 取到本次创建的 ChildPromptState；
   *   - 重发布/恢复：`agent/session-start` 再次触发但不在 withPending 作用域内 → 从
   *     `childPromptStates`（首建时持久化）取回状态。
   * 据此在其 ctx 上提前（重新）安装四类贡献，使首轮 + 后续每轮系统提示词与工具集都保持就位，
   * 不会「第二轮被官方提示词顶替、贡献被卸载」（二次重置 BUG）。
   */
  private onAgentSessionStart(payload: { agent?: { id?: unknown; ctx?: unknown } }): void {
    const agent = payload?.agent
    if (!agent || typeof agent !== 'object') return
    const childCtx = agent.ctx
    if (!childCtx) return
    const agentId = String(agent.id ?? '')
    if (!agentId) return
    // 状态优先级：仍在 withPending（首建）→ 用本次 pending；否则用首建持久化的对应该子代理状态（重发布/恢复）
    const state = this.childPrompt.peekPending() ?? this.childPromptStates.get(agentId)
    if (!state) return // 非视觉工作流子代理（既不处于首建 pending，也不是已知视觉工作流子代理）
    this.dropChildScope(agentId) // 同 id 二次发布先撤销旧装配，防重复
    // 用 withPending 包裹，使 contribution 读到该 state（首建嵌套于 runner 的 pending，取最内层值）
    void this.childPrompt.withPending(state, async () => {
      const dispose = this.installChildScope(childCtx)
      if (typeof dispose === 'function') this.childScopeDisposers.set(agentId, dispose)
      return dispose
    })
    this.childPromptStates.set(agentId, state)
  }

  /** 子代理被销毁时回收其作用域装配与提示词状态（重建配置签名变化 / 正常运行结束）。 */
  private onAgentDisposed(payload: { agent?: { id?: unknown } }): void {
    const agentId = String(payload?.agent?.id ?? '')
    if (!agentId) return
    this.dropChildScope(agentId)
    this.childPromptStates.delete(agentId)
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
    const blocks = (Array.isArray(content) ? content : []) as Array<{ type: 'text'; text: string }>
    // 0.1.2 适配：SubagentRuntime 移除 rc.2 的 followup，改为相邻 Agent 通道。
    // sendMessage（live 父 → direct child）/ queuePrompt（host distinct turn）/ 旧 followup 依可用性投递。
    if (typeof subagents.sendMessage === 'function') {
      return subagents.sendMessage(parent, childId, blocks, options.signal ? { signal: options.signal } : {})
    }
    if (typeof subagents.queuePrompt === 'function') {
      return subagents.queuePrompt(parent, childId, blocks, options.source, options.signal)
    }
    if (typeof subagents.followup === 'function') {
      return subagents.followup(parent, childId, blocks, options)
    }
    throw new Error('subagents 服务不支持协作投递（缺少 sendMessage/queuePrompt/followup）')
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

    // 全局工具开关装载：磁盘快照 → 内存权威集；随后注册 system-prompt/assemble
    // 全局瀑布（unscoped ctx 对所有 agent 组装生效），关闭工具即时从所有会话
    // 的代理上下文中剔除（独立于工作流运行状态，正菜单交互语义）。
    await this.toolSwitches.load()
    this.ctx.effect(() => registerToolSwitchFilter(this.ctx, this.toolSwitches), 'visualWorkflowHost.toolSwitches')

    // 角色提示词首轮注入全局瀑布（unscoped，与工具开关瀑布同构）：子代理首轮组装在
    // startContinuable 内部、withPending 状态仍活跃时发生（详见 prompt-setup.ts），
    // 全局瀑布据此注入角色 Prompt 段并应用开关过滤，使子代理【第一轮】即用角色 Prompt
    // 替换官方身份/人设段——修复「初始提示词未被用户自设替换、第二轮才替换」的 BUG。
    // 后续回合由 per-agent 贡献（contribution/bindParent）持久生效，本瀑布只介入首轮。
    this.ctx.effect(() => this.childPrompt.registerGlobalAssemblyHook(this.ctx), 'visualWorkflowHost.promptGlobalHook')

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
    //   - agent/session-start：子代理创建窗口内提前安装四类每子代理作用域贡献
    //     （角色提示词/工具可见性/模型选择/软截停），使首轮系统提示词与工具集就位
    //   - agent/disposed：撤销对应子代理的作用域装配（重建/正常销毁回收）
    // ctx.on 随本 fiber 自动反注册，无需手动 removeListener。
    this.ctx.on('subagent/end', (payload) => this.onSubagentEnd(payload))
    this.ctx.on('agent/error', (payload) => this.onAgentError(payload))
    this.ctx.on('agent/session-start', (payload) => this.onAgentSessionStart(payload))
    this.ctx.on('agent/disposed', (payload) => this.onAgentDisposed(payload))

    // 0.1.2 适配：rc.2 的 registerContinuableSetup 已从官方移除。每子代理作用域装配改为
    // 由 host 监听 `agent/session-start`（子代理创建窗口内同步触发）提前安装四类贡献
    // （见 onAgentSessionStart / installChildScope），不再由 runner 在 startContinuable
    // 返回后安装——否则首轮系统提示词/工具尚未就位、第二轮才更新。此处仅检测 subagents
    // 服务可用性并提示。
    if (!subagentsServiceLike(this.ctx)) {
      this.ctx.logger.warn('[visual-workflow] subagents 服务不可用：子代理执行/护栏将受限（运行时按需报错或降级）')
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

    // 定时任务引擎：tick 扫描（触发/窗口挂起/续跑；disposer 随 fiber 注销）
    this.ctx.effect(() => this.scheduler.start(), 'visualWorkflowHost.scheduler')

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
    this.scheduler.dispose()
    this.orchestrator.dispose()
    this.runner.dispose()
    // 回收所有已安装的子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）
    for (const dispose of this.childScopeDisposers.values()) {
      try {
        dispose()
      } catch {
        // 撤销尽力而为
      }
    }
    this.childScopeDisposers.clear()
    this.childPromptStates.clear()
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

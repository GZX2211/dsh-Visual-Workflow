// src/host/orchestrator/runtime-base.ts
//
// 编排运行时继承链基类（RuntimeBase）：承载全部字段、基础工具、运行查询、
// 运行时读取、清理与内部辅助。方法体与拆分前逐字一致（零逻辑修改）；
// 可见性自 private 放宽为 protected 仅因跨文件继承协作（编译产物不变）。
//
// 运行锁语义（用户裁决后的降权改造）：锁不再充当「执行节点的前置条件」，而只保护
// 「同工作流单活 + 断点归属 + 画布回显 + 运行历史」；工具层遇到本会话的暂停/已停止/
// 已中断断点时经 ensureActiveRun **静默接续**（resumeRun silent 分支）接管——只接管
// 运行事实与锁，不注入编排指令、也不要求父代理空闲，故父代理可在自身回合内自行恢复，
// 无需人工回工作台点「运行」。
//
// 继承链：RuntimeBase ← RuntimeLaunch ← RuntimeExecute ← RuntimeComm ←
// RuntimeObserve ← RuntimeLifecycle ← OrchestratorRuntime（runtime.ts 收口）。

import { randomUUID } from 'node:crypto'
import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot, RunStatus } from '../shared/types.js'
import { cloneSnapshot, setNodeStatus } from './snapshot.js'
import { RESUMABLE_STATUSES, type ResumeInput, type ResumeResult } from './resume.js'
import { orchestrationChangeTextOf, type ExecutorContextFacts } from '../prompts/index.js'
import { effectiveRetryLimitOf } from './node-params.js'
import { DEFAULT_SYSTEM_LANGUAGE, isEnglishSystemLanguage } from '../system-language.js'
import { coordinatorMessage } from './send-message-protocol.js'
import { summarizeFlowChange } from './flow-diff.js'
import { buildNodeContextFacts } from './graph-facts.js'
import { parentExecutorOf } from './directive.js'
import { parentRoleIdentityOf } from './role-identity.js'
import { WfError, messageOf } from './errors.js'
import type { OrchestratorDeps, RunEntry } from './run-entry.js'
import {
  type ChildMeta,
  type FlowLockInfo,
  type OrchestratorLogger,
  type RootAgentLike,
  type TurnEndInfo,
  consoleLogger,
} from './seams.js'

export abstract class RuntimeBase {
  /**
   * 断点续跑（实现位于 RuntimeLaunch，见 runtime-launch.ts）。
   * 此处只做抽象声明，使基类内的运行上下文自动接续（adoptRunContext）可以调用它，
   * 而不必把基类反向依赖到下游继承层。入参用 ResumeInput 单一契约，避免与实现漂移。
   */
  abstract resumeRun(input: ResumeInput): Promise<ResumeResult>
  /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
  readonly runs = new Map<string, RunEntry>()
  /** childId → 运行位置反查（subagent/end 观察回写用）。 */
  protected readonly childIndex = new Map<string, ChildMeta>()
  /** nodeId → childId 反向索引（wf_send_message 节点 id 寻址 O(1)，P2-4）。 */
  protected readonly childByNode = new Map<string, string>()
  /**
   * 断点静默接续去重表（sessionId → 进行中的运行上下文接续 Promise）。
   * 为什么需要：父代理可以在同一步里并发发起多个 wf_* 工具调用（模型支持并行工具
   * 调用），而「定位断点」要 await 磁盘扫描——若不去重，两次调用会各自拿到暂停/停止
   * 的断点并各自续跑，第二个必然撞 WF_LOCKED。会话级去重让并发调用共享同一次接续。
   */
  protected readonly adopting = new Map<string, Promise<RunEntry | null>>()
  /** flowId 级续跑去重（同会话多 flow 交错时的二次收口）。 */
  protected readonly resuming = new Map<string, Promise<ResumeResult | null>>()
  /** dispose 标记：置位后迟到事件缓冲不再重试（插件卸载清理彻底）。 */
  protected disposed = false

  constructor(protected readonly deps: OrchestratorDeps) {}
  // ---- 基础工具 -------------------------------------------------------------

  protected log(): OrchestratorLogger {
    return this.deps.logger ?? consoleLogger
  }

  /** 当前时间戳（时钟注入）。 */
  now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** 当前 ISO 时间字符串。 */
  protected isoNow(): string {
    return new Date(this.now()).toISOString()
  }

  /**
   * 把父代理（会话根 Agent）节点的配置注入到根 Agent 的 ctx：
   *   - 角色 Prompt（含 .md 路径读取）注册为系统提示词段 visual-workflow:prompt；
   *   - injectSystemPrompt 开关控制官方系统提示词注入；injectToolSections 控制工具散文段；
   *   - 服务商/模型/思考强度写入根 Agent 的模型选择。
   * 非侵入：仅挂载到根 Agent 的 ctx，只对本会话生效；缺父代理节点/根无 ctx 时静默跳过。
   */
  protected async bindParentConfig(flow: WorkflowDocument, root: RootAgentLike, sessionId: string): Promise<void> {
    const ctx = root.ctx
    if (!ctx || typeof ctx !== 'object') return
    if (!this.deps.promptSetup || !this.deps.modelSelection || !this.deps.resolveRolePrompt) return
    const parentNode = flow.nodes.find((n): n is RoleNode => n.kind === 'parent')
    if (!parentNode) return
    try {
      // 角色 Prompt 实际注入文本（.md 路径设置时读取文件当前内容，与子代理一致）
      const rolePrompt = await this.deps.resolveRolePrompt(parentNode)
      this.deps.promptSetup.bindParent(ctx, {
        systemPrompt: rolePrompt,
        injectSystemPrompt: parentNode.data.injectSystemPrompt !== false,
        injectToolSections: parentNode.data.injectToolSections !== false,
      }, sessionId)
      const data = parentNode.data
      this.deps.modelSelection.bindParent(ctx, {
        provider: String(data.provider ?? ''),
        model: String(data.model ?? ''),
        ...(typeof data.reasoning === 'string' && data.reasoning.trim() ? { reasoningEffort: data.reasoning } : {}),
      }, sessionId)
    } catch (error) {
      this.deps.logger?.warn(`[visual-workflow] 父代理配置注入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 记录告警（watchdog 扫描失败/持久化告警路径）。 */
  warn(message: string): void {
    this.log().warn(message)
  }

  /**
   * 父代理执行单元准备（startRun/resumeRun 共用；情况2 hybrid / 情况3 executor）：
   *   - 父代理节点被流程线连接 → 登记 executorParentId，快照中该节点标记 running
   *     （续跑已 ok 则跳过——继承不重跑）；
   *   - 组装父代理执行单元上下文（复用 buildNodeContextFacts：上游产出（自动注入）/文件
   *     文本与路径索引/db 提示），返回结构化上下文供 hybrid 的【你的节点任务】与
   *     executor（情况3）提示词构建使用；
   *   - 情况1 纯调度者返回 null（指令不含执行单元内容）。
   */
  protected async prepareParentExecutor(
    flow: WorkflowDocument,
    entry: RunEntry,
  ): Promise<{ nodeId: string; nodeLabel: string; task: ExecutorContextFacts; runContextText: string } | null> {
    const executor = parentExecutorOf(flow)
    if (!executor) return null
    const parentNode = flow.nodes.find((n) => n.id === executor.nodeId)
    if (!parentNode || parentNode.kind !== 'parent') return null
    const snapshot = entry.snapshot
    const existing = snapshot.nodes.find((n) => n.nodeId === executor.nodeId)
    // 续跑继承：已 ok/react-capped 的父代理节点不再注入执行单元（断点产出已随快照继承）
    if (existing && (existing.status === 'ok' || existing.status === 'react-capped')) return null
    entry.executorParentId = executor.nodeId
    if (!existing || existing.status !== 'running') {
      setNodeStatus(snapshot, executor.nodeId, 'running', { now: this.now() })
    }
    const systemLanguage = snapshot.systemLanguage ?? this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE
    const context = buildNodeContextFacts({
      flow,
      node: parentNode,
      snapshot,
      documentTextLimit: this.deps.config.documentTextLimit,
      systemLanguage,
    })
    // 重试预算与真实护栏同源（参数覆盖 > 节点配置 > 配置默认）：分母不再硬编码为 1，
    // 否则父代理在可重试的节点上被提示「只有 1 次尝试」而提前放弃。
    const retryBudget = effectiveRetryLimitOf(parentNode, {}, this.deps.config.retryLimitDefault) + 1
    return {
      nodeId: executor.nodeId,
      nodeLabel: executor.nodeLabel,
      task: { ...context, nodeLabel: executor.nodeLabel },
      runContextText: `runId=${snapshot.id}; attempt ${(existing?.attempts ?? 0) + 1}/${retryBudget}${isEnglishSystemLanguage(systemLanguage) ? ' (parent execution unit)' : '（父代理执行单元）'}`,
    }
  }

  /**
   * 父代理执行者收尾：开始调度（首次 wf_run_node / wf_finish）时把父代理节点标记 ok。
   */
  protected markParentExecutorDone(entry: RunEntry): void {
    const nodeId = entry.executorParentId
    if (!nodeId) return
    const snapshot = entry.snapshot
    const existing = snapshot.nodes.find((n) => n.nodeId === nodeId)
    if (!existing || existing.status !== 'running') return
    // 输出取父代理最近一条 assistant/message 文本（有产出才回写；无文本仍标记 ok 完成调度）
    const output = this.deps.agents.latestRootAssistantText?.(
      snapshot.sessionId,
      Date.parse(snapshot.startedAt ?? '') || 0,
    ) ?? ''
    setNodeStatus(snapshot, nodeId, 'ok', {
      output,
      outputFullLimit: this.deps.config.outputFullLimit,
      now: this.now(),
      recordTurn: true,
      stopReason: 'completed',
    })
  }

  /** 空闲看护门限（watchdog.ts 引用）。 */
  get idleTimeoutMs(): number {
    return this.deps.config.runIdleTimeoutMs
  }

  /** 子代理是否仍在运行（watchdog.ts 引用；经 AgentHost）。 */
  childRunning(childId: string): boolean {
    return this.deps.agents.childRunning(childId)
  }

  /** 父代理回合终态检测（watchdog.ts 引用）。 */
  parentTurnTerminal(entry: RunEntry): TurnEndInfo | null {
    const startedMs = Date.parse(entry.snapshot.startedAt ?? '') || 0
    return this.deps.agents.latestTurnEnd(entry.snapshot.sessionId, startedMs)
  }

  // ---- 查询 -----------------------------------------------------------------

  /** 某会话正在运行的 run（status === 'running'）。 */
  activeRunForSession(sessionId: string): RunEntry | null {
    for (const entry of this.runs.values()) {
      if (entry.snapshot.status === 'running' && entry.snapshot.sessionId === sessionId) return entry
    }
    return null
  }

  /**
   * 某会话正在运行实例的工作流文档（`wf_org_catalog` 的 instance 召回取数源；无活跃 run 返回 null）。
   *
   * 为什么只认 running：暂停中的运行不暴露骨架（暂停态父代理不继续编排，恢复后重新
   * running 即再次可见）——「当前正在运行的实例」这条语义由本函数独占定义，取数方不判状态。
   * 为什么取最新实例文档而不是运行起始快照：运行中画布可能被改，父代理要按最新拓扑调度
   * （与 currentResolvedFlow 同口径；读失败回退起始快照）。
   */
  async activeRunFlow(sessionId: string): Promise<WorkflowDocument | null> {
    const entry = this.activeRunForSession(sessionId)
    if (!entry) return null
    return await this.currentResolvedFlow(entry)
  }

  /**
   * 活跃 run 摘要（running/paused 均保留运行锁；返回 flowId/status/runId/sessionId）。
   * 工作台全局化改版：sessionId 缺省时返回**全部会话**的活跃 run（工作台全局面板
   * 实例列表状态徽标用）；传入时按会话过滤（进入时自动选中、旧单会话面板兼容）。
   */
  activeRunsForSession(sessionId?: string): Array<{ flowId: string; status: RunStatus; runId: string; sessionId: string }> {
    const out: Array<{ flowId: string; status: RunStatus; runId: string; sessionId: string }> = []
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (sessionId !== undefined && s.sessionId !== sessionId) continue
      if (s.status !== 'running' && s.status !== 'paused') continue
      out.push({ flowId: s.flowId, status: s.status, runId: s.id, sessionId: s.sessionId })
    }
    return out
  }

  // ---- Experience 运行事实 seam（只读语义化查询） --------------------------------

  /**
   * 某会话当前活跃运行的归属事实（Experience 域解析 subject 用）。
   * 为什么返回最小结构而不是 RunEntry：运行表与会话/工作流的定位口径是编排器内部
   * 知识，模块外只应表达「这个会话当前在跑哪个 run、以哪个父代理角色在跑」。
   */
  activeExperienceRunForSession(
    sessionId: string,
  ): { runId: string; flowId: string; sessionId: string; roleKey: string; roleLabel: string } | null {
    const entry = this.activeRunForSession(sessionId)
    if (!entry) return null
    const snapshot = entry.snapshot
    // 父代理角色身份从起始流程的父代理节点推导：绑定父代理配置时用的也是同一份 baseFlow
    return {
      runId: snapshot.id,
      flowId: snapshot.flowId,
      sessionId: snapshot.sessionId,
      ...parentRoleIdentityOf(entry.baseFlow),
    }
  }

  /**
   * 某子代理所属运行的归属事实（Experience 域解析来源 run、节点与角色用）。
   * 已退役（被同节点新配置替换）或运行已非 running 时返回 null。
   */
  experienceRunForChild(
    childId: string,
  ): { runId: string; flowId: string; sessionId: string; nodeId: string; roleKey: string; roleLabel: string } | null {
    const meta = this.childIndex.get(childId)
    if (!meta || meta.retired) return null
    const entry = this.runForChild(childId)
    if (!entry) return null
    return {
      runId: entry.snapshot.id,
      flowId: meta.flowId,
      sessionId: meta.sessionId,
      nodeId: meta.nodeId,
      // 旧登记（升级前启动的子代理）没有角色字段：按空身份返回，不伪造角色
      roleKey: meta.roleKey ?? "",
      roleLabel: meta.roleLabel ?? "",
    }
  }

  // ---- 运行上下文自动接续（工具层用） ------------------------------------------

  /**
   * 取「可直接执行节点」的激活运行；依次尝试：
   *   ① 本会话 running 的 run（常态路径）；
   *   ② 内存中本会话 paused 的 run → 用该 flowId **静默接续**（等价人工点「运行」，但不注入指令）；
   *   ③ 该会话**全部可恢复**的磁盘记录（stopped/interrupted/paused）→ 逐条静默接续；
   *   ④ 都没有 → null（调用方按 WF_NO_ACTIVE_RUN 给出可行动提示）。
   *
   * 运行锁语义（用户裁决）：锁不再作为「执行节点的前置条件」，而是降权为
   * 「同工作流单活 + 断点归属」的保护；工具层遇到暂停/已停止的断点即静默接续，
   * 不再要求用户回到工作台点「运行」。真正的硬边界只剩「本会话从未启动过运行」。
   *
   * 为什么必须静默（而非沿用注入了编排指令的显式续跑）：工具调用发生在父代理**自身
   * 回合内**（root.status === 'running'），而显式续跑要求父代理空闲让位给指令注入
   * （WF_ROOT_BUSY），两者天然互斥——这正是「必须人工点运行」的根因。
   *
   * 停点判定为何「内存优先」：paused 是唯一保留在内存的断点（锁未释放），
   * 恢复它会原样接管其断点产出；磁盘兜底按 startedAt 倒序逐条尝试。
   */
  protected async ensureActiveRun(sessionId: string): Promise<RunEntry | null> {
    const active = this.activeRunForSession(sessionId)
    if (active) return active
    // 去重键按会话（而非 flowId）：断点定位本身要 await 磁盘扫描，若不去重，
    // 并发的两次调用会各自扫到同一条断点并各自续跑 → 第二次撞 WF_LOCKED。
    // Promise 在首个 await 之前同步登记，保证并发调用共享同一次接续。
    const pending = this.adopting.get(sessionId)
    if (pending) return pending
    const task = this.adoptRunContext(sessionId)
    this.adopting.set(sessionId, task)
    try {
      return await task
    } finally {
      this.adopting.delete(sessionId)
    }
  }

  /** 接续本体（已由 ensureActiveRun 完成会话级去重）：定位断点 → 静默接续 → 取回运行条目。 */
  private async adoptRunContext(sessionId: string): Promise<RunEntry | null> {
    // 断点候选按「内存 paused 优先，磁盘按 startedAt 倒序」排列，逐条尝试。
    // 为什么逐条而不是只认最新一条：一条断点不可恢复（图被改坏/被别的会话锁住/指定记录
    // 不可恢复）不代表本会话没有可用的断点；旧实现只试最新一条，失败即上抛，用户明明
    // 还有可接续的运行却收到错误。
    const candidates: Array<{ flowId: string; runId: string }> = []
    const known = new Set<string>()
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId !== sessionId || s.status !== 'paused') continue
      candidates.push({ flowId: s.flowId, runId: s.id })
      known.add(s.id)
    }

    // 磁盘断点（stopped/interrupted/paused；宿主重启或用户在工作台停止后）。
    // 扫描语义（跳过非本资源文档）：单个坏文件不得让整轮断点扫描失效。
    try {
      const disk = (await this.deps.store.listAllRuns()).filter((record) =>
        record.sessionId === sessionId
        && !known.has(record.id)
        && (RESUMABLE_STATUSES as readonly string[]).includes(record.status))
      disk.sort((a, b) => (String(a.startedAt ?? '') < String(b.startedAt ?? '') ? 1 : -1))
      for (const record of disk) candidates.push({ flowId: record.flowId, runId: record.id })
    } catch (error) {
      this.log().warn(`[visual-workflow] 断点扫描失败：${messageOf(error)}`)
      if (candidates.length === 0) return null
    }
    if (candidates.length === 0) return null

    const skipped: Array<{ runId: string; code: string; reason: string }> = []
    for (const candidate of candidates) {
      try {
        await this.autoResumeRun(sessionId, candidate.flowId, candidate.runId)
      } catch (error) {
        // 恢复类错误（断点不可恢复）逐条跳过并留痕；非恢复类错误（程序缺陷/磁盘故障）
        // 不得被吞——直接上抛，否则真正的故障会被伪装成「没有可接续的断点」。
        if (!(error instanceof WfError)) throw error
        skipped.push({ runId: candidate.runId, code: error.code, reason: messageOf(error) })
        continue
      }
      const adopted = this.runningEntryOf(sessionId, candidate.flowId)
      if (adopted) return adopted
      skipped.push({ runId: candidate.runId, code: 'WF_NO_ACTIVE_RUN', reason: '接续后未产生运行条目（可能已被并发接续或停止）' })
    }

    // 全部候选都失败：报可行动错误并逐条列出被跳过的断点与原因（不静默丢断点）。
    // 错误码沿用**最新一条**候选的恢复类错误码——单候选时与旧行为逐字一致，
    // 调用方按码分支的既有逻辑（如 WF_FLOW_INCOMPLETE 的提示）不失效。
    const detail = skipped.map((item) => `${item.runId}（${item.reason}）`).join('；')
    throw new WfError(
      `本会话的断点都无法接续（已跳过 ${skipped.length} 条：${detail}）。请在工作台检查这些工作流的完整性后重新运行。`,
      skipped[0].code,
      { runId: skipped[0].runId },
    )
  }

  /** 本会话某工作流当前 running 的条目（接续成功后取回；未取到返回 null）。 */
  private runningEntryOf(sessionId: string, flowId: string): RunEntry | null {
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId === sessionId && s.flowId === flowId && s.status === 'running') return entry
    }
    return null
  }

  /**
   * 断点静默接续（同 flowId 并发去重）：续跑失败时把恢复路径的错误向上抛（调用方据此
   * 给出精确错误码，例如 WF_FLOW_INCOMPLETE），不吞错。
   * 固定 silent：本方法只服务工具路径——调用时父代理正在自身回合内，故不注入编排指令、
   * 也不要求父代理空闲；显式启动语义（工作台/调度器/模式二）不经此路径。接续成功日志
   * 由 resumeRun 的静默分支记录，此处不重复。
   * fromRunId 指定本次要接管的断点记录（接续多候选逐条尝试时用），缺省取该工作流最新可恢复记录。
   */
  protected autoResumeRun(sessionId: string, flowId: string, fromRunId?: string): Promise<ResumeResult | null> {
    const pending = this.resuming.get(flowId)
    if (pending) return pending
    const task = (async (): Promise<ResumeResult | null> => {
      try {
        return await this.resumeRun({ sessionId, flowId, ...(fromRunId ? { fromRunId } : {}), silent: true })
      } finally {
        this.resuming.delete(flowId)
      }
    })()
    this.resuming.set(flowId, task)
    return task
  }

  /** 某工作流当前被哪个会话锁定（running/paused 均保留锁）。 */
  flowLockInfo(flowId: string): FlowLockInfo | null {
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if ((s.status === 'running' || s.status === 'paused') && s.flowId === flowId) {
        return { flowId, sessionId: s.sessionId, runId: s.id, flowName: s.flowName, status: s.status }
      }
    }
    return null
  }

  /**
   * 运行锁检查（startRun 用）：存在锁定（running/paused）即抛错。
   * 为什么同时用于「开头护栏」与「登记前重检」：两处语义一致——只要此刻
   * 该 flowId 已有激活 run，本次启动就要拒绝；登记前在同一同步块内重检，
   * 使 check-then-act 原子化（并发 startRun 不会双双通过）。
   */
  protected assertFlowLockFree(flowId: string, sessionId: string): void {
    const locked = this.flowLockInfo(flowId)
    if (!locked) return
    if (locked.status === 'paused' && locked.sessionId === sessionId) {
      throw new WfError('该工作流已暂停，请先恢复运行', 'WF_PAUSED', { runId: locked.runId, pausedRunId: locked.runId })
    }
    if (locked.sessionId === sessionId) {
      throw new WfError('该工作流正在本会话运行中，请先停止再运行', 'WF_LOCKED', { lockedSessionId: locked.sessionId })
    }
    throw new WfError('该工作流正在另一个会话中运行，请先停止后再试', 'WF_LOCKED', { lockedSessionId: locked.sessionId })
  }

  /**
   * 运行锁检查（resumeRun 用）：允许本会话 paused（恢复接管锁），拒绝
   * 跨会话锁定与本会话 running。与 assertFlowLockFree 一样用于开头护栏
   * 与登记前重检两处，保证并发恢复/启动不会产生同 flowId 双运行。
   */
  protected assertResumeLockFree(flowId: string, sessionId: string): void {
    const locked = this.flowLockInfo(flowId)
    if (!locked) return
    if (locked.sessionId !== sessionId) {
      throw new WfError('该工作流正在另一个会话中运行，请先停止后再试', 'WF_LOCKED', { lockedSessionId: locked.sessionId })
    }
    if (locked.status === 'running') {
      throw new WfError('该工作流正在本会话运行中，请先停止再运行', 'WF_LOCKED', { lockedSessionId: locked.sessionId })
    }
  }

  /** 读取 run 快照（深拷贝副本，防调用方改写内部状态）。 */
  runSnapshot(runId: string): RunSnapshot | null {
    const entry = this.runs.get(runId)
    return entry ? cloneSnapshot(entry.snapshot) : null
  }

  /** 取 run 内存条目本身（API 层会话归属校验用；调用方只读，不得改写内部状态）。 */
  entryFor(runId: string): RunEntry | null {
    return this.runs.get(runId) ?? null
  }

  /** childId → 运行位置反查（subagent/end 观察用；未登记返回 null）。 */
  childMetaFor(childId: string): ChildMeta | null {
    return this.childIndex.get(childId) ?? null
  }

  /**
   * 子代理 id → 其所属在编运行条目（childIndex 归属反查）。
   * 为什么提供方法而不是让调用方遍历 runs：运行表的定位口径（会话 + 工作流 + running）
   * 是运行时的内部知识，模块外只应表达「我要这个子代理的运行」。
   * 无登记记录、或对应运行已非 running 时返回 null。
   */
  runForChild(childId: string): RunEntry | null {
    const meta = this.childIndex.get(childId)
    if (!meta) return null
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId === meta.sessionId && s.flowId === meta.flowId && s.status === 'running') return entry
    }
    return null
  }

  // ---- 运行时读取 --------------------------------------------------------------

  /**
   * 触碰运行的空闲基准（工具层调用）：wf_ask_user 提问等长阻塞交互期间持续
   * 刷新 lastActiveAt，防止空闲看护（runIdleTimeoutMs）把等待用户的运行误判为空闲
   * 并自动停止。
   */
  touchRun(entry: RunEntry): void {
    entry.lastActiveAt = this.now()
  }

  /**
   * 按会话刷新运行的空闲基准（自主编排方案 §5.1，host 经 `agent/status` 事件调用）。
   * 为什么需要：父代理只在调用 wf_* 工具时刷新 lastActiveAt（runtime-execute.ts），
   * 规划/思考/读写文件期间父代理虽在干活却不刷新 → 长规划（> runIdleTimeoutMs，
   * 默认 30 分钟）会被空闲看护误判为空闲并自动 stopped。官方 `agent/status` 在父代理
   * 转为 running 时触发，据此把「父代理在干活」翻译成「运行不空闲」。
   * 只作用于本会话 status==='running' 的 run：paused 由看护自然跳过（watchdog 只扫
   * running），终态 run 已释放内存条目，均无需刷新。返回是否命中（便于断言/日志）。
   */
  touchRunForSession(sessionId: string): boolean {
    const id = String(sessionId ?? '')
    if (!id) return false
    let touched = false
    for (const entry of this.runs.values()) {
      const snapshot = entry.snapshot
      if (!snapshot || snapshot.sessionId !== id || snapshot.status !== 'running') continue
      this.touchRun(entry)
      touched = true
    }
    return touched
  }

  /** 重读当前（运行的）工作流最新快照：每节点执行前读一次，运行中调整即时生效（双向同步①）。 */
  async currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument> {
    try {
      // 模式二运行的服务文档在 services/ 目录，必须按 mode 分派读取；
      // 固定读 workflows/ 会让 mode2 运行「读错文档/读到 null 隐式回退」（Bug 20）。
      const raw = entry.snapshot.mode === 'mode2'
        ? await this.deps.store.getServiceAsFlow(entry.snapshot.flowId)
        : await this.deps.store.getWorkflow(entry.snapshot.sessionId, entry.snapshot.flowId)
      if (raw) return raw
    } catch {
      // 读失败回退起始快照
    }
    return entry.baseFlow
  }

  /**
   * 刷新实例保存后的运行编排基线（双向同步①「画布→编排」的闭环补全）：
   * 保存后若**编排语义确有变更**（flow-diff 判定，纯坐标拖动/Team 卡片缩放等几何改动不算），
   * 且该 run 正在运行（running），立即向父代理注入【编排变更】通知（steer 插队优先，
   * 父代理空闲时 followupRoot 唤醒），父代理据此重新召回实例骨架并调整后续编排。
   *
   * 为什么基线是内存事实而不是落盘副本：那份 orchestrations/<runId>.json 副本的唯一用途
   * 曾是「给父代理 read 一份只读快照」；改用 wf_org_catalog 的 instance 通道召回后它失去
   * 消费者，故收敛为 RunEntry 上的内存基线（单一事实源，不再有「副本与画布漂移」这一整类问题）。
   * 拓扑本身由 currentResolvedFlow 每次显式重读最新实例文档，不依赖任何快照副本。
   *
   * 暂停中的 run 只更新基线、不注入（不打断暂停态，恢复时按最新拓扑续跑）。
   * 幂等：无活跃 run 时为空操作；不打断正在执行的子代理。
   */
  async refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void> {
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.flowId !== flowId || s.sessionId !== sessionId) continue
      if (s.status !== 'running' && s.status !== 'paused') continue
      // 编排变更判定：与「本 run 上一次同步的拓扑」比较。基线缺失（尚未初始化）按已变更处理
      // ——宁可多注入一次通知，也不漏掉一次真实变更。
      const previous = entry.lastSyncedFlow
      const semanticallyChanged = previous ? summarizeFlowChange(previous, flow).changed : true
      entry.lastSyncedFlow = flow
      if (!semanticallyChanged) {
        this.log().debug(`[visual-workflow] 画布保存仅几何改动，不注入编排变更：run=${s.id}`)
        continue
      }
      if (s.status !== 'running') continue
      this.notifyOrchestrationChange(entry)
    }
  }

  /**
   * 向父代理注入【编排变更】通知（运行中画布保存且编排语义变更时调用）。
   * 通道选择（用户裁决）：父代理回合进行中（status='running'）且具备 steer → 插队
   * 注入（下一步边界即见，与 wf_send_message 超时通知同通道）；否则用 followupRoot 唤醒
   * （父代理空闲时也能收到）。注入失败仅告警，绝不阻断画布保存主流程。
   */
  protected notifyOrchestrationChange(entry: RunEntry): void {
    const sessionId = entry.snapshot.sessionId
    try {
      const root = this.deps.agents.getRootAgent(sessionId)
      if (!root) {
        this.log().warn('[visual-workflow] 编排变更通知失败：父代理未激活')
        return
      }
      const text = orchestrationChangeTextOf(
        entry.snapshot.systemLanguage ?? this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
      )
      const id = this.deps.uuid?.() ?? randomUUID()
      if (root.status === 'running' && typeof root.steer === 'function') {
        root.steer(coordinatorMessage(id, text, 'visual-workflow'))
      } else {
        this.deps.agents.followupRoot(root, {
          id,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })
      }
      this.log().info(`[visual-workflow] 已向父代理注入编排变更通知：run=${entry.snapshot.id} flow=${entry.snapshot.flowId}`)
    } catch (error) {
      this.log().warn(`[visual-workflow] 编排变更通知注入失败：${messageOf(error)}`)
    }
  }

  // ---- 清理 -------------------------------------------------------------------

  /**
   * 清理运行时资源（插件卸载/Service dispose，幂等）：
   * 中止全部运行（阻塞等待随之 reject）并清空内存表。
   * 快照不在此写终态——**已落盘**的 running/paused 记录由下次启动 reconcileStaleRuns
   * 标记为 interrupted（可恢复）；尚未落盘就进入 dispose 的记录（例如 resumeRun 在
   * persistWarn 之前被中止）内存条目直接丢弃，磁盘上不留痕，故既非 interrupted 也不可恢复。
   */
  dispose(): void {
    this.disposed = true
    for (const entry of this.runs.values()) {
      try {
        entry.controller.abort('visual-workflow plugin disposed')
      } catch {
        // 忽略清理期错误
      }
      this.rejectWaiters(entry)
    }
    this.runs.clear()
    this.childIndex.clear()
    this.adopting.clear()
    this.resuming.clear()
  }

  // ---- 内部辅助 ---------------------------------------------------------------

  /**
   * 释放某运行的内存条目（终态收尾路径唯一入口）：清运行表项 + **连带退役该运行的
   * 子代理归属索引**（childIndex / childByNode）。
   *
   * 为什么必须连带清子代理归属：这两张表是「子代理 id → 所属运行/节点」的全局归属事实。
   * 只删运行表项会让旧归属永久残留，于是同一会话重新起跑（resumeRun 接管同 flowId）后：
   *   - `childIndex` 里旧 run 的 child 因 sessionId/flowId 与新 run 相同而**通过越权校验**，
   *     仍可发起协作消息（投递到已废弃的子代理会话）；
   *   - `childByNode` 仍指向旧 child，节点寻址会命中过期执行者。
   * 归属随运行条目同生共死，是这两张表唯一自洽的回收条件（宿主 dispose 另有兜底清表）。
   */
  protected releaseRunMemory(runId: string): void {
    const snapshot = this.runs.get(runId)?.snapshot
    this.runs.delete(runId)
    if (!snapshot) return
    for (const [childId, meta] of [...this.childIndex]) {
      if (meta.sessionId !== snapshot.sessionId || meta.flowId !== snapshot.flowId) continue
      this.childIndex.delete(childId)
      // 同节点可能已被更新的 child 重新登记（配置签名变化）：只在指向本 child 时清映射
      if (this.childByNode.get(meta.nodeId) === childId) this.childByNode.delete(meta.nodeId)
    }
  }

  /** 拒绝某运行的全部阻塞等待器（终止/卸载路径）。 */
  protected rejectWaiters(entry: RunEntry): void {
    for (const waiter of entry.waiters.values()) {
      waiter.reject(new WfError('WF_CANCELLED: the run has been stopped', 'WF_CANCELLED'))
    }
    entry.waiters.clear()
  }

  /** 持久化 run 快照（尽力而为：失败仅告警，不阻断状态机）。 */
  protected async persistWarn(entry: RunEntry): Promise<void> {
    try {
      await this.deps.store.saveRun(entry.snapshot)
    } catch (error) {
      this.log().warn(`[visual-workflow] run record save failed: ${messageOf(error)}`)
    }
  }
}

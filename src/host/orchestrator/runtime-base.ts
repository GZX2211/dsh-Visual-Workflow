// src/host/orchestrator/runtime-base.ts
//
// 编排运行时继承链基类（RuntimeBase）：承载全部字段、基础工具、运行查询、
// 运行时读取、清理与内部辅助。方法体与拆分前逐字一致（零逻辑修改）；
// 可见性自 private 放宽为 protected 仅因跨文件继承协作（编译产物不变）。
//
// 继承链：RuntimeBase ← RuntimeLaunch ← RuntimeExecute ← RuntimeComm ←
// RuntimeObserve ← RuntimeLifecycle ← OrchestratorRuntime（runtime.ts 收口）。

import { resolveRolePrompt } from '../agent/runner.js'
import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot, RunStatus } from '../shared/types.js'
import { cloneSnapshot } from './snapshot.js'
import {
  WfError,
  type ChildMeta,
  type FlowLockInfo,
  type OrchestratorLogger,
  type RootAgentLike,
  type TurnEndInfo,
  consoleLogger,
} from './seams.js'
import type { OrchestratorDeps, RunEntry } from './run-types.js'
import { messageOf } from './helpers.js'

export class RuntimeBase {
  /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
  readonly runs = new Map<string, RunEntry>()
  /** childId → 运行位置反查（subagent/end 观察回写用）。 */
  protected readonly childIndex = new Map<string, ChildMeta>()
  /** nodeId → childId 反向索引（wf_ask_agent 节点 id 寻址 O(1)，P2-4）。 */
  protected readonly childByNode = new Map<string, string>()
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
    if (!this.deps.promptSetup || !this.deps.modelSelection) return
    const parentNode = flow.nodes.find((n): n is RoleNode => n.kind === 'parent')
    if (!parentNode) return
    try {
      // 角色 Prompt 实际注入文本（.md 路径设置时读取文件当前内容，与子代理一致）
      const rolePrompt = await resolveRolePrompt(parentNode)
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
   * 某会话的全部活跃 run（running/paused 均保留运行锁；返回 flowId/status/runId 摘要）。
   * 用途：工作台「进入时自动选中实例」——判断哪个实例正在运行（running 优先，
   * 否则 paused），从而在实例列表中优先展示运行中的实例（图2 交互改造补充需求）。
   */
  activeRunsForSession(sessionId: string): Array<{ flowId: string; status: RunStatus; runId: string }> {
    const out: Array<{ flowId: string; status: RunStatus; runId: string }> = []
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId !== sessionId) continue
      if (s.status !== 'running' && s.status !== 'paused') continue
      out.push({ flowId: s.flowId, status: s.status, runId: s.id })
    }
    return out
  }

  /** 某会话+工作流的暂停 run（断点恢复入口）。 */
  pausedRun(sessionId: string, flowId: string): RunEntry | null {
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.status === 'paused' && s.sessionId === sessionId && s.flowId === flowId) return entry
    }
    return null
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


  // ---- 运行时读取 --------------------------------------------------------------

  /**
   * 触碰运行的空闲基准（工具层调用）：wf_ask 提问等长阻塞交互期间持续
   * 刷新 lastActiveAt，防止空闲看护（runIdleTimeoutMs）把等待用户的运行误判为空闲
   * 并自动停止。
   */
  touchRun(entry: RunEntry): void {
    entry.lastActiveAt = this.now()
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
   * 刷新实例保存后的运行事实源（双向同步①「画布→编排」的闭环补全）：
   * 画布保存（putWorkflow/putService）会更新 workflows/services 目录，但运行
   * 事实源 orchestrations/<runId>.json 是 startRun 时的一次性快照——若不同步
   * 刷新，父代理（编排指令的 definitionPath 指向该文件）永远读到旧拓扑，
   * 新增节点/连线在运行中不可见（本缺陷已验证）。此处对属于该实例且处于
   * running/paused 的活跃 run，用最新保存内容重写其事实源文件。
   * 幂等：无活跃 run 时为空操作；不打断正在执行的子代理。
   */
  async refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void> {
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.flowId !== flowId || s.sessionId !== sessionId) continue
      if (s.status !== 'running' && s.status !== 'paused') continue
      try {
        await this.deps.store.saveOrchestration(s.id, flow)
        this.log().debug(`[visual-workflow] 运行事实源已随画布保存刷新：run=${s.id} flow=${flowId}`)
      } catch (error) {
        // 事实源刷新失败不阻断保存主流程（next 调度前 currentResolvedFlow 仍会
        // 显式重读最新实例，双向同步①的兜底路径生效）。
        this.log().warn(`[visual-workflow] 运行事实源刷新失败：${messageOf(error)}`)
      }
    }
  }

  // ---- 清理 -------------------------------------------------------------------

  /**
   * 清理运行时资源（插件卸载/Service dispose，幂等）：
   * 中止全部运行（阻塞等待随之 reject）并清空内存表。
   * 快照不在此写终态——磁盘上残留的 running/paused 由下次启动 reconcileStaleRuns
   * 标记为 interrupted（可恢复）。
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
      this.rejectAsks(entry)
    }
    this.runs.clear()
    this.childIndex.clear()
  }

  // ---- 内部辅助 ---------------------------------------------------------------

  /** 拒绝某运行的全部阻塞等待器（终止/卸载路径）。 */
  protected rejectWaiters(entry: RunEntry): void {
    for (const waiter of entry.waiters.values()) {
      waiter.reject(new WfError('该工作流已停止', 'WF_CANCELLED'))
    }
    entry.waiters.clear()
  }

  /** 拒绝某运行的全部挂起协作通信（终止/卸载路径：清计时器 + reject + 清表）。 */
  protected rejectAsks(entry: RunEntry, error: unknown = new WfError('该工作流已停止', 'WF_CANCELLED')): void {
    for (const pending of entry.asks.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    entry.asks.clear()
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
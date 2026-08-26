// src/host/orchestrator/runtime.ts
//
// 编排运行时：运行锁 / run 快照 / startRun / 编排指令注入 / subagent/end
// 观察回写 / 护栏 / currentResolvedFlow / terminate / 幂等收尾 / wait 阻塞 /
// 暂停门 / wf_ask_agent 三态通信。
//
// 语义要点：
//   - 零官方包运行时依赖：全部官方能力（子代理创建/followup/interrupt、事件
//     payload）经依赖注入缝（deps）接入，单测用 fake 替代；
//   - 官方 seam 事实：startContinuable 的 request.prompt 即首条 user 消息（创建
//     即开始推理）；followup(parent, childId, content, { source, signal }) 复用
//     派发；interrupt(childId, { kind:'user', parentSessionId }) 尽力中断；
//     'subagent/end' 观察 payload 携带 stopReason 与 lastAssistantMessage；
//     'agent/error' 携带 agent/turn/step/error（观察只读，字段运行时守卫）。
//
// 依赖注入缝（单测用 fake，真实适配在宿主装配层）：
//   - NodeRunner.startNodeTask/interruptChild —— 节点子代理执行引擎；
//   - AgentHost —— 父代理（会话根 Agent）服务：available/getRootAgent/followupRoot/
//     latestTurnEnd/childRunning。
//
// 运行锁：不设独立锁表——以 runs 内存表为单一事实源，flowLockInfo 扫描
// status ∈ {running, paused} 的 run；暂停保留锁、收尾/终止自然释放。

import { randomUUID } from 'node:crypto'
import { buildOrchestrationDirective, type OrchestrationDirectiveParams } from '../prompts/orchestration.js'
import { buildNodeTaskBlock } from '../prompts/node-task.js'
import { ctxInEdges, dbInEdges, nodeById } from '../graph/model.js'
import { validateFlow } from '../graph/validate.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot, RunStatus } from '../shared/types.js'
import { WF_RUN_NODE_WAIT } from '../shared/protocol.js'
import { buildResumedSnapshot, findResumableRun, type ResumeInput, type ResumeResult } from './resume.js'
import {
  OUTPUT_SUMMARY_LIMIT,
  createRunSnapshot,
  lastAssistantText,
  cloneSnapshot,
  setNodeStatus,
  statusText,
  terminalizeNodes,
  truncateText,
} from './snapshot.js'

// ---------------------------------------------------------------------------
// 常量与错误
// ---------------------------------------------------------------------------

/** 单次运行 wf_run_node 调用总上限（编排护栏）。 */
export const GLOBAL_RUN_CALL_LIMIT = 500

/**
 * subagent/end 迟到缓冲参数：childIndex 登记的窗口（startNodeTask 派发 → 编排器
 * 拿到 childId 登记）只有数个事件循环轮转，10ms × 20 次 = 200ms 远宽于窗口，
 * 同时有界（不无限重试；超限告警丢弃，避免无主事件常驻）。
 */
const SUBAGENT_END_RETRY_DELAY_MS = 10
const SUBAGENT_END_RETRY_MAX = 20

/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export class WfError extends Error {
  readonly code: string
  constructor(message: string, code: string, extras?: Record<string, unknown>) {
    super(message)
    this.name = 'WfError'
    this.code = code
    if (extras) Object.assign(this, extras)
  }
}

// ---------------------------------------------------------------------------
// 依赖缝（DI seams；单测 fake / index.ts 真实适配）
// ---------------------------------------------------------------------------

/** 节点子代理执行引擎（startContinuable 创建/签名复用/followup 派发）。 */
export interface NodeRunner {
  /**
   * 启动（或复用）一个角色节点的子代理并派发本轮任务。
   * 首条创建即开始推理（官方 startContinuable 语义）；复用经 followup 派发。
   * 立即返回，不等待子代理完成——完成事件经 subagent/end 观察。
   */
  startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }>
  /** 尽力中断某子代理当前回合（保留会话；官方 interrupt 语义）。 */
  interruptChild(childId: string, sessionId: string): Promise<void>
  /**
   * 消费软截停标记（护栏）：该 child 最近一次任务是否触达 ReAct 迭代上限
   * （消费后清除）。触达上限仍正常产出——节点标记 react-capped（非失败）。
   */
  consumeReactCapped?(childId: string): boolean
}

/** 节点任务启动入参（任务块与节点级参数，经子代理引擎透传官方配置）。 */
export interface NodeStartInput {
  sessionId: string
  flowId: string
  /** 已解析为角色主节点的节点（虚拟节点在进入本缝前解析）。 */
  node: GraphNode
  /** 任务块（首条 prompt / followup 内容）。 */
  blocks: Array<{ type: 'text'; text: string }>
  /** 运行级取消信号（运行停止/终止/插件卸载）。 */
  signal: AbortSignal
  /** 节点级思考强度覆盖（缺省继承节点配置；取值域以官方为准）。 */
  thinking?: string
  /** 节点级 ReAct 迭代上限覆盖（缺省继承节点配置）。 */
  iterationLimit?: number
    /** 协作组 Prompt（组卡片 data.collabPrompt；非组内成员为空字符串）。 */
    collabPrompt?: string
}

/** 注入父代理的 followup 消息（官方 Message 契约：必须带 id 与 source，否则父回合失败）。 */
export interface RootInjectedMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/**
 * 协作通信消息（wf_ask_agent 投递/通知用）：source 使用官方「merge-extensible」
 * 扩展 kind（'coordinator' 不在官方 MessageSourceMap 内，官方消费端按未知 kind
 * fall-through，与旧项目 relay 语义一致）。
 */
export interface CoordinatorMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'coordinator'; form: 'relay'; senderSessionId: string }
}

/** 会话根 Agent 的结构化最小形状（零官方类型依赖；运行时守卫）。 */
export interface RootAgentLike {
  id: string
  status?: string
  followup?: (message: RootInjectedMessage) => void
  steer?: (message: CoordinatorMessage) => void
  session?: { events?: unknown[] }
}

/** 父代理回合终态（看护用；error=编排已死，aborted=用户取消）。 */
export type TurnEndInfo = { kind: 'error'; error: unknown } | { kind: 'aborted' }

/** 父代理侧宿主能力（会话根 Agent 服务；index.ts 的 CordisAgentHost 实现）。 */
export interface AgentHost {
  /** agents 服务是否可用。 */
  available(): boolean
  /** 取会话根 Agent；未激活返回 null。 */
  getRootAgent(sessionId: string): RootAgentLike | null
  /** followup 一次性注入 + 唤醒父代理（消息必须带 id/source，见 RootInjectedMessage）。 */
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void
  /** 根 Agent 会话在 afterMs 之后的最新 turn/end（无则 null；看护权威检测）。 */
  latestTurnEnd(sessionId: string, afterMs: number): TurnEndInfo | null
  /** 某子代理是否仍在运行（看护 inflight 自愈；查询失败保守返回 true）。 */
  childRunning(childId: string): boolean
}

/** 编排器配置子集（来自 Host Config，默认值与 cordis.patch.yml 一致）。 */
export interface OrchestratorConfig {
  /** 节点完整输出持久化字节上限（断点/上下文传递用）。 */
  outputFullLimit: number
  /** 文本文件内容注入上下文字符上限。 */
  documentTextLimit: number
  /** 运行空闲超时毫秒数（无 in-flight 时看护门限）。 */
  runIdleTimeoutMs: number
  /** 单节点回流重试次数默认上限（节点未配置时兜底）。 */
  retryLimitDefault: number
  /** ReAct 迭代次数默认上限（节点未配置时兜底）。 */
  reactIterationLimitDefault: number
  /** wf_ask_agent 阻塞通信超时毫秒数（超时后注入父代理裁决）。 */
  wfAskAgentTimeoutMs: number
}

/** 日志缝（默认 console；单测注入收集器断言 warn 路径）。 */
export interface OrchestratorLogger {
  warn: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

const consoleLogger: OrchestratorLogger = {
  warn: (message, ...args) => console.warn(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
}

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------

/** 单次运行的内存条目（旧项目 entry 同构：快照 + 护栏计数 + in-flight 表）。 */
export interface RunEntry {
  /** 运行级取消控制器（停止/终止/插件卸载时 abort；阻塞中的 wait/提问随之取消）。 */
  controller: AbortController
  /** 运行快照（状态机事实源；持久化副本经 store.saveRun）。 */
  snapshot: RunSnapshot
  /** 起始工作流（currentResolvedFlow 读失败时的回退）。 */
  baseFlow: WorkflowDocument
  /** 运行中的子代理 childId 集合（空闲看护据此不判空闲）。 */
  inflight: Set<string>
  /** nodeId → 已调用次数（回流重试硬护栏）。 */
  attempts: Map<string, number>
  /** wf_run_node 总调用数（全局硬护栏）。 */
  callCount: number
  /** 最近活动时间戳（空闲看护基准）。 */
  lastActiveAt: number
  /** 阻塞等待表：`${runId}:${nodeId}` → waiter（wait:true 路径）。 */
  waiters: Map<string, Waiter>
  /** 挂起协作通信表：askId → PendingAsk（wf_ask_agent 路径）。 */
  asks: Map<string, PendingAsk>
}

/** wait:true 的阻塞等待器（subagent/end 唤醒 resolve；终止/取消 reject）。 */
interface Waiter {
  promise: Promise<RunNodeResult>
  resolve: (result: RunNodeResult) => void
  reject: (error: unknown) => void
}

/** 创建挂起等待器（resolve/reject 闭合到 promise）。 */
function createWaiter(): Waiter {
  let resolve!: (result: RunNodeResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<RunNodeResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 运行锁信息（flowLockInfo 结果；暂停保留锁，status 供消息区分）。 */
export interface FlowLockInfo {
  flowId: string
  sessionId: string
  runId: string
  flowName: string
  status: RunStatus
}

/** 工具调用方身份（工具层从 exec 派生：isChild 与 sessionId）。 */
export interface CallerInfo {
  /** 调用者是否子代理（子代理禁止调度/收尾）。 */
  isChild: boolean
  /** 调用者会话 id（根 Agent 的会话）。 */
  sessionId: string
}

// ---------------------------------------------------------------------------
// wf_ask_agent 通信协议（ask/reply/resolve 三态）
// ---------------------------------------------------------------------------

/** wf_ask_agent 三态命令。 */
export type AskAgentCmd = 'ask' | 'reply' | 'resolve'

/** resolve 三动作：continue 重启计时 / resend 重发 / abort 终止。 */
export type ResolveAction = 'continue' | 'resend' | 'abort'

/** wf_ask_agent 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface AskAgentArgs {
  cmd?: unknown
  targetChildId?: unknown
  askId?: unknown
  message?: unknown
  action?: unknown
}

/** wf_ask_agent 返回（cmd 恒为本次调用的命令；ask 挂起结束时携带回复）。 */
export interface AskAgentResult {
  cmd: 'ask' | 'reply' | 'resolve'
  askId?: string
  from?: string
  to?: string
  reply?: string
  action?: ResolveAction
}

/** 协作消息投递缝（真实实现 = 在线 steer / 冷态 followup；单测 fake）。 */
export interface AskAgentDelivery {
  /** 投递协作消息到目标子代理（在线 steer；离线冷恢复 followup，由实现选择）。 */
  deliver(input: { sessionId: string; to: string; message: CoordinatorMessage; signal?: AbortSignal }): Promise<void>
  /** 把超时详情通知父代理（steer 注入，父代理回合内征询用户并 resolve）。 */
  notifyParent(input: { sessionId: string; message: CoordinatorMessage }): void
}

/** 审计事件单条（at 为 ISO 时间；detail 为事件附注）。 */
export interface AskAuditEntry {
  at: string
  event: string
  detail: string
}

/** 挂起的协作通信记录（注册于 RunEntry.asks；A 的阻塞等待由此驱动）。 */
export interface PendingAsk {
  askId: string
  from: string
  to: string
  fromNodeId: string
  toNodeId: string
  message: string
  timeoutMs: number
  expiresAt: number
  state: 'pending' | 'timed-out' | 'resolved' | 'aborted'
  audit: AskAuditEntry[]
  promise: Promise<AskAgentResult>
  resolve: (result: AskAgentResult) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
  delivery: AskAgentDelivery
}

/** 协作消息文本长度上限（防御性截断）。 */
export const ASK_MESSAGE_LIMIT = 20000

/** 构造协作消息（steer/followup 共用；senderSessionId = 发起者会话 id）。 */
export function coordinatorMessage(id: string, text: string, senderSessionId: string): CoordinatorMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'coordinator', form: 'relay', senderSessionId },
  }
}

/** 投递给目标子代理的消息文本（含 askId 与回复指令，业务中文）。 */
export function buildAskText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message'>): string {
  return [
    `[协作通信] 同工作流节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向你发送协作消息（askId: ${pending.askId}）：`,
    pending.message,
    '',
    `请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "${pending.from}", askId: "${pending.askId}", message: "<你的回复文本>" })，回复会解除对方的阻塞等待。`,
  ].join('\n')
}

/** 超时通知父代理的消息文本（父代理据此征询用户并 resolve）。 */
export function buildTimeoutText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message' | 'timeoutMs'>): string {
  const seconds = Math.max(1, Math.round(pending.timeoutMs / 1000))
  return [
    `[协作通信超时] 节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向「${pending.toNodeId}」（会话 ${pending.to}）的协作消息超过 ${seconds} 秒未获回复：`,
    `- askId: ${pending.askId}`,
    `- 消息内容: ${pending.message}`,
    `请用 ask_user_question 向用户征询处理方式（继续等待 / 重发消息 / 终止通信），然后调用 wf_ask_agent({ cmd: "resolve", askId: "${pending.askId}", action: "continue" | "resend" | "abort" })。abort 时发起者会收到超时错误并继续执行。`,
  ].join('\n')
}

/** wf_run_node 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface RunNodeArgs {
  nodeId?: unknown
  wait?: unknown
  thinking?: unknown
  iterationLimit?: unknown
  retryLimit?: unknown
}

/** wf_run_node 返回（三条路径：started 异步 / paused 暂停门 / ok|fail wait 阻塞）。 */
export interface RunNodeResult {
  nodeId: string
  status: 'started' | 'paused' | 'ok' | 'fail'
  childId?: string
  output?: string
}

/** 官方 subagent/end 观察 payload（全字段可选，运行时守卫）。 */
export interface SubagentEndInfo {
  runId?: unknown
  provider?: unknown
  id?: unknown
  local?: unknown
  stopReason?: unknown
  lastAssistantMessage?: unknown
}

/** 子代理归属反查记录（childId → 运行位置；wfRunNode 启动成功后登记）。 */
interface ChildMeta {
  sessionId: string
  flowId: string
  nodeId: string
}

// ---------------------------------------------------------------------------
// 编排运行时
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  /** 数据层（FlowStore）。 */
  store: FlowStore
  /** 节点子代理执行引擎（单测 fake）。 */
  runner: NodeRunner
  /** 父代理宿主能力（index.ts 的 CordisAgentHost；单测 fake）。 */
  agents: AgentHost
  /** 配置子集。 */
  config: OrchestratorConfig
  /** 日志（缺省 console）。 */
  logger?: OrchestratorLogger
  /** 时钟注入（单测可控；缺省 Date.now）。 */
  now?: () => number
  /** runId 生成注入（缺省 run-<base36 时间戳>-<随机段>）。 */
  newRunId?: () => string
  /** 消息 id 生成注入（缺省 randomUUID）。 */
  uuid?: () => string
}

export interface StartRunOptions {
  /** 运行模式（缺省 mode1；模式二由服务管理器传入 mode2）。 */
  mode?: 'mode1' | 'mode2'
  /** 模式二：本次外部请求的用户问题（注入输入节点产出 + 编排指令动态段）。 */
  question?: string
}

export interface StartRunResult {
  runId: string
  /** 流程事实源文件绝对路径（编排指令 facts.definitionPath）。 */
  defPath: string
}

export interface FinishArgs {
  status?: unknown
  summary?: unknown
}

export interface FinishResult {
  ok: true
  runId: string
  status: RunStatus
  /** 已终止运行的幂等收尾标记。 */
  idempotent?: boolean
}

export interface TerminateOptions {
  status: 'stopped' | 'failed'
  summary: string
  abortReason?: string
}

/** 数据库连线提示（面向模型英文）。 */
const DB_TOOL_HINT =
  'Database nodes are connected via db-in edges. Access them only through wf_db_query: ' +
  'mode "search" (vector retrieval), mode "query" (read-only SELECT with LIMIT), mode "schema" (table structure). ' +
  'Never read database files directly.'

/**
 * 编排运行时：模式一「父代理编排」执行引擎的全部内存状态与状态机。
 * 每个实例由 Host service 持有（index.ts 装配）；单测可独立构造 fake 依赖。
 */
export class OrchestratorRuntime {
  /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
  readonly runs = new Map<string, RunEntry>()
  /** childId → 运行位置反查（subagent/end 观察回写用）。 */
  private readonly childIndex = new Map<string, ChildMeta>()
  /** dispose 标记：置位后迟到事件缓冲不再重试（插件卸载清理彻底）。 */
  private disposed = false

  constructor(private readonly deps: OrchestratorDeps) {}

  // ---- 基础工具 -------------------------------------------------------------

  private log(): OrchestratorLogger {
    return this.deps.logger ?? consoleLogger
  }

  /** 当前时间戳（时钟注入）。 */
  now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** 当前 ISO 时间字符串。 */
  private isoNow(): string {
    return new Date(this.now()).toISOString()
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
  private assertFlowLockFree(flowId: string, sessionId: string): void {
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
  private assertResumeLockFree(flowId: string, sessionId: string): void {
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

  // ---- 编排启动 --------------------------------------------------------------

  /**
   * 启动一次「父代理编排」运行（模式一入口）。
   * 流程：校验 → 运行锁 → 建 run 状态 → 写流程事实源文件 → 构造编排指令 →
   * followup 一次性注入+唤醒父代理 → 开始即落盘（崩溃后历史可追溯）。
   */
  async startRun(input: { sessionId: string; flowId: string } & StartRunOptions): Promise<StartRunResult> {
    const sessionId = String(input.sessionId ?? '')
    const flowId = String(input.flowId ?? '')
    const mode = input.mode ?? 'mode1'
    if (!sessionId || !flowId) throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS')

    // 运行锁护栏：跨会话冲突 / 同会话重复 / 暂停保留锁
    // （登记前还会在同一同步块内重检一次，见 runs.set 前注释——杜绝并发双运行）
    this.assertFlowLockFree(flowId, sessionId)

    const flow = mode === 'mode2'
      ? await this.deps.store.getServiceAsFlow(flowId)
      : await this.deps.store.getWorkflow(sessionId, flowId)
    if (!flow) throw new WfError(mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND')

    // 运行前完整性：启动/输入与结束/输出必须齐备（保存中间态与运行分离）
    const missing = missingStageLabels(flow)
    if (missing.length > 0) {
      throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE')
    }
    const validation = validateFlowForRun(flow)
    if (validation !== null) throw validation

    if (!this.deps.agents.available()) {
      throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE')
    }
    const root = this.deps.agents.getRootAgent(sessionId)
    if (!root) throw new WfError('当前会话 Agent 未激活；请先在对话区发送一条消息后重试', 'WF_ROOT_INACTIVE')
    if (root.status === 'running') throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY')

    const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot = createRunSnapshot({ runId, flow, sessionId, mode, now: this.now() })
    // 模式二：用户问题注入输入节点产出（无需连线即作为初始上下文；
    // 右出 ctx 连线经 buildNodeBlocks 的 start 源分支显式传递给下游）
    const question = typeof input.question === 'string' ? input.question.trim() : ''
    if (mode === 'mode2' && question) {
      const inputNode = flow.nodes.find((n) => n.kind === 'start')
      if (inputNode) {
        setNodeStatus(snapshot, inputNode.id, 'ok', {
          output: question,
          outputFullLimit: this.deps.config.outputFullLimit,
          now: this.now(),
        })
      }
    }
    const entry: RunEntry = {
      controller: new AbortController(),
      snapshot,
      baseFlow: flow,
      inflight: new Set(),
      attempts: new Map(),
      callCount: 0,
      lastActiveAt: this.now(),
      waiters: new Map(),
      asks: new Map(),
    }
    // 运行锁登记（check-then-act 竞态收口）：并发 startRun 可能已在本请求的
    // await 期间登记了同一 flowId 的 run。此处重检 + runs.set 在同一同步块内
    // 完成（Node 单线程内无交错），保证同工作流最多一个激活 run。
    this.assertFlowLockFree(flowId, sessionId)
    this.runs.set(runId, entry)

    // 流程事实源文件（父代理可 read，只读；defPath 注入编排指令）
    const defPath = this.deps.store.orchestrationFilePath(runId)
    try {
      await this.deps.store.saveOrchestration(runId, flow)
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED')
    }

    // 一次性注入 + 唤醒：官方 Message 契约要求 id 与 source 齐备（缺 source 父回合
    // 以 UNKNOWN 失败——旧项目根因复盘结论，必须保留）。
    const directive = buildOrchestrationDirective(directiveParams(flow, defPath, mode, { question }))
    try {
      this.deps.agents.followupRoot(root, {
        id: this.deps.uuid?.() ?? randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: directive }],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`编排指令注入失败：${messageOf(error)}`, 'WF_INJECT_FAILED')
    }

    // 运行记录：开始即落盘（中断/崩溃后历史面板仍有记录）
    await this.persistWarn(entry)
    return { runId, defPath }
  }

  // ---- 断点续跑（resumeRun） --------------------------------------------------

  /**
   * 断点续跑：从 paused/interrupted 的旧 run 创建新 run（resumedFromRunId 继承链）。
   * 已 ok/react-capped 节点继承状态与完整产出（resumed 标记，不重跑），其余节点
   * 回退 pending 重新执行；断点产出随继承快照重新可用（后续节点 ctx 注入直接用
   * 新快照，无需额外回填通道）。
   * 旧 paused 记录保留在磁盘历史（状态不变），内存条目释放——运行锁随新 run 接管。
   */
  async resumeRun(input: ResumeInput): Promise<ResumeResult> {
    const sessionId = String(input.sessionId ?? '')
    const flowId = String(input.flowId ?? '')
    if (!sessionId || !flowId) throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS')

    const prev = await findResumableRun(this.deps.store, { sessionId, flowId, fromRunId: input.fromRunId })
    if (!prev) {
      if (input.fromRunId) {
        const run = await this.deps.store.getRun(input.fromRunId)
        if (run && (run.sessionId !== sessionId || run.flowId !== flowId)) {
          throw new WfError('指定的运行不属于该工作流', 'WF_BAD_ARGS', { runId: input.fromRunId })
        }
        throw new WfError(
          run ? `该运行已${statusText(run.status)}，无法恢复` : '指定的运行不存在',
          run ? 'WF_NOT_RESUMABLE' : 'WF_NOT_FOUND',
          { runId: input.fromRunId },
        )
      }
      throw new WfError('该工作流没有可恢复的断点（暂停或中断记录）', 'WF_NO_RESUME_POINT')
    }

    // 运行锁护栏：同会话 paused 允许恢复（启动后锁移交新 run）；其余冲突拒绝
    // （登记前还会在同一同步块内重检一次，见 runs.set 前注释）
    this.assertResumeLockFree(flowId, sessionId)

    const flow = prev.mode === 'mode2'
      ? await this.deps.store.getServiceAsFlow(flowId)
      : await this.deps.store.getWorkflow(sessionId, flowId)
    if (!flow) throw new WfError(prev.mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND')

    // 运行前完整性（与全新启动同一套校验）
    const missing = missingStageLabels(flow)
    if (missing.length > 0) {
      throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE')
    }
    const validation = validateFlowForRun(flow)
    if (validation !== null) throw validation

    if (!this.deps.agents.available()) {
      throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE')
    }
    const root = this.deps.agents.getRootAgent(sessionId)
    if (!root) throw new WfError('当前会话 Agent 未激活；请先在对话区发送一条消息后重试', 'WF_ROOT_INACTIVE')
    if (root.status === 'running') throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY')

    const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot = buildResumedSnapshot({ prev, runId, flow, sessionId, mode: prev.mode, now: this.now() })
    const entry: RunEntry = {
      controller: new AbortController(),
      snapshot,
      baseFlow: flow,
      inflight: new Set(),
      attempts: new Map(),
      callCount: 0,
      lastActiveAt: this.now(),
      waiters: new Map(),
      asks: new Map(),
    }
    // 运行锁登记（check-then-act 竞态收口）：并发 resumeRun/startRun 可能已在本
    // 请求的 await 期间登记同一 flowId 的 run；重检 + 写入同一同步块内完成。
    this.assertResumeLockFree(flowId, sessionId)
    this.runs.set(runId, entry)

    // 流程事实源文件（同 startRun；defPath 注入编排指令）
    const defPath = this.deps.store.orchestrationFilePath(runId)
    try {
      await this.deps.store.saveOrchestration(runId, flow)
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED')
    }

    // 断点继续指令：isResume 动态态注入末段（已 ok 不重跑；从 resumeFromNodeId 继续）
    const directive = buildOrchestrationDirective(
      directiveParams(flow, defPath, prev.mode, {
        resume: { resumeFromNodeId: prev.resumeFromNodeId, resumedFromRunId: prev.id },
      }),
    )
    try {
      this.deps.agents.followupRoot(root, {
        id: this.deps.uuid?.() ?? randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: directive }],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`编排指令注入失败：${messageOf(error)}`, 'WF_INJECT_FAILED')
    }

    await this.persistWarn(entry)

    // 释放同工作流的旧 paused 内存条目（磁盘历史保留；锁随新 run 接管）
    for (const [oldId, oldEntry] of [...this.runs]) {
      const old = oldEntry.snapshot
      if (oldId !== runId && old.sessionId === sessionId && old.flowId === flowId && old.status === 'paused') {
        try {
          oldEntry.controller.abort('resumed')
        } catch {
          // 忽略清理期错误
        }
        this.rejectWaiters(oldEntry)
        this.rejectAsks(oldEntry)
        this.runs.delete(oldId)
      }
    }
    return { runId, defPath, resumedFromRunId: prev.id }
  }

  // ---- wf_run_node ----------------------------------------------------------

  /** 校验调用者为「当前会话根 Agent」且处于激活运行；返回 run entry。 */
  private requireActiveRootRun(caller: CallerInfo, toolName: string): RunEntry {
    if (caller.isChild) throw new WfError(`子代理无法调用 ${toolName}（仅当前会话主 Agent 可调度编排）`, 'WF_NOT_ROOT')
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
    const run = this.activeRunForSession(sessionId)
    if (!run) {
      // 会话曾运行但已结束/停止/暂停：给出更明确的终态提示（暂停保留锁，单独错误码供恢复入口）
      for (const entry of this.runs.values()) {
        const s = entry.snapshot
        if (s.sessionId !== sessionId || s.status === 'running') continue
        if (s.status === 'paused') {
          throw new WfError('该工作流已暂停，请先恢复运行', 'WF_PAUSED', { runId: s.id })
        }
        throw new WfError(`该工作流已${statusText(s.status)}，无法继续执行`, 'WF_STOPPED')
      }
      throw new WfError('当前没有正在运行的工作流编排（请先在画布点击「运行」）', 'WF_NO_ACTIVE_RUN')
    }
    if (run.snapshot.status === 'paused') {
      throw new WfError('该工作流已暂停，请先恢复运行', 'WF_PAUSED', { runId: run.snapshot.id })
    }
    if (run.snapshot.status !== 'running') {
      throw new WfError(`该工作流已${statusText(run.snapshot.status)}，无法继续执行`, 'WF_STOPPED')
    }
    return run
  }

  /**
   * wf_run_node：启动一个角色节点的子代理。
   *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
   *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
   *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）。
   */
  async wfRunNode(
    caller: CallerInfo,
    args: RunNodeArgs,
    callerSignal?: AbortSignal,
    options: { expectedMode?: 'mode1' | 'mode2' } = {},
  ): Promise<RunNodeResult> {
    const run = this.requireActiveRootRun(caller, options?.expectedMode === 'mode2' ? WF_RUN_NODE_WAIT : 'wf_run_node')
    // 模式与工具一一对应：wf_run_node 仅编排执行模式，wf_run_node_wait 仅后台服务模式
    if (options?.expectedMode && run.snapshot.mode !== options.expectedMode) {
      throw new WfError(
        options.expectedMode === 'mode2'
          ? 'wf_run_node_wait 只能在后台服务模式（mode2）中使用'
          : 'wf_run_node 只能在编排执行模式（mode1）中使用',
        'WF_MODE_MISMATCH',
      )
    }
    const nodeId = String(args?.nodeId ?? '').trim()
    if (!nodeId) throw new WfError('wf_run_node 需要参数 nodeId', 'WF_BAD_ARGS')
    if (run.controller.signal.aborted) throw new WfError('该工作流已停止', 'WF_CANCELLED')

    // 双向同步①：每次调度前重读最新工作流快照（运行中画布调整即时生效）
    const flow = await this.currentResolvedFlow(run)

    // 虚拟节点解析为主节点（共享同一子代理执行实例）
    let node = nodeById(flow, nodeId)
    if (!node) throw new WfError(`节点不存在或已从画布移除：${nodeId}`, 'WF_NODE_MISSING')
    if (node.kind === 'proxy') {
      const source = nodeById(flow, node.proxySourceId)
      if (!source) throw new WfError(`虚拟节点引用的主节点不存在：${node.proxySourceId}`, 'WF_NODE_MISSING')
      node = source
    }

    // 暂停门：暂停节点不派生子代理，run 置 paused + 断点持久化
    if (node.kind === 'pause') {
      run.callCount += 1
      if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
        throw new WfError(`编排执行超过全局调用上限（${GLOBAL_RUN_CALL_LIMIT} 次 wf_run_node）`, 'WF_GLOBAL_LIMIT')
      }
      run.lastActiveAt = this.now()
      setNodeStatus(run.snapshot, nodeId, 'ok', { attempts: 1, output: '（暂停门）暂停运行', now: this.now() })
      run.snapshot.status = 'paused'
      run.snapshot.resumeFromNodeId = nodeId
      await this.persistWarn(run)
      return { nodeId, status: 'paused' }
    }

    if (node.kind !== 'agent') {
      throw new WfError(`wf_run_node 只接受角色(agent)节点；「${labelOf(node)}」类型为 ${node.kind}`, 'WF_NODE_KIND')
    }

    // 虚拟节点解析后一切以主节点 key 记账（共享同一子代理执行实例与快照记录）
    const resolvedNodeId = node.id

    // 硬护栏：全局调用上限 + 单节点重试上限
    run.callCount += 1
    if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
      throw new WfError(`编排执行超过全局调用上限（${GLOBAL_RUN_CALL_LIMIT} 次 wf_run_node），自动停止`, 'WF_GLOBAL_LIMIT')
    }
    const attempt = (run.attempts.get(resolvedNodeId) ?? 0) + 1
    run.attempts.set(resolvedNodeId, attempt)
    const effectiveRetryLimit = effectiveRetryLimitOf(node, args, this.deps.config.retryLimitDefault)
    if (attempt > effectiveRetryLimit + 1) {
      throw new WfError(`节点「${labelOf(node)}」执行次数超过上限（最多 ${effectiveRetryLimit} 次重试）`, 'WF_RETRY_LIMIT')
    }
    const effectiveReactLimit = effectiveReactLimitOf(node, args, this.deps.config.reactIterationLimitDefault)
    const thinking = effectiveThinkingOf(node, args)
    run.lastActiveAt = this.now()

    setNodeStatus(run.snapshot, resolvedNodeId, 'running', { attempts: attempt, now: this.now() })
    const blocks = buildNodeBlocks({
      flow,
      node,
      snapshot: run.snapshot,
      documentTextLimit: this.deps.config.documentTextLimit,
      pauseNodeIds: pauseNodeIdsOf(flow),
      retryLimit: effectiveRetryLimit,
      reactLimit: effectiveReactLimit,
      runContextText: `runId=${run.snapshot.id}; attempt ${attempt}/${effectiveRetryLimit + 1}`,
    })

    // wait:true 阻塞等待器必须先于启动注册（subagent/end 可能在启动返回前到达）
    const waitRequested = args?.wait === true
    const waitKey = `${run.snapshot.id}:${resolvedNodeId}`
    let waiter: Waiter | null = null
    if (waitRequested) {
      if (run.waiters.has(waitKey)) {
        throw new WfError(`节点「${labelOf(node)}」已有阻塞等待中的执行`, 'WF_BUSY')
      }
      waiter = createWaiter()
      run.waiters.set(waitKey, waiter)
    }

    try {
      const { childId } = await this.deps.runner.startNodeTask({
        sessionId: run.snapshot.sessionId,
        flowId: run.snapshot.flowId,
        node,
        blocks,
        signal: run.controller.signal,
        collabPrompt: collabPromptOf(flow, node.id),
        ...(thinking !== undefined ? { thinking } : {}),
        ...(effectiveReactLimit !== undefined ? { iterationLimit: effectiveReactLimit } : {}),
      })
      run.inflight.add(childId)
      this.childIndex.set(childId, { sessionId: run.snapshot.sessionId, flowId: run.snapshot.flowId, nodeId: resolvedNodeId })
      if (!waitRequested) return { nodeId: resolvedNodeId, status: 'started', childId }
    } catch (error) {
      if (waiter) run.waiters.delete(waitKey)
      if (run.snapshot.status === 'running') setNodeStatus(run.snapshot, resolvedNodeId, 'fail', { attempts: attempt, now: this.now() })
      throw error
    }

    // wait 阻塞：等待 subagent/end 唤醒（完成）或运行终止/调用取消（reject）
    const onAbort = (): void => {
      run.waiters.delete(waitKey)
      waiter!.reject(new WfError('该工作流已停止', 'WF_CANCELLED'))
    }
    if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener('abort', onAbort, { once: true })
    else if (callerSignal?.aborted) onAbort()
    try {
      return await waiter!.promise
    } finally {
      callerSignal?.removeEventListener('abort', onAbort)
    }
  }

  // ---- wf_finish ------------------------------------------------------------

  /** wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。 */
  async wfFinish(caller: CallerInfo, args: FinishArgs): Promise<FinishResult> {
    if (caller.isChild) throw new WfError('子代理无法调用 wf_finish（仅当前会话主 Agent 可收尾编排）', 'WF_NOT_ROOT')
    const sessionId = caller.sessionId
    const run = sessionId ? this.activeRunForSession(sessionId) : null
    // 已停止/已完成的幂等：允许对已终止的同会话运行静默返回。
    // 终态条目已从内存释放（防内存膨胀），故幂等判定查磁盘历史（收尾调用频率极低）。
    if (!run) {
      try {
        for (const runId of await this.deps.store.listAllRunIds()) {
          const record = await this.deps.store.getRun(runId)
          if (record && record.sessionId === sessionId && record.status !== 'running') {
            return { ok: true, runId: record.id, status: record.status, idempotent: true }
          }
        }
      } catch {
        // 磁盘读失败按无历史处理
      }
      throw new WfError('当前没有正在运行的工作流编排', 'WF_NO_ACTIVE_RUN')
    }
    const snapshot = run.snapshot
    if (snapshot.status !== 'running') return { ok: true, runId: snapshot.id, status: snapshot.status, idempotent: true }
    const isFailed = args?.status === 'failed'
    snapshot.status = isFailed ? 'failed' : 'completed'
    snapshot.summary = String(args?.summary ?? '')
    snapshot.endedAt = this.isoNow()
    terminalizeNodes(snapshot, this.now())
    await this.persistWarn(run)
    // 收尾完成即释放内存条目（终态已持久化；运行锁随状态自然释放）
    this.runs.delete(snapshot.id)
    return { ok: true, runId: snapshot.id, status: snapshot.status }
  }

  // ---- wf_ask_agent ----------------------------------------------------------

  /** 校验调用者会话存在运行且 running（ask/reply/resolve 共用；子代理不在此拒绝）。 */
  private requireRunningRun(caller: CallerInfo): RunEntry {
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
    const run = this.activeRunForSession(sessionId)
    if (!run) throw new WfError('当前没有正在运行的工作流编排', 'WF_NO_ACTIVE_RUN')
    if (run.snapshot.status !== 'running') {
      throw new WfError(`该工作流已${statusText(run.snapshot.status)}，无法继续通信`, 'WF_STOPPED')
    }
    return run
  }

  /**
   * wf_ask_agent：Agent 间阻塞通信（ask/reply/resolve 三态协议）。
   *   - ask：子代理 A 向同运行节点子代理 B 发起协作消息并阻塞等待回复；
   *     投递经 delivery 缝（在线 steer 插队 / 冷态 followup 冷恢复）；
   *   - reply：目标 B 回复，解除 A 的阻塞（工具结果 = 回复文本）；
   *   - resolve：父代理对超时 ask 裁决（continue 重启计时 / resend 重发 / abort
   *     让 A 以超时错误继续）。
   * 强校验（越权拒绝）：运行锁 + childIndex 表内所有权 + 会话归属，全程写审计日志。
   * 超时后 A 仍挂起，等待父代理裁决；运行终止/插件卸载时全部挂起 ask 以
   * WF_CANCELLED 释放。
   */
  async wfAskAgent(
    caller: CallerInfo,
    childId: string,
    args: AskAgentArgs,
    delivery: AskAgentDelivery,
    callerSignal?: AbortSignal,
  ): Promise<AskAgentResult> {
    const cmd = String(args?.cmd ?? '').trim() as AskAgentCmd
    if (cmd !== 'ask' && cmd !== 'reply' && cmd !== 'resolve') {
      throw new WfError('wf_ask_agent 需要 cmd: "ask" | "reply" | "resolve"', 'WF_BAD_ARGS')
    }
    const run = this.requireRunningRun(caller)

    // ---- ask：发起协作消息并挂起等待回复 ----
    if (cmd === 'ask') {
      if (!caller.isChild) {
        throw new WfError('wf_ask_agent 的 ask 仅供子代理使用（父代理请用 resolve 处理超时）', 'WF_NOT_CHILD')
      }
      const from = childId
      const metaFrom = from ? this.childIndex.get(from) : null
      if (!metaFrom || metaFrom.sessionId !== run.snapshot.sessionId || metaFrom.flowId !== run.snapshot.flowId) {
        throw new WfError('仅当前运行中的节点子代理可以发起协作通信', 'WF_ASK_FORBIDDEN')
      }
      const to = String(args?.targetChildId ?? '').trim()
      if (!to) throw new WfError('wf_ask_agent ask 需要 targetChildId（目标子代理会话 id）', 'WF_BAD_ARGS')
      if (to === from) throw new WfError('不能向自己发起协作通信', 'WF_BAD_ARGS')
      const metaTo = this.childIndex.get(to)
      if (!metaTo || metaTo.sessionId !== run.snapshot.sessionId || metaTo.flowId !== run.snapshot.flowId) {
        throw new WfError(`目标 ${to} 不是当前运行的节点子代理`, 'WF_ASK_TARGET_UNKNOWN')
      }
      const message = String(args?.message ?? '').trim()
      if (!message) throw new WfError('wf_ask_agent ask 需要 message', 'WF_BAD_ARGS')
      for (const existing of run.asks.values()) {
        if (existing.from === from && existing.state === 'pending') {
          throw new WfError('已有挂起的协作通信等待回复，请先处理', 'WF_BUSY')
        }
      }
      const timeoutMs = Math.max(1, this.deps.config.wfAskAgentTimeoutMs)
      const askId = this.deps.uuid?.() ?? randomUUID()
      let askResolve!: (result: AskAgentResult) => void
      let askReject!: (error: unknown) => void
      const promise = new Promise<AskAgentResult>((res, rej) => {
        askResolve = res
        askReject = rej
      })
      const pending: PendingAsk = {
        askId,
        from,
        to,
        fromNodeId: metaFrom.nodeId,
        toNodeId: metaTo.nodeId,
        message: truncateText(message, ASK_MESSAGE_LIMIT),
        timeoutMs,
        expiresAt: this.now() + timeoutMs,
        state: 'pending',
        audit: [],
        promise,
        resolve: askResolve,
        reject: askReject,
        timer: null,
        delivery,
      }
      run.asks.set(askId, pending)
      this.auditAsk(pending, 'ask', `from=${from}(${metaFrom.nodeId}) to=${to}(${metaTo.nodeId})`)
      try {
        await delivery.deliver({
          sessionId: run.snapshot.sessionId,
          to,
          message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildAskText(pending), from),
          signal: run.controller.signal,
        })
        this.auditAsk(pending, 'deliver', `to=${to}`)
      } catch (error) {
        run.asks.delete(askId)
        this.auditAsk(pending, 'deliver-failed', messageOf(error))
        throw new WfError(`协作消息投递失败：${messageOf(error)}`, 'WF_DELIVERY_FAILED')
      }
      pending.expiresAt = this.now() + timeoutMs
      pending.timer = setTimeout(() => this.onAskTimeout(run, askId), timeoutMs)
      run.lastActiveAt = this.now()

      // 挂起：等待回复 / 超时裁决 / 运行终止 / 调用方取消
      const onAbort = (): void => {
        run.asks.delete(askId)
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(new WfError('该工作流已停止', 'WF_CANCELLED'))
      }
      if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener('abort', onAbort, { once: true })
      else if (callerSignal?.aborted) onAbort()
      try {
        return await pending.promise
      } finally {
        callerSignal?.removeEventListener('abort', onAbort)
      }
    }

    // ---- reply：目标回复，解除发起者阻塞 ----
    if (cmd === 'reply') {
      if (!caller.isChild) {
        throw new WfError('wf_ask_agent 的 reply 仅供子代理使用', 'WF_NOT_CHILD')
      }
      const askId = String(args?.askId ?? '').trim()
      if (!askId) throw new WfError('wf_ask_agent reply 需要 askId', 'WF_BAD_ARGS')
      const pending = run.asks.get(askId)
      if (!pending) throw new WfError('协作通信不存在或已结束', 'WF_ASK_NOT_FOUND')
      if (pending.to !== childId) throw new WfError('只有消息目标可以回复该协作通信', 'WF_ASK_MISMATCH')
      if (pending.state !== 'pending') throw new WfError('该协作通信已超时，等待父代理裁决', 'WF_ASK_NOT_PENDING')
      const target = String(args?.targetChildId ?? '').trim()
      if (target && target !== pending.from) throw new WfError('回复对象与发起者不一致', 'WF_ASK_MISMATCH')
      const message = String(args?.message ?? '').trim()
      if (!message) throw new WfError('wf_ask_agent reply 需要 message', 'WF_BAD_ARGS')
      if (pending.timer) clearTimeout(pending.timer)
      pending.timer = null
      pending.state = 'resolved'
      this.auditAsk(pending, 'reply', `from=${childId}`)
      pending.resolve({ cmd: 'ask', askId, from: pending.from, to: pending.to, reply: message })
      run.asks.delete(askId)
      return { cmd: 'reply', askId, from: childId, to: pending.from }
    }

    // ---- resolve：父代理对超时 ask 裁决 ----
    if (caller.isChild) {
      throw new WfError('wf_ask_agent 的 resolve 仅供父代理使用（子代理请用 reply）', 'WF_NOT_ROOT')
    }
    const askId = String(args?.askId ?? '').trim()
    if (!askId) throw new WfError('wf_ask_agent resolve 需要 askId', 'WF_BAD_ARGS')
    const pending = run.asks.get(askId)
    if (!pending) throw new WfError('协作通信不存在或已结束', 'WF_ASK_NOT_FOUND')
    if (pending.state !== 'timed-out') {
      throw new WfError('该协作通信尚未超时，无需裁决', 'WF_ASK_NOT_TIMED_OUT')
    }
    const action = String(args?.action ?? '').trim() as ResolveAction
    if (action !== 'continue' && action !== 'resend' && action !== 'abort') {
      throw new WfError('wf_ask_agent resolve 需要 action: "continue" | "resend" | "abort"', 'WF_BAD_ARGS')
    }
    if (action === 'abort') {
      pending.state = 'aborted'
      this.auditAsk(pending, 'resolve-abort', '')
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new WfError('协作通信超时未获回复，已由父代理终止', 'WF_ASK_AGENT_TIMEOUT', { askId }))
      run.asks.delete(askId)
      return { cmd: 'resolve', askId, action }
    }
    if (action === 'resend') {
      try {
        await pending.delivery.deliver({
          sessionId: run.snapshot.sessionId,
          to: pending.to,
          message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildAskText(pending), pending.from),
          signal: run.controller.signal,
        })
        this.auditAsk(pending, 'resolve-resend', `to=${pending.to}`)
      } catch (error) {
        pending.state = 'aborted'
        this.auditAsk(pending, 'deliver-failed', messageOf(error))
        pending.reject(new WfError(`协作消息重发失败：${messageOf(error)}`, 'WF_DELIVERY_FAILED'))
        run.asks.delete(askId)
        return { cmd: 'resolve', askId, action }
      }
    } else {
      this.auditAsk(pending, 'resolve-continue', '')
    }
    pending.state = 'pending'
    pending.expiresAt = this.now() + pending.timeoutMs
    pending.timer = setTimeout(() => this.onAskTimeout(run, askId), pending.timeoutMs)
    return { cmd: 'resolve', askId, action }
  }

  /** 协作通信超时：置 timed-out 并把超时详情通知父代理（A 继续挂起等裁决）。 */
  private onAskTimeout(entry: RunEntry, askId: string): void {
    const pending = entry.asks.get(askId)
    if (!pending || pending.state !== 'pending') return
    pending.state = 'timed-out'
    pending.timer = null
    this.auditAsk(pending, 'timeout', `timeoutMs=${pending.timeoutMs}`)
    try {
      pending.delivery.notifyParent({
        sessionId: entry.snapshot.sessionId,
        message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildTimeoutText(pending), 'visual-workflow'),
      })
    } catch (error) {
      this.log().warn(`[visual-workflow] wf_ask_agent 超时通知父代理失败：${messageOf(error)}`)
    }
  }

  /** 写协作通信审计：内存审计链 + 宿主日志（越权校验的可追溯性）。 */
  private auditAsk(pending: PendingAsk, event: string, detail: string): void {
    pending.audit.push({ at: this.isoNow(), event, detail })
    this.log().info(`[visual-workflow] wf_ask_agent audit: askId=${pending.askId} ${event}${detail ? ` ${detail}` : ''}`)
  }

  // ---- subagent/end 观察 ------------------------------------------------------

  /**
   * 子代理结束观察：
   *   - 运行快照：completed/max-tokens → 节点 ok（outputSummary 取最后一条 assistant 文本）；
   *     error/aborted 等 → 节点 fail；
   *   - 清空 inflight、刷新 lastActiveAt（避免空闲看护误停）；
   *   - 唤醒 wait:true 阻塞等待器（ok/fail + output）。
   * 只观察 DSH 事件，不向父代理注入任何额外内容——父代理继续推进由官方汇报链路驱动。
   * 暂停中的运行（paused）同样回写节点状态（该节点确实完成了）。
   */
  async handleSubagentEnd(info: SubagentEndInfo): Promise<void> {
    const childId = String(info?.id ?? '')
    if (!childId) return
    const meta = this.childIndex.get(childId)
    // childIndex 尚未登记（极快完成/同步失败的子代理事件先于登记到达）：
    // 不能静默丢弃——否则 wait:true 等待器永久挂起、inflight 残留。有界重试等待登记。
    if (!meta) {
      this.deferSubagentEnd(info, 0)
      return
    }
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId !== meta.sessionId || s.flowId !== meta.flowId) continue
      entry.inflight.delete(childId)
      entry.lastActiveAt = this.now()
      if (s.status !== 'running' && s.status !== 'paused') return
      const stopReason = String(info?.stopReason ?? '')
      const completed = stopReason === 'completed' || stopReason === 'max-tokens'
      const outputText = lastAssistantText(info?.lastAssistantMessage, OUTPUT_SUMMARY_LIMIT)
      // 软截停（护栏）：触达 ReAct 上限仍正常产出——标记 react-capped（非失败）
      const reactCapped = this.deps.runner.consumeReactCapped?.(childId) === true
      if (completed) {
        setNodeStatus(s, meta.nodeId, reactCapped ? 'react-capped' : 'ok', {
          output: outputText || '(子代理已完成，但无可汇总文本)',
          outputFullLimit: this.deps.config.outputFullLimit,
          now: this.now(),
        })
        // 协作组聚合：成员完成后若组内全部成员 ok/react-capped → 组卡片记为 ok
        // （「组内全部 ok -> 组卡片记为 ok」；只做回显，不干预父代理调度）
        await this.markGroupOkIfComplete(entry, meta.nodeId)
      } else {
        setNodeStatus(s, meta.nodeId, 'fail', { now: this.now() })
      }
      await this.persistWarn(entry)
      // 唤醒阻塞等待（wait:true；与 subagent/end 共用同一完成通道）
      const waitKey = `${s.id}:${meta.nodeId}`
      const waiter = entry.waiters.get(waitKey)
      if (waiter) {
        entry.waiters.delete(waitKey)
        waiter.resolve({ nodeId: meta.nodeId, status: completed ? 'ok' : 'fail', childId, output: outputText })
      }
      return
    }
  }

  /**
   * 迟到 subagent/end 有界重试：等待 childIndex 完成登记后重放事件。
   * 防御性兜底——正常路径事件必然晚于登记到达，重试一次即命中；
   * 连续超限（20 次/200ms）说明 childId 无主（run 已清理），告警后丢弃。
   */
  private deferSubagentEnd(info: SubagentEndInfo, tries: number): void {
    if (this.disposed) return
    if (tries >= SUBAGENT_END_RETRY_MAX) {
      this.log().warn('[visual-workflow] subagent/end 缓冲重试超限丢弃：childId=' + String(info?.id ?? ''))
      return
    }
    setTimeout(() => {
      if (this.disposed) return
      const childId = String(info?.id ?? '')
      if (!childId) return
      if (this.childIndex.has(childId)) void this.handleSubagentEnd(info)
      else this.deferSubagentEnd(info, tries + 1)
    }, SUBAGENT_END_RETRY_DELAY_MS)
  }

  // ---- 终止 / 停止 ------------------------------------------------------------

  /**
   * 协作组聚合：某成员节点完成后，若其所属协作组全部成员均为
   * ok/react-capped，把组卡片标记为 ok（只影响运行回显，不干预父代理调度）。
   * 组卡片单向推进：仅 pending → ok；成员后续重试/失败不回退组卡片。
   * 流程读取失败时跳过聚合（下一次成员完成事件重试）。
   */
  private async markGroupOkIfComplete(entry: RunEntry, memberNodeId: string): Promise<void> {
    const snapshot = entry.snapshot
    if (snapshot.status !== 'running' && snapshot.status !== 'paused') return
    let flow: WorkflowDocument
    try {
      flow = await this.currentResolvedFlow(entry)
    } catch {
      return
    }
    for (const group of flow.nodes) {
      if (group.kind !== 'group' || !(group.data.memberIds ?? []).includes(memberNodeId)) continue
      const allDone = (group.data.memberIds ?? []).every((id) => {
        const record = snapshot.nodes.find((n) => n.nodeId === id)
        return record !== undefined && (record.status === 'ok' || record.status === 'react-capped')
      })
      if (!allDone) continue
      const current = snapshot.nodes.find((n) => n.nodeId === group.id)
      if (current && current.status === 'pending') {
        setNodeStatus(snapshot, group.id, 'ok', { output: '（协作组）全部成员已完成', now: this.now() })
      }
    }
  }

  /**
   * 统一终止运行：中止控制器（含阻塞中的 wait/提问）、尽力中断运行中子代理、
   * 写终态、持久化、释放锁（内存锁随状态自然释放）。幂等。
   * 终态条目随即从内存 runs 表释放（历史记录在磁盘，由 FlowStore 提供），
   * 防止长期运行内存膨胀；running/paused 条目保留（续跑/锁查询需要）。
   */
  async terminateRun(entry: RunEntry, options: TerminateOptions): Promise<boolean> {
    const snapshot = entry.snapshot
    if (!snapshot || (snapshot.status !== 'running' && snapshot.status !== 'paused')) return false

    // 1. 中止控制器：阻塞中的 wait 等待器随之取消
    entry.controller.abort(options.abortReason ?? `terminate-${options.status}`)
    // 2. 尽力中断运行中的子代理回合（防止后台空转）
    for (const childId of [...entry.inflight]) {
      try {
        await this.deps.runner.interruptChild(childId, snapshot.sessionId)
      } catch {
        // 中断尽力而为
      }
    }
    entry.inflight.clear()
    // 3. 收尾状态
    snapshot.status = options.status
    snapshot.summary = options.summary
    snapshot.endedAt = this.isoNow()
    terminalizeNodes(snapshot, this.now())
    this.rejectWaiters(entry)
    this.rejectAsks(entry)
    await this.persistWarn(entry)
    // 4. 释放内存条目（终态记录已持久化；幂等基于 snapshot.status，删除后
    //    重复 terminateRun(entry) 仍返回 false）
    this.runs.delete(snapshot.id)
    return true
  }

  /** 用户停止运行（控制栏停止按钮；幂等）。 */
  async stopRun(runId: string): Promise<void> {
    const entry = this.runs.get(runId)
    if (!entry) return
    await this.terminateRun(entry, { status: 'stopped', summary: '运行已停止', abortReason: 'user-stop' })
  }

  /** 父代理回合以 error 结束（编排已死）→ 自动把运行标记为 failed。 */
  async failRunForParentError(entry: RunEntry, error: unknown): Promise<void> {
    const message = messageOf(error)
    const summary = message ? `编排父代理执行出错：${message}` : '编排父代理执行出错（未知错误）'
    await this.terminateRun(entry, { status: 'failed', summary, abortReason: 'parent-turn-error' })
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
      const raw = await this.deps.store.getWorkflow(entry.snapshot.sessionId, entry.snapshot.flowId)
      if (raw) return raw
    } catch {
      // 读失败回退起始快照
    }
    return entry.baseFlow
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
  private rejectWaiters(entry: RunEntry): void {
    for (const waiter of entry.waiters.values()) {
      waiter.reject(new WfError('该工作流已停止', 'WF_CANCELLED'))
    }
    entry.waiters.clear()
  }

  /** 拒绝某运行的全部挂起协作通信（终止/卸载路径：清计时器 + reject + 清表）。 */
  private rejectAsks(entry: RunEntry, error: unknown = new WfError('该工作流已停止', 'WF_CANCELLED')): void {
    for (const pending of entry.asks.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    entry.asks.clear()
  }

  /** 持久化 run 快照（尽力而为：失败仅告警，不阻断状态机）。 */
  private async persistWarn(entry: RunEntry): Promise<void> {
    try {
      await this.deps.store.saveRun(entry.snapshot)
    } catch (error) {
      this.log().warn(`[visual-workflow] run record save failed: ${messageOf(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 纯函数（导出供单测独立断言）
// ---------------------------------------------------------------------------

/** 错误消息提取（Error 或任意值）。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

/** 节点人类可读名称（提示语与错误消息用）。 */
export function labelOf(node: GraphNode): string {
  if (node.kind === 'proxy') return node.id
  if (node.kind === 'parent' || node.kind === 'agent') return node.data.label || node.id
  if (node.kind === 'group') return node.data.label || node.id
  if (node.kind === 'file' || node.kind === 'database') return node.data.label || node.id
  return node.data.label
}

/** 流程中的暂停节点 id 清单（编排指令与节点任务块动态态共用）。 */
export function pauseNodeIdsOf(flow: WorkflowDocument): string[] {
  return flow.nodes.filter((n) => n.kind === 'pause').map((n) => n.id)
}

/** 编排指令 facts 的节点清单（可调度执行的角色与协作组；父代理节点即编排者本人，不列出）。 */
export function orchestrationNodeList(flow: WorkflowDocument): Array<{ id: string; label: string }> {
  return flow.nodes
    .filter((n) => n.kind === 'agent' || n.kind === 'group')
    .map((n) => ({ id: n.id, label: labelOf(n) }))
}

/** 编排指令 facts 的协作组说明（组内成员并行启动提示）。 */
export function collabGroupList(flow: WorkflowDocument): Array<{ groupId: string; label: string; memberIds: string[] }> {
  return flow.nodes
    .filter((n) => n.kind === 'group')
    .map((n) => ({ groupId: n.id, label: n.data.label || n.id, memberIds: n.data.memberIds ?? [] }))
}

/** 读取某角色节点所属协作组的协作 Prompt（组卡片 data.collabPrompt；非组内成员返回空串）。 */
export function collabPromptOf(flow: WorkflowDocument, nodeId: string): string {
  const group = flow.nodes.find(
    (n): n is GraphNode & { data: { collabPrompt?: string; memberIds?: string[] } } =>
      n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(nodeId),
  )
  return group ? String(group.data.collabPrompt ?? '').trim() : ''
}

/** 运行前完整性检查：缺失的启动/结束节点（按模式渲染中文名）。 */
function missingStageLabels(flow: WorkflowDocument): string[] {
  const labels: string[] = []
  if (!flow.nodes.some((n) => n.kind === 'start')) labels.push(flow.mode === 'mode2' ? '输入' : '启动')
  if (!flow.nodes.some((n) => n.kind === 'end')) labels.push(flow.mode === 'mode2' ? '输出' : '结束')
  return labels
}

/** 运行前校验（防御：保存时已校验，此处拦截非法快照）。 */
function validateFlowForRun(flow: WorkflowDocument): WfError | null {
  const validation = validateFlow(flow)
  if (!validation.ok) {
    return new WfError(`工作流校验未通过：${validation.issues[0]?.message ?? '未知问题'}`, 'WF_FLOW_INVALID')
  }
  return null
}

/** 节点任务块组装：persona 任务 + 输入输出结构 + 上下文注入 + 执行与交付约定。 */
function buildNodeBlocks(input: {
  flow: WorkflowDocument
  node: RoleNode
  /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
  snapshot: RunSnapshot
  documentTextLimit: number
  pauseNodeIds: string[]
  retryLimit: number
  reactLimit: number | undefined
  runContextText: string
}): Array<{ type: 'text'; text: string }> {
  const { flow, node } = input
  const data = node.data
  // 上游上下文（ctx-in 显式连线）：
  //   - file 节点：文本直通（截断）/ 受管文件路径索引；
  //   - agent/parent 角色节点（含虚拟节点引用）：注入运行快照中该节点的最终
  //     产出（status=ok/react-capped，截断；其余状态无产出不注入）——需求
  //     明确「上游最终输出作为上下文传入下游；不连接则不传」。
  const upstreamContext: Array<{ source: string; content: string }> = []
  const filePaths: string[] = []
  for (const edge of ctxInEdges(flow, node.id)) {
    const src = nodeById(flow, edge.source)
    if (!src) continue
    if (src.kind === 'file') {
      if (src.data.fileKind === 'text' && String(src.data.content ?? '').trim()) {
        upstreamContext.push({
          source: src.data.label ?? src.id,
          content: truncateText(src.data.content, input.documentTextLimit),
        })
      } else if (src.data.managedPath) {
        filePaths.push(src.data.managedPath)
      }
      continue
    }
    // 模式二输入节点：右出 ctx 连线显式传递用户问题（快照已预填产出）
    if (src.kind === 'start') {
      if (flow.mode !== 'mode2') continue
      const entry = input.snapshot.nodes.find((n) => n.nodeId === src.id)
      if (!entry || entry.status !== 'ok') continue
      const output = String(entry.output ?? '').trim()
      if (!output) continue
      upstreamContext.push({
        source: labelOf(src),
        content: truncateText(output, input.documentTextLimit),
      })
      continue
    }
    // 角色/虚拟节点：解析主节点后查快照产出（快照按主节点 key 记账）
    const resolved = src.kind === 'proxy' ? nodeById(flow, src.proxySourceId) : src
    if (!resolved || (resolved.kind !== 'agent' && resolved.kind !== 'parent')) continue
    const entry = input.snapshot.nodes.find((n) => n.nodeId === resolved.id)
    if (!entry || (entry.status !== 'ok' && entry.status !== 'react-capped')) continue
    const output = String(entry.output ?? '').trim()
    if (!output) continue
    upstreamContext.push({
      source: labelOf(src),
      content: truncateText(output, input.documentTextLimit),
    })
  }
  const dbHint = dbInEdges(flow, node.id).length > 0 ? DB_TOOL_HINT : ''

  const text = buildNodeTaskBlock({
    facts: {
      task: data.systemPrompt ?? '',
      nodeLabel: data.label || node.id,
      upstreamContext,
      filePaths,
      dbToolHint: dbHint,
      toolAllowlistNote: '', // 工具白名单解析后填充
    },
    dynamic: {
      retryLimit: input.retryLimit,
      ...(input.reactLimit !== undefined ? { reactLimit: input.reactLimit } : {}),
      pauseNodeIds: input.pauseNodeIds,
      runContextText: input.runContextText,
    },
  })
  return [{ type: 'text', text }]
}

/** 编排指令参数组装（facts 静态事实 + dynamic 末段动态态，前缀稳定）。 */
function directiveParams(
  flow: WorkflowDocument,
  defPath: string,
  mode: 'mode1' | 'mode2',
  extra?: {
    /** 断点继续事实（resumeRun 用）。 */
    resume?: { resumeFromNodeId?: string; resumedFromRunId: string }
    /** 模式二用户问题（不稳定内容，仅末段）。 */
    question?: string
  },
): OrchestrationDirectiveParams {
  return {
    facts: {
      workflowName: flow.name ?? flow.id,
      workflowGoal: flow.description ?? '',
      definitionPath: defPath,
      nodes: orchestrationNodeList(flow),
      collabGroups: collabGroupList(flow),
    },
    dynamic: {
      pauseNodeIds: pauseNodeIdsOf(flow),
      runParamsText:
        mode === 'mode2'
          ? 'mode2 (service): use wf_run_node_wait to start each node and block until it finishes; never use wf_run_node.'
            : 'mode1 (orchestration): use wf_run_node to start each node asynchronously; never use wf_run_node_wait.',
      ...(extra?.question ? { question: extra.question } : {}),
      ...(extra?.resume
        ? { isResume: true, resumeFromNodeId: extra.resume.resumeFromNodeId, resumedFromRunId: extra.resume.resumedFromRunId }
        : {}),
    },
  }
}

/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
function effectiveRetryLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number {
  const fromArgs = Number(args?.retryLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 0) return fromArgs
  const fromNode = Number(node.data?.retryLimit)
  if (Number.isFinite(fromNode) && fromNode >= 0) return fromNode
  return fallback
}

/** 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认。 */
function effectiveReactLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number | undefined {
  const fromArgs = Number(args?.iterationLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 1) return fromArgs
  const fromNode = node.data?.reactLimit
  if (fromNode === null) return undefined // 节点显式不设限（V-01）
  const numeric = Number(fromNode)
  if (Number.isFinite(numeric) && numeric >= 1) return numeric
  return fallback
}

/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
function effectiveThinkingOf(node: RoleNode, args: RunNodeArgs): string | undefined {
  const fromArgs = args?.thinking
  if (typeof fromArgs === 'string' && fromArgs.trim()) return fromArgs
  const fromNode = node.data?.reasoning
  return typeof fromNode === 'string' && fromNode.trim() ? fromNode : undefined
}

// src/host/agent/agents-host.ts
//
// 会话根 Agent（父代理）服务适配：CordisAgentHost 实现编排运行时的 AgentHost 缝
// （可用性/取根 Agent/followup 注入/回合终态/子代理存活），以及 agents/subagents
// 服务的惰性解析（运行时守卫，零官方类型依赖）。

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHost, RootAgentLike, RootInjectedMessage, TurnEndInfo } from '../orchestrator/index.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { AgentsServiceLike, SubagentsServiceLike } from './runner.js'

// ---------------------------------------------------------------------------
// 会话事件流读取（DSH 0.1.2 适配，A4-03/A4-04）
// ---------------------------------------------------------------------------
// rc.2 时代插件直读 root.session.events（数组）；0.1.2 移除该 getter，改为按需
// `seq` / `eventAt()` / `snapshotEvents()`（SessionSeq/SessionLogOffset 为 branded
// number，运行时仍是普通非负整数）。官方类型已取证：`session.seq` 为当前长度、
// `eventAt(seq)` 取单个事件。这里用运行时守卫兼容双版本，避免零官方类型依赖被打破。

/** 会话事件倒序扫描上限（只关心最新若干条；防止极端长日志全量物化）。 */
const SESSION_EVENT_LOOKBACK = 200

/**
 * 自会话事件流末尾向前扫描，返回首个满足 predicate 的事件（最新优先）。
 * 兼容 DSH 0.1.2（seq/eventAt）与 0.1.1（events 数组）；读取失败返回 null（降级，
 * 不抛错——看护/产出读取属辅助路径）。
 */
function scanLatestSessionEvent(
  session: unknown,
  predicate: (event: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (!session || typeof session !== 'object') return null
  const s = session as { seq?: unknown; eventAt?: (seq: number | unknown) => unknown; events?: unknown[] }
  // 长度：0.1.2 用 seq（当前日志长度）；旧版本回退 events.length。
  const seq = Number(s.seq)
  const length = Number.isFinite(seq) && seq >= 0 ? seq : (Array.isArray(s.events) ? s.events.length : 0)
  const from = Math.max(0, length - SESSION_EVENT_LOOKBACK)
  for (let index = length - 1; index >= from; index -= 1) {
    let event: unknown
    if (typeof s.eventAt === 'function') {
      try {
        event = s.eventAt(index)
      } catch {
        event = undefined
      }
    }
    if (event === undefined && Array.isArray(s.events)) event = s.events[index]
    if (event !== null && typeof event === 'object' && predicate(event as Record<string, unknown>)) {
      return event as Record<string, unknown>
    }
  }
  return null
}

// ── agents 服务适配 ─────────────────────────────────────────────────────
// 会话根 Agent（父代理）服务的最小结构适配：零官方类型依赖，全部运行时守卫。

/** agents 服务注册表的最小结构（运行时守卫后收窄）。 */
interface AgentsRegistryLike {
  get(id: string): unknown
}

export class CordisAgentHost implements AgentHost {
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

  /** 按会话 id 取子代理 agent（wf_ask_agent 投递缝用；未激活返回 null）。 */
  getChildAgent(childId: string): RootAgentLike | null {
    const service = this.agentsService()
    if (!service) return null
    try {
      const raw = service.get(childId)
      if (raw === null || typeof raw !== 'object') return null
      return raw as RootAgentLike
    } catch {
      return null
    }
  }

  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    if (typeof agent.followup !== 'function') {
      throw new Error('当前会话 Agent 未激活；请先在对话区发送一条消息后重试')
    }
    agent.followup(message)
  }

  /**
   * 会话根 Agent 在 afterMs 之后的最新 turn/end（无则 null）。
   *
   * 【官方词表取证】dsh-session 的 `TurnEndReasonMap`（merge-extensible）含 7 种 kind：
   * `completed` / `aborted`（带 cancel cause）/ `blocked` / `error`（结构化 LlmFailure）/
   * `max-tokens` / `interrupted`（崩溃孤儿回合事后收口）/ `forked`（fork 种子构造收口）。
   * 本适配的终态翻译口径（用户裁决 2026.10）：
   *   - `error` → 编排已死（模型/工具/官方内部错误）→ 运行 failed；
   *   - `blocked` → pre-step 被拒绝，父代理回合停住且不会自行恢复 → 同样按编排已死
   *     处理（运行 failed）。若不纳入，运行只能等空闲看护（默认 30 分钟）超时收敛；
   *   - `aborted` → 用户中止（对话区停止按钮）→ 保持运行，等下一次调度（见 watchdog）；
   *   - `completed` / `max-tokens` / `interrupted` / `forked` / 未知 kind → null（不判终态）：
   *     completed 是正常回合结束（父代理可能还有后续调度）；max-tokens 只表示本轮输出
   *     被截断、父代理仍可继续；interrupted/forked 只出现在冷读与 fork 种子，运行中
   *     看护不应据此判定。未知 kind 一律保守返回 null（官方可扩展，不得因未知而误判）。
   * 若将来需要把 max-tokens 也纳入终态判定，属编排语义变更：必须同时改
   * TurnEndInfo 契约、看护分支与测试（见同目录 AGENTS.md § 依赖边界：适配必须取证可追溯）。
   */
  latestTurnEnd(sessionId: string, afterMs: number): TurnEndInfo | null {
    const root = this.getRootAgent(sessionId)
    if (!root) return null
    const event = scanLatestSessionEvent(root.session, (candidate) => candidate.type === 'turn/end')
    if (!event) return null
    // 最新回合在运行开始前结束 → 运行发起回合尚未结束，不判终态
    if ((Number(event.time) || 0) < afterMs) return null
    const reason = (event.data as { reason?: { kind?: unknown; error?: unknown } } | undefined)?.reason
    const kind = reason?.kind
    if (kind === 'error') return { kind: 'error', error: reason?.error ?? {} }
    if (kind === 'blocked') return { kind: 'error', error: { message: '父代理回合被拒绝（blocked）：pre-step 未通过，编排无法继续推进', code: 'TURN_BLOCKED' } }
    if (kind === 'aborted') return { kind: 'aborted' }
    return null
  }

  /**
   * 最近一条父代理 assistant/message 文本（afterMs 之后；无则 null）。
   * 官方 dsh-agent-loop 每步结束追加 assistant/message 事件（{ turn, step, message }，
   * message.content 为 ContentBlock[]）——取事件流中时间 >= afterMs 的最后一条
   * assistant/message 的 text 块拼接（执行者模式回写父代理节点输出用）。
   */
  latestRootAssistantText(sessionId: string, afterMs: number): string | null {
    const root = this.getRootAgent(sessionId)
    if (!root) return null
    const event = scanLatestSessionEvent(root.session, (candidate) => {
      if (candidate.type !== 'assistant/message') return false
      return (Number(candidate.time) || 0) >= afterMs
    })
    if (!event) return null
    const content = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content
    if (Array.isArray(content)) {
      const joined = content
        .map((block) => {
          const value = block as { type?: unknown; text?: unknown } | null
          return value && value.type === 'text' ? String(value.text ?? '') : ''
        })
        .filter(Boolean)
        .join('\n')
        .trim()
      if (joined) return joined
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

/**
 * 按会话取/建服务会话的根 Agent（模式二服务进程装配使用）。
 * 父代理节点声明的 provider/model 优先；会话已有 Agent 时直接复用（持久化上下文保留）。
 * 「取/建」的官方 agents 服务守卫与形状收敛归本模块——进程入口只做装配，不承载实现。
 */
export async function createOrGetServiceAgent(
  ctx: Context,
  store: FlowStore,
  serviceId: string,
  sessionId: string,
): Promise<{ agent: unknown; provider?: string; model?: string }> {
  const agents = ctx.get('agents') as {
    get?(id: string): unknown
    create?(options: Record<string, unknown>): Promise<{ agent?: unknown } | unknown>
  } | null
  if (!agents || typeof agents.get !== 'function' || typeof agents.create !== 'function') {
    throw new Error('agents 服务不可用，无法建立服务会话')
  }
  const service = await store.getServiceById(serviceId)
  const parent = service?.nodes?.find((node) => node.kind === 'parent')
  const data = (parent as { data?: Record<string, unknown> } | undefined)?.data
  const provider = typeof data?.provider === 'string' && data.provider ? data.provider : undefined
  const model = typeof data?.model === 'string' && data.model ? data.model : undefined

  let agent = agents.get(sessionId)
  if (!agent) {
    const created = await agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      ...(provider && model ? { agentOptions: { provider, model } } : {}),
    })
    agent = (created as { agent?: unknown })?.agent ?? created
  }
  if (agent === null || agent === undefined) throw new Error('服务会话 Agent 建立失败')
  return { agent, provider, model }
}

/** agents 服务惰性解析（节点子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
export function agentsServiceLike(ctx: Context): AgentsServiceLike | null {
  const service: unknown = ctx.get('agents')
  if (service !== null && typeof service === 'object' && typeof (service as { get?: unknown }).get === 'function') {
    return service as AgentsServiceLike
  }
  return null
}

/** subagents 服务惰性解析（子代理创建/相邻投递/中断/provider 探测使用面）。 */
export function subagentsServiceLike(ctx: Context): SubagentsServiceLike | null {
  const service: unknown = ctx.get('subagents')
  if (
    service !== null && typeof service === 'object'
    && typeof (service as { startContinuable?: unknown }).startContinuable === 'function'
    // 相邻投递二选一：sendMessage（当前官方公开 runtime 唯一通道；sender 即 live 父代理，
    // 来源由服务派生）/ queuePrompt（旧宿主兼容兜底：当前官方公开 runtime 已无该通道，
    // 仅内部 continuation manager 持有 —— 取证见 runner.ts 的 SubagentsServiceLike）。
    // 【0.1.5-rc.1 取证】官方 SubagentRuntime 已无 followup 方法（rc.2 面），故不再作为
    // 可用性判据；registerContinuableSetup 亦早已移除，不再判定。
    && (typeof (service as { sendMessage?: unknown }).sendMessage === 'function'
        || typeof (service as { queuePrompt?: unknown }).queuePrompt === 'function')
    && typeof (service as { interrupt?: unknown }).interrupt === 'function'
  ) {
    return service as SubagentsServiceLike
  }
  return null
}

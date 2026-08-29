// src/host/agent/agents-host.ts
//
// 会话根 Agent（父代理）服务适配：CordisAgentHost 实现编排运行时的 AgentHost 缝
// （可用性/取根 Agent/followup 注入/回合终态/子代理存活），以及 agents/subagents
// 服务的惰性解析（运行时守卫，零官方类型依赖）。

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHost, RootAgentLike, RootInjectedMessage, TurnEndInfo } from '../orchestrator/runtime.js'
import type { AgentsServiceLike, SubagentsServiceLike } from './runner.js'

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

/** agents 服务惰性解析（节点子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
export function agentsServiceLike(ctx: Context): AgentsServiceLike | null {
  const service: unknown = ctx.get('agents')
  if (service !== null && typeof service === 'object' && typeof (service as { get?: unknown }).get === 'function') {
    return service as AgentsServiceLike
  }
  return null
}

/** subagents 服务惰性解析（子代理创建/followup/interrupt/护栏贡献使用面）。 */
export function subagentsServiceLike(ctx: Context): SubagentsServiceLike | null {
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

// src/host/scheduler/session-provider.ts
//
// 定时任务「新会话」模式：以编程方式创建会话 + 根 Agent（官方 ctx.agents.create，
// 工厂创建会话与 agent 并发布；创建后 agent 处于 idle，后续 startRun 的
// followupRoot 注入编排指令即唤醒回合——与 goal-round-driver 官方同款驱动模式）。
//
// 非侵入扩展（架构文档 §1）：零官方包类型依赖（运行时守卫），经 ctx.get('agents')
// 解析 create 能力；创建失败抛明确错误，由引擎按触发失败处理（不补打）。

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** agents 服务「创建」能力的最小结构（运行时守卫后收窄）。 */
interface AgentsCreateLike {
  create?(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: { provider?: string; model?: string }
  }): Promise<{ agent: { id: unknown } }>
}

/** 新会话创建缝（引擎依赖；单测 fake）。 */
export interface SessionProvider {
  /**
   * 创建新会话（含根 Agent）并返回会话 id。
   * @param options.label 会话来源标识（写入用途说明；元信息可追溯）
   * @param options.agentPreset 官方预设 id（缺省 standard：父代理具备官方标准工具集）
   * @param options.cwd 可选工作目录（继承创建者会话；解析不到时省略）
   */
  createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string>
}

/** Cordis 实现：经 ctx.agents.create 创建会话与根 Agent（工厂缺失时抛出明确错误）。 */
export class CordisSessionProvider implements SessionProvider {
  constructor(private readonly ctx: Context) {}

  async createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string> {
    const agents = this.ctx.get('agents') as AgentsCreateLike | null | undefined
    if (!agents || typeof agents.create !== 'function') {
      throw new Error('agents 服务不支持创建会话（agent 工厂未安装），无法执行定时任务的「新会话」模式')
    }
    const sessionId = `sched-${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await agents.create({
      sessionId,
      meta: {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        agentPreset: options.agentPreset ?? 'standard',
      },
    })
    return sessionId
  }
}

/** sessions 服务快照的最小结构（运行时守卫后收窄）。 */
interface SessionsSnapshotLike {
  list?: {
    getSnapshot?(): { byId?: Record<string, unknown> }
    get?(): { byId?: Record<string, unknown> }
  }
}

/**
 * 解析某会话记录的工作目录（新会话继承创建者 cwd 用；读不到返回 undefined，
 * 由引擎组装时省略该字段——官方 meta.cwd 为可选）。
 */
export function sessionCwdResolver(ctx: { get(name: string): unknown }): (sessionId: string) => Promise<string | undefined> {
  return async (sessionId: string): Promise<string | undefined> => {
    try {
      const sessions = ctx.get('sessions') as SessionsSnapshotLike | null | undefined
      const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.()
      const entry = (snapshot?.byId ?? {})[sessionId] as { meta?: { cwd?: unknown }; header?: { meta?: { cwd?: unknown } }; parentSessionId?: unknown } | undefined
      const cwd = entry?.meta?.cwd ?? entry?.header?.meta?.cwd
      return typeof cwd === 'string' && cwd.trim() ? cwd : undefined
    } catch {
      return undefined
    }
  }
}

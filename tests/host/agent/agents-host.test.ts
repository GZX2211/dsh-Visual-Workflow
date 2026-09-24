// tests/host/agent/agents-host.test.ts
//
// CordisAgentHost 的会话事件流读取（DSH 0.1.2 适配，A4-03/A4-04）：
//   - 0.1.1 直读 root.session.events（数组）；
//   - 0.1.2 移除 events getter，改为 seq / eventAt()（branded number 运行时仍为整数）。
// 本测试验证 latestTurnEnd / latestRootAssistantText 对两种形状都给出相同结果，
// 且 afterMs 过滤与终态词表翻译口径（error/blocked → 终态；aborted 单列；
// completed/max-tokens/未知 kind → 不判终态）保持不变。
//
// 另覆盖 createOrGetServiceAgent（模式二服务进程的会话根 Agent 取/建适配）：
// 服务缺失报错、已有 Agent 复用、新建时携带父代理节点 provider/model。

import { describe, expect, it } from 'vitest'
import { CordisAgentHost, createOrGetServiceAgent } from '../../../src/host/agent/agents-host.js'
import type { RootAgentLike, TurnEndInfo } from '../../../src/host/orchestrator/index.js'

/** 构造一个最小 root session：0.1.1 形状（events 数组）。 */
function rc2Session(events: Array<Record<string, unknown>>): { events: unknown[] } {
  return { events }
}

/** 构造一个 0.1.2 形状的 root session：seq + eventAt()（无 events 字段）。 */
function rc1Session(events: Array<Record<string, unknown>>): { seq: number; eventAt: (i: number) => unknown } {
  return { seq: events.length, eventAt: (i: number) => events[i] }
}

/** 构造事件样本：turn/end(error)、turn/end(aborted)、assistant/message。 */
function sampleEvents(): Array<Record<string, unknown>> {
  return [
    {
      type: 'turn/end',
      time: 900,
      data: { reason: { kind: 'completed' } },
    },
    {
      type: 'assistant/message',
      time: 950,
      data: { message: { content: [{ type: 'text', text: '执行者产出' }] } },
    },
    {
      type: 'turn/end',
      time: 1000,
      data: { reason: { kind: 'error', error: { code: 'E1' } } },
    },
  ]
}

/** fake ctx：仅提供 agents 服务（get 返回 registry，root 带 session）。 */
function hostWith(session: unknown): CordisAgentHost {
  const registry = { get: (id: string) => (id === 's1' ? { id: 's1', session } : undefined) }
  const ctx = { get: (name: string) => (name === 'agents' ? registry : undefined) } as never
  return new CordisAgentHost(ctx as never)
}

describe('CordisAgentHost 会话事件读取（0.1.2 seq/eventAt 与 0.1.1 events 双形状兼容）', () => {
  it('latestTurnEnd：0.1.1 与 0.1.2 形状命中同一 turn/end(error)（最新一条）', () => {
    const events = sampleEvents()
    const host2 = hostWith(rc2Session(events))
    const host1 = hostWith(rc1Session(events))
    const expect1: TurnEndInfo = { kind: 'error', error: { code: 'E1' } }
    expect(host1.latestTurnEnd('s1', 800)).toEqual(expect1)
    expect(host2.latestTurnEnd('s1', 800)).toEqual(expect1)
  })

  it('latestTurnEnd：afterMs 大于最新 turn/end → null（运行发起回合尚未结束）', () => {
    const host = hostWith(rc1Session(sampleEvents()))
    expect(host.latestTurnEnd('s1', 2000)).toBeNull()
  })

  it('latestRootAssistantText：两种形状返回 afterMs 后最新 assistant/message 文本', () => {
    const events = sampleEvents()
    expect(hostWith(rc1Session(events)).latestRootAssistantText?.('s1', 800)).toBe('执行者产出')
    expect(hostWith(rc2Session(events)).latestRootAssistantText?.('s1', 800)).toBe('执行者产出')
    // afterMs 过滤：没有任何晚于 2000 的 assistant/message → null
    expect(hostWith(rc1Session(events)).latestRootAssistantText?.('s1', 2000)).toBeNull()
  })

  it('session 形状缺失（无 seq/eventAt/events）→ 返回 null 而非抛错', () => {
    const host = hostWith({} as RootAgentLike['session'])
    expect(host.latestTurnEnd('s1', 0)).toBeNull()
    expect(host.latestRootAssistantText?.('s1', 0)).toBeNull()
  })

  it('latestTurnEnd 词表翻译：blocked → 终态 error（pre-step 被拒，编排无法推进）', () => {
    const host = hostWith(rc1Session([{ type: 'turn/end', time: 1000, data: { reason: { kind: 'blocked' } } }]))
    const terminal = host.latestTurnEnd('s1', 800)
    expect(terminal?.kind).toBe('error')
    expect((terminal as { error?: { code?: unknown } } | null)?.error?.code).toBe('TURN_BLOCKED')
  })

  it('latestTurnEnd 词表翻译：completed / max-tokens / interrupted / forked / 未知 kind → null（不判终态）', () => {
    for (const kind of ['completed', 'max-tokens', 'interrupted', 'forked', 'something-new']) {
      const host = hostWith(rc1Session([{ type: 'turn/end', time: 1000, data: { reason: { kind } } }]))
      expect(host.latestTurnEnd('s1', 800)).toBeNull()
    }
  })

  it('latestTurnEnd 词表翻译：aborted → aborted（用户中止，运行保持）', () => {
    const host = hostWith(rc1Session([{ type: 'turn/end', time: 1000, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }]))
    expect(host.latestTurnEnd('s1', 800)).toEqual({ kind: 'aborted' })
  })
})

// ---------------------------------------------------------------------------
// createOrGetServiceAgent（模式二服务进程的会话根 Agent 取/建）
// ---------------------------------------------------------------------------

/** fake ctx：仅提供 agents 服务（get/create 形状可控）。 */
function serviceCtx(agents: unknown): never {
  return { get: (name: string) => (name === 'agents' ? agents : undefined) } as never
}

/** fake store：服务文档含 parent 节点的 provider/model。 */
function serviceStore(nodes: unknown[] | null): never {
  return { getServiceById: async (id: string) => (id === 'svc-1' && nodes ? { nodes } : null) } as never
}

describe('createOrGetServiceAgent（服务会话根 Agent 取/建）', () => {
  it('agents 服务缺失或形状不完整 → 明确报错（不含糊降级）', async () => {
    await expect(createOrGetServiceAgent(serviceCtx(undefined), serviceStore([]), 'svc-1', 'session-1')).rejects.toThrow(
      /agents 服务不可用/,
    )
    await expect(createOrGetServiceAgent(serviceCtx({ get: () => undefined }), serviceStore([]), 'svc-1', 'session-1')).rejects.toThrow(
      /agents 服务不可用/,
    )
  })

  it('会话已有 Agent → 直接复用（不重复创建）', async () => {
    const existing = { id: 'session-1', followup: () => {} }
    let createCalls = 0
    const ctx = serviceCtx({ get: () => existing, create: async () => { createCalls += 1; return existing } })
    const result = await createOrGetServiceAgent(ctx, serviceStore([{ kind: 'parent', data: { provider: 'p1', model: 'm1' } }]), 'svc-1', 'session-1')
    expect(result.agent).toBe(existing)
    expect(createCalls).toBe(0)
    // 父代理节点的 provider/model 仍从服务文档解析（供调用方回显）
    expect(result).toMatchObject({ provider: 'p1', model: 'm1' })
  })

  it('会话无 Agent → 创建并携带父代理节点 provider/model 与会话 id', async () => {
    const created = { id: 'session-1' }
    const options: Array<Record<string, unknown>> = []
    const ctx = serviceCtx({ get: () => undefined, create: async (input: Record<string, unknown>) => { options.push(input); return { agent: created } } })
    const result = await createOrGetServiceAgent(ctx, serviceStore([{ kind: 'parent', data: { provider: 'p1', model: 'm1' } }]), 'svc-1', 'session-1')
    expect(result.agent).toBe(created)
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ sessionId: 'session-1', agentOptions: { provider: 'p1', model: 'm1' } })
    expect((options[0].meta as { cwd?: unknown }).cwd).toBe(process.cwd())
  })

  it('服务文档缺 parent 节点（或无 provider/model）→ 创建时不带 agentOptions（官方按默认选择）', async () => {
    const options: Array<Record<string, unknown>> = []
    const ctx = serviceCtx({ get: () => undefined, create: async (input: Record<string, unknown>) => { options.push(input); return { id: 'session-1' } } })
    await createOrGetServiceAgent(ctx, serviceStore([{ kind: 'agent', data: {} }]), 'svc-1', 'session-1')
    expect(options[0].agentOptions).toBeUndefined()
  })

  it('create 返回空值 → 明确报错（不把 undefined 当 Agent 返回）', async () => {
    const ctx = serviceCtx({ get: () => undefined, create: async () => undefined })
    await expect(createOrGetServiceAgent(ctx, serviceStore([]), 'svc-1', 'session-1')).rejects.toThrow(/建立失败/)
  })
})

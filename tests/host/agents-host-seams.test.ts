// tests/host/agents-host-seams.test.ts
//
// CordisAgentHost 的会话事件流读取（DSH 0.1.2 适配，A4-03/A4-04）：
//   - 0.1.1 直读 root.session.events（数组）；
//   - 0.1.2 移除 events getter，改为 seq / eventAt()（branded number 运行时仍为整数）。
// 本测试验证 latestTurnEnd / latestRootAssistantText 对两种形状都给出相同结果，
// 且 afterMs 过滤、仅 completed/aborted/error 语义保持不变。

import { describe, expect, it } from 'vitest'
import { CordisAgentHost } from '../../src/host/agent/agents-host.js'
import type { RootAgentLike, TurnEndInfo } from '../../src/host/orchestrator/runtime.js'

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
})

// tests/host/guards.test.ts
//
// ReAct 软截停护栏单测（T-022；V-01）：
//   - pre-step 计步：达到上限后替换本步消息为强制收尾指令（enter 分支）；
//   - tools.guard 双保险：软截停窗口内拒绝工具调用（原因「已达迭代上限」）；
//   - 回合重置与 consumeCapped 消费；未登记 child 旁路；贡献 disposer 生效。
// 断言依据：架构文档 §4.2 L221、需求文档 §4.2.3.2 规则 3（软截停不硬性中断）。

import { describe, expect, it } from 'vitest'
import { REACT_CAP_DENY_REASON, REACT_CAP_MESSAGE, createReactGuard, type GuardChildContext } from '../../src/host/agent/guards.js'

/** 最小 childCtx fake：waterfall 事件链 + tools.guard 记录。 */
class FakeChildCtx implements GuardChildContext {
  private listeners = new Map<string, Array<(payload: unknown, next?: () => Promise<unknown>) => unknown>>()
  guards: Array<(exec: { name?: unknown; agent?: { id?: unknown } }) => string | undefined> = []
  readonly tools = {
    guard: (guard: (exec: { name?: unknown; agent?: { id?: unknown } }) => string | undefined): (() => void) => {
      this.guards.push(guard)
      return () => {}
    },
  }

  on(name: string, listener: (payload: unknown, next?: () => Promise<unknown>) => unknown): () => void {
    const list = this.listeners.get(name) ?? []
    list.push(listener)
    this.listeners.set(name, list)
    return () => {
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    }
  }

  listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0
  }

  /** 瀑布链派发：监听器依次执行，末位 next 返回终值（默认决策）。 */
  async dispatch(name: string, payload: unknown, terminal: () => Promise<unknown> | unknown): Promise<unknown> {
    const list = [...(this.listeners.get(name) ?? [])]
    let index = -1
    const chain = async (): Promise<unknown> => {
      index += 1
      const listener = list[index]
      if (!listener) return terminal()
      return listener(payload, chain)
    }
    return chain()
  }

  /** 软截停窗口内拒绝检查（模拟工具执行前 guard 判定；官方 ToolExecution 携带 agent）。 */
  denyReason(exec: { name: unknown; agent?: { id?: unknown } }): string | undefined {
    for (const guard of this.guards) {
      const reason = guard(exec)
      if (reason !== undefined) return reason
    }
    return undefined
  }
}

const defaultDecision = (): unknown => ({ kind: 'enter', messages: [] })

/** 构造 childCtx + 护栏桥 + 贡献装配。 */
function setup(limit: number | undefined, childId = 'child-1') {
  const guard = createReactGuard()
  const ctx = new FakeChildCtx()
  const dispose = guard.contribution(ctx)
  guard.bridge.setLimit(childId, limit)
  const preStep = (turn: number): Promise<unknown> => ctx.dispatch('agent/pre-step', { agent: { id: childId }, turn }, defaultDecision)
  return { guard, ctx, dispose, preStep }
}

describe('ReAct 软截停护栏（guards.ts）', () => {
  it('未登记 child / 未设限：全程放行（waterfall 透传）', async () => {
    const { preStep } = setup(undefined, 'child-other')
    expect(await preStep(1)).toEqual({ kind: 'enter', messages: [] })
  })

  it('计步：上限前放行，达到上限后替换本步消息为强制收尾指令', async () => {
    const { preStep, ctx } = setup(3)
    expect(await preStep(1)).toEqual({ kind: 'enter', messages: [] }) // 第 1 步
    expect(await preStep(1)).toEqual({ kind: 'enter', messages: [] }) // 第 2 步
    const capped = (await preStep(1)) as { kind: string; messages: Array<{ content: Array<{ text: string }> }> }
    expect(capped.kind).toBe('enter')
    expect(capped.messages[0].content[0].text).toBe(REACT_CAP_MESSAGE)
    // 软截停窗口内持续替换（不重置计数）
    expect(((await preStep(1)) as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text).toBe(REACT_CAP_MESSAGE)
    expect(ctx.listenerCount('agent/pre-step')).toBe(1)
  })

  it('tools.guard 双保险：上限前放行，软截停窗口内拒绝并给出「已达迭代上限」原因', async () => {
    const { preStep, ctx } = setup(2)
    expect(ctx.denyReason({ name: 'read', agent: { id: 'child-1' } })).toBeUndefined()
    await preStep(1)
    await preStep(1) // 第 2 步触达上限
    expect(ctx.denyReason({ name: 'read', agent: { id: 'child-1' } })).toBe(REACT_CAP_DENY_REASON)
    expect(ctx.denyReason({ name: 'write', agent: { id: 'child-1' } })).toBe(REACT_CAP_DENY_REASON)
    // 空 id（防御）不影响判定
    expect(ctx.denyReason({ name: '' })).toBeUndefined()
  })

  it('consumeCapped：触达后消费 true、二次消费 false', async () => {
    const { guard, preStep } = setup(1)
    await preStep(1)
    expect(guard.bridge.consumeCapped('child-1')).toBe(true)
    expect(guard.bridge.consumeCapped('child-1')).toBe(false)
  })

  it('回合变化：新回合重置计数与软截停标记（未消费标记自然清除，工具恢复放行）', async () => {
    // A) 消费路径：编排器在 subagent/end 观察时消费标记
    const a = setup(2)
    await a.preStep(1)
    await a.preStep(1) // turn 1 触达上限
    expect(a.guard.bridge.consumeCapped('child-1')).toBe(true)
    expect(a.guard.bridge.consumeCapped('child-1')).toBe(false)

    // B) 未消费路径：新回合 pre-step 重置清除（不属于任何运行的 child 不残留）
    const b = setup(2)
    await b.preStep(1)
    await b.preStep(1) // turn 1 触达上限
    expect(b.ctx.denyReason({ name: 'read', agent: { id: 'child-1' } })).toBe(REACT_CAP_DENY_REASON)
    expect(await b.preStep(2)).toEqual({ kind: 'enter', messages: [] }) // 新回合第 1 步：放行
    expect(b.ctx.denyReason({ name: 'read', agent: { id: 'child-1' } })).toBeUndefined() // 工具恢复
    expect(b.guard.bridge.consumeCapped('child-1')).toBe(false) // 标记已被重置清除
    // 新回合重新计数：第 2 步再次触达
    expect(((await b.preStep(2)) as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text).toBe(REACT_CAP_MESSAGE)
  })

  it('drop 清除登记：护栏旁路 + 未消费标记清除', async () => {
    const { guard, preStep, ctx } = setup(1)
    await preStep(1)
    guard.bridge.drop('child-1')
    expect(guard.bridge.consumeCapped('child-1')).toBe(false) // drop 已清除标记
    expect(await preStep(1)).toEqual({ kind: 'enter', messages: [] }) // 登记清除后放行
    expect(ctx.denyReason({ name: 'read', agent: { id: 'child-1' } })).toBeUndefined()
  })

  it('贡献 disposer：移除 pre-step 监听（不再拦截）', async () => {
    const { preStep, ctx, dispose } = setup(1)
    await preStep(1)
    dispose()
    expect(ctx.listenerCount('agent/pre-step')).toBe(0)
    // 移除后即便仍触发也不替换
    expect(await preStep(1)).toEqual({ kind: 'enter', messages: [] })
  })

  it('tools 服务缺失：拒绝线失效但 pre-step 指令线仍有效（降级不失效）', async () => {
    const guard = createReactGuard()
    const ctx = { on: (name: string, listener: (payload: unknown, next?: () => Promise<unknown>) => unknown) => {
      if (name === 'agent/pre-step') listenerRef = listener
      return () => {}
    } }
    let listenerRef: ((payload: unknown, next?: () => Promise<unknown>) => unknown) | undefined
    guard.contribution(ctx as unknown as GuardChildContext)
    guard.bridge.setLimit('child-1', 1)
    expect(listenerRef).toBeDefined()
    const decision = await listenerRef!({ agent: { id: 'child-1' }, turn: 1 }, async () => defaultDecision())
    expect((decision as { kind: string }).kind).toBe('enter')
  })
})

// tests/host/agent/model-selection.test.ts
//
// 思考强度模型选择单测（T-022；V-02）：
//   - 官方 installModelSelection 双瀑布移植：system-prompt/assemble 注入 provider/model
//     变量并捕获 selection.assembled；agent/request 改写 provider/model/reasoningEffort
//     （无 effort 时清除继承值）；按官方时序先 assemble 后 request（assembled 由
//     组装期捕获，与官方 model-selection.ts L40-70 一致）；
//   - WeakMap 身份匹配 attach（贡献与 runner 解耦、并发创建无竞态）。
// 断言依据：需求文档 V-02、架构文档 §4.2 L220、官方 model-selection.ts L40-70。

import { describe, expect, it } from 'vitest'
import { createModelSelectionSetup, type SelectionChildContext } from '../../../src/host/agent/model-selection.js'

/** 最小 childCtx fake：waterfall 事件链（可变参：assemble 为 (assembly, context, next)）。 */
class FakeChildCtx implements SelectionChildContext {
  private listeners = new Map<string, Array<(payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown>>()

  on(name: string, listener: (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown): () => void {
    const list = this.listeners.get(name) ?? []
    list.push(listener)
    this.listeners.set(name, list)
    return () => {
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    }
  }

  /** 瀑布链派发：监听器依次执行（args 透传 + 尾位 next）；末位 next 返回终值。 */
  async dispatch(name: string, args: unknown[], terminal: () => Promise<unknown> | unknown): Promise<unknown> {
    const list = [...(this.listeners.get(name) ?? [])]
    let index = -1
    const chain = async (): Promise<unknown> => {
      index += 1
      const listener = list[index]
      if (!listener) return terminal()
      // args 逐个展开（数量由事件契约决定：pre-step/request 为 (payload, next)，
      // assemble 为 (assembly, context, next)）；测试内固定形状，运行时守卫见实现。
      return (listener as (...rest: unknown[]) => unknown)(...args, chain)
    }
    return chain()
  }
}

/** 官方时序：先组装（捕获 assembled）再请求（改写路由）。 */
async function assembleThenRequest(ctx: FakeChildCtx, config: () => unknown): Promise<unknown> {
  await ctx.dispatch('system-prompt/assemble', [{ variables: {} }, {}], async () => ({ variables: {} }))
  return ctx.dispatch('agent/request', [{}], async () => config())
}

describe('模型选择装配（model-selection.ts）', () => {
  it('agent/request：attach 后改写 provider/model 并写入 reasoningEffort（保留其他字段）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.contribution(ctx)
    setup.attach(ctx, { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' })

    const resolved = await assembleThenRequest(ctx, () => ({
      provider: 'old', model: 'old', reasoningEffort: 'low', maxTokens: 100,
    }))
    expect(resolved).toEqual({ maxTokens: 100, provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' })
  })

  it('agent/request：无 reasoningEffort 时清除继承 effort（恢复所选模型默认行为）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.contribution(ctx)
    setup.attach(ctx, { provider: 'deepseek', model: 'deepseek-chat' })

    const resolved = (await assembleThenRequest(ctx, () => ({
      provider: 'old', model: 'old', reasoningEffort: 'low', maxTokens: 50,
    }))) as Record<string, unknown>
    expect(resolved.provider).toBe('deepseek')
    expect(resolved.model).toBe('deepseek-chat')
    expect('reasoningEffort' in resolved).toBe(false)
    expect(resolved.maxTokens).toBe(50)
  })

  it('attach 前（selection 未挂接）：请求原样透传', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.contribution(ctx)
    const resolved = await assembleThenRequest(ctx, () => ({ provider: 'p', model: 'm' }))
    expect(resolved).toEqual({ provider: 'p', model: 'm' })
  })

  it('system-prompt/assemble：注入 provider/model 变量（selected 未挂接时原样）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.contribution(ctx)

    const before = await ctx.dispatch('system-prompt/assemble', [{ variables: { cwd: '/w' } }, {}], async () => ({ variables: { cwd: '/w' } }))
    expect(before).toEqual({ variables: { cwd: '/w' } })

    setup.attach(ctx, { provider: 'deepseek', model: 'deepseek-chat' })
    const after = await ctx.dispatch('system-prompt/assemble', [{ variables: { cwd: '/w' } }, {}], async () => ({ variables: { cwd: '/w' } }))
    expect(after).toEqual({ variables: { cwd: '/w', provider: 'deepseek', model: 'deepseek-chat' } })
  })

  it('attach 未登记 ctx：静默忽略（不抛错）——非本贡献创建的子代理旁路', () => {
    const setup = createModelSelectionSetup()
    expect(() => setup.attach({ on: () => () => {} }, { provider: 'x', model: 'y' })).not.toThrow()
  })

  it('disposer：移除两条瀑布监听后不再改写', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    const dispose = setup.contribution(ctx)
    setup.attach(ctx, { provider: 'deepseek', model: 'deepseek-chat' })
    dispose()
    const resolved = await ctx.dispatch('agent/request', [{}], async () => ({ provider: 'p', model: 'm' }))
    expect(resolved).toEqual({ provider: 'p', model: 'm' })
  })

  it('并发 attach 各自独立（身份匹配，无 pending 竞态）', async () => {
    const setup = createModelSelectionSetup()
    const ctxA = new FakeChildCtx()
    const ctxB = new FakeChildCtx()
    setup.contribution(ctxA)
    setup.contribution(ctxB)
    setup.attach(ctxA, { provider: 'pa', model: 'ma', reasoningEffort: 'low' })
    setup.attach(ctxB, { provider: 'pb', model: 'mb', reasoningEffort: 'high' })

    const resolvedA = await assembleThenRequest(ctxA, () => ({ provider: 'x', model: 'x' }))
    const resolvedB = await assembleThenRequest(ctxB, () => ({ provider: 'x', model: 'x' }))
    expect(resolvedA).toEqual({ provider: 'pa', model: 'ma', reasoningEffort: 'low' })
    expect(resolvedB).toEqual({ provider: 'pb', model: 'mb', reasoningEffort: 'high' })
  })

  it('withPending：创建窗口内的选择在首次组装即就位（首条请求即用成员模型）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()

    await setup.withPending({ provider: 'member', model: 'member-model' }, async () => {
      setup.contribution(ctx)
      return undefined
    })

    const resolved = await assembleThenRequest(ctx, () => ({ provider: 'parent', model: 'parent' }))
    expect(resolved).toEqual({ provider: 'member', model: 'member-model' })
  })

  it('withPending(undefined)：不写入选择（沿用官方继承路由）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()

    await setup.withPending(undefined, async () => {
      setup.contribution(ctx)
      return undefined
    })

    const resolved = await assembleThenRequest(ctx, () => ({ provider: 'parent', model: 'parent' }))
    expect(resolved).toEqual({ provider: 'parent', model: 'parent' })
  })

  it('remember + restore：重发布（冷恢复）后按 childId 重装选择', async () => {
    const setup = createModelSelectionSetup()
    setup.remember('child-1', { provider: 'member', model: 'member-model', reasoningEffort: 'high' })

    // 模拟冷恢复：全新的子代理作用域（selection 初始为空）
    const restored = new FakeChildCtx()
    setup.contribution(restored)
    setup.restore('child-1', restored)

    const resolved = await assembleThenRequest(restored, () => ({ provider: 'parent', model: 'parent' }))
    expect(resolved).toEqual({ provider: 'member', model: 'member-model', reasoningEffort: 'high' })
  })

  it('restore：无留存记录 / 非本贡献作用域时静默跳过（不抛错）', async () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.contribution(ctx)

    expect(() => setup.restore('child-unknown', ctx)).not.toThrow()
    const resolved = await assembleThenRequest(ctx, () => ({ provider: 'parent', model: 'parent' }))
    expect(resolved).toEqual({ provider: 'parent', model: 'parent' })
  })

  // ---------------------------------------------------------------------------
  // 按身份查询当前模型（经验评价的 evaluator_model 事实来源）：
  // 为什么必须有查询入口而不是让消费方各自推断：模型路由只在本装配内成事实，
  // 消费方（经验域）只能经此读取；读不到即「无法确定」，必须显式返回 null 而不是空对象。
  // ---------------------------------------------------------------------------

  it('test_按子代理身份查询模型_已留存选择时返回该选择_未留存时返回 null', () => {
    const setup = createModelSelectionSetup()
    setup.remember('child-1', { provider: 'member', model: 'member-model', reasoningEffort: 'high' })

    expect(setup.modelOf('child-1')).toEqual({ provider: 'member', model: 'member-model', reasoningEffort: 'high' })
    expect(setup.modelOf('child-unknown')).toBeNull()
    expect(setup.modelOf('')).toBeNull()
  })

  it('test_按会话查询父代理模型_已绑定会话时返回最新选择_未绑定时返回 null', () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.bindParent(ctx, { provider: 'root', model: 'root-model' }, 'session-1')

    expect(setup.parentModelOf('session-1')).toEqual({ provider: 'root', model: 'root-model' })
    expect(setup.parentModelOf('session-unknown')).toBeNull()
  })

  it('test_按会话查询父代理模型_会话内改选后返回最新值（官方 selection 可变语义）', () => {
    const setup = createModelSelectionSetup()
    const ctx = new FakeChildCtx()
    setup.bindParent(ctx, { provider: 'root', model: 'first' }, 'session-1')
    setup.bindParent(ctx, { provider: 'root', model: 'second' }, 'session-1')

    expect(setup.parentModelOf('session-1')?.model).toBe('second')
  })
})

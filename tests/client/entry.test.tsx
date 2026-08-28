// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/entry.test.tsx
//
// 入口单测（T-041）：样式注入（style[data-plugin]）、FAB 浮窗挂载（body 常驻）、
// 会话绑定跟随、slot 注册（order/label/inject）、dispose 清理 DOM 与样式。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply, rootSessionIdOf } from '../../src/client/entry.js'
import { zh } from '../../src/client/i18n.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** 入口 fake ctx：effect 立即执行收集 disposer；slots/locale/sessions 可注入。 */
function makeCtx(options: { currentSession?: string; locale?: unknown } = {}) {
  const disposers: Array<() => void> = []
  const registered: Array<Record<string, unknown>> = []
  const locale = options.locale ?? {
    register: vi.fn(),
    language: 'zh-CN',
  }
  const sessions = {
    list: {
      get: () => ({ current: options.currentSession ?? 'session-1' }),
      subscribe: vi.fn(() => () => {}),
    },
  }
  const ctx = {
    get: (name: string) => (name === 'locale' ? locale : name === 'sessions' ? sessions : null),
    effect: (fn: () => void | (() => void)) => {
      const result = fn()
      if (typeof result === 'function') disposers.push(result)
      return undefined
    },
    slots: {
      inject: vi.fn((_name: string, factory: () => unknown) => {
        const register = (options2: Record<string, unknown>): () => void => {
          registered.push(options2)
          return () => {}
        }
        factory()
        return register as unknown as () => void
      }),
      register: vi.fn((options2: Record<string, unknown>) => {
        registered.push(options2)
        return () => {}
      }),
    },
  }
  return { ctx, disposers, registered, locale, sessions }
}

describe('apply 装配', () => {
  it('样式注入：style[data-plugin=visual-workflow] 进入 head', async () => {
    const { ctx, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    const tag = document.querySelector('style[data-plugin="visual-workflow"]') as HTMLStyleElement
    expect(tag).toBeTruthy()
    expect(tag.textContent).toContain('.wf-fab')
    expect(tag.textContent).toContain('.wf-window')
    while (disposers.length > 0) disposers.pop()!()
  })

  it('FAB 常驻 body：浮窗容器 + 圆形按钮；点击展开窗口', async () => {
    const { ctx } = makeCtx({ currentSession: 'session-9' })
    await act(async () => { apply(ctx as never) })
    const host = document.getElementById('visual-workflow-float-host')
    expect(host).toBeTruthy()
    expect(document.body.contains(host)).toBe(true)
    const fab = document.querySelector('.wf-fab') as HTMLButtonElement
    expect(fab).toBeTruthy()
    expect(fab.getAttribute('aria-label')).toBe(zh.fabOpen)
    await act(async () => { fab.click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(windowEl).toBeTruthy()
    // 窗口内为工作台（标题顶栏 = 工作流设计器一行）
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
  })

  it('i18n 注册：locale.register 收到 zh/en 词典', async () => {
    const register = vi.fn()
    const { ctx, disposers } = makeCtx({ locale: { register } })
    await act(async () => { apply(ctx as never) })
    expect(register).toHaveBeenCalledWith('visualWorkflow', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    while (disposers.length > 0) disposers.pop()!()
  })

  it('不再注册 conversation.view 会话页 tab（用户验收批注：不要在这里注册插件入口）', async () => {
    const { ctx, registered, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    // registered 仅收集 slots 注册；插件入口仅保留 FAB + 浮窗
    expect(registered.find((entry) => entry.name === 'conversation.view')).toBeUndefined()
    while (disposers.length > 0) disposers.pop()!()
  })

  it('dispose：样式移除 + 浮窗容器移除（FAB 消失）', async () => {
    const { ctx, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    expect(document.querySelector('.wf-fab')).toBeTruthy()
    while (disposers.length > 0) disposers.pop()!()
    expect(document.querySelector('style[data-plugin="visual-workflow"]')).toBeNull()
    expect(document.getElementById('visual-workflow-float-host')).toBeNull()
    expect(document.querySelector('.wf-fab')).toBeNull()
  })
})

describe('rootSessionIdOf：会话树根解析（疑点二修复）', () => {
  /** 构造 sessions.list 快照：byId 含 parentSessionId 链。 */
  function snapshotOf(entries: Array<{ id: string; parentSessionId?: string }>) {
    const byId: Record<string, unknown> = {}
    for (const e of entries) byId[e.id] = { parentSessionId: e.parentSessionId }
    return { list: { get: () => ({ current: entries[0]?.id, byId }) } }
  }

  it('根会话自身：无父链时返回自身（行为不变）', () => {
    const snap = snapshotOf([{ id: 'session-root' }])
    expect(rootSessionIdOf('session-root', snap as never)).toBe('session-root')
  })

  it('子代理会话：沿 parentSessionId 上溯到根（主代理及其后代共享实例列表）', () => {
    // child-1 → root；child-2 → child-1 → root（两级子树）
    const snap = snapshotOf([
      { id: 'root', parentSessionId: undefined },
      { id: 'child-1', parentSessionId: 'root' },
      { id: 'child-2', parentSessionId: 'child-1' },
    ])
    expect(rootSessionIdOf('child-1', snap as never)).toBe('root')
    expect(rootSessionIdOf('child-2', snap as never)).toBe('root')
    expect(rootSessionIdOf('root', snap as never)).toBe('root')
  })

  it('快照不含 byId（旧运行时）或父不在表内时回退自身', () => {
    expect(rootSessionIdOf('session-x', { list: { get: () => ({ current: 'session-x' }) } } as never)).toBe('session-x')
    const snap = snapshotOf([{ id: 'orphan', parentSessionId: 'missing-parent' }])
    expect(rootSessionIdOf('orphan', snap as never)).toBe('orphan')
  })

  it('空会话 id 返回空串（未激活守卫）', () => {
    expect(rootSessionIdOf('', snapshotOf([]) as never)).toBe('')
  })
})

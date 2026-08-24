// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/entry.test.tsx
//
// 入口单测（T-041）：样式注入（style[data-plugin]）、FAB 浮窗挂载（body 常驻）、
// 会话绑定跟随、slot 注册（order/label/inject）、dispose 清理 DOM 与样式。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply } from '../../src/client/entry.js'
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
    getLocale: () => ({ active: 'zh' }),
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
    // 窗口内为工作台（会话绑定注入）
    expect(document.querySelector('.wf-titlebar__session')).toBeTruthy()
  })

  it('i18n 注册：locale.register 收到 zh/en 词典', async () => {
    const register = vi.fn()
    const { ctx, disposers } = makeCtx({ locale: { register } })
    await act(async () => { apply(ctx as never) })
    expect(register).toHaveBeenCalledWith('visualWorkflow', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    while (disposers.length > 0) disposers.pop()!()
  })

  it('conversation.view slot 注册：order 20 / id / label 工作流', async () => {
    const { ctx, registered, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    expect(registered.length).toBeGreaterThan(0)
    const view = registered.find((entry) => entry.name === 'conversation.view')
    expect(view).toBeTruthy()
    expect(view?.id).toBe('visual-workflow')
    expect(view?.order).toBe(20)
    expect(typeof view?.label === 'function' ? (view.label as () => string)() : view?.label).toBe(zh.libTab.workflow)
    expect(typeof view?.inject).toBe('function')
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

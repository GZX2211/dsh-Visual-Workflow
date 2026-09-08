// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/entry.test.tsx
//
// 入口单测（图1/图2 交互改造后契约）：样式注入（style[data-plugin]）、
// body 常驻宿主容器（WorkbenchHost）、官方侧边栏入口注入与点击打开、
// 会话绑定跟随、slot 注册（不再注册 conversation.view）、dispose 清理 DOM 与样式。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply, rootSessionIdOf } from '../../src/client/entry.js'
import { zh, en } from '../../src/client/i18n.js'

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

/** 模拟官方侧边栏底部「设置」按钮（useWorkbenchView 在其上方注入插件入口）。 */
function seedSettingButton(): HTMLButtonElement {
  const wrap = document.createElement('div')
  wrap.className = 'ds-x-settingsArea'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ds-x-trigger'
  btn.innerText = '设置'
  wrap.append(btn)
  document.body.append(wrap)
  return btn
}

/** 模拟官方 locale 服务（dsh-client-locale LocaleRuntime 最小形状）：可切换 active 并通知订阅者。 */
function makeFakeLocale(initial: string) {
  const listeners = new Set<() => void>()
  const snap = { active: initial, locales: [] as Array<unknown>, revision: 0 }
  const locale = {
    register: vi.fn(),
    getSnapshot: () => snap,
    getLocale: () => snap,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    switch: (next: string) => {
      snap.active = next
      snap.revision += 1
      for (const fn of listeners) fn()
    },
  }
  return locale
}

describe('apply 装配', () => {
  it('样式注入：style[data-plugin=visual-workflow] 进入 head，含浮窗/分栏/入口样式', async () => {
    const { ctx, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    const tag = document.querySelector('style[data-plugin="visual-workflow"]') as HTMLStyleElement
    expect(tag).toBeTruthy()
    expect(tag.textContent).toContain('.wf-window')
    expect(tag.textContent).toContain('.wf-titlebar__view')
    expect(tag.textContent).toContain('.wf-split-pane')
    while (disposers.length > 0) disposers.pop()!()
  })

  it('body 常驻宿主容器 + 官方侧边栏入口注入；点击打开浮窗工作台', async () => {
    seedSettingButton()
    const { ctx, disposers } = makeCtx({ currentSession: 'session-9' })
    await act(async () => { apply(ctx as never) })
    const host = document.getElementById('visual-workflow-workbench-host')
    expect(host).toBeTruthy()
    expect(document.body.contains(host)).toBe(true)
    const entry = document.querySelector('.wf-sidebar-entry') as HTMLButtonElement
    expect(entry).toBeTruthy()
    expect(document.querySelector('.wf-window')).toBeNull()
    await act(async () => { entry.click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(windowEl).toBeTruthy()
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
    while (disposers.length > 0) disposers.pop()!()
  })

  it('i18n 注册：locale.register 收到 zh/en 词典', async () => {
    const register = vi.fn()
    const { ctx, disposers } = makeCtx({ locale: { register } })
    await act(async () => { apply(ctx as never) })
    expect(register).toHaveBeenCalledWith('visualWorkflow', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    while (disposers.length > 0) disposers.pop()!()
  })

  it('语言切换：订阅 locale，active 变化后工作台与入口文案随语言重渲染', async () => {
    seedSettingButton()
    const locale = makeFakeLocale('zh')
    const { ctx, disposers } = makeCtx({ currentSession: 'session-9', locale })
    await act(async () => { apply(ctx as never) })
    // 打开工作台
    const entry = document.querySelector('.wf-sidebar-entry') as HTMLButtonElement
    expect(entry).toBeTruthy()
    await act(async () => { entry.click() })
    // 初始 zh：标题 + 入口文案
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
    expect(entry.querySelector('.wf-sidebar-entry__label')?.textContent).toBe(zh.workflows)
    // 切到 en → subscribe(render) 触发重渲染
    await act(async () => { locale.switch('en') })
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(en.studio)
    expect(entry.querySelector('.wf-sidebar-entry__label')?.textContent).toBe(en.workflows)
    while (disposers.length > 0) disposers.pop()!()
  })

  it('不再注册 conversation.view 会话页 tab（用户验收批注：不要在这里注册插件入口）', async () => {
    const { ctx, registered, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    expect(registered.find((entry) => entry.name === 'conversation.view')).toBeUndefined()
    while (disposers.length > 0) disposers.pop()!()
  })

  it('dispose：样式移除 + 宿主容器移除 + 入口移除', async () => {
    seedSettingButton()
    const { ctx, disposers } = makeCtx()
    await act(async () => { apply(ctx as never) })
    expect(document.querySelector('.wf-sidebar-entry')).toBeTruthy()
    while (disposers.length > 0) disposers.pop()!()
    expect(document.querySelector('style[data-plugin="visual-workflow"]')).toBeNull()
    expect(document.getElementById('visual-workflow-workbench-host')).toBeNull()
  })
})

describe('rootSessionIdOf：会话树根解析（疑点二修复）', () => {
  function snapshotOf(entries: Array<{ id: string; parentSessionId?: string }>) {
    const byId: Record<string, unknown> = {}
    for (const e of entries) byId[e.id] = { parentSessionId: e.parentSessionId }
    return { list: { get: () => ({ current: entries[0]?.id, byId }) } }
  }

  it('根会话自身：无父链时返回自身（行为不变）', () => {
    const snap = snapshotOf([{ id: 'session-root' }])
    expect(rootSessionIdOf('session-root', snap as never)).toBe('session-root')
  })

  it('子代理会话：沿 parentSessionId 上溯到根', () => {
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

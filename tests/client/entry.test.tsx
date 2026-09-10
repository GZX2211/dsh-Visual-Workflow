// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/entry.test.tsx
//
// 入口装配单测（DSH 0.1.5-rc.1 迁移后契约）：
//   ① 样式注入（style[data-plugin]）：含新的标签页挂载点样式与官方插槽入口样式，
//      **不含**已删除的浮窗/分栏/FAB 样式；
//   ② 常驻容器 + 隐藏 holder：Studio 挂载其中（永不卸载），且容器不在任何标签页 body 时停在 holder；
//   ③ 官方插槽三处注册：sidebarRightTabs 类型 / sidebar.right.pane.tab body / sidebar.footer.action 入口；
//      **不再**注册 conversation.view，且**不再**向官方侧边栏 DOM 注入任何入口按钮；
//   ④ i18n 注册与语言切换跟随；
//   ⑤ dispose 清理：样式、容器、插槽注册全释放。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply } from '../../src/client/entry.js'
import { getWorkbenchOpenHandler } from '../../src/client/sidebar/footer-entry.js'
import { zh, en } from '../../src/client/i18n.js'
import { WORKBENCH_TAB_ID } from '../../src/client/sidebar/workbench-tab.js'

const cleanups: Array<() => void> = []

afterEach(async () => {
  // 卸载常驻 React root 必须在 act 内（否则 React 报「update not wrapped in act」噪音）
  await act(async () => {
    while (cleanups.length > 0) cleanups.pop()!()
  })
  localStorage.clear()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** 模拟官方 locale 服务（LocaleRuntime 最小形状）：可切换 active 并通知订阅者。 */
function makeFakeLocale(initial: string) {
  const listeners = new Set<() => void>()
  const snap = { active: initial, locales: [] as Array<unknown>, revision: 0 }
  return {
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
}

/** 入口 fake ctx：effect 立即执行收集 disposer；inject 立即以同一 ctx 运行回调。 */
function makeCtx(options: { currentSession?: string; locale?: unknown; withSidebar?: boolean } = {}) {
  const disposers: Array<() => void> = []
  const registered: Array<Record<string, unknown>> = []
  const tabTypes: unknown[] = []
  const injectedDeps: string[][] = []
  const injectedSlots: string[] = []
  const unwoundRegistrations: string[] = []
  const locale = options.locale ?? { register: vi.fn(), language: 'zh-CN' }
  const sessions = {
    list: {
      getSnapshot: () => ({ current: options.currentSession ?? 'session-1', byId: {} }),
      subscribe: vi.fn(() => () => {}),
    },
  }
  const openTab = vi.fn()
  const selectPanel = vi.fn()
  const slots = {
    inject: (key: string, callback: () => unknown) => {
      injectedSlots.push(key)
      const produced = callback()
      return () => {
        unwoundRegistrations.push(key)
        if (typeof produced === 'function') (produced as () => void)()
      }
    },
    register: (registerOptions: Record<string, unknown>) => {
      registered.push(registerOptions)
      return () => {
        unwoundRegistrations.push(String(registerOptions.name))
      }
    },
  }
  const services: Record<string, unknown> = {
    locale,
    sessions,
    slots,
    sidebarRightTabs: {
      register: (definition: unknown) => {
        tabTypes.push(definition)
        return () => {
          unwoundRegistrations.push('sidebarRightTabs')
        }
      },
    },
  }
  if (options.withSidebar !== false) {
    services.sidebarRight = { openTab, active: () => undefined }
    services.layout = { selectPanel }
  }
  const ctx = {
    get: (name: string) => services[name] ?? null,
    effect: (fn: () => void | (() => void)) => {
      const result = fn()
      if (typeof result === 'function') disposers.push(result)
      return undefined
    },
    inject: (deps: string[], callback: (scoped: unknown) => void) => {
      injectedDeps.push(deps)
      callback(ctx)
      return undefined
    },
  }
  return { ctx, disposers, registered, tabTypes, injectedDeps, injectedSlots, unwoundRegistrations, openTab, selectPanel, locale, sessions }
}

/** 装配插件并登记清理。 */
async function mount(options: Parameters<typeof makeCtx>[0] = {}) {
  const harness = makeCtx(options)
  cleanups.push(() => { while (harness.disposers.length > 0) harness.disposers.pop()!() })
  await act(async () => { apply(harness.ctx as never) })
  return harness
}

describe('apply 装配', () => {
  it('样式注入：含标签页挂载点与官方插槽入口样式；不含已删除的浮窗/分栏/FAB 样式', async () => {
    await mount()
    const tag = document.querySelector('style[data-plugin="visual-workflow"]') as HTMLStyleElement
    expect(tag).toBeTruthy()
    const css = tag.textContent ?? ''
    expect(css).toContain('.wf-tab-mount')
    expect(css).toContain('.wf-sidebar-entry')
    expect(css).toContain('#visual-workflow-workbench-holder')
    // 回归：浮窗 / 分栏 / FAB / 窗口框架内容容器已随视图模式整体删除
    expect(css).not.toContain('.wf-window')
    expect(css).not.toContain('.wf-split-pane')
    expect(css).not.toContain('.wf-frame-content')
    expect(css).not.toContain('.wf-fab')
    expect(css).not.toContain('.wf-titlebar__view')
  })

  it('常驻容器停在隐藏 holder 内且 Studio 已挂载（无标签页 body 时也不卸载）', async () => {
    await mount({ currentSession: 'session-9' })
    const holder = document.getElementById('visual-workflow-workbench-holder')
    const host = document.getElementById('visual-workflow-workbench-host')
    expect(holder).toBeTruthy()
    expect(host).toBeTruthy()
    expect(host!.parentElement).toBe(holder)
    expect(document.body.contains(holder!)).toBe(true)
    // Studio 已在常驻容器内渲染（工作台内容随插件装配即就绪）
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
    // 不再有浮窗/分栏外壳
    expect(document.querySelector('.wf-window')).toBeNull()
    expect(document.querySelector('.wf-split-pane')).toBeNull()
  })

  it('官方插槽三处注册：类型 / body（key=id） / 入口；且不再注册 conversation.view', async () => {
    const h = await mount()
    // 通过 ctx.inject 悬挂（等服务就绪），依赖精确
    expect(h.injectedDeps).toEqual([['slots', 'sidebarRightTabs']])
    // 阶段一：类型
    expect(h.tabTypes).toHaveLength(1)
    expect((h.tabTypes[0] as { id: string }).id).toBe(WORKBENCH_TAB_ID)
    // 阶段二：body + 入口
    const names = h.registered.map((entry) => entry.name)
    expect(names).toContain('sidebar.right.pane.tab')
    expect(names).toContain('sidebar.footer.action')
    expect(h.registered.find((entry) => entry.name === 'sidebar.right.pane.tab')?.key).toBe(WORKBENCH_TAB_ID)
    expect(h.registered.find((entry) => entry.name === 'sidebar.footer.action')?.id).toBe('visual-workflow')
    // 用户验收批注：不得在 conversation.view 注册插件入口
    expect(names).not.toContain('conversation.view')
    // 非侵入：不再向官方侧边栏 DOM 注入任何入口节点
    expect(document.querySelector('[data-wf-entry]')).toBeNull()
    expect(h.injectedSlots).toEqual(['sidebar.right.pane.tab', 'sidebar.footer.action'])
  })

  it('i18n 注册：locale.register 收到 zh/en 词典', async () => {
    const register = vi.fn()
    await mount({ locale: { register } })
    expect(register).toHaveBeenCalledWith('visualWorkflow', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
  })

  it('语言切换：订阅 locale，active 变化后常驻工作台随语言重渲染', async () => {
    const locale = makeFakeLocale('zh')
    await mount({ currentSession: 'session-9', locale })
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
    await act(async () => { locale.switch('en') })
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(en.studio)
  })

  it('入口点击处理已装配：调用后打开工作台标签页（幂等聚焦）', async () => {
    const h = await mount()
    const opener = getWorkbenchOpenHandler()
    expect(opener).toBeTruthy()
    opener!()
    expect(h.openTab).toHaveBeenCalledTimes(1)
  })

  it('dispose：样式移除 + 常驻容器移除 + 插槽注册全部撤销 + 点击处理清空', async () => {
    const h = await mount()
    expect(document.querySelector('style[data-plugin="visual-workflow"]')).toBeTruthy()
    await act(async () => {
      while (h.disposers.length > 0) h.disposers.pop()!()
    })
    expect(document.querySelector('style[data-plugin="visual-workflow"]')).toBeNull()
    expect(document.getElementById('visual-workflow-workbench-host')).toBeNull()
    expect(document.getElementById('visual-workflow-workbench-holder')).toBeNull()
    // 插槽注册撤销（类型 + body + 入口）
    expect(h.unwoundRegistrations).toContain('sidebarRightTabs')
    expect(h.unwoundRegistrations).toContain('sidebar.right.pane.tab')
    expect(h.unwoundRegistrations).toContain('sidebar.footer.action')
    expect(getWorkbenchOpenHandler()).toBeNull()
  })

  it('sidebarRight 服务缺失（非 Web 组合）：装配不抛错，其余部分照常', async () => {
    const h = await mount({ withSidebar: false })
    const opener = getWorkbenchOpenHandler()
    expect(() => opener!()).not.toThrow()
    expect(document.getElementById('visual-workflow-workbench-host')).toBeTruthy()
    expect(h.tabTypes).toHaveLength(1)
  })
})

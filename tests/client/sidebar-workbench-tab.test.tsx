// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/sidebar-workbench-tab.test.tsx
//
// 工作台 → 官方右侧 Sidebar 标签页（DSH 0.1.5-rc.1 迁移核心）回归测试：
//   ① 类型定义形状：id/kind/priority/title；**刻意不含 patterns 与 guide**；
//   ② 两阶段注册形状：sidebarRightTabs.register(定义)；sidebar.right.pane.tab 按 **id** 注册 body，
//      且 slots.inject 的回调必须**返回** register 的 disposer（防「漏 return」回归）；
//   ③ 常驻容器挂载语义（状态保留的关键）：body 挂载 → 容器移入；卸载 → 交还下一个/隐藏 holder；
//      容器始终是**同一个 DOM 对象**（Studio 因此永不卸载）；
//   ④ 全屏缩回助手：仅在全屏时点官方模式按钮，非全屏保持原状。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import {
  WORKBENCH_TAB_ID,
  WORKBENCH_TAB_KIND,
  WORKBENCH_TAB_SLOT,
  WorkbenchTabBody,
  attachWorkbenchHost,
  injectWorkbenchTabBody,
  liveWorkbenchHostCount,
  registerWorkbenchTabType,
  setWorkbenchMountHost,
  shrinkOfficialSidebarIfFullscreen,
  workbenchTabDefinition,
} from '../../src/client/sidebar/workbench-tab.js'
import { resetWorkbenchDictForTest, setWorkbenchDict } from '../../src/client/sidebar/locale-bridge.js'
import { zh } from '../../src/client/i18n.js'

/** 常驻容器 + 隐藏 holder（模拟 entry.ts 的 apply 装配）。 */
function makeMountHost(): { holder: HTMLDivElement; container: HTMLDivElement } {
  const holder = document.createElement('div')
  holder.id = 'visual-workflow-workbench-holder'
  const container = document.createElement('div')
  container.id = 'visual-workflow-workbench-host'
  container.append(document.createElement('span')) // 模拟 Studio 子树（跨搬运保留）
  holder.append(container)
  document.body.append(holder)
  return { holder, container }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

afterEach(() => {
  setWorkbenchMountHost(null)
  resetWorkbenchDictForTest()
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// ① 类型定义形状
// ---------------------------------------------------------------------------

describe('workbenchTabDefinition：页面类型定义', () => {
  it('id / kind / priority 正确；**不含** patterns 与 guide（页面类型 + 不改官方默认页）', () => {
    const def = workbenchTabDefinition() as unknown as Record<string, unknown>
    expect(def.id).toBe(WORKBENCH_TAB_ID)
    expect(def.kind).toBe(WORKBENCH_TAB_KIND)
    expect(def.priority).toBe('builtin')
    // 无 patterns → 页面类型（按 kind 打开，不参与资源地址认领，绝不抢官方文件预览）
    expect(def.patterns).toBeUndefined()
    // 无 guide → 不改变官方 defaultSeed 判定（否则新面板默认页会从「文件」变成 guide 页）
    expect(def.guide).toBeUndefined()
  })

  it('id 与 kind 分离；title 是读取词典桥的 thunk（语言切换无需重新注册）', () => {
    const def = workbenchTabDefinition()
    expect(def.id).not.toBe(def.kind)
    setWorkbenchDict(zh)
    expect(def.title()).toBe(zh.workflows)
  })
})

// ---------------------------------------------------------------------------
// ② 两阶段注册形状
// ---------------------------------------------------------------------------

describe('注册装配形状（两阶段）', () => {
  it('阶段一：sidebarRightTabs.register(定义)，并把其 disposer 作为注销函数返回', () => {
    const inner = vi.fn()
    const register = vi.fn((_definition: unknown) => inner)
    const dispose = registerWorkbenchTabType({ register } as never)
    expect(register).toHaveBeenCalledTimes(1)
    const def = register.mock.calls[0]![0] as { id: string; kind: string }
    expect(def.id).toBe(WORKBENCH_TAB_ID)
    expect(def.kind).toBe(WORKBENCH_TAB_KIND)
    dispose()
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('阶段二：slots.inject(sidebar.right.pane.tab) 内按 **id** 注册 body；回调必须 return disposer', () => {
    const inner = vi.fn()
    const register = vi.fn(() => inner)
    const inject = vi.fn((_key: string, callback: () => unknown) => {
      const produced = callback()
      // 【关键回归】回调必须返回 register 的 disposer，否则插件卸载时不清理插槽注册
      expect(typeof produced).toBe('function')
      return produced
    })
    const dispose = injectWorkbenchTabBody({ inject, register } as never)

    expect(inject).toHaveBeenCalledTimes(1)
    expect(inject.mock.calls[0]![0]).toBe(WORKBENCH_TAB_SLOT)
    expect(register).toHaveBeenCalledTimes(1)
    const [options, component] = register.mock.calls[0]! as unknown as [Record<string, unknown>, unknown]
    expect(options.name).toBe(WORKBENCH_TAB_SLOT)
    // key 必须是 id 而非 kind（官方调度侧 entryKey = definition.id）
    expect(options.key).toBe(WORKBENCH_TAB_ID)
    expect(options.key).not.toBe(WORKBENCH_TAB_KIND)
    expect(component).toBe(WorkbenchTabBody)

    dispose()
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('slots 服务形状不符（缺 inject/register）：安全降级为空注销', () => {
    expect(typeof injectWorkbenchTabBody({} as never)).toBe('function')
    expect(injectWorkbenchTabBody({} as never)()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ③ 常驻容器挂载语义（状态保留的关键回归）
// ---------------------------------------------------------------------------

describe('常驻容器挂载语义：Studio 永不卸载（状态保留）', () => {
  it('无存活 body：容器停在隐藏 holder；容器对象与子树恒等', () => {
    const { holder, container } = makeMountHost()
    const child = container.firstElementChild
    setWorkbenchMountHost({ holder, container })
    expect(container.parentElement).toBe(holder)
    expect(liveWorkbenchHostCount()).toBe(0)
    expect(container.firstElementChild).toBe(child)
  })

  it('body 挂载 → 容器移入；卸载 → 交还 holder；容器始终是**同一个 DOM 对象**', () => {
    const { holder, container } = makeMountHost()
    const child = container.firstElementChild
    setWorkbenchMountHost({ holder, container })

    const hostA = document.createElement('div')
    document.body.append(hostA)
    const detachA = attachWorkbenchHost(hostA)
    expect(container.parentElement).toBe(hostA)
    expect(hostA.dataset.wfMount).toBe('held')

    detachA()
    expect(container.parentElement).toBe(holder)
    expect(container.firstElementChild).toBe(child) // 子树未重建 → Studio 状态原样
    expect(liveWorkbenchHostCount()).toBe(0)
  })

  it('多 body 并存：容器归最新挂载者，其余标 empty（渲染占位），卸载后交还前一个', () => {
    const { holder, container } = makeMountHost()
    setWorkbenchMountHost({ holder, container })

    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.append(hostA, hostB)

    const detachA = attachWorkbenchHost(hostA)
    expect(hostA.dataset.wfMount).toBe('held')
    expect(hostB.dataset.wfMount).toBeUndefined()

    const detachB = attachWorkbenchHost(hostB)
    expect(container.parentElement).toBe(hostB)
    expect(hostB.dataset.wfMount).toBe('held')
    expect(hostA.dataset.wfMount).toBe('empty')

    // B 卸载：容器交还仍存活的 A（工作台跟随用户最近一次的标签页）
    detachB()
    expect(container.parentElement).toBe(hostA)
    expect(hostA.dataset.wfMount).toBe('held')

    detachA()
    expect(container.parentElement).toBe(holder)
  })

  it('宿主清空（插件卸载）：容器不再被搬运', () => {
    const { holder, container } = makeMountHost()
    setWorkbenchMountHost({ holder, container })
    const host = document.createElement('div')
    document.body.append(host)
    setWorkbenchMountHost(null)
    const detach = attachWorkbenchHost(host)
    expect(container.parentElement).toBe(holder)
    detach()
  })
})

// ---------------------------------------------------------------------------
// body 组件
// ---------------------------------------------------------------------------

describe('WorkbenchTabBody：只承载常驻容器', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    root = null
    container?.remove()
    container = null
  })

  it('挂载后接管常驻容器；卸载后交还 holder；渲染占位提示与挂载点类名', async () => {
    const mount = makeMountHost()
    setWorkbenchMountHost(mount)
    setWorkbenchDict(zh)
    root = createRoot(container!)
    await act(async () => { root!.render(React.createElement(WorkbenchTabBody)) })

    const mountNode = document.querySelector('.wf-tab-mount') as HTMLElement
    expect(mountNode).toBeTruthy()
    expect(mount.container.parentElement).toBe(mountNode)
    expect(mountNode.dataset.wfMount).toBe('held')
    expect(mountNode.querySelector('.wf-tab-mount__placeholder')?.textContent).toBe(zh.workbenchInUse)

    await act(async () => { root!.unmount() })
    root = null
    expect(mount.container.parentElement).toBe(mount.holder)
  })
})

// ---------------------------------------------------------------------------
// ④ 全屏缩回助手
// ---------------------------------------------------------------------------

describe('shrinkOfficialSidebarIfFullscreen：官方右侧 Sidebar 全屏缩回', () => {
  /** 造一个官方面板 + 模式按钮（data-sidebar-right-mode 恒为「下一个模式」）。 */
  function seedPanel(fullscreen: boolean, withButton = true): HTMLButtonElement | null {
    const panel = document.createElement('div')
    panel.setAttribute('data-sidebar-right-panel', fullscreen ? 'fullscreen' : 'push')
    document.body.append(panel)
    if (!withButton) return null
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-sidebar-right-mode', fullscreen ? 'push' : 'fullscreen')
    document.body.append(button)
    return button
  }

  it('全屏中：点击官方模式按钮并返回 true', () => {
    const button = seedPanel(true)!
    const spy = vi.fn()
    button.addEventListener('click', spy)
    expect(shrinkOfficialSidebarIfFullscreen()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('非全屏：不点击、返回 false（保持原状）', () => {
    const button = seedPanel(false)!
    const spy = vi.fn()
    button.addEventListener('click', spy)
    expect(shrinkOfficialSidebarIfFullscreen()).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('全屏但找不到模式按钮：返回 false 且不抛错（官方结构变化时静默降级）', () => {
    seedPanel(true, false)
    expect(shrinkOfficialSidebarIfFullscreen()).toBe(false)
  })

  it('无面板：返回 false', () => {
    expect(shrinkOfficialSidebarIfFullscreen()).toBe(false)
  })
})

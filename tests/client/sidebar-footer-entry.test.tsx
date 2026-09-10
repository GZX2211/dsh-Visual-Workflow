// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/sidebar-footer-entry.test.tsx
//
// 入口按钮（官方 sidebar.footer.action 插槽）回归测试：
//   ① 注册形状（list 型插槽：name/id/order/label；id 用自有 id 落在官方条目旁）；
//   ② 组件渲染：宽屏含文案、折叠轨道加 --rail 类；语言切换跟随词典桥；
//   ③ 点击 → 模块级点击处理（幂等聚焦：只调 openTab，不切换收起）；
//   ④ openWorkbench 的三条路径：正常 / 服务缺失静默 / 无 seat 抛错时兜底导航 + 下一拍重试。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import {
  WORKBENCH_ENTRY_ORDER,
  WORKBENCH_ENTRY_SLOT,
  WorkbenchEntryButton,
  createWorkbenchOpener,
  getWorkbenchOpenHandler,
  injectWorkbenchEntry,
  setWorkbenchOpenHandler,
} from '../../src/client/sidebar/footer-entry.js'
import { WORKBENCH_TAB_KIND } from '../../src/client/sidebar/workbench-tab.js'
import { resetWorkbenchDictForTest, setWorkbenchDict } from '../../src/client/sidebar/locale-bridge.js'
import { en, zh } from '../../src/client/i18n.js'

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
  setWorkbenchOpenHandler(null)
  resetWorkbenchDictForTest()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// ① 注册形状
// ---------------------------------------------------------------------------

describe('injectWorkbenchEntry：官方 sidebar.footer.action 注册形状', () => {
  it('注册到 sidebar.footer.action；id/order/label 正确；回调必须 return disposer', () => {
    const inner = vi.fn()
    const register = vi.fn(() => inner)
    const inject = vi.fn((_key: string, callback: () => unknown) => {
      const produced = callback()
      expect(typeof produced).toBe('function')
      return produced
    })
    const dispose = injectWorkbenchEntry({ inject, register } as never)

    expect(inject.mock.calls[0]![0]).toBe(WORKBENCH_ENTRY_SLOT)
    const [options, component] = register.mock.calls[0]! as unknown as [Record<string, unknown>, unknown]
    expect(options.name).toBe(WORKBENCH_ENTRY_SLOT)
    expect(options.id).toBe('visual-workflow')
    expect(options.order).toBe(WORKBENCH_ENTRY_ORDER)
    expect(typeof options.label).toBe('function')
    // label thunk 每次读取当前词典（语言切换无需重新注册）
    setWorkbenchDict(zh)
    expect((options.label as () => string)()).toBe(zh.workflows)
    expect(component).toBe(WorkbenchEntryButton)

    dispose()
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('slots 服务形状不符：安全降级为空注销', () => {
    expect(typeof injectWorkbenchEntry({} as never)).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// ② 组件渲染与点击
// ---------------------------------------------------------------------------

describe('WorkbenchEntryButton：渲染与点击', () => {
  async function render(props: { wide?: boolean } = {}): Promise<void> {
    setWorkbenchDict(zh)
    root = createRoot(container!)
    await act(async () => { root!.render(React.createElement(WorkbenchEntryButton, props)) })
  }

  it('宽屏：普通类名 + 文案与 aria-label 均为「工作流」', async () => {
    await render({ wide: true })
    const button = document.querySelector('button.wf-sidebar-entry') as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.className).not.toContain('wf-sidebar-entry--rail')
    expect(button.getAttribute('aria-label')).toBe(zh.workflows)
    expect(button.querySelector('.wf-sidebar-entry__label')?.textContent).toBe(zh.workflows)
    expect(button.dataset.wfEntry).toBe('workflow')
  })

  it('折叠轨道（wide=false）：加 --rail 类（CSS 只留图标）', async () => {
    await render({ wide: false })
    expect((document.querySelector('button.wf-sidebar-entry') as HTMLButtonElement).className).toContain('wf-sidebar-entry--rail')
  })

  it('语言切换：词典桥广播后文案跟随（无需重新注册）', async () => {
    await render({ wide: true })
    await act(async () => { setWorkbenchDict(en) })
    const button = document.querySelector('button.wf-sidebar-entry') as HTMLButtonElement
    expect(button.querySelector('.wf-sidebar-entry__label')?.textContent).toBe(en.workflows)
    expect(button.getAttribute('aria-label')).toBe(en.workflows)
  })

  it('点击 → 调用模块级点击处理（未设置处理时为无操作、不抛错）', async () => {
    await render({ wide: true })
    const button = document.querySelector('button.wf-sidebar-entry') as HTMLButtonElement
    await act(async () => { button.click() }) // 未设置处理：安全无操作

    const handler = vi.fn()
    setWorkbenchOpenHandler(handler)
    expect(getWorkbenchOpenHandler()).toBe(handler)
    await act(async () => { button.click() })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// ④ openWorkbench 三条路径
// ---------------------------------------------------------------------------

describe('createWorkbenchOpener：打开工作台标签页', () => {
  it('正常路径：只调一次 openTab(kind)，不做兜底导航', () => {
    const openTab = vi.fn()
    const selectPanel = vi.fn()
    const opener = createWorkbenchOpener({
      get: (name: string) => (name === 'sidebarRight' ? { openTab } : name === 'layout' ? { selectPanel } : null),
    })
    opener()
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openTab).toHaveBeenCalledWith(WORKBENCH_TAB_KIND)
    expect(selectPanel).not.toHaveBeenCalled()
  })

  it('无 sidebarRight 服务（非 Web 组合）：静默无操作，不抛错', () => {
    const opener = createWorkbenchOpener({ get: () => null })
    expect(() => opener()).not.toThrow()
  })

  it('无挂载 seat（首页 / 全局面板）：回到会话界面并在下一拍重试一次', () => {
    vi.useFakeTimers()
    const openTab = vi.fn()
      .mockImplementationOnce(() => { throw new Error('sidebarRight: no session surface is mounted') })
      .mockImplementation(() => {})
    const selectPanel = vi.fn()
    const opener = createWorkbenchOpener({
      get: (name: string) => (name === 'sidebarRight' ? { openTab } : name === 'layout' ? { selectPanel } : null),
    })
    opener()
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(selectPanel).toHaveBeenCalledWith(null)
    vi.runAllTimers()
    expect(openTab).toHaveBeenCalledTimes(2)
  })

  it('重试仍失败：静默吞掉（不把宿主异常抛进 React 事件处理）', () => {
    vi.useFakeTimers()
    const openTab = vi.fn(() => { throw new Error('boom') })
    const opener = createWorkbenchOpener({ get: (name: string) => (name === 'sidebarRight' ? { openTab } : null) })
    expect(() => opener()).not.toThrow()
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(openTab).toHaveBeenCalledTimes(2)
  })
})

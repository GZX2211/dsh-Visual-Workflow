// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/toolbar/Toolbar.test.tsx
//
// 画布控制栏禁用态矩阵（D07-16 补缺）：本组件此前无独立用例，只有 Studio 装配层间接渲染。
// 逐条件锁定：无画布/无内容（canSave/canClear/canTidy/canHistory 全灰）、运行中（运行变停止、
// 停止不受 canSave 影响）、模式一/模式二文案差异、服务状态指示四态、模板态才显示「开启新会话」
// 及其工作区输入框。断言用户可观察的 disabled/文案/类名，不触碰内部实现。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Toolbar, type ToolbarProps } from '../../../../src/client/components/toolbar/Toolbar.js'
import { zh } from '../../../../src/client/i18n.js'

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
  vi.restoreAllMocks()
})

/** 默认：实例态、非运行、四个开关全开（各用例只改自己关心的条件）。 */
function props(partial: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    copy: zh,
    mode: 'mode1',
    panelsCollapsed: false,
    onTogglePanels: vi.fn(),
    saveLabel: zh.saveInstance,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onClear: vi.fn(),
    canClear: true,
    clearTitle: zh.clearRunningHint,
    onTidy: vi.fn(),
    canTidy: true,
    onSave: vi.fn(),
    canSave: true,
    running: false,
    onStop: vi.fn(),
    onRun: vi.fn(),
    onOpenHistory: vi.fn(),
    canHistory: true,
    serviceStatus: null,
    showNewSession: false,
    instanceOptions: { newSession: false, workspacePath: '' },
    onInstanceOptionsChange: vi.fn(),
    ...partial,
  }
}

function render(partial: Partial<ToolbarProps> = {}): ToolbarProps {
  const p = props(partial)
  act(() => {
    // 同一用例内可能需要多个条件组合：先卸载上一个根，避免同容器重复 createRoot
    root?.unmount()
    root = createRoot(container!)
    root.render(<Toolbar {...p} />)
  })
  return p
}

function buttonOf(text: string): HTMLButtonElement {
  const button = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

function hasButton(text: string): boolean {
  return [...container!.querySelectorAll('button')].some((item) => item.textContent === text)
}

describe('Toolbar 禁用态矩阵：画布/历史开关', () => {
  it('四项开关全灰（无画布/无内容）：清空、整理布局、保存、运行、运行历史都禁用', () => {
    render({ canClear: false, canTidy: false, canSave: false, canHistory: false })

    expect(buttonOf(zh.clear).disabled).toBe(true)
    expect(buttonOf(zh.tidy).disabled).toBe(true)
    expect(buttonOf(zh.saveInstance).disabled).toBe(true)
    // 运行按钮与保存同判据（运行前必须能落库）
    expect(buttonOf(zh.run).disabled).toBe(true)
    expect(buttonOf(zh.history).disabled).toBe(true)
  })

  it('全开：保存/清空/整理/历史可点；撤销重做始终可点（可用性由 history 面承载）', () => {
    render()

    expect(buttonOf(zh.clear).disabled).toBe(false)
    expect(buttonOf(zh.tidy).disabled).toBe(false)
    expect(buttonOf(zh.saveInstance).disabled).toBe(false)
    expect(buttonOf(zh.run).disabled).toBe(false)
    expect(buttonOf(zh.history).disabled).toBe(false)
    expect(buttonOf('↶').disabled).toBe(false)
    expect(buttonOf('↷').disabled).toBe(false)
  })

  it('单独禁用只影响自身：canClear=false 不牵连保存/运行/历史', () => {
    render({ canClear: false })

    expect(buttonOf(zh.clear).disabled).toBe(true)
    expect(buttonOf(zh.saveInstance).disabled).toBe(false)
    expect(buttonOf(zh.run).disabled).toBe(false)
    expect(buttonOf(zh.history).disabled).toBe(false)
    expect(buttonOf(zh.tidy).disabled).toBe(false)
  })
})

describe('Toolbar 运行态：运行/停止互斥', () => {
  it('运行中：出现「停止」（不因 canSave=false 而禁用），不再渲染「运行」', () => {
    const p = render({ running: true, canSave: false })

    expect(hasButton(zh.run)).toBe(false)
    expect(buttonOf(zh.stop).disabled).toBe(false)

    act(() => { buttonOf(zh.stop).click() })
    expect(p.onStop).toHaveBeenCalledTimes(1)
    expect(p.onRun).not.toHaveBeenCalled()
  })

  it('非运行：渲染「运行」并接 onRun；不出现「停止」', () => {
    const p = render({ running: false })

    expect(hasButton(zh.stop)).toBe(false)
    act(() => { buttonOf(zh.run).click() })
    expect(p.onRun).toHaveBeenCalledTimes(1)
    expect(p.onStop).not.toHaveBeenCalled()
  })

  it('运行中保存仍受 canSave 约束（禁用态矩阵相互独立）', () => {
    render({ running: true, canSave: false })
    expect(buttonOf(zh.saveInstance).disabled).toBe(true)

    render({ running: true, canSave: true })
    expect(buttonOf(zh.saveInstance).disabled).toBe(false)
  })
})

describe('Toolbar 模式差异与服务状态指示', () => {
  it('模式一运行按钮文案 = 「运行」；模式二 = 「启动服务」', () => {
    render({ mode: 'mode1' })
    expect(hasButton(zh.run)).toBe(true)
    expect(hasButton(zh.startService)).toBe(false)

    render({ mode: 'mode2' })
    expect(hasButton(zh.startService)).toBe(true)
    expect(hasButton(zh.run)).toBe(false)
  })

  it('模式二服务状态四态：运行中带端口 / 启动中（无端口）/ 崩溃 / 已停止', () => {
    render({ mode: 'mode2', serviceStatus: { status: 'running', port: 7877 } })
    expect(container!.querySelector('.wf-status')!.textContent).toBe(`${zh.serviceRunning} · 7877`)
    expect(container!.querySelector('.wf-status')!.classList.contains('is-running')).toBe(true)

    render({ mode: 'mode2', serviceStatus: { status: 'running' } })
    expect(container!.querySelector('.wf-status')!.textContent).toBe(zh.serviceStarting)

    render({ mode: 'mode2', serviceStatus: { status: 'crashed' } })
    const crashed = container!.querySelector('.wf-status')!
    expect(crashed.textContent).toBe(zh.serviceCrashed)
    expect(crashed.classList.contains('is-running')).toBe(false)

    render({ mode: 'mode2', serviceStatus: { status: 'stopped' } })
    expect(container!.querySelector('.wf-status')!.textContent).toBe(zh.serviceStopped)
  })

  it('模式一不显示服务状态；模式二无服务对象也不显示', () => {
    render({ mode: 'mode1', serviceStatus: { status: 'running', port: 7877 } })
    expect(container!.querySelector('.wf-status')).toBeNull()

    render({ mode: 'mode2', serviceStatus: null })
    expect(container!.querySelector('.wf-status')).toBeNull()
  })
})

describe('Toolbar 模板态临时选项（开启新会话/工作区）', () => {
  it('实例态（showNewSession=false）：不显示复选框与工作区输入框', () => {
    render({ showNewSession: false, instanceOptions: { newSession: true, workspacePath: 'D:/ws' } })

    expect(container!.querySelector('.wf-toolbar__switch')).toBeNull()
    expect(container!.querySelector('.wf-toolbar__workspace')).toBeNull()
  })

  it('模板态未勾选：显示复选框（未选中）且不显示工作区输入框', () => {
    render({ showNewSession: true, instanceOptions: { newSession: false, workspacePath: '' } })

    const checkbox = container!.querySelector<HTMLInputElement>('.wf-toolbar__switch input')!
    expect(checkbox.checked).toBe(false)
    expect(container!.querySelector('.wf-toolbar__workspace')).toBeNull()
  })

  it('模板态已勾选：复选框选中 + 显示工作区输入框（值为当前选项），变更各走回调', () => {
    const p = render({ showNewSession: true, instanceOptions: { newSession: true, workspacePath: 'D:/ws' } })

    const checkbox = container!.querySelector<HTMLInputElement>('.wf-toolbar__switch input')!
    expect(checkbox.checked).toBe(true)
    const workspace = container!.querySelector<HTMLInputElement>('.wf-toolbar__workspace')!
    expect(workspace.value).toBe('D:/ws')
    expect(workspace.placeholder).toBe(zh.workspacePlaceholder)

    act(() => {
      checkbox.click()
    })
    expect(p.onInstanceOptionsChange).toHaveBeenLastCalledWith({ newSession: false })
  })
})

describe('Toolbar 折叠按钮', () => {
  it('折叠状态切换类名，标题恒为两侧联动说明', () => {
    render({ panelsCollapsed: false })
    const expanded = container!.querySelector('.wf-toolbar__panels')!
    expect(expanded.classList.contains('is-collapsed')).toBe(false)
    expect(expanded.getAttribute('title')).toBe(zh.togglePanels)

    const p = render({ panelsCollapsed: true })
    const collapsed = container!.querySelector('.wf-toolbar__panels')!
    expect(collapsed.classList.contains('is-collapsed')).toBe(true)

    act(() => { (collapsed as HTMLButtonElement).click() })
    expect(p.onTogglePanels).toHaveBeenCalledTimes(1)
  })
})

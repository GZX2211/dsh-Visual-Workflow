// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/floating-window.test.tsx
//
// 浮窗单测（图2 交互改造后契约）：窗口已改为受控（open/onClose 由宿主驱动），
// 不再自绘 FAB（入口改为官方侧边栏，见 useWorkbenchView）。保留核心交互：
//   内容标题栏拖动（视口钳制 + 按钮目标忽略）、八方向缩放（最小/最大尺寸钳制）、
//   几何 localStorage 记忆、卸载清理。
// 窗口不再自绘标题栏：close/drag 经 children render-prop 注入内容（单一标题栏）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  FloatingWindow,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_BOUNDS_KEY,
  type WindowBounds,
} from '../../src/client/studio/floating-window.js'
import { zh } from '../../src/client/i18n.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})

function mount(): { root: Root; host: HTMLDivElement } {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { root.unmount() })
  return { root, host }
}

/** 内容模板：标题栏（可拖动）+ close 按钮 + 主体。 */
function content(api: { close(): void; drag(event: { button?: number; clientX: number; clientY: number; preventDefault?(): void }): void }) {
  return (
    <div className="wf-test-studio">
      <div className="wf-test-titlebar" onPointerDown={api.drag as never}>工作流设计器</div>
      <button type="button" className="wf-test-close" onClick={api.close}>×</button>
    </div>
  )
}

/** 受控 Harness：管理 open 状态（open 由 props 驱动，close → 关闭）。 */
function Harness({ open: initialOpen = true }: { open?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return <FloatingWindow t={zh} open={open} onClose={() => setOpen(false)}>{content}</FloatingWindow>
}

/** pointer 事件派发。 */
function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
}

describe('窗口开关（受控）', () => {
  it('open=true 渲染窗口；不再自绘 FAB；标题栏=内容标题栏', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh} open onClose={vi.fn()}>{content}</FloatingWindow>)
    })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(windowEl).toBeTruthy()
    expect(windowEl.querySelector('.wf-test-titlebar')?.textContent).toBe('工作流设计器')
    expect(document.querySelector('.wf-fab')).toBeNull()
    expect(document.querySelector('.wf-window__titlebar')).toBeNull()
  })

  it('open=false 不渲染窗口', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh} open={false} onClose={vi.fn()}>{content}</FloatingWindow>)
    })
    expect(document.querySelector('.wf-window')).toBeNull()
  })

  it('内容 close 按钮调用 onClose（宿主关闭工作台）', async () => {
    const { root } = mount()
    const onClose = vi.fn()
    await act(async () => {
      root.render(<FloatingWindow t={zh} open onClose={onClose}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-test-close') as HTMLButtonElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('窗口几何交互', () => {
  it('标题栏拖动更新位置（线性跟随 + 视口钳制）', async () => {
    const { root } = mount()
    await act(async () => { root.render(<Harness />) })
    const titlebar = document.querySelector('.wf-test-titlebar') as HTMLElement
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const beforeLeft = windowEl.style.left
    const beforeTop = windowEl.style.top
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 160, 140)
      pointer(window, 'pointerup', 160, 140)
    })
    expect(windowEl.style.left).not.toBe(beforeLeft)
    expect(windowEl.style.top).not.toBe(beforeTop)
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', -5000, -5000)
      pointer(window, 'pointerup', -5000, -5000)
    })
    const clamped = (document.querySelector('.wf-window') as HTMLElement).style
    expect(Number.parseInt(clamped.left, 10)).toBeGreaterThanOrEqual(0)
    expect(Number.parseInt(clamped.top, 10)).toBeGreaterThanOrEqual(0)
  })

  it('拖动忽略标题栏内按钮目标（点击按钮不拖动）', async () => {
    const { root } = mount()
    const contentWithButton = (api: { close(): void; drag(event: { button?: number; clientX: number; clientY: number; preventDefault?(): void }): void }) => (
      <div className="wf-test-titlebar" onPointerDown={api.drag as never}>
        <button type="button">打开</button>
      </div>
    )
    await act(async () => {
      root.render(<FloatingWindow t={zh} open onClose={vi.fn()}>{contentWithButton}</FloatingWindow>)
    })
    const button = document.querySelector('.wf-test-titlebar button') as HTMLButtonElement
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const beforeLeft = windowEl.style.left
    await act(async () => {
      pointer(button, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 400, 400)
      pointer(window, 'pointerup', 400, 400)
    })
    expect(windowEl.style.left).toBe(beforeLeft)
  })

  it('重复派发的 pointermove 不放大增量（防非线性滑动回归）', async () => {
    const { root } = mount()
    await act(async () => { root.render(<Harness />) })
    const titlebar = document.querySelector('.wf-test-titlebar') as HTMLElement
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const before = windowEl.getBoundingClientRect()
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 200, 200)
      pointer(window, 'pointermove', 200, 200)
      pointer(window, 'pointermove', 200, 200)
      pointer(window, 'pointerup', 200, 200)
    })
    const after = windowEl.getBoundingClientRect()
    expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(100)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(100)
  })

  it('四角缩放（se 方向）：最小 ± 最大尺寸钳制（不超出浏览器）', async () => {
    const { root } = mount()
    await act(async () => { root.render(<Harness />) })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const se = windowEl.querySelector('.wf-window__resize.is-se') as HTMLElement
    await act(async () => {
      pointer(se, 'pointerdown', 960, 640)
      pointer(window, 'pointermove', 1100, 720)
      pointer(window, 'pointerup', 1100, 720)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeGreaterThan(960)
    await act(async () => {
      pointer(se, 'pointerdown', 1100, 720)
      pointer(window, 'pointermove', 5000, 5000)
      pointer(window, 'pointerup', 5000, 5000)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(Number.parseInt(windowEl.style.height, 10)).toBeLessThanOrEqual(window.innerHeight - 8)
    await act(async () => {
      pointer(se, 'pointerdown', 1100, 720)
      pointer(window, 'pointermove', 0, 0)
      pointer(window, 'pointerup', 0, 0)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(Number.parseInt(windowEl.style.height, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
  })

  it('几何经 localStorage 记忆（位置/尺寸保存）', async () => {
    const { root } = mount()
    await act(async () => { root.render(<Harness />) })
    const titlebar = document.querySelector('.wf-test-titlebar') as HTMLElement
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 300, 220)
      pointer(window, 'pointerup', 300, 220)
    })
    const saved = JSON.parse(localStorage.getItem(WINDOW_BOUNDS_KEY) ?? '{}') as WindowBounds
    expect(saved.x).toBeGreaterThan(100)
    expect(saved.w).toBeLessThanOrEqual(window.innerWidth - 8)
  })
})

describe('卸载清理', () => {
  it('unmount 后窗口移除', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh} open onClose={vi.fn()}>{content}</FloatingWindow>)
    })
    expect(document.querySelector('.wf-window')).toBeTruthy()
    await act(async () => { root.unmount() })
    expect(document.querySelector('.wf-window')).toBeNull()
  })
})

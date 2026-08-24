// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/floating-window.test.tsx
//
// 浮窗单测（修复后契约）：FAB 开关窗口、内容标题栏拖动（视口钳制 + 按钮目标忽略）、
// 八方向缩放（最小/最大尺寸钳制）、几何 localStorage 记忆、卸载清理。
// 窗口不再自绘标题栏：close/drag 经 children render-prop 注入内容（单一标题栏）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
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

/** pointer 事件派发。 */
function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
}

describe('FAB 与窗口开关', () => {
  it('初始渲染 FAB；点击展开窗口（内容标题栏=窗口标题栏）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    const fab = document.querySelector('.wf-fab') as HTMLButtonElement
    expect(fab).toBeTruthy()
    expect(document.querySelector('.wf-window')).toBeNull()
    await act(async () => { fab.click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(windowEl).toBeTruthy()
    expect(windowEl.querySelector('.wf-test-titlebar')?.textContent).toBe('工作流设计器')
    // 窗口自绘标题栏不存在（合并为单一标题栏）
    expect(document.querySelector('.wf-window__titlebar')).toBeNull()
    expect((document.querySelector('.wf-fab') as HTMLButtonElement).hidden).toBe(true)
  })

  it('内容 close 按钮收起窗口（FAB 回归）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-window')).toBeTruthy()
    await act(async () => { (document.querySelector('.wf-test-close') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-window')).toBeNull()
    expect((document.querySelector('.wf-fab') as HTMLButtonElement).hidden).toBe(false)
  })
})

describe('窗口几何交互', () => {
  it('标题栏拖动更新位置（线性跟随 + 视口钳制）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
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
    // 越界拖动钳制在视口内（x >= 0）
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
      root.render(<FloatingWindow t={zh}>{contentWithButton}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
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
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const titlebar = document.querySelector('.wf-test-titlebar') as HTMLElement
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const before = windowEl.getBoundingClientRect()
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 200, 200)
      // 同一坐标重复派发（模拟事件重复/监听叠加场景）
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
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    const se = windowEl.querySelector('.wf-window__resize.is-se') as HTMLElement
    await act(async () => {
      pointer(se, 'pointerdown', 960, 640)
      pointer(window, 'pointermove', 1100, 720)
      pointer(window, 'pointerup', 1100, 720)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeGreaterThan(960)
    // 放大到超出视口 → 钳制 ≤ 视口宽
    await act(async () => {
      pointer(se, 'pointerdown', 1100, 720)
      pointer(window, 'pointermove', 5000, 5000)
      pointer(window, 'pointerup', 5000, 5000)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(Number.parseInt(windowEl.style.height, 10)).toBeLessThanOrEqual(window.innerHeight - 8)
    // 缩小到极小 → 最小尺寸兜底
    await act(async () => {
      pointer(se, 'pointerdown', 1100, 720)
      pointer(window, 'pointermove', 0, 0)
      pointer(window, 'pointerup', 0, 0)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(Number.parseInt(windowEl.style.height, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
  })

  it('几何经 localStorage 记忆（关闭重开恢复且 ≤ 视口）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const titlebar = document.querySelector('.wf-test-titlebar') as HTMLElement
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 300, 220)
      pointer(window, 'pointerup', 300, 220)
    })
    await act(async () => { (document.querySelector('.wf-test-close') as HTMLButtonElement).click() })
    const saved = JSON.parse(localStorage.getItem(WINDOW_BOUNDS_KEY) ?? '{}') as WindowBounds
    expect(saved.x).toBeGreaterThan(100)
    expect(saved.w).toBeLessThanOrEqual(window.innerWidth - 8)
    // 重开：位置从记忆恢复
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(Number.parseInt(windowEl.style.left, 10)).toBe(saved.x)
  })
})

describe('卸载清理', () => {
  it('unmount 后窗口/FAB 全部移除', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}>{content}</FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-window')).toBeTruthy()
    await act(async () => { root.unmount() })
    expect(document.querySelector('.wf-fab')).toBeNull()
    expect(document.querySelector('.wf-window')).toBeNull()
  })
})

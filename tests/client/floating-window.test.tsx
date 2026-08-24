// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/floating-window.test.ts
//
// 浮窗单测（T-041）：FAB 开关窗口、标题栏拖动（视口钳制）、八方向缩放
// （最小尺寸）、几何 localStorage 记忆、卸载清理。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  FloatingWindow,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_BOUNDS_KEY,
} from '../../src/client/studio/floating-window.js'
import { zh } from '../../src/client/i18n.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
})

function mount(): { root: Root; host: HTMLDivElement } {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { root.unmount() })
  return { root, host }
}

/** pointer 事件派发（jsdom 支持 PointerEvent 构造）。 */
function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
}

describe('FAB 与窗口开关', () => {
  it('初始渲染 FAB（右下角圆形按钮）；点击展开窗口', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}><div className="wf-test-body">工作台</div></FloatingWindow>)
    })
    const fab = document.querySelector('.wf-fab') as HTMLButtonElement
    expect(fab).toBeTruthy()
    expect(document.querySelector('.wf-window')).toBeNull()
    await act(async () => { fab.click() })
    const windowEl = document.querySelector('.wf-window') as HTMLElement
    expect(windowEl).toBeTruthy()
    expect(windowEl.querySelector('.wf-test-body')?.textContent).toBe('工作台')
    // FAB 隐藏
    expect((document.querySelector('.wf-fab') as HTMLButtonElement).hidden).toBe(true)
  })

  it('关闭按钮收起窗口（FAB 回归）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}><div /></FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    await act(async () => { (document.querySelector('.wf-window__close') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-window')).toBeNull()
    expect((document.querySelector('.wf-fab') as HTMLButtonElement).hidden).toBe(false)
  })
})

describe('窗口几何交互', () => {
  it('标题栏拖动更新位置（pointermove 跟随 + 边界钳制）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}><div /></FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const titlebar = document.querySelector('.wf-window__titlebar') as HTMLElement
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
  })

  it('四角缩放（se 方向）更新尺寸且不低于最小值', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}><div /></FloatingWindow>)
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
    expect(Number.parseInt(windowEl.style.height, 10)).toBeGreaterThan(640)
    // 缩小到极小 → 最小尺寸兜底
    await act(async () => {
      pointer(se, 'pointerdown', 1100, 720)
      pointer(window, 'pointermove', 10, 10)
      pointer(window, 'pointerup', 10, 10)
    })
    expect(Number.parseInt(windowEl.style.width, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(Number.parseInt(windowEl.style.height, 10)).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
  })

  it('几何经 localStorage 记忆（关闭重开恢复）', async () => {
    const { root } = mount()
    await act(async () => {
      root.render(<FloatingWindow t={zh}><div /></FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    const titlebar = document.querySelector('.wf-window__titlebar') as HTMLElement
    await act(async () => {
      pointer(titlebar, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 300, 220)
      pointer(window, 'pointerup', 300, 220)
    })
    await act(async () => { (document.querySelector('.wf-window__close') as HTMLButtonElement).click() })
    const saved = JSON.parse(localStorage.getItem(WINDOW_BOUNDS_KEY) ?? '{}') as { x: number; y: number }
    expect(saved.x).toBeGreaterThan(100)
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
      root.render(<FloatingWindow t={zh}><div /></FloatingWindow>)
    })
    await act(async () => { (document.querySelector('.wf-fab') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-window')).toBeTruthy()
    await act(async () => { root.unmount() })
    expect(document.querySelector('.wf-fab')).toBeNull()
    expect(document.querySelector('.wf-window')).toBeNull()
  })
})

beforeEach(() => {
  // 默认窗口几何与视口（jsdom 默认 1024x768）
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})

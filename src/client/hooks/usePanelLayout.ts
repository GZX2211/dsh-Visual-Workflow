// src/client/hooks/usePanelLayout.ts
//
// 面板几何：左/右/底三向 pointer 拖宽/拖高 + localStorage 持久化。
// 本次改造：显隐不再由几何布尔控制——左栏/底栏显隐由「折叠切换循环位置 mode」推导，
// 右侧属性栏显隐由选中对象是否具备属性推导；这里的几何仅负责宽度/高度与持久化。
// 折叠/切换按钮（Toolbar）经 Studio 的 nextPanelMode 推进循环，不在此处处理。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import { defaultPanels, type PanelLayout, type StudioAction, type StudioState } from '../studio/studio-state.js'
import { PANEL_CYCLE_LEN } from '../studio/studio-state.js'

/** 面板默认/记忆几何。 */
export const LEFT_PANEL_DEFAULT = 230
export const RIGHT_PANEL_DEFAULT = 230
export const BOTTOM_PANEL_DEFAULT = 170

/** localStorage 键（与旧项目兼容的左右宽度沿用；新增 mode/bottom-height）。 */
export const LAYOUT_KEYS = {
  mode: 'visual-workflow:panel-mode',
  leftWidth: 'visual-workflow:left-width',
  rightWidth: 'visual-workflow:right-width',
  bottomHeight: 'visual-workflow:bottom-height',
} as const

function storedNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function storedMode(fallback: number): number {
  try {
    const value = Number(localStorage.getItem(LAYOUT_KEYS.mode))
    return Number.isFinite(value) && value >= 0 && value < PANEL_CYCLE_LEN ? Math.floor(value) : fallback
  } catch {
    return fallback
  }
}

function keepLayout(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 忽略（隐私模式等）
  }
}

/** 读取持久化面板几何（组件初始化用）。 */
export function restorePanels(): PanelLayout {
  const fallback = defaultPanels()
  return {
    mode: storedMode(fallback.mode),
    leftWidth: storedNumber(LAYOUT_KEYS.leftWidth, fallback.leftWidth),
    rightWidth: storedNumber(LAYOUT_KEYS.rightWidth, fallback.rightWidth),
    bottomHeight: storedNumber(LAYOUT_KEYS.bottomHeight, fallback.bottomHeight),
  }
}

export interface PanelLayoutFace {
  /** 开始拖宽/拖高（side: left/right/bottom；pointermove 期间更新几何与持久化）。 */
  beginResize(side: 'left' | 'right' | 'bottom', event: {
    button?: number
    clientX: number
    clientY: number
    preventDefault?(): void
    currentTarget?: { classList?: { add(name: string): void; remove(name: string): void } }
  }): void
}

/** 面板几何面（当前几何在 state.panels；拖宽过程 dispatch PANELS_SET）。 */
export function usePanelLayout(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
): PanelLayoutFace {
  const beginResize = useCallback((side: 'left' | 'right' | 'bottom', event: {
    button?: number
    clientX: number
    clientY: number
    preventDefault?(): void
    currentTarget?: { classList?: { add(name: string): void; remove(name: string): void } }
  }) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    const panels = state.panels
    const isBottom = side === 'bottom'
    const base = side === 'left' ? panels.leftWidth : side === 'right' ? panels.rightWidth : panels.bottomHeight
    const startX = event.clientX
    const startY = event.clientY
    let lastValue = base
    const maximum = side === 'left'
      ? Math.max(180, Math.min(520, window.innerWidth * 0.46))
      : side === 'right'
        ? Math.max(180, Math.min(680, window.innerWidth * 0.46))
        : Math.max(120, Math.min(460, window.innerHeight * 0.5))
    const splitter = event.currentTarget
    const oldCursor = document.body.style.cursor
    const oldSelect = document.body.style.userSelect
    splitter?.classList?.add('is-dragging')
    document.body.style.cursor = isBottom ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (moveEvent: PointerEvent): void => {
      // 左栏向右拖 = 变宽；右栏向左拖 = 变宽；底栏向上拖 = 变高
      const delta = side === 'left'
        ? moveEvent.clientX - startX
        : side === 'right'
          ? startX - moveEvent.clientX
          : startY - moveEvent.clientY
      lastValue = Math.max(0, Math.min(maximum, base + delta))
      const next: Partial<PanelLayout> = side === 'left'
        ? { leftWidth: lastValue }
        : side === 'right'
          ? { rightWidth: lastValue }
          : { bottomHeight: lastValue }
      dispatch({ type: 'PANELS_SET', panels: next })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      splitter?.classList?.remove('is-dragging')
      document.body.style.cursor = oldCursor
      document.body.style.userSelect = oldSelect
      const final = Math.max(1, lastValue)
      if (side === 'left') keepLayout(LAYOUT_KEYS.leftWidth, String(final))
      else if (side === 'right') keepLayout(LAYOUT_KEYS.rightWidth, String(final))
      else keepLayout(LAYOUT_KEYS.bottomHeight, String(final))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // Bug 7：鼠标移出浏览器窗口后松开时 pointerup 可能不触发（取决于 OS），
    // 必须用 pointercancel + 窗口失焦兜底清理，否则 body cursor 永久停留在
    // col-resize、监听器残留，用户必须刷新页面才能恢复。
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
  }, [dispatch, state.panels])

  return { beginResize }
}

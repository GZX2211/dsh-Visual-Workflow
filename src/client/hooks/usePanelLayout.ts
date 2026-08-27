// src/client/hooks/usePanelLayout.ts
//
// 左/右面板几何：pointer 拖宽（开合阈值/最大值）+ localStorage 持久化。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import { defaultPanels, type PanelLayout, type StudioAction, type StudioState } from '../studio/studio-state.js'

/** 面板默认/记忆几何。 */
export const LEFT_PANEL_DEFAULT = 236
export const RIGHT_PANEL_DEFAULT = 300
/** 宽度低于该值视为收起。 */
export const PANEL_COLLAPSE_THRESHOLD = 90

/** localStorage 键（与旧项目一致，保留用户布局记忆）。 */
export const LAYOUT_KEYS = {
  leftOpen: 'visual-workflow:left-open',
  rightOpen: 'visual-workflow:right-open',
  leftWidth: 'visual-workflow:left-width',
  rightWidth: 'visual-workflow:right-width',
} as const

function storedNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
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
  const wide = typeof window !== 'undefined' && window.innerWidth > 1040
  return {
    leftOpen: storedBoolean(LAYOUT_KEYS.leftOpen, wide),
    rightOpen: storedBoolean(LAYOUT_KEYS.rightOpen, wide),
    leftWidth: storedNumber(LAYOUT_KEYS.leftWidth, LEFT_PANEL_DEFAULT),
    rightWidth: storedNumber(LAYOUT_KEYS.rightWidth, RIGHT_PANEL_DEFAULT),
  }
}

export interface PanelLayoutFace {
  /** 开始拖宽（side: left/right；pointermove 期间更新几何与持久化）。 */
  beginResize(side: 'left' | 'right', event: { button?: number; clientX: number; preventDefault?(): void; currentTarget?: { classList?: { add(name: string): void; remove(name: string): void } } }): void
}

/** 面板几何面（当前几何在 state.panels；拖宽过程 dispatch PANELS_SET）。 */
export function usePanelLayout(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
): PanelLayoutFace {
  const beginResize = useCallback((side: 'left' | 'right', event: { button?: number; clientX: number; preventDefault?(): void; currentTarget?: { classList?: { add(name: string): void; remove(name: string): void } } }) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    const isLeft = side === 'left'
    const panels = state.panels
    const wasOpen = isLeft ? panels.leftOpen : panels.rightOpen
    const remembered = isLeft ? panels.leftWidth : panels.rightWidth
    const fallback = isLeft ? LEFT_PANEL_DEFAULT : RIGHT_PANEL_DEFAULT
    const startWidth = wasOpen ? remembered : 0
    const startX = event.clientX
    let moved = false
    let lastWidth = startWidth
    const maximum = Math.max(180, Math.min(isLeft ? 520 : 680, window.innerWidth * 0.46))
    const splitter = event.currentTarget
    const oldCursor = document.body.style.cursor
    const oldSelect = document.body.style.userSelect
    splitter?.classList?.add('is-dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = isLeft ? moveEvent.clientX - startX : startX - moveEvent.clientX
      if (Math.abs(delta) > 3) moved = true
      lastWidth = Math.max(0, Math.min(maximum, startWidth + delta))
      const next: Partial<PanelLayout> = isLeft
        ? { leftOpen: lastWidth > 4, leftWidth: Math.max(1, lastWidth) }
        : { rightOpen: lastWidth > 4, rightWidth: Math.max(1, lastWidth) }
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
      let finalOpen = wasOpen
      if (!moved && !wasOpen) {
        lastWidth = Math.max(PANEL_COLLAPSE_THRESHOLD, remembered || fallback)
        finalOpen = true
      } else if (lastWidth < PANEL_COLLAPSE_THRESHOLD) {
        lastWidth = Math.max(PANEL_COLLAPSE_THRESHOLD, startWidth || remembered || fallback)
        finalOpen = false
      } else {
        finalOpen = true
      }
      const next: Partial<PanelLayout> = isLeft
        ? { leftOpen: finalOpen, leftWidth: lastWidth }
        : { rightOpen: finalOpen, rightWidth: lastWidth }
      dispatch({ type: 'PANELS_SET', panels: next })
      if (isLeft) {
        keepLayout(LAYOUT_KEYS.leftWidth, String(lastWidth))
        keepLayout(LAYOUT_KEYS.leftOpen, finalOpen ? '1' : '0')
      } else {
        keepLayout(LAYOUT_KEYS.rightWidth, String(lastWidth))
        keepLayout(LAYOUT_KEYS.rightOpen, finalOpen ? '1' : '0')
      }
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

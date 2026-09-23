// src/client/hooks/usePanelLayout.ts
//
// 面板几何：左/右/底三向 pointer 拖宽/拖高 + 几何与折叠态的 localStorage 记忆。
// 本次改造：显隐不再由几何布尔控制——左栏/底栏显隐由「折叠切换循环位置 mode」推导，
// 右侧属性栏显隐由选中对象是否具备属性推导；这里的几何仅负责宽度/高度与持久化。
// 折叠/切换按钮（Toolbar）经 Studio 的 nextPanelMode 推进循环，不在此处处理。
//
// 持久化落点（本体在 studio/panel-layout.ts，经 StorageLike 注入）：
//   - 几何：拖动结束（pointerup）写当前这一向；
//   - 折叠态：mode 变化时按值比对后写一次（不每次渲染写）；初始恢复在
//     useStudioState 初始化工厂完成（restorePanels）。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { PanelLayout, StudioAction, StudioState } from '../studio/studio-state.js'
import { keepPanelMode, keepPanelSize } from '../studio/panel-layout.js'

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
  /** 已持久化的折叠态：只在 mode 真正变化时写一次（初始恢复值不再回写，避免无谓写入）。 */
  const persistedModeRef = useRef(state.panels.mode)
  useEffect(() => {
    if (persistedModeRef.current === state.panels.mode) return
    persistedModeRef.current = state.panels.mode
    if (typeof window === 'undefined') return
    keepPanelMode(window.localStorage, state.panels.mode)
  }, [state.panels.mode])

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
      keepPanelSize(window.localStorage, side, final)
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

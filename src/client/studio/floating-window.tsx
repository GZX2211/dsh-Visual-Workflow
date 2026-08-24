// src/client/studio/floating-window.tsx
//
// 工作台浮窗入口：主界面右下角圆形 FAB + 独立窗口型页面。
// 窗口交互：标题栏拖动（视口边界钳制）；四边/四角 8 方向缩放（最小 480×320）；
// 几何经 localStorage 记忆（visual-workflow:window-bounds）；关闭后回到 FAB。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Dict } from '../i18n.js'

/** 窗口几何（像素；x/y 为窗口左上角）。 */
export interface WindowBounds {
  x: number
  y: number
  w: number
  h: number
}

/** 默认几何（视口右下偏上居中）。 */
export const DEFAULT_WINDOW_BOUNDS: WindowBounds = { x: 120, y: 60, w: 960, h: 640 }
/** 最小窗口尺寸。 */
export const MIN_WINDOW_WIDTH = 480
export const MIN_WINDOW_HEIGHT = 320
/** 几何持久化键。 */
export const WINDOW_BOUNDS_KEY = 'visual-workflow:window-bounds'

function restoreBounds(): WindowBounds {
  try {
    const raw = localStorage.getItem(WINDOW_BOUNDS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WindowBounds>
      const w = Number(parsed.w) || DEFAULT_WINDOW_BOUNDS.w
      const h = Number(parsed.h) || DEFAULT_WINDOW_BOUNDS.h
      const x = Number(parsed.x)
      const y = Number(parsed.y)
      const width = Math.max(MIN_WINDOW_WIDTH, Math.min(w, window.innerWidth - 40))
      const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(h, window.innerHeight - 40))
      return {
        x: Number.isFinite(x) ? Math.max(0, Math.min(x, window.innerWidth - width)) : DEFAULT_WINDOW_BOUNDS.x,
        y: Number.isFinite(y) ? Math.max(0, Math.min(y, window.innerHeight - height)) : DEFAULT_WINDOW_BOUNDS.y,
        w: width,
        h: height,
      }
    }
  } catch {
    // 几何记忆损坏/不可用 → 默认
  }
  return { ...DEFAULT_WINDOW_BOUNDS }
}

function keepBounds(bounds: WindowBounds): void {
  try {
    localStorage.setItem(WINDOW_BOUNDS_KEY, JSON.stringify(bounds))
  } catch {
    // 忽略（隐私模式等）
  }
}

/** 缩放方向（四边/四角）。 */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface DragState {
  startX: number
  startY: number
  bounds: WindowBounds
}

interface ResizeState extends DragState {
  direction: ResizeDirection
}

export interface FloatingWindowProps {
  /** 文案词典。 */
  t: Dict
  /** 窗口内容（工作台）。 */
  children: ReactNode
}

/**
 * FAB + 浮窗宿主：FAB 固定右下角；打开后渲染可拖动/可缩放的窗口。
 * 几何状态本地管理（与工作台状态机解耦），持久化记忆。
 */
export function FloatingWindow({ t, children }: FloatingWindowProps) {
  const [open, setOpen] = useState(false)
  const [bounds, setBounds] = useState<WindowBounds>(() => restoreBounds())
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  const clamp = useCallback((next: WindowBounds): WindowBounds => {
    const maxX = Math.max(0, window.innerWidth - next.w)
    const maxY = Math.max(0, window.innerHeight - next.h)
    return {
      x: Math.max(0, Math.min(next.x, maxX)),
      y: Math.max(0, Math.min(next.y, maxY)),
      w: next.w,
      h: next.h,
    }
  }, [])

  /** 标题栏拖动开始（视口边界钳制；几何变化即时持久化）。 */
  const beginDrag = useCallback((event: { button?: number; clientX: number; clientY: number; preventDefault?(): void }) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    dragRef.current = { startX: event.clientX, startY: event.clientY, bounds }
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const next = clamp({
        ...drag.bounds,
        x: drag.bounds.x + (moveEvent.clientX - drag.startX),
        y: drag.bounds.y + (moveEvent.clientY - drag.startY),
      })
      setBounds(next)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setBounds((current) => {
        keepBounds(current)
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [bounds, clamp])

  /** 八方向缩放开始（对边/对角按方向调整几何）。 */
  const beginResize = useCallback((direction: ResizeDirection, event: { button?: number; clientX: number; clientY: number; preventDefault?(): void }) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    resizeRef.current = { direction, startX: event.clientX, startY: event.clientY, bounds }
    const onMove = (moveEvent: PointerEvent): void => {
      const resize = resizeRef.current
      if (!resize) return
      const dx = moveEvent.clientX - resize.startX
      const dy = moveEvent.clientY - resize.startY
      let { x, y, w, h } = resize.bounds
      if (resize.direction.includes('e')) w = Math.max(MIN_WINDOW_WIDTH, resize.bounds.w + dx)
      if (resize.direction.includes('s')) h = Math.max(MIN_WINDOW_HEIGHT, resize.bounds.h + dy)
      if (resize.direction.includes('w')) {
        w = Math.max(MIN_WINDOW_WIDTH, resize.bounds.w - dx)
        x = resize.bounds.x + (resize.bounds.w - w)
      }
      if (resize.direction.includes('n')) {
        h = Math.max(MIN_WINDOW_HEIGHT, resize.bounds.h - dy)
        y = resize.bounds.y + (resize.bounds.h - h)
      }
      setBounds(clamp({ x, y, w, h }))
    }
    const onUp = (): void => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setBounds((current) => {
        keepBounds(current)
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [clamp])

  // 打开时几何收敛到视口（窗口尺寸变化后防止越界）
  useEffect(() => {
    if (!open) return
    setBounds((current) => clamp(current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      {/* FAB：主界面右下角圆形入口 */}
      <button
        type="button"
        className="wf-fab"
        aria-label={t.fabOpen}
        title={t.fabOpen}
        onClick={() => setOpen(true)}
        hidden={open}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path fill="currentColor" d="M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z" />
        </svg>
      </button>

      {/* 浮窗：可拖动标题栏 + 八方向缩放边 */}
      {open && (
        <section className="wf-window" style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }} data-wf-window="">
          <header className="wf-window__titlebar" onPointerDown={beginDrag}>
            <span className="wf-window__title">{t.windowTitle}</span>
            <span className="wf-window__badge">{t.badge}</span>
            <span className="wf-window__spacer" />
            <button type="button" className="wf-window__close" aria-label={t.windowClose} title={t.windowClose} onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="wf-window__body">{children}</div>
          {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((direction) => (
            <div
              key={direction}
              className={`wf-window__resize is-${direction}`}
              data-direction={direction}
              onPointerDown={(event) => beginResize(direction, event)}
            />
          ))}
        </section>
      )}
    </>
  )
}

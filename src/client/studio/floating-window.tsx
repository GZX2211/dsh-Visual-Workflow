// src/client/studio/floating-window.tsx
//
// 工作台浮窗入口：主界面右下角圆形 FAB + 独立窗口型页面。
//
// 窗口交互（修复"非线性快速滑动"的根因）：
//   - **单一常驻事件源**：pointermove/pointerup/pointercancel 只在 mount 时挂载一次
//     （effect + 卸载清理），pointerdown 仅登记会话 → 物理上不可能出现多组监听器
//     同时累加位移（此前 onMove 叠加是放大的根源）；
//   - **增量位移**：每次 move 只按 "当前事件坐标 - 上一事件坐标" 计算 dx/dy 并累加，
//     同一事件被重复派发时 dx=0，数学上杜绝倍数放大；
//   - **Pointer Capture**：pointerdown 捕获指针，拖出窗口/浏览器松开也能收到
//     pointerup/pointercancel，会话必然结束；
//   - **钳制**：x/y ≥ 0 且在视口内；尺寸最小 480×320、最大 ≤ 视口（防越界延展）；
//   - 几何样式以固定引用对象传递（React 重渲染不覆盖直写值）→ 无闪烁；
//   - 单一标题栏：浮窗不自绘标题栏，工作台标题顶栏兼任（children({ close, drag })）。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
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

export interface FloatingWindowProps {
  /** 文案词典。 */
  t: Dict
  /** 窗口内容（工作台）；close 关闭窗口、drag 把拖动把手挂到内容标题栏。 */
  children: (api: { close(): void; drag(event: DragEventLike): void }) => ReactNode
}

/** beginDrag/beginResize 事件最小形状（React 合成 PointerEvent 满足）。 */
export interface DragEventLike {
  button?: number
  clientX: number
  clientY: number
  pointerId?: number
  preventDefault?(): void
  target?: unknown
  currentTarget?: unknown
}

/** 活动交互会话（常驻监听器驱动；会话寄存器 + 增量位移）。 */
interface InteractionSession {
  kind: 'drag' | 'resize'
  pointerId: number
  lastX: number
  lastY: number
  bounds: WindowBounds
  direction?: ResizeDirection
}

/** 标题栏/缩放把手内的可交互节点（按钮等）不触发拖动。 */
function isInteractive(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element?.closest) return false
  return Boolean(element.closest('button, input, select, textarea, a'))
}

/** 几何钳制：视口内定位；尺寸最小 480×320、最大 = 视口（防延展超出浏览器）。 */
function clampBounds(next: WindowBounds): WindowBounds {
  const maxW = Math.max(MIN_WINDOW_WIDTH, window.innerWidth - 8)
  const maxH = Math.max(MIN_WINDOW_HEIGHT, window.innerHeight - 8)
  const w = Math.min(maxW, Math.max(MIN_WINDOW_WIDTH, next.w))
  const h = Math.min(maxH, Math.max(MIN_WINDOW_HEIGHT, next.h))
  const maxX = Math.max(0, window.innerWidth - w)
  const maxY = Math.max(0, window.innerHeight - h)
  return {
    x: Math.max(0, Math.min(next.x, maxX)),
    y: Math.max(0, Math.min(next.y, maxY)),
    w,
    h,
  }
}

/**
 * FAB + 浮窗宿主：FAB 固定右下角；打开后渲染可拖动/可缩放的窗口。
 * 几何状态本地管理（与工作台状态机解耦），持久化记忆。
 */
export function FloatingWindow({ t, children }: FloatingWindowProps) {
  const [open, setOpen] = useState(false)
  const [bounds, setBounds] = useState<WindowBounds>(() => restoreBounds())
  const windowRef = useRef<HTMLElement | null>(null)
  /** 几何 CSSProperties：固定引用（React 重渲染跳过该 style diff，不覆盖直写值）。 */
  const styleRef = useRef<CSSProperties>({})
  /** 活动会话（唯一；常驻监听器读取）。 */
  const sessionRef = useRef<InteractionSession | null>(null)
  /** 会话期间的 body 样式快照（常驻监听器在会话结束时恢复）。 */
  const bodyRestoreRef = useRef<{ cursor: string; userSelect: string } | null>(null)

  // 首渲染前置：以当前 bounds 初始化 styleRef（窗口首个帧即有几何；整体替换不修改）
  {
    styleRef.current = {
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.w}px`,
      height: `${bounds.h}px`,
    }
  }

  /**
   * 同步几何（唯一写路径）：
   *  - el.style 直接写（DOM 层，React 不感知，move 期间零重渲染）；
   *  - styleRef 整体替换为新对象（绝不修改 React 已看过的对象——React dev 会冻结它）。
   */
  const applyGeometry = useCallback((next: WindowBounds): void => {
    const el = windowRef.current
    if (el) {
      el.style.left = `${next.x}px`
      el.style.top = `${next.y}px`
      el.style.width = `${next.w}px`
      el.style.height = `${next.h}px`
    }
    styleRef.current = {
      left: `${next.x}px`,
      top: `${next.y}px`,
      width: `${next.w}px`,
      height: `${next.h}px`,
    }
  }, [])

  /** 提交几何（状态 + DOM + 持久化）。 */
  const commitBounds = useCallback((next: WindowBounds): void => {
    const clamped = clampBounds(next)
    applyGeometry(clamped)
    setBounds(clamped)
    keepBounds(clamped)
  }, [applyGeometry])

  // ---------------------------------------------------------------------------
  // 常驻事件源：mount 时挂载一次；会话结束时自动清理（指针捕获保证 up 必达）
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const session = sessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      const dx = event.clientX - session.lastX
      const dy = event.clientY - session.lastY
      // 增量：重复派发的同一事件 dx=0（数学上杜绝倍数放大）
      session.lastX = event.clientX
      session.lastY = event.clientY
      if (dx === 0 && dy === 0) return
      const base = session.bounds
      let next: WindowBounds
      if (session.kind === 'drag') {
        next = { ...base, x: base.x + dx, y: base.y + dy }
      } else {
        let { x, y, w, h } = base
        const direction = session.direction ?? 'se'
        if (direction.includes('e')) w = Math.max(MIN_WINDOW_WIDTH, w + dx)
        if (direction.includes('s')) h = Math.max(MIN_WINDOW_HEIGHT, h + dy)
        if (direction.includes('w')) {
          w = Math.max(MIN_WINDOW_WIDTH, w - dx)
          x = base.x + (base.w - w)
        }
        if (direction.includes('n')) {
          h = Math.max(MIN_WINDOW_HEIGHT, h - dy)
          y = base.y + (base.h - h)
        }
        next = { x, y, w, h }
      }
      const clamped = clampBounds(next)
      session.bounds = clamped
      applyGeometry(clamped)
    }
    const endSession = (event: PointerEvent): void => {
      const session = sessionRef.current
      if (!session) return
      if (event.pointerId !== session.pointerId) return
      sessionRef.current = null
      const restore = bodyRestoreRef.current
      if (restore) {
        document.body.style.cursor = restore.cursor
        document.body.style.userSelect = restore.userSelect
        bodyRestoreRef.current = null
      }
      commitBounds(session.bounds)
    }
    const onBlur = (): void => {
      const session = sessionRef.current
      if (!session) return
      sessionRef.current = null
      const restore = bodyRestoreRef.current
      if (restore) {
        document.body.style.cursor = restore.cursor
        document.body.style.userSelect = restore.userSelect
        bodyRestoreRef.current = null
      }
      commitBounds(session.bounds)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endSession)
    window.addEventListener('pointercancel', endSession)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endSession)
      window.removeEventListener('pointercancel', endSession)
      window.removeEventListener('blur', onBlur)
      sessionRef.current = null
      const restore = bodyRestoreRef.current
      if (restore) {
        document.body.style.cursor = restore.cursor
        document.body.style.userSelect = restore.userSelect
        bodyRestoreRef.current = null
      }
    }
  }, [applyGeometry, commitBounds])

  /** 标题栏拖动开始（登记会话 + Pointer Capture；按钮/输入目标忽略）。 */
  const beginDrag = useCallback((event: DragEventLike): void => {
    if (event.button !== undefined && event.button !== 0) return
    if (isInteractive((event.target as EventTarget | null) ?? null)) return
    event.preventDefault?.()
    const pointerId = Number(event.pointerId) || 0
    const target = event.currentTarget as Element | null | undefined
    try {
      target?.setPointerCapture?.(pointerId)
    } catch {
      // 不支持/已捕获：忽略（常驻监听器 + pointercancel/blur 仍保证会话结束）
    }
    bodyRestoreRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    document.body.style.cursor = 'move'
    document.body.style.userSelect = 'none'
    sessionRef.current = {
      kind: 'drag',
      pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      bounds,
    }
  }, [bounds])

  /** 八方向缩放开始（同上）。 */
  const beginResize = useCallback((direction: ResizeDirection, event: DragEventLike): void => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    const pointerId = Number(event.pointerId) || 0
    const target = event.currentTarget as Element | null | undefined
    try {
      target?.setPointerCapture?.(pointerId)
    } catch {
      // 忽略
    }
    bodyRestoreRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    document.body.style.cursor = 'se-resize'
    document.body.style.userSelect = 'none'
    sessionRef.current = {
      kind: 'resize',
      pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      bounds,
      direction,
    }
  }, [bounds])

  // 打开时几何收敛到视口（窗口尺寸变化后防止越界）
  useEffect(() => {
    if (!open) return
    commitBounds(bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      {/* FAB：主界面右下角圆形入口（独立于 .wf-root，变量经 :root 全局化） */}
      <button
        type="button"
        className="wf-fab"
        aria-label={t.fabOpen}
        title={t.fabOpen}
        onClick={() => setOpen(true)}
        hidden={open}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style={{ color: 'currentColor' }}>
          <path fill="currentColor" d="M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z" />
        </svg>
      </button>

      {/* 浮窗：内容自身标题栏 = 窗口标题栏（可拖动 + 关闭）；边缘八方向缩放 */}
      {open ? (
        <section
          ref={windowRef}
          className="wf-window"
          style={styleRef.current}
          data-wf-window=""
        >
          <div className="wf-window__body">
            {children({ close: () => setOpen(false), drag: beginDrag })}
          </div>
          {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((direction) => (
            <div
              key={direction}
              className={`wf-window__resize is-${direction}`}
              data-direction={direction}
              onPointerDown={(event) => beginResize(direction, event)}
            />
          ))}
        </section>
      ) : null}
    </>
  )
}

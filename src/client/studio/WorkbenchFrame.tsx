// src/client/studio/WorkbenchFrame.tsx
//
// 工作台统一窗口框架（修复「切换窗口丢失全部状态」的根因）：
//   - 旧实现（WorkbenchHost 双分支）在 float/split 两个分支各渲染一份 <Studio>，
//     切换视图模式时 React 因根节点类型不同（FloatingWindow → div.wf-split-pane）
//     卸载并重建整个 Studio 子树——画布内容、未保存修改、运行快照、轮询结果、
//     选中实例、面板布局等全部内存状态随之丢失（已实证）。
//   - 本组件把两种视图模式合并为**同一个组件实例**：float/split 只是外壳的
//     className/几何样式与交互（浮窗拖拽缩放 / 分栏分隔线）不同；
//     **内容容器（.wf-frame-content）恒为根元素的第 0 个子节点**，React 对同一
//     位置的同一类型子树只更新 props、不卸载——Studio 跨模式切换保持挂载，
//     一切状态与布局原样保留，「切换窗口」退化为纯视图切换、零副作用。
//   - 运行联动（浮窗点「运行」→ 自动切分栏 + 收侧栏）由 Studio 层 handleRun
//     组合（view.setViewMode('split') + PANELS_SET），与切换按钮互不干扰。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampBounds,
  isInteractive,
  keepBounds,
  restoreBounds,
  type DragEventLike,
  type InteractionSession,
  type ResizeDirection,
  type WindowBounds,
} from './floating-window.js'
import { clampSplitWidth } from './useWorkbenchView.js'

/** 窗口框架给内容（Studio）的 api：close 关闭工作台；drag 标题栏拖动把手（仅浮窗生效）。 */
export interface WorkbenchFrameApi {
  close: () => void
  drag: (event: DragEventLike) => void
}

export interface WorkbenchFrameProps {
  /** 视图模式：float=悬浮窗口（可拖/缩放）；split=分栏窗口（右侧固定 + 可拖分隔线）。 */
  mode: 'float' | 'split'
  /** 关闭回调（标题栏 ×；分栏模式不渲染关闭按钮，由 WorkbenchHost 决定传不传）。 */
  onClose: () => void
  /** 当前分栏宽度（px；split 模式分隔线拖动回传）。 */
  splitWidth: number
  /** 分隔线拖动回传新宽度（宿主持久化 + 更新官方对话列内边距）。 */
  onResize: (width: number) => void
  /** 内容渲染（Studio）；api.close/api.drag 供标题栏使用。 */
  children: (api: WorkbenchFrameApi) => ReactNode
}

/** 八向缩放把手方向（仅浮窗模式渲染）。 */
const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/**
 * 工作台统一窗口框架：children（Studio）恒挂载于框架内，视图模式切换不重建。
 * 浮窗几何（bounds）本地管理并持久化；切换分栏再切回时几何原样恢复。
 */
export function WorkbenchFrame({ mode, onClose, splitWidth, onResize, children }: WorkbenchFrameProps) {
  const isFloat = mode === 'float'
  const [bounds, setBounds] = useState<WindowBounds>(() => restoreBounds())
  const shellRef = useRef<HTMLElement | null>(null)
  /** 几何 CSSProperties：固定引用（React 重渲染跳过该 style diff，不覆盖直写值）。 */
  const styleRef = useRef<CSSProperties>({})
  /** 活动会话（唯一；常驻监听器读取；仅浮窗拖拽/缩放使用）。 */
  const sessionRef = useRef<InteractionSession | null>(null)
  /** 会话期间的 body 样式快照（常驻监听器在会话结束时恢复）。 */
  const bodyRestoreRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  /** 最近一次浮窗几何（split 期间不展示但保留，切回 float 时按记忆还原）。 */
  const boundsRef = useRef(bounds)

  // 首渲染前置：以当前 bounds 初始化 styleRef（首个帧即有几何；整体替换不修改）
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
    const el = shellRef.current
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
    boundsRef.current = clamped
    applyGeometry(clamped)
    setBounds(clamped)
    keepBounds(clamped)
  }, [applyGeometry])

  // ---------------------------------------------------------------------------
  // 浮窗拖拽/缩放：常驻事件源（mount 时挂载一次；会话结束时自动清理）
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
      if (!session || event.pointerId !== session.pointerId) return
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
      bounds: boundsRef.current,
    }
  }, [])

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
      bounds: boundsRef.current,
      direction,
    }
  }, [])

  /** 分栏分隔线拖动开始（split 模式；常驻 window 监听；结束恢复）。 */
  const beginDividerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault?.()
    const pointerId = Number(event.pointerId) || 0
    const target = event.currentTarget as Element | null | undefined
    try {
      target?.setPointerCapture?.(pointerId)
    } catch {
      // 忽略（不支持/已捕获）
    }
    // 分栏宽度 = 视口右缘 - 当前 x（工作台 fixed 贴右侧，divider 在其左缘）
    const right = window.innerWidth
    const onMove = (moveEvent: PointerEvent): void => {
      onResize(clampSplitWidth(right - moveEvent.clientX))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
  }, [onResize])

  // 挂载/切回浮窗时几何收敛到视口（窗口尺寸变化后防止越界；split 期间仅记忆不展示）
  useEffect(() => {
    if (!isFloat) return
    commitBounds(bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFloat])

  return (
    <section
      ref={shellRef}
      className={isFloat ? 'wf-window' : 'wf-split-pane'}
      style={isFloat ? styleRef.current : undefined}
      data-wf-frame={mode}
    >
      {/* 内容容器恒为根元素第 0 个子节点（位置/类型恒定）→ Studio 跨模式保持挂载，
          视图切换只改外壳类名与后续兄弟节点，不触发子树重建。 */}
      <div className="wf-frame-content">
        {children({ close: onClose, drag: beginDrag })}
      </div>
      {/* 浮窗：八向缩放把手（渲染在内容之后，属于兄弟节点增删，不影响内容实例） */}
      {isFloat
        ? RESIZE_DIRECTIONS.map((direction) => (
            <div
              key={direction}
              className={`wf-window__resize is-${direction}`}
              data-direction={direction}
              onPointerDown={(event) => beginResize(direction, event)}
            />
          ))
        : null}
      {/* 分栏：左侧分隔线（absolute 定位覆盖在左缘；DOM 顺序在内容之后，React 稳定） */}
      {isFloat ? null : (
        <div
          className="wf-split-divider"
          role="separator"
          aria-orientation="vertical"
          title="拖动调节分栏宽度"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, zIndex: 12, cursor: 'col-resize', touchAction: 'none' }}
          onPointerDown={beginDividerDrag}
        />
      )}
    </section>
  )
}
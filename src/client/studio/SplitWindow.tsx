// src/client/studio/SplitWindow.tsx
//
// 分栏窗口（图2 交互改造）：插件工作台以 fixed 定位覆盖官方页面右侧（见 WorkbenchHost）。
//   本组件渲染在工作台 fixed 容器（.wf-split-pane）内：
//   - 左侧一条可拖分隔线（.wf-split-divider），拖动改变分栏宽度（onResize）；
//   - 主体为插件工作台（children = Studio），样式与悬浮窗口内的工作台完全一致。
//   「左侧官方对话区」由 useWorkbenchView 在 split 时给官方 centerCol 设右内边距实现
//   （本组件不复制官方 DOM，也不触碰官方 frame 网格）。
//
// 说明：本组件不修改官方源码；仅作为分栏工作台的 React 内容宿主。

import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { officialCenterCol, clampSplitWidth } from './useWorkbenchView.js'

export interface SplitWindowProps {
  /** 插件工作台（Studio）。 */
  children: ReactNode
  /** 当前分栏宽度（px）。 */
  splitWidth: number
  /** 拖拽分隔线过程中回传新宽度（宿主持久化 + 更新 centerCol 内边距）。 */
  onResize: (width: number) => void
}

/** 分栏窗口：右侧工作台 + 左侧可拖分隔线。 */
export function SplitWindow({ children, onResize }: SplitWindowProps) {
  const dividerRef = useRef<HTMLDivElement | null>(null)

  /** 分隔线拖动开始（常驻 window 监听；结束恢复）。 */
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
      const width = clampSplitWidth(right - moveEvent.clientX)
      onResize(width)
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

  return (
    <div className="wf-split-pane__inner" data-wf-split-inner="">
      <div
        ref={dividerRef}
        className="wf-split-divider"
        role="separator"
        aria-orientation="vertical"
        title="拖动调节分栏宽度"
        onPointerDown={beginDividerDrag}
      />
      <div className="wf-split-pane__content">
        {children}
      </div>
    </div>
  )
}

export { officialCenterCol }

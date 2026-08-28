// src/client/hooks/useLibraryDrag.ts
//
// 左侧库卡片拖拽（pointer 事件，照搬旧项目 beginLibraryDrag）：拖拽预览、
// 协作组卡片悬停高亮，落点在画布内放置节点 / 落点在协作组卡片表面入组。
// 返回 beginLibraryDrag 与拖拽状态（dragPreview / dropGroupId）。

import { useCallback, useRef, useState } from 'react'
import type { DragPayload } from '../components/sidebar/LeftPanel.js'
import type { CanvasApi } from '../components/canvas/GraphCanvas.js'
import { groupSurfaceUnderPoint } from '../components/canvas/geometry.js'

export interface LibraryDragFace {
  beginLibraryDrag(event: React.PointerEvent, payload: DragPayload): void
  dragPreview: { x: number; y: number; label: string } | null
  dropGroupId: string | null
}

/** 左侧库拖拽面（canvasShellRef/canvasApiRef 供落点换算；payload 由 LeftPanel 注入）。 */
export function useLibraryDrag(
  canvasShellRef: React.RefObject<HTMLDivElement | null>,
  canvasApiRef: React.RefObject<CanvasApi | null>,
): LibraryDragFace {
  // 拖拽现场（payload + 起点 + 预览位置）；指针事件期间唯一权威源
  const dragRef = useRef<{ payload: DragPayload; startX: number; startY: number; preview: { x: number; y: number } | null } | null>(null)
  const [dropGroupId, setDropGroupId] = useState<string | null>(null)
  const beginLibraryDrag = useCallback((event: React.PointerEvent, payload: DragPayload) => {
    if (event.button !== undefined && event.button !== 0) return
    dragRef.current = {
      payload,
      startX: event.clientX,
      startY: event.clientY,
      preview: null,
    }
    // 最后一次有效指针位置（pointercancel/blur 场景无落点坐标，取消放置）
    let lastClient: { x: number; y: number } | null = null
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      lastClient = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (!drag.preview && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) > 5) {
        drag.preview = { x: moveEvent.clientX, y: moveEvent.clientY }
        setDragPreview({ x: moveEvent.clientX, y: moveEvent.clientY, label: payload.label })
      } else if (drag.preview) {
        drag.preview = { x: moveEvent.clientX, y: moveEvent.clientY }
        setDragPreview({ x: moveEvent.clientX, y: moveEvent.clientY, label: payload.label })
      }
      // 拖拽悬停检测：仅协作组卡片表面（非连接点）→ 高亮 + 提示；
      // 只有角色模板（含 onDropIntoGroup）才提示，其他卡片（文件/数据库/阶段）不显示悬浮提示、不能入组
      setDropGroupId(payload.onDropIntoGroup ? groupSurfaceUnderPoint(moveEvent.clientX, moveEvent.clientY) : null)
    }
    const onUp = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      setDragPreview(null)
      setDropGroupId(null)
      if (!drag?.preview) {
        payload.onClick?.()
        return
      }
      // pointercancel / blur：没有有效指针落点，仅收尾不放置
      if (!lastClient) return
      const rect = canvasShellRef.current?.getBoundingClientRect()
      if (!rect || lastClient.x < rect.left || lastClient.x > rect.right || lastClient.y < rect.top || lastClient.y > rect.bottom) {
        return
      }
      // 左栏角色模板直接拖入协作组：仅落点为协作组卡片表面（非连接点）时生成节点并入组（§4.2.5.2 规则 1）
      const groupId = groupSurfaceUnderPoint(lastClient.x, lastClient.y) ?? ''
      if (groupId && payload.onDropIntoGroup) {
        payload.onDropIntoGroup(groupId)
        return
      }
      const position = canvasApiRef.current?.screenToWorld?.(lastClient.x, lastClient.y)
      payload.onDrop?.({
        x: Math.round((position?.x ?? 120) - 104),
        y: Math.round((position?.y ?? 80) - 58),
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 鼠标移出浏览器窗口/失焦时 pointerup 可能不触发（Bug 7 同款兜底），
    // pointercancel + blur 一并清理，避免 dragRef 残留与监听器泄漏。
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
  }, [])
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; label: string } | null>(null)

  return { beginLibraryDrag, dragPreview, dropGroupId }
}

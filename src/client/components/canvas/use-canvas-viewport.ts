// src/client/components/canvas/use-canvas-viewport.ts
//
// 画布视口（纯视口关心）：平移/缩放/适配视图/坐标换算，以及经 onInit 上报 CanvasApi。
// 从 GraphCanvas 拆出——交互（节点拖拽、连线、组拉伸）与视口是两个独立的变更原因。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasNode } from '../../studio/studio-state.js'
import { GRAPH_NODE_SIZE, nodeSizeOf } from '../../lib/card-geometry.js'
import { GRAPH_MAX_ZOOM, GRAPH_MIN_ZOOM, clamp } from './geometry.js'

export interface CanvasApi {
  fitView(options?: { padding?: number; nodes?: CanvasNode[] }): void
  focusNode(id: string, options?: { zoom?: number }): void
  zoomIn(): void
  zoomOut(): void
  screenToWorld(clientX: number, clientY: number): { x: number; y: number }
}

export interface Viewport { x: number; y: number; zoom: number }

export interface PanSession { startX: number; startY: number; originX: number; originY: number }

export interface CanvasViewportFace {
  /** 画布根元素（坐标换算与平移起点）。 */
  rootRef: React.RefObject<HTMLDivElement | null>
  /** 当前视口（渲染 transform 用）。 */
  viewport: Viewport
  /** 视口的最新值（事件回调里读取，避免闭包过期）。 */
  viewportRef: React.RefObject<Viewport>
  updateViewport(value: Viewport | ((current: Viewport) => Viewport)): void
  /** 适配视图（画布控制栏与自动布局共用）。 */
  fitView(options?: { padding?: number; nodes?: CanvasNode[] }): void
  /** 平移会话（非空 = 正在平移，用于 cursor 与监听器生命周期）。 */
  panning: PanSession | null
  beginPan(event: React.PointerEvent): void
  zoomBy(factor: number): void
  screenToWorld(clientX: number, clientY: number): { x: number; y: number }
}

export function useCanvasViewport(nodes: CanvasNode[], onInit: (api: CanvasApi) => void): CanvasViewportFace {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<Viewport>({ x: 32, y: 32, zoom: 0.8 })
  const [viewport, setViewport] = useState<Viewport>({ x: 32, y: 32, zoom: 0.8 })
  const [panning, setPanning] = useState<PanSession | null>(null)

  const updateViewport = useCallback((value: Viewport | ((current: Viewport) => Viewport)): void => {
    setViewport((current) => {
      const next = typeof value === 'function' ? value(current) : value
      viewportRef.current = next
      return next
    })
  }, [])

  const fitView = useCallback((options: { padding?: number; nodes?: CanvasNode[] } = {}): void => {
    const root = rootRef.current
    if (!root || nodes.length === 0) return
    const rect = root.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const requestedIds = new Set((options.nodes ?? []).map((node) => typeof node === 'string' ? node : node.id).filter(Boolean))
    const visibleNodes = requestedIds.size > 0 ? nodes.filter((node) => requestedIds.has(node.id)) : nodes
    if (visibleNodes.length === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of visibleNodes) {
      const size = nodeSizeOf(node)
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + size.w)
      maxY = Math.max(maxY, node.position.y + size.h)
    }
    const padding = Math.max(36, Math.min(rect.width, rect.height) * Number(options.padding ?? 0.16))
    const zoom = clamp(
      Math.min((rect.width - padding * 2) / Math.max(1, maxX - minX), (rect.height - padding * 2) / Math.max(1, maxY - minY)),
      GRAPH_MIN_ZOOM, 1.15,
    )
    updateViewport({
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    })
  }, [nodes, updateViewport])

  const focusNode = useCallback((id: string, options: { zoom?: number } = {}): void => {
    const root = rootRef.current
    const node = nodes.find((candidate) => candidate.id === id)
    if (!root || !node) return
    const rect = root.getBoundingClientRect()
    const zoom = clamp(Number(options.zoom ?? Math.max(viewportRef.current.zoom, 0.96)), GRAPH_MIN_ZOOM, 1.15)
    updateViewport({
      x: rect.width / 2 - (node.position.x + GRAPH_NODE_SIZE.w / 2) * zoom,
      y: rect.height / 2 - (node.position.y + GRAPH_NODE_SIZE.h / 2) * zoom,
      zoom,
    })
  }, [nodes, updateViewport])

  const zoomBy = useCallback((factor: number): void => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const current = viewportRef.current
    const zoom = clamp(current.zoom * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
    const ratio = zoom / current.zoom
    updateViewport({ zoom, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio })
  }, [updateViewport])

  const screenToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - viewportRef.current.x) / viewportRef.current.zoom,
      y: (clientY - rect.top - viewportRef.current.y) / viewportRef.current.zoom,
    }
  }, [])

  useEffect(() => {
    onInit({ fitView, focusNode, zoomIn: () => zoomBy(1.2), zoomOut: () => zoomBy(1 / 1.2), screenToWorld })
  }, [onInit, fitView, focusNode, zoomBy, screenToWorld])

  // ---- 画布平移 ----
  const beginPan = useCallback((event: React.PointerEvent): void => {
    if (event.button !== undefined && event.button !== 0) return
    setPanning({ startX: event.clientX, startY: event.clientY, originX: viewportRef.current.x, originY: viewportRef.current.y })
  }, [])

  useEffect(() => {
    if (!panning) return undefined
    const onMove = (event: PointerEvent): void => {
      updateViewport({
        ...viewportRef.current,
        x: panning.originX + (event.clientX - panning.startX),
        y: panning.originY + (event.clientY - panning.startY),
      })
    }
    const onUp = (): void => setPanning(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [panning, updateViewport])

  // ---- 缩放（滚轮） ----
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const current = viewportRef.current
      const rect = root.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      const factor = Math.exp(-event.deltaY * 0.0012)
      const zoom = clamp(current.zoom * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
      const ratio = zoom / current.zoom
      updateViewport({ zoom, x: mx - (mx - current.x) * ratio, y: my - (my - current.y) * ratio })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [updateViewport])

  return { rootRef, viewport, viewportRef, updateViewport, fitView, panning, beginPan, zoomBy, screenToWorld }
}

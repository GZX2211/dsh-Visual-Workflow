// src/client/components/canvas/GraphCanvas.tsx
//
// 自研 SVG 画布（照搬旧项目 graph-canvas.js，TSX 化 + 新模型适配）。
// 节点为绝对定位 HTML 卡片（左 db/ctx/flow 入点、右 ctx/flow/db 出点），连线为
// SVG 贝塞尔曲线；支持拖拽、平移、缩放、连线、条件标签、运行态高亮、空画布引导。
// 协作组卡片渲染成员迷你列表（组内成员节点以迷你形态叠加于组内）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js'
import { conditionLabel } from '../../lib/graph-model.js'
import { FlowNode } from './FlowNode.js'
import { GroupCard } from './GroupCard.js'
import { connectionTargetAt, groupSurfaceUnderPoint, edgeGeometry, GRAPH_NODE_SIZE, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM, nodeSizeOf, clamp } from './geometry.js'

export interface CanvasApi {
  fitView(options?: { padding?: number; nodes?: CanvasNode[] }): void
  focusNode(id: string, options?: { zoom?: number }): void
  zoomIn(): void
  zoomOut(): void
  screenToWorld(clientX: number, clientY: number): { x: number; y: number }
}

export interface GraphCanvasProps {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  copy: Dict & { modeName(id: string | null | undefined): string }
  mode: 'mode1' | 'mode2'
  selectedNode: string | null
  selectedEdge: string | null
  runStatusByNode: Record<string, { status: string; attempts: number; outputSummary: string }>
  highlightedNodeIds: string[]
  onInit(api: CanvasApi): void
  onNodeDragStart(): void
  onNodeMove(id: string, position: { x: number; y: number }): void
  /** 角色节点拖入协作组（需求 §4.2.5.2 规则 1）。 */
  onNodeDropToGroup(nodeId: string, groupId: string): void
  onNodeSelect(id: string): void
  onEdgeSelect(id: string): void
  onPaneClick(): void
  onConnect(connection: { source: string; target: string; sourceHandle: string; targetHandle: string }): void
  onConnectionRejected(): void
  onGroupResize(id: string, size: { w: number; h: number }): void
  /** 左栏拖拽悬停的协作组 id（组卡片高亮 + 「放开以入组」提示）。 */
  dropTargetGroupId?: string | null
  fitLabel: string
  zoomInLabel: string
  zoomOutLabel: string
  emptyHint: string
}

interface Viewport { x: number; y: number; zoom: number }

export function GraphCanvas(props: GraphCanvasProps) {
  const {
    nodes, edges, copy, mode, selectedNode, selectedEdge, runStatusByNode, highlightedNodeIds,
    onInit, onNodeDragStart, onNodeMove, onNodeDropToGroup, onNodeSelect, onEdgeSelect, onPaneClick,
    onConnect, onConnectionRejected, onGroupResize, dropTargetGroupId, fitLabel, zoomInLabel, zoomOutLabel, emptyHint,
  } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<Viewport>({ x: 32, y: 32, zoom: 0.8 })
  const [viewport, setViewport] = useState<Viewport>({ x: 32, y: 32, zoom: 0.8 })
  const [panning, setPanning] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const [draggingNode, setDraggingNode] = useState<{ nodeId: string; startClientX: number; startClientY: number; originX: number; originY: number } | null>(null)
  /** 画布内节点拖拽时悬停的协作组 id（组卡片高亮 + 「放开以入组」提示）。 */
  const [dragHoverGroupId, setDragHoverGroupId] = useState<string | null>(null)
  const [connectionDraft, setConnectionDraft] = useState<{ source: string; sourceHandle: string; clientX: number; clientY: number; start: { x: number; y: number } } | null>(null)
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const highlightedSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds])
  const runStatusOf = (id: string): { status: string; attempts: number; outputSummary: string } | null => runStatusByNode[id] ?? null

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

  // ---- 节点拖拽 ----
  const beginNodeDrag = useCallback((event: React.PointerEvent, nodeId: string): void => {
    if (event.button !== undefined && event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest?.('.wf-graph__handle')) return
    if (target.closest?.('.wf-group__resize')) return
    event.stopPropagation()
    const node = byId.get(nodeId)
    if (!node) return
    onNodeSelect?.(nodeId)
    onNodeDragStart?.()
    setDragHoverGroupId(null)
    setDraggingNode({
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
    })
  }, [byId, onNodeSelect, onNodeDragStart])

  useEffect(() => {
    if (!draggingNode) return undefined
    const onMove = (event: PointerEvent): void => {
      const current = viewportRef.current
      const dx = (event.clientX - draggingNode.startClientX) / current.zoom
      const dy = (event.clientY - draggingNode.startClientY) / current.zoom
      onNodeMove?.(draggingNode.nodeId, {
        x: Math.round(draggingNode.originX + dx),
        y: Math.round(draggingNode.originY + dy),
      })
      // 悬停检测：仅「角色节点」拖到协作组表面才高亮（排除被拖拽本体；连接点不具入组功能；
      // 角色以外的卡片（文件/数据库/阶段/虚拟）不显示悬浮提示、也不能入组，用户批注）
      const dragged = byId.get(draggingNode.nodeId)
      const canJoinGroup = !!dragged && (dragged.kind === 'parent' || dragged.kind === 'agent')
      setDragHoverGroupId(canJoinGroup ? groupSurfaceUnderPoint(event.clientX, event.clientY, draggingNode.nodeId) : null)
    }
    const onUp = (event: PointerEvent): void => {
      // 拖入协作组：角色节点落在协作组表面（不含连接点）时入组；被拖拽节点已排除，
      // 避免「节点覆盖在组上方」导致 elementFromPoint 命中自身而无法入组（用户批注）。
      const node = byId.get(draggingNode.nodeId)
      const groupId = groupSurfaceUnderPoint(event.clientX, event.clientY, draggingNode.nodeId)
      if (node && (node.kind === 'parent' || node.kind === 'agent') && groupId && groupId !== node.id
        && !((node.data.groupId as string | null | undefined) ?? null)) {
        onNodeDropToGroup?.(node.id, groupId)
        setDraggingNode(null)
        setDragHoverGroupId(null)
        return
      }
      setDraggingNode(null)
      setDragHoverGroupId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [draggingNode, byId, onNodeMove, onNodeDropToGroup, setDragHoverGroupId])

  // ---- 连线 ----
  const beginConnection = useCallback((event: React.PointerEvent, nodeId: string, handle: string): void => {
    if (event.button !== undefined && event.button !== 0) return
    if (!handle.endsWith('-out')) return
    event.stopPropagation()
    const node = byId.get(nodeId)
    if (!node) return
    // 起点统一按 handle 屏幕位置换算 world（组内成员迷你接点与普通接点同位）
    const start = screenToWorld(event.clientX, event.clientY)
    setConnectionDraft({
      source: nodeId,
      sourceHandle: handle,
      clientX: event.clientX,
      clientY: event.clientY,
      start,
    })
  }, [byId, screenToWorld])

  useEffect(() => {
    if (!connectionDraft) return undefined
    const onMove = (event: PointerEvent): void => {
      setConnectionDraft((draft) => (draft ? { ...draft, clientX: event.clientX, clientY: event.clientY } : draft))
    }
    const onUp = (event: PointerEvent): void => {
      const targetId = connectionTargetAt(event.clientX, event.clientY)
      const targetHandle = `${connectionDraft.sourceHandle.replace(/-out$/, '')}-in`
      if (targetId && targetId !== connectionDraft.source) {
        onConnect?.({
          source: connectionDraft.source,
          target: targetId,
          sourceHandle: connectionDraft.sourceHandle,
          targetHandle,
        })
      } else {
        onConnectionRejected?.()
      }
      setConnectionDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [connectionDraft, onConnect, onConnectionRejected])

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

  // ---- 协作组拉伸 ----
  const [groupResize, setGroupResize] = useState<{ nodeId: string; startX: number; startY: number; startSize: { w: number; h: number } } | null>(null)
  const beginGroupResize = useCallback((event: React.PointerEvent, nodeId: string): void => {
    if (event.button !== undefined && event.button !== 0) return
    event.stopPropagation()
    const node = byId.get(nodeId)
    if (!node) return
    // 只记录拖拽起点，不直接在回调里注册 window 监听（Bug 14 修正定位：原先
    // addEventListener 在 callback 内、仅 onUp 移除——组件卸载/指针丢失时监听器
    // 残留并持续向已卸载组件回调）。监听与清理统一由下方 useEffect 管理。
    setGroupResize({
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      startSize: nodeSizeOf(node),
    })
  }, [byId])

  useEffect(() => {
    if (!groupResize) return undefined
    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - groupResize.startX
      const dy = moveEvent.clientY - groupResize.startY
      const nextW = Math.max(240, groupResize.startSize.w + dx)
      const nextH = Math.max(150, groupResize.startSize.h + dy)
      onGroupResize?.(groupResize.nodeId, { w: Math.round(nextW), h: Math.round(nextH) })
    }
    const onUp = (): void => setGroupResize(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 鼠标移出浏览器窗口/失焦时 pointerup 可能不触发（Bug 7 同款兜底），
    // pointercancel + blur 一并清理，避免监听器残留与 onGroupResize 空转。
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [groupResize, onGroupResize])

  // ---- 连线渲染 ----
  const edgeViews = nodes.length === 0 ? [] : edges.map((edge) => {
    const geometry = edgeGeometry(edge, byId)
    if (!geometry) return null
    const isSelected = edge.id === selectedEdge
    const isRunning = runStatusOf(edge.source)?.status === 'running'
    const lineType = conditionLabel(edge.condition) ? edgeConditionClass(edge) : edgeChannelClass(edge)
    const label = conditionLabel(edge.condition)
    // 流程通道有向（箭头）；上下文/数据库线无方向要求
    const channel = lineType.startsWith('is-') ? lineType.slice(3) : ''
    const directed = channel === '' || channel === 'pass' || channel === 'fail' || channel === 'content'
    const markerEnd = directed ? `url(#wf-arrow-${channel === '' ? 'flow' : channel})` : undefined
    const labelWidth = label ? Math.min(150, Math.max(34, label.length * 7 + 16)) : 0
    return (
      <g key={edge.id}>
        <path
          className={`wf-graph__edge-hit${isSelected ? ' is-selected' : ''}`}
          d={geometry.path}
          onPointerDown={(event) => { event.stopPropagation(); onEdgeSelect?.(edge.id) }}
        />
        <path
          className={`wf-graph__edge${isSelected ? ' is-selected' : ''}${lineType ? ` ${lineType}` : ''}${isRunning ? ' is-running' : ''}`}
          d={geometry.path}
          markerEnd={markerEnd}
        />
        {label ? (
          <g className="wf-edge-label-group">
            <rect className="wf-graph__label-bg" x={geometry.label.x - labelWidth / 2} y={geometry.label.y - 8} width={labelWidth} height={16} rx={8} />
            <text className="wf-graph__label" x={geometry.label.x} y={geometry.label.y}>{label}</text>
          </g>
        ) : null}
      </g>
    )
  })

  let draftPath: string | null = null
  if (connectionDraft) {
    const current = viewportRef.current
    const rect = rootRef.current?.getBoundingClientRect()
    const mouseWorld = rect
      ? { x: (connectionDraft.clientX - rect.left - current.x) / current.zoom, y: (connectionDraft.clientY - rect.top - current.y) / current.zoom }
      : connectionDraft.start
    const bend = Math.max(54, Math.abs(mouseWorld.x - connectionDraft.start.x) * 0.46)
    draftPath = `M ${connectionDraft.start.x} ${connectionDraft.start.y} C ${connectionDraft.start.x + bend} ${connectionDraft.start.y}, ${mouseWorld.x - bend} ${mouseWorld.y}, ${mouseWorld.x} ${mouseWorld.y}`
  }

  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`

  // 虚拟节点显示数据：label 从主节点取（不存独立配置，§4.2.3.2 规则 3）
  const renderedNodes: CanvasNode[] = nodes.map((node) => {
    if (node.kind !== 'proxy') return node
    const sourceId = String((node as { proxySourceId?: unknown }).proxySourceId ?? '')
    const main = byId.get(sourceId)
    return main ? { ...node, data: { ...node.data, label: String((main.data as { label?: unknown }).label ?? '') } } : node
  })
  const groupNodes = nodes.filter((node) => node.kind === 'group')
  // 组内成员 id（以 group.data.memberIds 为准并对重复 id 去重；与右侧「组合成员」及删除逻辑一致）
  const memberIdsOf = new Set<string>()
  for (const group of groupNodes) {
    for (const memberId of [...new Set((group.data.memberIds as string[] | undefined) ?? [])]) memberIdsOf.add(memberId)
  }
  // 组内成员仅在组卡片内显示迷你卡（不在画布重复渲染大卡，需求 §4.2.5.2 规则 9）
  const standalone = renderedNodes.filter((node) => node.kind !== 'group' && !memberIdsOf.has(node.id))
  const groupMembers = new Map<string, { id: string; label: string; status: string | null }[]>()
  for (const group of groupNodes) {
    const members = [...new Set((group.data.memberIds as string[] | undefined) ?? [])].map((memberId) => {
      const member = byId.get(memberId)
      return { id: memberId, label: String((member?.data as { label?: unknown } | undefined)?.label ?? memberId), status: runStatusOf(memberId)?.status ?? null }
    })
    groupMembers.set(group.id, members)
  }

  return (
    <div className="wf-canvas-stage">
      <div
        className={`wf-canvas${panning ? ' is-panning' : ''}`}
        ref={rootRef}
        onPointerDown={(event) => { if (event.target === event.currentTarget) beginPan(event) }}
        onClick={(event) => { if (event.target === event.currentTarget) onPaneClick?.() }}
      >
        <div className="wf-graph__stage" style={{ transform }}>
          <svg className="wf-graph__edges" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {/* 有向线段箭头（流程通道：流程/通过/不通过/内容；上下文/数据库线无方向要求） */}
            <defs>
              <marker id="wf-arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" className="wf-arrow-head" />
              </marker>
              <marker id="wf-arrow-pass" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" className="wf-arrow-head is-pass" />
              </marker>
              <marker id="wf-arrow-fail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" className="wf-arrow-head is-fail" />
              </marker>
              <marker id="wf-arrow-content" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" className="wf-arrow-head is-content" />
              </marker>
            </defs>
            {edgeViews}
            {draftPath ? <path className="wf-graph__connection" d={draftPath} /> : null}
          </svg>
          {groupNodes.map((node) => (
            <GroupCard
              key={node.id}
              node={node}
              copy={copy}
              members={groupMembers.get(node.id) ?? []}
              selected={node.id === selectedNode}
              dropTarget={dropTargetGroupId === node.id || dragHoverGroupId === node.id}
              onPointerDown={beginNodeDrag}
              onHandlePointerDown={beginConnection}
              onMemberSelect={onNodeSelect}
              onResizeStart={beginGroupResize}
            />
          ))}
          {standalone.map((node) => (
            <FlowNode
              key={node.id}
              node={node}
              copy={copy}
              mode={mode}
              selected={node.id === selectedNode}
              highlighted={highlightedSet.has(node.id)}
              dragging={draggingNode?.nodeId === node.id}
              runStatus={runStatusOf(node.id)}
              onPointerDown={beginNodeDrag}
              onHandlePointerDown={beginConnection}
            />
          ))}
        </div>
        {nodes.length === 0 ? (
          <div className="wf-canvas-empty">
            <div className="wf-canvas-empty__hint">
              <div className="wf-canvas-empty__icon">⬡</div>
              <div>{emptyHint}</div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="wf-graph__controls">
        <button type="button" onClick={() => zoomBy(1.2)} title={zoomInLabel}>+</button>
        <button type="button" onClick={() => fitView()} title={fitLabel}>⛶</button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} title={zoomOutLabel}>−</button>
      </div>
    </div>
  )
}

/** 连线通道颜色 class（流程/上下文/数据库）。 */
function edgeChannelClass(edge: CanvasEdge): string {
  const sourceHandle = edge.sourceHandle ?? ''
  const targetHandle = edge.targetHandle ?? ''
  if (sourceHandle === 'db-out' || targetHandle === 'db-in') return 'is-db'
  if (sourceHandle === 'ctx-out' || targetHandle === 'ctx-in') return 'is-ctx'
  return ''
}

/** 条件连线颜色 class（通过/不通过/内容）。 */
function edgeConditionClass(edge: CanvasEdge): string {
  const type = edge.condition?.type
  if (type === 'pass') return 'is-pass'
  if (type === 'fail') return 'is-fail'
  if (type === 'content') return 'is-content'
  return ''
}

// src/client/components/canvas/CanvasEdges.tsx
//
// 画布连线层（SVG）：贝塞尔连线、条件标签、运行/锁定态样式、方向箭头定义与连线草稿。
// 从 GraphCanvas 拆出——连线渲染与节点交互是两个独立的变更原因。

import type { Dict } from '../../i18n.js'
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js'
import { conditionLabel, lineColorClass } from '../../lib/graph-edges.js'
import { edgeGeometry } from './geometry.js'

export interface CanvasEdgesProps {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  byId: Map<string, CanvasNode>
  selectedEdge: string | null
  /** 连线源节点的运行状态（运行中连线用虚线）。 */
  runStatusOf(id: string): { status: string; attempts: number; outputSummary: string } | null
  isLockedEdge(id: string): boolean
  copy: Dict
  onEdgeSelect(id: string): void
  /** 连线草稿路径（拖拽连线中）。 */
  draftPath: string | null
}

export function CanvasEdges(props: CanvasEdgesProps) {
  const { nodes, edges, byId, selectedEdge, runStatusOf, isLockedEdge, copy, onEdgeSelect, draftPath } = props

  const edgeViews = nodes.length === 0 ? [] : edges.map((edge) => {
    const geometry = edgeGeometry(edge, byId)
    if (!geometry) return null
    const isSelected = edge.id === selectedEdge
    const isRunning = runStatusOf(edge.source)?.status === 'running'
    // 运行中锁定连线：属于已完成流程或执行中节点的左入口 → 灰化虚线、点击不选中（属性栏不展开）
    const isLocked = isLockedEdge(edge.id)
    // 连线颜色 class 与 lib/graph-edges.lineColorClass 同源（条件优先 + 通道回退）
    const lineType = lineColorClass(edge)
    // 条件标签文案取自词典（英文界面不再出现中文标签）
    const label = conditionLabel(edge.condition, { pass: copy.lineTypePass, fail: copy.lineTypeFail, content: copy.lineTypeContent })
    // 流程通道有向（箭头）；上下文/数据库线无方向要求
    const channel = lineType.startsWith('is-') ? lineType.slice(3) : ''
    const directed = channel === '' || channel === 'pass' || channel === 'fail' || channel === 'content'
    const markerEnd = directed ? `url(#wf-arrow-${channel === '' ? 'flow' : channel})` : undefined
    const labelWidth = label ? Math.min(150, Math.max(34, label.length * 7 + 16)) : 0
    return (
      <g key={edge.id} className={isLocked ? 'is-locked' : undefined}>
        {/* 被锁连线不可选中/编辑（用户裁决：锁定的内容不展开属性面板，故无需 toast） */}
        {isLocked ? <title>{String(copy.lockedEdgeHint)}</title> : null}
        <path
          className={`wf-graph__edge-hit${isSelected ? ' is-selected' : ''}`}
          d={geometry.path}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (isLocked) return
            onEdgeSelect?.(edge.id)
          }}
        />
        <path
          className={`wf-graph__edge${isSelected ? ' is-selected' : ''}${lineType ? ` ${lineType}` : ''}${isRunning ? ' is-running' : ''}${isLocked ? ' is-locked' : ''}`}
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

  return (
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
  )
}

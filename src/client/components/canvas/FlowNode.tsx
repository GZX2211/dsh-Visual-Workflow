// src/client/components/canvas/FlowNode.tsx
//
// 画布节点卡片（照搬旧项目 graph-canvas.js 的 FlowNode，TSX 化 + 新模型适配）：
// 角色（父/子代理）/ 文件 / 数据库 / 阶段 / 虚拟节点。接点按 HANDLES 展开；
// 运行状态徽标（pending/running/ok/fail）回显；虚拟节点虚线边框 + 「↻ 引用」角标。

import type { Dict } from '../../i18n.js'
import type { CanvasNode } from '../../studio/studio-state.js'
import { HANDLES } from '../../lib/graph-model.js'
import { nodeSizeOf } from './geometry.js'

interface FlowNodeProps {
  node: CanvasNode
  copy: Dict & { modeName(id: string | null | undefined): string }
  mode: 'mode1' | 'mode2'
  selected: boolean
  highlighted: boolean
  dragging: boolean
  runStatus: { status: string; attempts: number } | null
  onPointerDown(event: React.PointerEvent, id: string): void
  onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void
}

/** 连接点（按模式裁剪：启动/结束的上下文接点仅模式二，§4.2.5.1 连接点定义）。 */
function nodeHandles(kind: string, mode: 'mode1' | 'mode2'): { left: string[]; right: string[] } {
  const def = HANDLES[kind] ?? HANDLES.agent
  const inputs = (def.inputs ?? []).filter((handle) => !(mode === 'mode1' && kind === 'end' && handle === 'ctx-in'))
  const outputs = (def.outputs ?? []).filter((handle) => !(mode === 'mode1' && kind === 'start' && handle === 'ctx-out'))
  return { left: [...inputs].reverse(), right: [...outputs].reverse() }
}

function metaLinesOf(node: CanvasNode, copy: Dict & { modeName(id: string | null | undefined): string }): string[] {
  const kind = node.kind
  const data = node.data
  const out: string[] = []
  if (kind === 'proxy') {
    out.push(String(copy.proxyBadge ?? '↻ 引用'))
  } else if (kind === 'parent' || kind === 'agent') {
    if (data.model) out.push(`模型：${String(data.model)}`)
    out.push(`模式：${copy.modeName((data.presetId as string | null) ?? null)}`)
  } else if (kind === 'file') {
    const fileKind = String(data.fileKind ?? 'text')
    out.push(String((copy.fileKindLabel as Record<string, string>)[fileKind] ?? fileKind))
    if (data.fileName) out.push(String(data.fileName))
  } else if (kind === 'database') {
    out.push(data.dbType === 'server' ? `${String(data.dbKind ?? 'mysql')} · ${String(copy.dbTypeServer ?? '服务器')}` : String(copy.dbLocalLabel ?? '本地库'))
    if (data.vectorSource === 'bm25') out.push(String(copy.dbBm25Badge ?? '相似度检索（非语义）'))
  }
  return out.filter((line) => String(line ?? '').trim())
}

export function FlowNode({ node, copy, mode, selected, highlighted, dragging, runStatus, onPointerDown, onHandlePointerDown }: FlowNodeProps) {
  const kind = node.kind
  const isProxy = kind === 'proxy'
  const displayKind = isProxy ? 'agent' : kind
  const handles = nodeHandles(displayKind, mode)
  const status = runStatus?.status ?? null
  const statusText = status ? String((copy.status as Record<string, string>)[status] ?? '') : ''
  const metaText = metaLinesOf(node, copy).join(' · ')
  const size = nodeSizeOf(node)
  const cls = [
    'wf-node',
    `wf-node--${displayKind}`,
    selected ? 'is-selected' : '',
    highlighted ? 'is-highlighted' : '',
    isProxy ? 'is-proxy' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={`wf-graph__node${dragging ? ' is-dragging' : ''}`}
      data-wf-node-id={node.id}
      style={{ left: node.position.x, top: node.position.y, width: size.w, height: size.h }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div className={cls}>
        <div className="wf-node__kind">
          <span>{String(copy.nodeKinds?.[displayKind] ?? displayKind)}</span>
          {statusText ? <span className={`wf-status-dot is-${status}`} /> : null}
          {statusText ? <span className="wf-hint">{statusText}</span> : null}
        </div>
        <div className="wf-node__label">
          {isProxy ? <span className="wf-node__proxy-badge">↻ 引用</span> : null}
          {String(node.data.label ?? copy.nodeKinds?.[displayKind] ?? '')}
        </div>
        {metaText ? <div className="wf-node__prompt">{metaText}</div> : null}
        {handles.left.map((handle) => (
          <span
            key={handle}
            className="wf-graph__handle wf-graph__handle--target"
            style={{ top: `${handleYOf(handle) * 100}%` }}
            data-handle={handle}
            title={handle}
            onPointerDown={(event) => onHandlePointerDown(event, node.id, handle)}
          />
        ))}
        {handles.right.map((handle) => (
          <span
            key={handle}
            className="wf-graph__handle wf-graph__handle--source"
            style={{ top: `${handleYOf(handle) * 100}%` }}
            data-handle={handle}
            title={handle}
            onPointerDown={(event) => onHandlePointerDown(event, node.id, handle)}
          />
        ))}
      </div>
    </div>
  )
}

/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
function handleYOf(handle: string): number {
  if (handle === 'db-in' || handle === 'db-out') return 0.22
  if (handle === 'ctx-in' || handle === 'ctx-out') return 0.42
  return 0.72
}

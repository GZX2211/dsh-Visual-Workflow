// src/client/lib/graph-serialize.ts
//
// 画布 → 存储写回归一化：剔除视图字段、按 kind 收敛保留字段
// （虚拟节点保留 proxySourceId 与 data 的 label/role；阶段节点只保留 label；
// 组节点保留 memberIds/size）。节点 JSON 即事实源，序列化必须与文档投影对称。

import type { GraphNode, WorkflowDocument } from '../../host/shared/graph-model.js'
import type { CanvasEdge, CanvasNode } from './canvas-model.js'
import { nodeKindOf } from './canvas-model.js'
import { lineToCanvasEdge } from './graph-edges.js'

export function serializeFlow(currentFlow: WorkflowDocument, nodes: CanvasNode[], lines: CanvasEdge[]): WorkflowDocument {
  return {
    ...currentFlow,
    nodes: (nodes ?? []).map((node) => {
      const kind = nodeKindOf(node)
      if (kind === 'proxy') {
        // P3：虚拟节点的 data（label / role）是「闸门识别」的事实源，必须随保存写回；
        // 只保留这两个已知字段，避免把画布视图字段（如 selected）落到文档里。
        const proxyData = node.data ?? {}
        const data: Record<string, unknown> = {}
        if (proxyData.label !== undefined) data.label = String(proxyData.label)
        if (proxyData.role === 'milestone' || proxyData.role === 'executor') data.role = proxyData.role
        return {
          id: node.id,
          kind,
          position: node.position,
          proxySourceId: node.proxySourceId,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        } as GraphNode
      }
      if (kind === 'start' || kind === 'end' || kind === 'pause') {
        return { id: node.id, kind, position: node.position, data: { label: String(node.data?.label ?? '') } } as GraphNode
      }
      const data = { ...(node.data ?? {}) }
      delete (data as Record<string, unknown>).kind
      return { id: node.id, kind, position: node.position, data } as GraphNode
    }),
    lines: (lines ?? []).map((line) => lineToCanvasEdge(line)),
  }
}

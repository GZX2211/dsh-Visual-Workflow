// src/client/studio/studio-projection.ts
//
// 文档 → 画布投影（纯函数）：把工作流文档/模板、服务文档投影为画布
// 节点/连线（节点全量内联、虚拟节点顶层 proxySourceId 保留、位置缺省
// 落默认格点、重复 协作组节点合并）。reducer 的 OPEN_FLOW 系列动作消费。

import type { CanvasEdge, CanvasNode } from './studio-types.js'
import type { GraphNode, Line, WorkflowDocument } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import { consolidateGroups } from '../lib/group-members.js'
import { lineToCanvasEdge } from '../lib/graph-edges.js'

/**
 * 文档 → 画布投影的唯一实现：工作流文档、模板与服务文档同构（nodes/lines 全量内联），
 * 字段口径只在这里定义一次，两条投影路径不得各自复写。
 */
function documentToCanvas(doc: { nodes?: GraphNode[]; lines?: Line[] }): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    // 合并重复 协作组节点（memberIds 并集），治愈历史数据的重复组节点，避免「删成员误删多个」
    nodes: consolidateGroups((doc.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position ?? { x: 120, y: 80 },
      data: (node as { data?: Record<string, unknown> }).data ?? {},
      // 虚拟节点顶层 proxySourceId 必须保留：否则打开工作流后虚拟节点退化为孤儿，
      // 保存时后端校验报缺主引用。
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    }))),
    edges: (doc.lines ?? []).map((line) => lineToCanvasEdge(line)),
  }
}

/** 工作流文档/模板 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
export function flowToCanvas(flow: Pick<WorkflowDocument, 'nodes' | 'lines'>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return documentToCanvas(flow)
}

/** 服务文档 → 画布投影（与工作流同构）。 */
export function serviceToCanvas(service: ServiceState): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return documentToCanvas(service)
}

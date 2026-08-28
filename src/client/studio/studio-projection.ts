// src/client/studio/studio-projection.ts
//
// 文档 → 画布投影（纯函数）：把工作流文档/模板、服务文档投影为画布
// 节点/连线（节点全量内联、虚拟节点顶层 proxySourceId 保留、位置缺省
// 落默认格点、重复协作组节点合并）。reducer 的 OPEN_FLOW 系列动作消费。

import type { CanvasEdge, CanvasNode } from './studio-types.js'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import { consolidateGroups } from '../lib/graph-model.js'

/** 工作流文档/模板 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
export function flowToCanvas(flow: Pick<WorkflowDocument, 'nodes' | 'lines'>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    // 合并重复协作组节点（memberIds 并集），治愈历史数据的重复组节点，避免「删成员误删多个」
    nodes: consolidateGroups((flow.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position ?? { x: 120, y: 80 },
      data: (node as { data?: Record<string, unknown> }).data ?? {},
      // 虚拟节点顶层 proxySourceId 必须保留（Bug 2）：否则打开工作流后
      // 虚拟节点退化为孤儿，保存时后端校验报缺主引用。
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    }))),
    edges: (flow.lines ?? []).map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition ? { condition: line.condition } : {}),
    })),
  }
}

/** 服务文档 → 画布投影（与工作流同构）。 */
export function serviceToCanvas(service: ServiceState): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: consolidateGroups((service.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position ?? { x: 120, y: 80 },
      data: (node as { data?: Record<string, unknown> }).data ?? {},
      // 虚拟节点顶层 proxySourceId 保留（Bug 2，同 flowToCanvas）
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    }))),
    edges: (service.lines ?? []).map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition ? { condition: line.condition } : {}),
    })),
  }
}

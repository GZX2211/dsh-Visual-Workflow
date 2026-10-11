// src/client/lib/graph-serialize.ts
//
// 画布 → 存储写回投影（唯一本体）：工作流实例 / 工作流模板 / 模式二服务三条保存
// 路径共用同一份字段映射，消除三处手写抄件的漂移（任一处漏改即静默丢字段）。
//
// 字段保全原则：节点保留 id / kind / position / data（data 原样，不做按 kind 的
// 白名单收敛）与顶层 proxySourceId；连线只保留语义字段。文档形状由写入路径保证，
// 未知字段一律原样落地——节点 data 白名单重写会静默丢弃未来新增字段，与
// `src/host/graph/validate.ts` 对「保存前归一化」的既有裁决同口径。

import type { GraphNode, Line } from '../../host/shared/graph-model.js'
import type { CanvasEdge, CanvasNode } from './canvas-model.js'

/**
 * 画布节点 → 存储节点。
 * 虚拟节点的顶层 proxySourceId 必须保留：与画布投影对称，否则保存后
 * 后端 validateFlow 报 proxySourceMissing；非虚拟节点不产出该字段。
 */
export function serializeNodes(nodes: CanvasNode[]): GraphNode[] {
  return nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    position: node.position,
    data: node.data,
    ...(node.proxySourceId !== undefined ? { proxySourceId: node.proxySourceId } : {}),
  })) as GraphNode[]
}

/** 画布连线 → 存储连线（只保留语义字段；condition 仅在存在时携带）。 */
export function serializeLines(edges: CanvasEdge[]): Line[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    ...(edge.condition ? { condition: edge.condition } : {}),
  })) as Line[]
}

/**
 * 文档 + 画布 → 可落盘文档：除 nodes / lines 外字段原样透传。
 * 泛型收三种文档（WorkflowDocument / WorkflowTemplate / ServiceState）——三者的
 * nodes / lines 同为 GraphNode[] / Line[]，差异字段随 `...doc` 透传。
 */
export function serializeFlow<T extends { nodes: GraphNode[]; lines: Line[] }>(
  doc: T,
  nodes: CanvasNode[],
  lines: CanvasEdge[],
): T {
  return { ...doc, nodes: serializeNodes(nodes), lines: serializeLines(lines) } as T
}

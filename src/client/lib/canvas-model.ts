// src/client/lib/canvas-model.ts
//
// 画布投影模型（唯一本体）：画布节点 / 画布连线，以及节点 kind 的统一读取。
//
// 与存储层（host/shared/graph-model）的关系：
//   - GraphNode 是**存储节点**——data 按 kind 收窄为具体形状的联合类型；
//   - 画布节点是**编辑期投影**——data 为宽松记录，允许编辑过程中的半成品字段。
// 此前这两者各有一处同名本体（studio-types 的 CanvasNode 与 graph-model 的
// `CanvasNode = GraphNode`），导致连接校验必须用 `as unknown as` 双重断言跨越，
// 类型检查对真实不兼容失明。现收敛为本文件一处本体，调用方零断言。
//
// 连线与存储 Line 同形：颜色 class 与条件标签属**渲染派生**，由渲染层按需计算，
// 不再随投影携带（原 CanvasLine 的 lineType/label 字段无任何消费方）。

import type { Line, NodeKind } from '../../host/shared/graph-model.js'

/** 画布节点投影（位置/数据全量内联）。 */
export interface CanvasNode {
  id: string
  kind: NodeKind
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** 虚拟节点引用的主节点 id（kind='proxy' 时由文档投影保留，见 §4.2.3.2 规则 3）。 */
  proxySourceId?: string
}

/** 画布连线投影（与存储 Line 同形）。 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle: Line['sourceHandle']
  targetHandle: Line['targetHandle']
  condition?: Line['condition']
}

/** 画布节点 kind 统一读取（顶层 kind 优先，兼容 data.kind 历史数据）。 */
export function nodeKindOf(node: { kind?: unknown; data?: { kind?: unknown } } | null | undefined): string {
  const kind = node?.kind
  if (typeof kind === 'string' && kind) return kind
  const dataKind = node?.data?.kind
  return typeof dataKind === 'string' && dataKind ? dataKind : 'agent'
}

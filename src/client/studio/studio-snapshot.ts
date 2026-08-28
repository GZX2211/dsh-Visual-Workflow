// src/client/studio/studio-snapshot.ts
//
// 图快照工具（纯函数）：撤销重做栈元素构造与一致性比较。快照必须产出
// 与 state.canvas 完全独立的副本（图标量而非引用），避免历史栈被后续
// 原地修改污染；比较用于 Bug 17 的 dirty 精确判定。

import type { GraphSnapshot, CanvasNode, CanvasEdge, StudioState } from './studio-types.js'

/**
 * 当前图快照（撤销重做栈元素构造）。
 * 必须产出与 state.canvas 完全独立的副本：历史栈（past/future）保存的是
 * 「图标量」而非引用——若直接返回数组/对象引用，任何后续对 canvas 节点的
 * 原地修改（拖拽缓存、组件副作用）都会污染历史记录，undo/redo 退化为
 * 同一对象的覆盖式恢复（撤销失效）。考虑 node.data/edge.condition 为嵌套
 * 对象，逐层浅拷贝断开引用即可（元素内容不可变约定下即快照语义）。
 */
export function graphSnapshotOf(state: StudioState): GraphSnapshot {
  return {
    nodes: state.canvas.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })),
    edges: state.canvas.edges.map((edge) => ({
      ...edge,
      ...(edge.condition ? { condition: { ...edge.condition } } : {}),
    })),
  }
}

/**
 * 图快照是否一致（Bug 17 的 dirty 精确判定用）。
 * 快照元素均为「内容不可变」结构（节点位置/数据、连线/条件），
 * 直接序列化比较即可（节点/连线顺序即文档事实源顺序）。
 */
export function graphSnapshotsEqual(a: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null, b: GraphSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

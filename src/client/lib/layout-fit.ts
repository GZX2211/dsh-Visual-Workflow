// src/client/lib/layout-fit.ts
//
// 自动布局判定与重叠检测（自主编排方案 §7.3 / 决策 D-15、P0-A2）：
//   - needsAutoLayout：节点缺坐标或坐标为哨兵 {0,0} → 需要自动布局一次；
//   - layoutBoxesOf：**实际渲染盒子**清单——组卡片 + 独立节点（组内成员与虚拟节点
//     不独立渲染、不参与重叠判定，见 layout.ts 头部说明）；
//   - findLayoutOverlaps：盒子两两相交检测（非阻断提示「建议整理布局」）；
//   - boxesOverlap / applyLayout：几何工具与「把坐标写回节点」的纯函数。
// 全部纯函数：不读时钟/随机源，同输入同输出。

import { layoutGraph as rawLayoutGraph, toLayoutInputs } from './layout.js'
import { isSentinelPosition } from './layout-types.js'
import type { LayoutResult } from './layout-types.js'

/** 画布节点最小形状（只读 id/kind/position/data；不绑定 studio 状态类型）。 */
export interface LayoutBoxNode {
  id: string
  kind: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
}

/** 渲染盒子（用于重叠判定；不含组内成员与虚拟节点）。 */
export interface LayoutBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 是否需要自动布局：任一节点坐标缺失/非有限数/为哨兵 {0,0} 即为真。
 * 语义（P0-A2）：新节点默认写哨兵坐标（或干脆不写），打开/接收文档时据此自动重排一次。
 */
export function needsAutoLayout(nodes: LayoutBoxNode[] | null | undefined): boolean {
  return (nodes ?? []).some((node) => isSentinelPosition(node?.position))
}

/** 协作组成员的 id 集合（以组的 memberIds 为准；用于排除重复渲染节点）。 */
export function groupMemberIdsOf(nodes: LayoutBoxNode[] | null | undefined): Set<string> {
  const members = new Set<string>()
  for (const node of nodes ?? []) {
    if (node.kind !== 'group') continue
    for (const memberId of [...new Set(Array.isArray(node.data?.memberIds) ? (node.data?.memberIds as unknown[]) : [])]) {
      if (String(memberId) !== node.id) members.add(String(memberId))
    }
  }
  return members
}

/**
 * 实际渲染盒子清单：组卡片 + 独立节点（排除组内成员与虚拟节点）。
 * 为什么排除它们：GraphCanvas 只渲染组卡片与独立节点（组内成员以迷你卡渲染在卡片内、
 * 虚拟节点与主节点同坐标），对它们做重叠判定会产生「永远重叠」的假告警（P0-A5）。
 */
export function layoutBoxesOf(
  nodes: LayoutBoxNode[] | null | undefined,
  sizeOf: (node: LayoutBoxNode) => { w: number; h: number },
  /** 额外排除的节点 id（布局输入已折叠的组员与虚拟节点；缺省只按 data 推导）。 */
  excludedIds: Iterable<string> = [],
): LayoutBox[] {
  const members = groupMemberIdsOf(nodes)
  for (const id of excludedIds) members.add(id)
  return (nodes ?? [])
    .filter((node) => node.kind !== 'proxy' && !members.has(node.id))
    .map((node) => {
      const size = sizeOf(node)
      return { id: node.id, x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0, w: Number(size.w) || 0, h: Number(size.h) || 0 }
    })
}

/** 两盒子是否相交（边贴边不算相交；零面积盒子不参与）。 */
export function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  if (a.id === b.id) return false
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** 全部重叠对（id 对按字典序归一，便于断言与去重）。 */
export function findLayoutOverlaps(boxes: LayoutBox[] | null | undefined): Array<[string, string]> {
  const list = boxes ?? []
  const overlaps: Array<[string, string]> = []
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (!boxesOverlap(list[i], list[j])) continue
      const [a, b] = [list[i].id, list[j].id].sort()
      overlaps.push([a, b])
    }
  }
  return overlaps
}

/**
 * 布局中被折叠（不占位置槽）的节点 id 集合：协作组成员 + 虚拟节点（含悬空引用）。
 * 与 layout.ts 的折叠规则同源：这里只做「清单推导」，供重叠判定与 UI 使用。
 */
export function collapsedIdsOf(inputs: Array<{ id: string; kind: string; sourceId?: string; memberIds?: string[] }>): Set<string> {
  const collapsed = new Set<string>()
  for (const input of inputs ?? []) {
    if (input.kind === 'proxy') collapsed.add(input.id)
  }
  const known = new Set((inputs ?? []).map((input) => input.id))
  for (const input of inputs ?? []) {
    if (input.kind !== 'group') continue
    for (const memberId of input.memberIds ?? []) {
      if (memberId === input.id || !known.has(memberId)) continue
      collapsed.add(memberId)
    }
  }
  return collapsed
}

/**
 * 统一布局入口（「整理布局」按钮与自动布局共用同一实现）：
 * 「宿主节点 → 布局输入 → 分层布局 → 坐标写回」四步收敛在一处，
 * 避免两条路径各写一遍而坐实「两份布局算法漂移」（Bug 25 的教训）。
 * @param sizeOf 卡片尺寸解析（通常为 card-geometry.groupCardSizeOf）
 */
export function tidyNodes<T extends LayoutBoxNode>(
  nodes: T[],
  lines: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
  options: { sizeOf: (node: T) => { w: number; h: number }; layout?: { gutterX?: number; gutterY?: number; maxOrderRounds?: number; originX?: number; originY?: number } } = { sizeOf: (() => ({ w: 0, h: 0 })) as never },
): { nodes: T[]; result: LayoutResult } {
  const inputs = toLayoutInputs(
    nodes as unknown as Array<{ id: string; kind: string; data?: Record<string, unknown> }>,
    options.sizeOf as never,
  )
  const result = rawLayoutGraph(inputs, lines as never, options.layout ?? {})
  return { nodes: applyLayout(nodes, result), result }
}

/**
 * 把布局结果写回节点（返回新数组，不改写入参）：
 * 只改 position，其余字段保持原引用（几何改动不算编排变更，见 flow-diff 语义）。
 * 布局结果里没有坐标的节点保持原样（防御：理论上布局覆盖全部节点）。
 */
export function applyLayout<T extends LayoutBoxNode>(nodes: T[], result: LayoutResult): T[] {
  return (nodes ?? []).map((node) => {
    const position = result.positions.get(node.id)
    if (!position) return node
    if (node.position?.x === position.x && node.position?.y === position.y) return node
    return { ...node, position: { x: Math.round(position.x), y: Math.round(position.y) } }
  })
}

// src/client/components/canvas/geometry.ts
//
// 画布几何原语（照搬旧项目 graph-canvas.js 的纯函数）：节点尺寸、接点垂直位置、
// 贝塞尔连线几何、元素命中坐标换算。

import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js'

export const GRAPH_NODE_WIDTH = 208
export const GRAPH_NODE_HEIGHT = 116
export const GRAPH_NODE_SIZE = { w: GRAPH_NODE_WIDTH, h: GRAPH_NODE_HEIGHT }
/** 阶段节点（启动/结束/暂停）紧凑卡片：流程门无需大卡，避免占用画布空间。 */
export const GRAPH_STAGE_WIDTH = 168
export const GRAPH_STAGE_HEIGHT = 88
export const GRAPH_STAGE_SIZE = { w: GRAPH_STAGE_WIDTH, h: GRAPH_STAGE_HEIGHT }
export const GRAPH_GROUP_WIDTH = 300
export const GRAPH_GROUP_HEIGHT = 220
/** 组内成员行高/列表起始（与 GroupCard 布局一致，连线锚点用；成员为迷你角色卡，略高于纯文本行）。 */
export const GROUP_MEMBER_ROW_H = 38
export const GROUP_MEMBER_LIST_TOP = 78
export const GRAPH_MIN_ZOOM = 0.5
export const GRAPH_MAX_ZOOM = 2.5

/** 节点实际尺寸（协作组卡片可拉伸，尺寸存 data.size；阶段节点用紧凑卡）。 */
export function nodeSizeOf(node: CanvasNode): { w: number; h: number } {
  if (node.kind === 'group') {
    const size = (node.data?.size ?? {}) as { w?: unknown; h?: unknown }
    const w = Number(size.w) > 0 ? Number(size.w) : GRAPH_GROUP_WIDTH
    const h = Number(size.h) > 0 ? Number(size.h) : GRAPH_GROUP_HEIGHT
    return { w, h }
  }
  if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
    return { w: GRAPH_STAGE_WIDTH, h: GRAPH_STAGE_HEIGHT }
  }
  return { w: GRAPH_NODE_WIDTH, h: GRAPH_NODE_HEIGHT }
}

/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
export function handleY(handle: string): number {
  if (handle === 'db-in' || handle === 'db-out') return 0.22
  if (handle === 'ctx-in' || handle === 'ctx-out') return 0.42
  return 0.72
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export interface EdgeGeometry {
  start: { x: number; y: number }
  end: { x: number; y: number }
  label: { x: number; y: number }
  path: string
}

/** 成员所在组（画布节点含该成员）。 */
export function groupOfMember(byId: Map<string, CanvasNode>, memberId: string): CanvasNode | null {
  for (const node of byId.values()) {
    if (node.kind === 'group' && ((node.data.memberIds as string[] | undefined) ?? []).includes(memberId)) return node
  }
  return null
}

/** 组内成员连线锚点（组卡片左/右边缘 + 成员行中心）。 */
export function memberAnchor(group: CanvasNode, memberId: string, side: 'left' | 'right'): { x: number; y: number } | null {
  const memberIds = (group.data.memberIds as string[] | undefined) ?? []
  const index = memberIds.indexOf(memberId)
  if (index < 0) return null
  const size = nodeSizeOf(group)
  const y = group.position.y + GROUP_MEMBER_LIST_TOP + index * GROUP_MEMBER_ROW_H + GROUP_MEMBER_ROW_H / 2
  return { x: side === 'left' ? group.position.x : group.position.x + size.w, y }
}

/**
 * 节点是否交换了左右连接点（卡片右上角切换按钮，用户批注：美化布线防交叉）。
 * 交换后：出点移到左侧、入点移到右侧；节点 JSON 即事实源，swapPorts 随节点持久化。
 */
export function swappedOf(node: CanvasNode | null | undefined): boolean {
  return (node?.data as { swapPorts?: unknown } | undefined)?.swapPorts === true
}

/** 连线贝塞尔几何（源右侧 → 目标左侧；组卡片流程接点居中，组内成员锚到成员行）。
 *  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。 */
export function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null {
  const source = byId.get(edge.source)
  const target = byId.get(edge.target)
  if (!source || !target) return null
  const sourceSize = nodeSizeOf(source)
  const targetSize = nodeSizeOf(target)
  const sourceGroup = source.kind === 'group' ? null : groupOfMember(byId, source.id)
  const targetGroup = target.kind === 'group' ? null : groupOfMember(byId, target.id)
  const sourceSwapped = swappedOf(source)
  const targetSwapped = swappedOf(target)
  const start = sourceGroup
    ? memberAnchor(sourceGroup, source.id, 'right')!
    : {
        x: source.position.x + (sourceSwapped ? 0 : sourceSize.w),
        y: source.position.y + sourceSize.h * (source.kind === 'group' ? 0.5 : handleY(edge.sourceHandle ?? 'flow-out')),
      }
  const end = targetGroup
    ? memberAnchor(targetGroup, target.id, 'left')!
    : {
        x: target.position.x + (targetSwapped ? targetSize.w : 0),
        y: target.position.y + targetSize.h * (target.kind === 'group' ? 0.5 : handleY(edge.targetHandle ?? 'flow-in')),
      }
  const forward = Math.max(54, Math.abs(end.x - start.x) * 0.46)
  const bend = end.x >= start.x ? forward : Math.max(90, forward * 0.7)
  return {
    start,
    end,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    path: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
  }
}

/** 命中检测：鼠标坐标下的节点 id（最近 data-wf-node-id 祖先）。 */
export function connectionTargetAt(clientX: number, clientY: number): string | null {
  const element = document.elementFromPoint(clientX, clientY)
  return element?.closest?.('[data-wf-node-id]')?.getAttribute('data-wf-node-id') ?? null
}

/**
 * 协作组表面命中（入组判定，用户批注 §4.2.5.2 收紧：仅组卡片表面可入组）：
 *  - 跳过不在协作组内的元素（画布空白/连线 SVG/其他节点等装饰层）；
 *  - 跳过被拖拽本体节点（拖拽时节点被挪到鼠标下方，若不排除会遮蔽组表面命中）；
 *  - 命中 `.wf-graph__handle`（连接点）→ 返回 null：连接点**不具入组功能**。
 * 返回命中的协作组 id；否则 null。纯函数接收元素数组，便于 jsdom 单测。
 */
export function groupSurfaceFromElements(elements: Element[], excludeNodeId?: string | null): string | null {
  for (const el of elements) {
    const groupEl = el.closest?.('.wf-group-node') as HTMLElement | null
    if (!groupEl) continue
    const hostNodeId = el.closest?.('[data-wf-node-id]')?.getAttribute('data-wf-node-id') ?? null
    if (excludeNodeId && hostNodeId === excludeNodeId) continue
    if (el.closest?.('.wf-graph__handle')) return null
    return groupEl.getAttribute('data-wf-node-id')
  }
  return null
}

/** 鼠标坐标下的协作组表面（入组落点；封装 elementsFromPoint，供拖拽 onMove/onUp 共用）。 */
export function groupSurfaceUnderPoint(clientX: number, clientY: number, excludeNodeId?: string | null): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null
  return groupSurfaceFromElements(document.elementsFromPoint(clientX, clientY), excludeNodeId)
}

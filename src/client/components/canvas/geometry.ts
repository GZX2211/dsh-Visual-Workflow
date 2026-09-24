// src/client/components/canvas/geometry.ts
//
// 画布渲染几何原语（纯计算，不触 DOM）：接点垂直位置、贝塞尔连线几何、组内成员锚点。
// 卡片尺寸常量与尺寸解析（nodeSizeOf / groupCardSizeOf）的本体在 lib/card-geometry.ts：
// 渲染与布局共用同一本体，此处只按本模块职责消费，不转发、不重复定义。
// DOM 命中检测（elementFromPoint / elementsFromPoint）归 lib/dom-hit-test.ts：
// 该能力被组件与 hooks 共用，不属于渲染几何。

import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_ROW_H, nodeSizeOf } from '../../lib/card-geometry.js'
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js'

export const GRAPH_MIN_ZOOM = 0.5
export const GRAPH_MAX_ZOOM = 2.5

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
  /** 贝塞尔控制点 1（源端口向外伸出方向）。 */
  c1: { x: number; y: number }
  /** 贝塞尔控制点 2（目标端口外侧进入方向）。 */
  c2: { x: number; y: number }
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

/** 连线贝塞尔几何（源端口 → 目标端口；组卡片流程接点居中，组内成员锚到成员行）。
 *  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。
 *  控制点方向跟随端口所在边缘（右缘向外 +x、左缘向外 -x），连线从正确一侧进出，不会
 *  穿入卡片体被遮挡（用户批注：连线方向应当根据连接点确定，而非默认朝右）。 */
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
  // 端口朝向（端口所在边缘的外法向）：右缘 +1、左缘 -1。组内成员沿用固定侧
  // （成员出点=组卡片右缘、入点=组卡片左缘，见 memberAnchor）。
  // 用户批注：连线方向应当根据连接点（左缘/右缘）确定，而非默认朝右。
  const startDir = sourceGroup ? 1 : (sourceSwapped ? -1 : 1)
  const endDir = targetGroup ? -1 : (targetSwapped ? 1 : -1)
  // 控制点沿各自端口外法向延伸：出点从所在边缘向外伸出、入点从所在边缘外侧进入，
  // 从而不会穿入节点卡片体导致被遮挡。标准「左→右相对（源右缘/目标左缘）」时与旧几何一致（回归安全）。
  const bend = Math.max(54, Math.abs(end.x - start.x) * 0.46)
  const c1 = { x: start.x + startDir * bend, y: start.y }
  const c2 = { x: end.x + endDir * bend, y: end.y }
  return {
    start,
    end,
    c1,
    c2,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
  }
}

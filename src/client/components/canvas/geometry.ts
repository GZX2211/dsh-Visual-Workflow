// src/client/components/canvas/geometry.ts
//
// 画布渲染几何原语（纯计算，不触 DOM）：接点垂直位置、贝塞尔连线几何、组内成员锚点。
// 卡片尺寸常量与尺寸解析（nodeSizeOf / groupCardSizeOf）的本体在 lib/card-geometry.ts：
// 渲染与布局共用同一本体，此处只按本模块职责消费，不转发、不重复定义。
// DOM 命中检测（elementFromPoint / elementsFromPoint）归 lib/dom-hit-test.ts：
// 该能力被组件与 hooks 共用，不属于渲染几何。

import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_ROW_H, GROUP_MEMBER_ROW_HEIGHT, nodeSizeOf } from '../../lib/card-geometry.js'
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js'

export const GRAPH_MIN_ZOOM = 0.5
export const GRAPH_MAX_ZOOM = 2.5

/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
export function handleY(handle: string): number {
  if (handle === 'db-in' || handle === 'db-out') return 0.22
  if (handle === 'ctx-in' || handle === 'ctx-out') return 0.42
  return 0.72
}

/** Team 卡片上下文入点的纵向比例（靠近标题，与居中的流程入点拉开；与样式片段对锁）。 */
export const GROUP_CTX_IN_TOP = 0.30

/**
 * 组内成员接点纵向比例（成员行内位置；与样式 .wf-graph__handle--member-* 对锁）。
 * ctx-out 已从 UI 退役，这里仍保留其比例：历史连线即使被隐藏，几何函数也应保持确定输出。
 */
export const MEMBER_HANDLE_TOP: Record<string, number> = {
  'db-in': 0.30,
  'ctx-in': 0.64,
  'ctx-out': 0.47,
}

/**
 * 成员接点中心相对 Team 卡片左右边缘的内缩。
 * 由盒模型累加：卡片外边框 1 + 卡片内边距 12 + 成员列表边框 1 + 列表内边距 6
 * + 接点半宽 0.5（接点 left/right: -6px、宽 13px）。
 */
export const GROUP_MEMBER_HANDLE_INSET_X = 20.5

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

/**
 * 成员 id → 所属组 的预建索引。
 * 为什么需要：所属组反查若按全节点扫描，连线几何会对每条边扫两次全节点（O(边×节点)），
 * 且拖拽时每帧执行；索引化后由 GraphCanvas 按节点集预建一次，逐边只做 O(1) 命中。
 * 同一成员出现在多个组时按节点顺序取先到的组，与原先的全量扫描口径一致。
 */
export type MemberGroupIndex = Map<string, CanvasNode>

/** 由画布节点表预建成员 → 组索引（一次全量扫描，替代逐边反查）。 */
export function memberGroupIndexOf(byId: Map<string, CanvasNode>): MemberGroupIndex {
  const index: MemberGroupIndex = new Map()
  for (const node of byId.values()) {
    if (node.kind !== 'group') continue
    for (const memberId of new Set((node.data.memberIds as string[] | undefined) ?? [])) {
      if (!index.has(memberId)) index.set(memberId, node)
    }
  }
  return index
}

/**
 * 组内成员连线锚点：成员迷你卡内侧的真实接点中心。
 * 不再使用 Team 卡片外缘 / 成员行中心——前者让线端停在卡片边框外，后者让线端偏离
 * 实际渲染的接点（ctx-in 在行下部、db-in 在行上部）。
 */
export function memberAnchor(group: CanvasNode, memberId: string, handle: string): { x: number; y: number } | null {
  const memberIds = (group.data.memberIds as string[] | undefined) ?? []
  const index = memberIds.indexOf(memberId)
  if (index < 0) return null
  const size = nodeSizeOf(group)
  const incoming = !handle.endsWith('-out')
  const rowTop = group.position.y + GROUP_MEMBER_LIST_TOP + index * GROUP_MEMBER_ROW_H
  const y = rowTop + GROUP_MEMBER_ROW_HEIGHT * (MEMBER_HANDLE_TOP[handle] ?? 0.5)
  const x = incoming
    ? group.position.x + GROUP_MEMBER_HANDLE_INSET_X
    : group.position.x + size.w - GROUP_MEMBER_HANDLE_INSET_X
  return { x, y }
}

/** Team 卡片接点纵向位置：ctx-in 位于标题下方，flow 接点保持居中（与 GroupCard 样式同源）。 */
export function groupHandleY(handle: string): number {
  return handle === 'ctx-in' ? GROUP_CTX_IN_TOP : 0.5
}

/**
 * 节点是否交换了左右连接点（卡片右上角切换按钮，用户批注：美化布线防交叉）。
 * 交换后：出点移到左侧、入点移到右侧；节点 JSON 即事实源，swapPorts 随节点持久化。
 */
export function swappedOf(node: CanvasNode | null | undefined): boolean {
  return (node?.data as { swapPorts?: unknown } | undefined)?.swapPorts === true
}

/** 连线贝塞尔几何（源端口 → 目标端口；Team 接点按 handle 定高，组内成员锚到真实接点）。
 *  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。
 *  控制点方向跟随端口所在边缘（右缘向外 +x、左缘向外 -x），连线从正确一侧进出，不会
 *  穿入卡片体被遮挡（用户批注：连线方向应当根据连接点确定，而非默认朝右）。 */
export function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>, memberGroups: MemberGroupIndex): EdgeGeometry | null {
  const source = byId.get(edge.source)
  const target = byId.get(edge.target)
  if (!source || !target) return null
  const sourceSize = nodeSizeOf(source)
  const targetSize = nodeSizeOf(target)
  const sourceGroup = source.kind === 'group' ? null : memberGroups.get(source.id) ?? null
  const targetGroup = target.kind === 'group' ? null : memberGroups.get(target.id) ?? null
  const sourceSwapped = swappedOf(source)
  const targetSwapped = swappedOf(target)
  // 成员锚点可能为空（组的 memberIds 与节点反查口径分叉时）：为空则回退节点自身几何，不用非空断言
  const sourceAnchor = sourceGroup ? memberAnchor(sourceGroup, source.id, edge.sourceHandle ?? 'ctx-out') : null
  const targetAnchor = targetGroup ? memberAnchor(targetGroup, target.id, edge.targetHandle ?? 'ctx-in') : null
  const start = sourceAnchor ?? {
    x: source.position.x + (sourceSwapped ? 0 : sourceSize.w),
    y: source.position.y + sourceSize.h * (source.kind === 'group' ? groupHandleY(edge.sourceHandle ?? 'flow-out') : handleY(edge.sourceHandle ?? 'flow-out')),
  }
  const end = targetAnchor ?? {
    x: target.position.x + (targetSwapped ? targetSize.w : 0),
    y: target.position.y + targetSize.h * (target.kind === 'group' ? groupHandleY(edge.targetHandle ?? 'flow-in') : handleY(edge.targetHandle ?? 'flow-in')),
  }
  // 端口朝向（端口所在边缘的外法向）：右缘 +1、左缘 -1。组内成员按真实接点所在侧
  // （入点在成员卡左缘、出点在右缘，见 memberAnchor）。
  // 用户批注：连线方向应当根据连接点（左缘/右缘）确定，而非默认朝右。
  const startDir = sourceAnchor ? 1 : (sourceSwapped ? -1 : 1)
  const endDir = targetAnchor ? -1 : (targetSwapped ? 1 : -1)
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

interface Point {
  x: number
  y: number
}

/** 一次贝塞尔插值。 */
function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** 三次贝塞尔在 t 处的点。 */
function cubicPointAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}

/** 取整条三次贝塞尔的 [t, 1] 后缀（de Casteljau 分割）。 */
function cubicSuffix(geometry: EdgeGeometry, t: number): string {
  const q0 = lerpPoint(geometry.start, geometry.c1, t)
  const q1 = lerpPoint(geometry.c1, geometry.c2, t)
  const q2 = lerpPoint(geometry.c2, geometry.end, t)
  const r0 = lerpPoint(q0, q1, t)
  const r1 = lerpPoint(q1, q2, t)
  const start = lerpPoint(r0, r1, t)
  return `M ${start.x} ${start.y} C ${r1.x} ${r1.y}, ${q2.x} ${q2.y}, ${geometry.end.x} ${geometry.end.y}`
}

/**
 * Team 成员入线的「卡片内段」路径：从 Team 卡片边缘切到成员接点。
 *
 * 为什么需要单独一段：SVG 连线层位于节点卡片之下，线段进入 Team 卡片后会被卡片背景
 * 遮挡；覆盖层把这一段画在卡片之上、接点之下，线端才能真正落到成员接点上。
 * 返回 null 表示目标不是组内成员，或线段没有进入卡片。
 */
export function memberInboundStubPath(edge: CanvasEdge, byId: Map<string, CanvasNode>, memberGroups: MemberGroupIndex): string | null {
  const target = byId.get(edge.target)
  if (!target) return null
  const group = memberGroups.get(target.id)
  if (!group) return null
  const geometry = edgeGeometry(edge, byId, memberGroups)
  if (!geometry) return null

  const size = nodeSizeOf(group)
  const left = group.position.x
  const right = group.position.x + size.w
  const top = group.position.y
  const bottom = group.position.y + size.h
  const inside = (t: number): boolean => {
    const point = cubicPointAt(geometry.start, geometry.c1, geometry.c2, geometry.end, t)
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
  }
  if (!inside(1)) return null

  // 从终点反向找「最后一段连续位于卡片内」的起点：采样定位后二分收敛到边界，
  // 避免曲线在卡片内外多次穿越时把卡片外的线段也抬到覆盖层。
  const samples = 80
  let firstInside = samples
  while (firstInside > 0 && inside((firstInside - 1) / samples)) firstInside -= 1
  if (firstInside === 0) return geometry.path
  let low = (firstInside - 1) / samples
  let high = firstInside / samples
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2
    if (inside(mid)) high = mid
    else low = mid
  }
  return cubicSuffix(geometry, high)
}

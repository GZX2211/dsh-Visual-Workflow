// src/client/lib/layout-types.ts
//
// 布局算法的类型契约（纯类型 + 常量；自主编排方案 §7.2）：输入节点元数据、选项、
// 结果与告警。与 card-geometry.ts 的分工：card-geometry 负责「单个卡片尺寸/成员行尺寸」，
// 本层负责「整图坐标」——布局只依赖传入的 width/height，不反向 import host 契约。

import type { GroupNode } from '../../host/shared/graph-model.js'
import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_PADDING, GROUP_MEMBER_ROW_H } from './card-geometry.js'

/** 组卡片内成员横向留白（布局专用；本体在 lib/card-geometry.ts，与卡片最小高度共用同一常量）。 */
export { GROUP_MEMBER_PADDING }

/**
 * 组卡片最小高度（容纳成员列表；用户手动设的更大高度优先）。
 * 与 card-geometry.groupCardSizeOf 同一口径（同一常量），两侧不会漂移。
 */
export function groupCardMinHeight(group: GroupNode | { data?: { memberIds?: string[]; size?: { h?: unknown } } }): number {
  const members = [...new Set(Array.isArray(group?.data?.memberIds) ? group.data.memberIds : [])]
  const containerHeight = Number((group?.data?.size as { h?: unknown } | undefined)?.h)
  const base = Number.isFinite(containerHeight) ? containerHeight : 0
  const needed = GROUP_MEMBER_LIST_TOP + members.length * GROUP_MEMBER_ROW_H + GROUP_MEMBER_PADDING
  return Math.max(base, needed)
}

/** 布局节点元数据（宿主图模型 → 布局输入的最小投影）。 */
export interface LayoutNodeInput {
  id: string
  kind: string
  width: number
  height: number
  /** 虚拟节点引用的主节点 id（kind='proxy' 时必填）。 */
  sourceId?: string
  /** 协作组成员所属组 id，或协作组卡片的成员清单（kind='group' 时必填）。 */
  groupId?: string | null
  memberIds?: string[]
}

/** 布局选项（缺省值见 LAYOUT_DEFAULTS）。 */
export interface LayoutOptions {
  /** 列（层）间距。 */
  gutterX?: number
  /** 行（层内单元）间距。 */
  gutterY?: number
  /** 层内排序迭代轮数（0 = 不做交叉最小化）。 */
  maxOrderRounds?: number
  /** 画布左上角留白（默认与旧布局一致：x=70, y=80）。 */
  originX?: number
  originY?: number
}

/** 布局结果（纯数据；调用方只读）。 */
export interface LayoutResult {
  /** 节点 id → 坐标（含组内成员与虚拟节点；虚拟节点沿用主节点坐标）。 */
  positions: Map<string, { x: number; y: number }>
  /** 节点 id → 列号（层号；仅布局单元与组内成员有值）。 */
  colOf: Map<string, number>
  /** 流程单元的最大列号（未参与流程的节点排在其右侧）。 */
  maxCol: number
  /** 回流边 id（被环检测剔除的边；供 UI 标注，不阻断）。 */
  reversedLineIds: string[]
  /** 告警（中文，面向用户/模型可读）。 */
  warnings: string[]
}

/** 布局缺省间距（与旧布局的视觉密度接近：旧 stepX=270 / stepY=180，卡片 208×116 → 间距 62/64）。 */
export const LAYOUT_DEFAULTS = {
  gutterX: 72,
  gutterY: 56,
  maxOrderRounds: 4,
  originX: 70,
  originY: 80,
} as const

/** 位置哨兵：{x:0,y:0} 视为「未布局」（新建/导入/代理落盘时可能缺坐标）。 */
export const SENTINEL_POSITION = { x: 0, y: 0 } as const

/** 是否为缺失/哨兵坐标（自动布局触发判据）。 */
export function isSentinelPosition(position: { x: number; y: number } | null | undefined): boolean {
  if (!position) return true
  return !Number.isFinite(position.x) || !Number.isFinite(position.y)
    || (position.x === SENTINEL_POSITION.x && position.y === SENTINEL_POSITION.y)
}



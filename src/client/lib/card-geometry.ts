// src/client/lib/card-geometry.ts
//
// 卡片尺寸几何（纯常量 + 纯函数）：节点 / 阶段 / Team 卡片的基础尺寸与「实际渲染尺寸」
// 解析。渲染层与布局层共用本模块，保证「布局算出的尺寸」与「渲染尺寸」口径唯一、不漂移。
// 为什么不放在组件层：lib（布局、重叠判定、图模型）需要同一本体，而 lib 不得反向
// 依赖 UI 模块；渲染侧的几何原语（接点位置、贝塞尔连线、命中换算）仍留在画布组件层。
// 纯函数：只读传入的 kind/data，不读时钟、随机源与 DOM。

/**
 * 卡片尺寸解析的最小节点形状：只读本模块真正消费的 kind/data。
 * 同时容忍调用方传入的完整节点（id/position 等冗余字段），避免各调用点为类型擦除做断言。
 */
export interface SizedNodeLike {
  id?: string
  kind?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
}

export const GRAPH_NODE_WIDTH = 208
export const GRAPH_NODE_HEIGHT = 116
/** 阶段节点（启动/结束/暂停）紧凑卡片：流程门无需大卡，避免占用画布空间。 */
export const GRAPH_STAGE_WIDTH = 168
export const GRAPH_STAGE_HEIGHT = 88
export const GRAPH_GROUP_WIDTH = 300
export const GRAPH_GROUP_HEIGHT = 220
/** 成员行高（border-box）与行间距（与样式片段对锁；节距 = 两者之和）。 */
export const GROUP_MEMBER_ROW_HEIGHT = 36
export const GROUP_MEMBER_ROW_GAP = 5
/** 组内成员行节距（连线锚点逐行推进用），由 tests/client/components/canvas/GroupCard.test.tsx
 *  与样式片段对锁，两处不得各自漂移。 */
export const GROUP_MEMBER_ROW_H = GROUP_MEMBER_ROW_HEIGHT + GROUP_MEMBER_ROW_GAP
/**
 * 首个成员行顶边相对 Team 卡片顶边的距离。
 * 由卡片实际盒模型累加得出：外边框 1 + 卡片上内边距 10 + 种类行 16.5
 * （成员计数 .wf-hint 为 11px × 1.5，撑高种类行）+ 下外边距 2 + 标题行 19.5
 * + 成员列表上外边距 6 + 列表边框 1 + 列表上内边距 6 = 62。
 * 标题/种类行由样式固定为单行，否则标题换行会把整列成员下移，连线锚点随之失准。
 */
export const GROUP_MEMBER_LIST_TOP = 62
/** Team 卡片内成员横向留白（渲染尺寸与布局坐标共用同一常量）。 */
export const GROUP_MEMBER_PADDING = 10

/** 节点实际尺寸（Team 卡片可拉伸，尺寸存 data.size；阶段节点用紧凑卡）。 */
export function nodeSizeOf(node: SizedNodeLike): { w: number; h: number } {
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

/**
 * Team 卡片最小尺寸（容纳成员列表所需高度；宽度保持用户拉伸值）。
 * 布局与自动布局判定共用同一口径，避免「布局算出的高度」与「渲染高度」漂移。
 * 纯函数：只读 data.memberIds / data.size，不读时钟/随机源。
 */
export function groupCardSizeOf(node: SizedNodeLike): { w: number; h: number } {
  const size = nodeSizeOf(node)
  if (node.kind !== 'group') return size
  const members = [...new Set((node.data?.memberIds as string[] | undefined) ?? [])]
  const minHeight = GROUP_MEMBER_LIST_TOP + members.length * GROUP_MEMBER_ROW_H + GROUP_MEMBER_PADDING
  return { w: size.w, h: Math.max(size.h, minHeight) }
}

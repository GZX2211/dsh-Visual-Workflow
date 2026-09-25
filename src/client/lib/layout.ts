// src/client/lib/layout.ts
//
// 分层布局主算法（自主编排方案 §7.1/§7.2；方向约定：**列 = 执行顺序（左→右），行 = 层内并行**）。
// 纯函数：不读时钟/随机源，同输入同输出；只依赖传入的宽高，不反向依赖渲染细节。
//
// 节点三大类（用户裁决 2026-09，见 assets/imgs/布局算法调整.png 批注）：
//   ① 主干类（kind: start/end/pause/parent/agent/group/proxy）：参与流程主干，按 flow 边分层；
//      proxy 是主节点的「分身」，**独立占位**（不再与主节点重叠），列号由自身流程边决定；
//   ② 数据类（kind: file/database）：不参与主干、不占主干通道，按「关联角色节点所在列 n」放到 **n-1 列**，
//      并在该列内以主轴为基准贴轴上下堆叠（关联角色在主轴上方则贴上侧，反之贴下侧）；
//   ③ 孤立类：既无流程边也无角色关联的单元，单独成列排在流程最右侧之外（保持既有不变量）。
//
// 几何规则（用户裁决 2026-09）：
//   - 流程主干保持一条水平直线：主轴 Y = originY + **最高**主干卡片高/2，各列主干卡片共线于该 Y；
//   - 同列多个主干节点以主轴为中心上下均分（尊重叠于轴）；数据节点紧贴主轴上下堆叠，间隔 rowGap；
//   - 列右对齐：同列卡片右边界对齐（x = columnRight - cardWidth）；
//   - 列间距：前一列最右边界 → 后一列最左边界 = columnGap；
//   - 覆写优先级（用户裁决）：① 主干不换列 + 主干线保持直线 > ② 列右对齐 > ③ 数据节点 (n-1) 列 > ④ 上下侧判定。

import { layerGraph, type DirectedEdge } from './layering.js'
import { orderLayers, DEFAULT_ORDER_ROUNDS } from './layout-order.js'
import { groupCardMinHeight, GROUP_MEMBER_PADDING, LAYOUT_DEFAULTS } from './layout-types.js'
import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_ROW_H, GRAPH_NODE_HEIGHT } from './card-geometry.js'
import type { LayoutNodeInput, LayoutOptions, LayoutResult } from './layout-types.js'
import type { Line } from '../../host/shared/graph-model.js'

/**
 * 主干类节点 kind（参与流程主干；与 host NODE_HANDLES 的流程通道能力对应）。
 * proxy 是主节点的分身，同样属于主干（用户口径：主干 = 除 file/database 之外的全部节点）。
 */
export const SPINE_KINDS: ReadonlySet<string> = new Set(['start', 'end', 'pause', 'parent', 'agent', 'group', 'proxy'])

/** 数据类节点 kind（上下文/数据库来源；按 (n-1) 列分布在主干两旁）。 */
export const DATA_KINDS: ReadonlySet<string> = new Set(['file', 'database'])

/**
 * 布局诊断文案（LayoutResult.warnings）：布局是 lib 层纯函数、不引词典，调用方按需消费。
 * 文案集中在模块级纯函数（同一语义只有一处本体），变量只作为参数注入。
 */
const orphanDataWarning = (id: string): string => `数据节点「${id}」未关联任何角色节点，已放到流程最右侧的独立列`
const groupHeightWarning = (id: string, needed: number, memberCount: number): string =>
  `协作组「${id}」卡片高度不足，建议加高到 ${needed}px 以容纳 ${memberCount} 名成员`

/** 仅流程线参与主干分层（ctx-out→ctx-in / db-out→db-in 不参与）。 */
export function isFlowLine(line: Line): boolean {
  return line?.sourceHandle === 'flow-out' && line?.targetHandle === 'flow-in'
}

/**
 * 数据节点的关联线：文件（ctx-out）或数据库（db-out）指向角色节点的注入线。
 * 与 isFlowLine 严格互补——同一批连线只会被其中一侧消费，不会既进主干又当数据关联。
 */
export function isDataLine(line: Line): boolean {
  if (!line) return false
  return (line.sourceHandle === 'ctx-out' && line.targetHandle === 'ctx-in')
    || (line.sourceHandle === 'db-out' && line.targetHandle === 'db-in')
}

/**
 * 布局输入装配：把节点投影为「尺寸 + 关系」元数据。
 * 尺寸由调用方提供（通常是 card-geometry.nodeSizeOf），布局不反向依赖渲染细节。
 */
export function toLayoutInputs(
  nodes: Array<{ id: string; kind: string; data?: Record<string, unknown> }>,
  sizeOf: (node: { id: string; kind: string; data?: Record<string, unknown> }) => { w: number; h: number },
): LayoutNodeInput[] {
  return (nodes ?? []).map((node) => {
    const size = sizeOf(node)
    const data = node.data ?? {}
    const memberIds = Array.isArray(data.memberIds) ? (data.memberIds as unknown[]).map(String) : undefined
    const groupId = typeof data.groupId === 'string' && data.groupId ? data.groupId : null
    // proxySourceId 在 Host 图模型里是 proxy 节点顶层字段；客户端投影（StudioState.CanvasNode）
    // 把它放在 data 内——两处都读，避免投影差异导致虚拟节点识别失败。
    const rawSource = (node as { proxySourceId?: unknown }).proxySourceId ?? data.proxySourceId
    const sourceId = typeof rawSource === 'string' && rawSource ? rawSource : undefined
    return {
      id: node.id,
      kind: node.kind,
      width: Number(size.w) || 0,
      height: Number(size.h) || 0,
      ...(node.kind === 'proxy' && sourceId ? { sourceId } : {}),
      ...(node.kind === 'group' ? { memberIds: memberIds ?? [] } : { groupId }),
    }
  })
}

/**
 * 折叠映射：协作组成员 → 组卡片。
 * 只折叠组成员：虚拟节点（proxy）**不再**折叠到主节点——它是主节点的分身，独立占位与分层
 * （用户裁决：proxy 可以参与流程的不同阶段，与主节点不一定同列）。
 */
function collapseMapOf(inputs: LayoutNodeInput[]): Map<string, string> {
  const byId = new Map(inputs.map((node) => [node.id, node]))
  const collapse = new Map<string, string>()
  for (const node of inputs) {
    if (node.kind !== 'group') continue
    for (const memberId of node.memberIds ?? []) {
      if (memberId === node.id || !byId.has(memberId)) continue
      collapse.set(memberId, node.id)
    }
  }
  return collapse
}

/**
 * 参与长边排序的边集合：把跨层边拆成「相邻层二元组」。
 * 长边（如 start → 第 4 层节点）若只按端点排序，中间层的重心不受影响、交叉难以收敛；
 * 拆成二元组后每一段都参与重心计算（不插真实虚拟节点，坐标仍按列独立生成）。
 */
function spanEdgesOf(edges: Array<{ source: string; target: string }>, layerOf: Map<string, number>): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = []
  for (const edge of edges) {
    const from = layerOf.get(edge.source)
    const to = layerOf.get(edge.target)
    if (from === undefined || to === undefined || to - from <= 1) {
      out.push(edge)
      continue
    }
    for (let layer = from; layer < to - 1; layer += 1) {
      out.push({ source: `${edge.source}#${layer}`, target: `${edge.target}#${layer + 1}` })
    }
    out.push({ source: `${edge.source}#${to - 1}`, target: edge.target })
  }
  return out
}

/**
 * 主轴上下堆叠：给定各卡片高与基准轴心，返回以轴心为中心、间隔不小于 gap 的对称落点。
 * 规则（用户裁决）：主轴那条水平线始终穿过主干卡片的中心——单卡居中于轴，
 * 多卡以轴为中心上下均分（间距 = max(gap, 均分值)），数据节点贴轴上下堆叠。
 */
export function axisOffsets(heights: number[], axisY: number, gap: number): number[] {
  if (heights.length === 0) return []
  const cards = heights.map((height) => Math.max(0, height))
  const safeGap = Math.max(0, gap)
  const totalCardHeight = cards.reduce((sum, height) => sum + height, 0)
  // 均分值（内部间隙）：主轴上下各 axisY 可用空间扣掉卡片总高后，按内部间隙数分摊；
  // 均分值小于最小间隔时用最小间隔（此时块会溢出轴上下空间，由「块中心仍在轴上」兜底）
  const evenSpacing = cards.length > 1
    ? Math.max(safeGap, (axisY * 2 - totalCardHeight) / (cards.length - 1))
    : safeGap
  const total = totalCardHeight + Math.max(0, cards.length - 1) * evenSpacing
  let cursor = axisY - total / 2
  const offsets: number[] = []
  for (const height of cards) {
    offsets.push(cursor)
    cursor += height + evenSpacing
  }
  return offsets
}

/**
 * 分层布局主函数（纯函数：同输入同输出，不读时钟/随机源）。
 *
 * 步骤：① 主干/数据分类与折叠 → ② 主干分层（flow 边，环被剔除）→ ③ 主干层内排序 →
 * ④ 数据节点 (n-1) 列推导 → ⑤ 主轴共线 + 列内均分 + 数据节点贴轴堆叠 + 列右对齐 → ⑥ 孤立列兜底。
 */
export function layoutGraph(nodes: LayoutNodeInput[], lines: Line[], options: LayoutOptions = {}): LayoutResult {
  const columnGap = Number(options.columnGap ?? LAYOUT_DEFAULTS.columnGap)
  const rowGap = Number(options.rowGap ?? LAYOUT_DEFAULTS.rowGap)
  const originX = Number(options.originX ?? LAYOUT_DEFAULTS.originX)
  const originY = Number(options.originY ?? LAYOUT_DEFAULTS.originY)
  const rawRounds = Number(options.maxOrderRounds ?? DEFAULT_ORDER_ROUNDS)
  const rounds = Number.isFinite(rawRounds) ? rawRounds : DEFAULT_ORDER_ROUNDS
  const inputs = nodes ?? []
  const positions = new Map<string, { x: number; y: number }>()
  const colOf = new Map<string, number>()
  const warnings: string[] = []
  if (inputs.length === 0) return { positions, colOf, maxCol: -1, axisY: originY, orphanCol: -1, reversedLineIds: [], warnings }

  const byId = new Map(inputs.map((node) => [node.id, node]))
  const collapse = collapseMapOf(inputs)
  /** 占位单元：全部非组员节点（含 proxy；proxy 独立占位）。 */
  const units = inputs.filter((node) => !collapse.has(node.id))
  const spineUnits = units.filter((unit) => SPINE_KINDS.has(unit.kind))
  const dataUnits = units.filter((unit) => DATA_KINDS.has(unit.kind))

  // —— ① 连线分类：flow 边进主干分层，ctx/db 边做数据节点关联 ——
  const spineEdges: DirectedEdge[] = []
  const spineEdgeLineIds: string[] = []
  const dataEdges: Array<{ source: string; target: string }> = []
  for (const line of lines ?? []) {
    if (!byId.has(line.source) || !byId.has(line.target)) continue
    const fromUnit = collapse.get(line.source) ?? line.source
    const toUnit = collapse.get(line.target) ?? line.target
    if (isFlowLine(line)) {
      if (fromUnit === toUnit) continue // 组内流程线：不参与分层
      spineEdges.push({ source: fromUnit, target: toUnit })
      spineEdgeLineIds.push(line.id)
      continue
    }
    if (isDataLine(line)) dataEdges.push({ source: fromUnit, target: toUnit })
  }

  // —— ② 主干分层：只有被流程线驱动的单元（其余主干单元进孤立列） ——
  const participatingSpineIds = new Set<string>()
  for (const edge of spineEdges) {
    participatingSpineIds.add(edge.source)
    participatingSpineIds.add(edge.target)
  }
  const spineParticipating = spineUnits.filter((unit) => participatingSpineIds.has(unit.id))
  const spineIsolated = spineUnits.filter((unit) => !participatingSpineIds.has(unit.id))
  const layering = layerGraph(spineParticipating.map((unit) => unit.id), spineEdges)
  const spineForwardEdges: DirectedEdge[] = []
  const reversedLineIds: string[] = []
  spineEdges.forEach((edge, index) => {
    const layerFrom = layering.layerOf.get(edge.source)
    const layerTo = layering.layerOf.get(edge.target)
    if (layerFrom === undefined || layerTo === undefined || layerTo <= layerFrom) {
      // 回流边（环）或环上节点：不参与分层与排序，仅登记供 UI 标注
      reversedLineIds.push(spineEdgeLineIds[index])
      return
    }
    spineForwardEdges.push(edge)
  })

  // 主轴两端固定（用户口径）：启动节点永远在第 0 列；结束节点的最长路径层号即主干最右列。
  const spineLayer = new Map<string, number>()
  for (const unit of spineParticipating) spineLayer.set(unit.id, layering.layerOf.get(unit.id) ?? 0)
  for (const unit of spineParticipating) {
    if (unit.kind === 'start') spineLayer.set(unit.id, 0)
  }

  // —— ③ 主干层内排序（跨层长边拆段参与重心计算；proxy 作为独立主干单元参与） ——
  const rawSpineLayers: string[][] = Array.from(
    { length: Math.max(1, ...[...spineLayer.values()].map((layer) => layer + 1)) },
    () => [],
  )
  for (const unit of spineParticipating) {
    const layer = spineLayer.get(unit.id) ?? 0
    rawSpineLayers[layer] = [...(rawSpineLayers[layer] ?? []), unit.id]
  }
  const spanEdges = spanEdgesOf(spineForwardEdges, spineLayer)
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const edge of spanEdges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
    reverse.set(edge.target, [...(reverse.get(edge.target) ?? []), edge.source])
  }
  const orderedSpine = orderLayers({ layers: rawSpineLayers, adjacency, reverse, rounds })
  const spineColOf = new Map<string, number>()
  const spineOrderOf = new Map<string, number>()
  orderedSpine.forEach((layer, index) => {
    layer.forEach((id, position) => {
      spineColOf.set(id, index)
      spineOrderOf.set(id, position)
    })
  })

  const widthOf = (id: string): number => Number(byId.get(id)?.width) || 0
  const heightOf = (id: string): number => {
    const unit = byId.get(id)
    if (!unit) return 0
    if (unit.kind === 'group') {
      return Math.max(Number(unit.height) || 0, groupCardMinHeight({ data: { memberIds: unit.memberIds ?? [], size: { h: unit.height } } }))
    }
    return Number(unit.height) || 0
  }

  // —— ④ 数据节点列推导：列 = 关联角色节点所在列 n - 1（多个关联角色取最小列，确定且左靠） ——
  const spineIdSet = new Set(spineUnits.map((unit) => unit.id))
  /**
   * 全局主轴 Y（主干线的水平位置）：originY + 基准主干卡片高/2。
   * 基准用「标准角色卡高」（card-geometry.GRAPH_NODE_HEIGHT）而非本图最高卡片：
   * 主轴是画布级的固定基准线，不应因某张协作组卡更高而整体下移（否则各文档之间主干高低不一致）。
   * 高于基准的卡片（如协作组卡）以自身中心叠在轴上，向上/向下略微越出轴两侧空间。
   */
  const axisY = originY + GRAPH_NODE_HEIGHT / 2

  const collapseUnitOf = (id: string): string => collapse.get(id) ?? id
  const spineColOfUnit = (id: string): number | undefined => {
    if (spineIdSet.has(id)) return spineColOf.get(id)
    const groupId = collapse.get(id)
    return groupId ? spineColOf.get(groupId) : undefined
  }
  const dataCol = new Map<string, number>()
  const dataAssociations = new Map<string, string[]>()
  for (const unit of dataUnits) {
    const associations = [...new Set(dataEdges.filter((edge) => edge.source === unit.id).map((edge) => collapseUnitOf(edge.target)))]
    dataAssociations.set(unit.id, associations)
    const columns = associations
      .map((targetId) => spineColOfUnit(targetId))
      .filter((column): column is number => column !== undefined)
    dataCol.set(unit.id, columns.length > 0 ? Math.max(0, Math.min(...columns) - 1) : -1)
    if (columns.length === 0) warnings.push(orphanDataWarning(unit.id))
  }

  // —— ⑤ 列装配：主干块居中于轴 + 数据节点贴轴上下堆叠 ——
  const lastSpineColumn = orderedSpine.length - 1
  const spineBlockAt = (column: number): LayoutNodeInput[] => (orderedSpine[column] ?? [])
    .map((id) => byId.get(id))
    .filter((unit): unit is LayoutNodeInput => Boolean(unit))
  const dataByColumn = new Map<number, LayoutNodeInput[]>()
  for (const unit of dataUnits) {
    const column = dataCol.get(unit.id) ?? -1
    if (column < 0) continue
    dataByColumn.set(column, [...(dataByColumn.get(column) ?? []), unit])
  }
  const columns: number[] = [...new Set([...orderedSpine.map((_, index) => index), ...dataByColumn.keys()])]
    .filter((column) => column >= 0 && column <= lastSpineColumn)
    .sort((a, b) => a - b)

  // 先定主干纵向位置（数据节点上下侧判定需要「关联角色中心相对主轴的偏移」）
  const spineYsByColumn = new Map<number, number[]>()
  const spineBlockByColumn = new Map<number, LayoutNodeInput[]>()
  /** 主干节点 id → 计划中的垂直中心（未落位前用于数据节点上下侧判定）。 */
  const spineCenterById = new Map<string, number>()
  for (const column of columns) {
    const spineBlock = spineBlockAt(column)
    const spineYs = axisOffsets(spineBlock.map((unit) => heightOf(unit.id)), axisY, rowGap)
    spineBlockByColumn.set(column, spineBlock)
    spineYsByColumn.set(column, spineYs)
    spineBlock.forEach((unit, index) => {
      spineCenterById.set(unit.id, (spineYs[index] ?? axisY) + heightOf(unit.id) / 2)
    })
  }
  /**
   * 数据节点关联角色相对主轴的平均垂直偏移（负数 = 关联角色在主轴上方）：
   * 用于「放主轴上方还是下方」的判定（用户裁决：按与关联角色在画布中的平均距离判断）。
   * 关联角色不在主干上（未关联）时返回正无穷，保证它排在最后。
   */
  const associationOffsetOf = (id: string): number => {
    const offsets = (dataAssociations.get(id) ?? [])
      .map((targetId) => spineCenterById.get(targetId))
      .filter((center): center is number => center !== undefined)
      .map((center) => center - axisY)
    if (offsets.length === 0) return Number.MAX_SAFE_INTEGER
    return offsets.reduce((sum, value) => sum + value, 0) / offsets.length
  }
  for (const [column, members] of dataByColumn) {
    members.sort((a, b) => {
      const offsetA = associationOffsetOf(a.id)
      const offsetB = associationOffsetOf(b.id)
      if (offsetA !== offsetB) return offsetA - offsetB
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    dataByColumn.set(column, members)
  }
  /** 列成员（自上而下）：主干块 → 轴上侧数据节点 → 轴下侧数据节点。 */
  const columnMembers = new Map<number, LayoutNodeInput[]>()
  for (const column of columns) {
    columnMembers.set(column, [...(spineBlockByColumn.get(column) ?? []), ...(dataByColumn.get(column) ?? [])])
  }

  // 列宽：该列卡片（主干 + 数据）的最大宽；列右边界 = 上一列右边界 + columnGap + 列宽
  const columnWidth = new Map<number, number>()
  for (const column of columns) {
    let width = 0
    for (const unit of columnMembers.get(column) ?? []) width = Math.max(width, widthOf(unit.id))
    columnWidth.set(column, width)
  }
  const columnRight = new Map<number, number>()
  let cursorRight = originX
  for (const column of columns) {
    cursorRight += (columnWidth.get(column) ?? 0) + columnGap
    columnRight.set(column, cursorRight)
  }

  // 主轴共线 + 数据节点贴轴上下堆叠
  for (const column of columns) {
    const spineBlock = spineBlockByColumn.get(column) ?? []
    const spineYs = spineYsByColumn.get(column) ?? []
    const dataMembers = dataByColumn.get(column) ?? []
    // 关联角色的平均位置在主轴上方（平均偏移 < 0）→ 数据节点贴主轴上方；否则贴主轴下方
    const splitIndex = dataMembers.findIndex((unit) => associationOffsetOf(unit.id) >= 0)
    const upper = splitIndex < 0 ? dataMembers : dataMembers.slice(0, splitIndex)
    const lower = splitIndex < 0 ? [] : dataMembers.slice(splitIndex)
    const columnRightEdge = columnRight.get(column) ?? originX
    const place = (unit: LayoutNodeInput, y: number): void => {
      positions.set(unit.id, { x: columnRightEdge - widthOf(unit.id), y })
      colOf.set(unit.id, column)
    }
    // 主干块：以主轴为中心上下均分（单卡即居中于轴）
    spineBlock.forEach((unit, index) => place(unit, spineYs[index] ?? axisY))
    // 数据节点：紧贴主轴上下堆叠（上侧自轴向外、下侧自轴向外），间隔 rowGap
    const lastSpineUnit = spineBlock[spineBlock.length - 1]
    const spineTop = spineYs[0] ?? axisY
    const spineBottom = lastSpineUnit ? (spineYs[spineYs.length - 1] ?? axisY) + heightOf(lastSpineUnit.id) : axisY
    let aboveCursor = spineTop
    for (const unit of [...upper].reverse()) {
      aboveCursor -= heightOf(unit.id) + Math.max(0, rowGap)
      place(unit, aboveCursor)
    }
    let belowCursor = spineBottom
    for (const unit of lower) {
      belowCursor += Math.max(0, rowGap)
      place(unit, belowCursor)
      belowCursor += heightOf(unit.id)
    }
  }

  // 组内成员：顺序 = memberIds 顺序（去重），坐标写在组卡片矩形内；不参与全局分层与重叠判定
  for (const unit of spineUnits) {
    if (unit.kind !== 'group') continue
    const position = positions.get(unit.id)
    if (!position) continue
    const column = colOf.get(unit.id) ?? 0
    const memberIds = [...new Set(unit.memberIds ?? [])].filter((memberId) => memberId !== unit.id && byId.has(memberId))
    memberIds.forEach((memberId, index) => {
      positions.set(memberId, {
        x: position.x + GROUP_MEMBER_PADDING,
        y: position.y + GROUP_MEMBER_LIST_TOP + index * GROUP_MEMBER_ROW_H,
      })
      colOf.set(memberId, column)
    })
    const needed = groupCardMinHeight({ data: { memberIds, size: { h: unit.height } } })
    if (needed > (Number(unit.height) || 0)) warnings.push(groupHeightWarning(unit.id, Math.round(needed), memberIds.length))
  }

  // —— ⑥ 孤立单元（未参与流程的主干单元，含悬空引用的虚拟节点 + 未关联角色的数据节点）：
  //      单独成列排在流程最右侧之外 ——
  const orphanUnits: LayoutNodeInput[] = [
    ...spineIsolated,
    ...dataUnits.filter((unit) => (dataCol.get(unit.id) ?? -1) < 0),
  ]
  const orphanCol = columns.length
  let maxColumnRight = originX
  for (const column of columns) maxColumnRight = Math.max(maxColumnRight, columnRight.get(column) ?? originX)
  const orphanRight = orphanUnits.length > 0 ? maxColumnRight + columnGap + Math.max(0, ...orphanUnits.map((unit) => widthOf(unit.id))) : maxColumnRight
  let orphanCursorY = originY
  for (const unit of orphanUnits) {
    const orphanX = orphanRight - widthOf(unit.id)
    const orphanY = orphanCursorY
    positions.set(unit.id, { x: orphanX, y: orphanY })
    colOf.set(unit.id, orphanCol)
    orphanCursorY += heightOf(unit.id) + Math.max(0, rowGap)
    if (unit.kind !== 'group') continue
    const memberIds = [...new Set(unit.memberIds ?? [])].filter((id) => id !== unit.id && byId.has(id))
    memberIds.forEach((memberId, index) => {
      positions.set(memberId, {
        x: orphanX + GROUP_MEMBER_PADDING,
        y: orphanY + GROUP_MEMBER_LIST_TOP + index * GROUP_MEMBER_ROW_H,
      })
      colOf.set(memberId, orphanCol)
    })
  }

  // 兜底：上面各步已覆盖全部非组员节点与组员；此处只防御「group 的 memberIds 指向不存在的节点」
  // 这类形状漂移，保证任何节点都有有限坐标（不丢节点、不产生 NaN）。
  for (const node of inputs) {
    if (positions.has(node.id)) continue
    const fallbackCol = Math.max(0, lastSpineColumn)
    const fallbackRight = columnRight.get(fallbackCol) ?? originX
    positions.set(node.id, { x: fallbackRight - widthOf(node.id), y: originY })
    colOf.set(node.id, fallbackCol)
  }

  return {
    positions,
    colOf,
    maxCol: Math.max(-1, lastSpineColumn),
    axisY,
    orphanCol: orphanUnits.length > 0 ? orphanCol : Math.max(-1, lastSpineColumn),
    reversedLineIds: [...new Set(reversedLineIds)],
    warnings,
  }
}

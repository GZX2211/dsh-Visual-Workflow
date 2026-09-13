// src/client/lib/layout.ts
//
// 分层布局主算法（自主编排方案 §7.1/§7.2，决策 D-14/D-15/D-16/P0-A5）：纯函数，
// 输入「节点尺寸 + 连线」，输出「坐标 + 列号 + 告警」。
//
// 方向约定（用户明确）：**列 = 执行顺序（左→右），行 = 层内并行**；
// start 在最左列、end 在最右列、串行链横向展开。
//
// 与旧布局（client/lib/graph-model.ts 的旧 layoutNodes 实现）的差异（修 7 项缺陷）：
//   ① proxy 入边不再计入 indegree——虚拟节点折叠到主节点，主节点列号不受其引用影响；
//   ② 按卡片实际尺寸计算（组卡片 300×220 可拉伸、阶段卡 168×88、角色卡 208×116）；
//   ③ 协作组卡片作为「超级节点」参与分层，组内成员不占位置槽、写在卡片矩形内；
//   ④ 层内排序（重心启发式，layout-order.ts）最小化交叉；
//   ⑤ 未参与流程的节点单独成列放在流程最右侧之外；
//   ⑥ 长边不插虚拟节点，列宽/行高按真实尺寸生成，连线不糊；
//   ⑦ 环（回流边）被识别并剔除分层，节点不丢、坐标不产生 NaN。
//
// 重复渲染节点（P0-A5）：虚拟节点与组内成员在画布上**不独立渲染**
// （GraphCanvas 只渲染组卡片与独立节点），因此它们不占位置槽、不参与重叠判定；
// 虚拟节点坐标沿用主节点（画布上二者重叠，与既有渲染行为一致，视觉改进留待后续阶段）。

import { layerGraph, type DirectedEdge } from './layering.js'
import { orderLayers, DEFAULT_ORDER_ROUNDS } from './layout-order.js'
import { groupCardMinHeight, GROUP_MEMBER_PADDING, LAYOUT_DEFAULTS } from './layout-types.js'
import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_ROW_H } from '../components/canvas/geometry.js'
import type { LayoutNodeInput, LayoutOptions, LayoutResult } from './layout-types.js'
import type { Line } from '../../host/shared/graph-model.js'

/** 仅流程线参与分层（ctx-out→ctx-in / db-out→db-in 不参与）。 */
export function isFlowLine(line: Line): boolean {
  return line?.sourceHandle === 'flow-out' && line?.targetHandle === 'flow-in'
}

/**
 * 布局输入装配：把节点投影为「尺寸 + 关系」元数据。
 * 尺寸由调用方提供（通常是 geometry.nodeSizeOf），布局不反向依赖渲染细节。
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
    // 把它放在 data 内——两处都读，避免投影差异导致虚拟节点识别失败（布局会把主节点错推到引用节点之后）。
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

/** 折叠映射：组内成员 → 组卡片；虚拟节点 → 主节点（主节点若在组内则再折叠到组）。 */
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
  for (const node of inputs) {
    if (node.kind !== 'proxy' || !node.sourceId) continue
    collapse.set(node.id, collapse.get(node.sourceId) ?? node.sourceId)
  }
  return collapse
}

/** 独占位置槽的布局单元（排除协作组成员与虚拟节点）。 */
function layoutUnitsOf(inputs: LayoutNodeInput[], collapse: Map<string, string>): LayoutNodeInput[] {
  return inputs.filter((node) => !collapse.has(node.id) && node.kind !== 'proxy')
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
 * 分层布局主函数（纯函数：同输入同输出，不读时钟/随机源）。
 */
export function layoutGraph(nodes: LayoutNodeInput[], lines: Line[], options: LayoutOptions = {}): LayoutResult {
  const gutterX = Number(options.gutterX ?? LAYOUT_DEFAULTS.gutterX)
  const gutterY = Number(options.gutterY ?? LAYOUT_DEFAULTS.gutterY)
  const originX = Number(options.originX ?? LAYOUT_DEFAULTS.originX)
  const originY = Number(options.originY ?? LAYOUT_DEFAULTS.originY)
  const rawRounds = Number(options.maxOrderRounds ?? DEFAULT_ORDER_ROUNDS)
  const rounds = Number.isFinite(rawRounds) ? rawRounds : DEFAULT_ORDER_ROUNDS
  const inputs = nodes ?? []
  const positions = new Map<string, { x: number; y: number }>()
  const colOf = new Map<string, number>()
  const warnings: string[] = []
  if (inputs.length === 0) return { positions, colOf, maxCol: -1, reversedLineIds: [], warnings }

  const byId = new Map(inputs.map((node) => [node.id, node]))
  const collapse = collapseMapOf(inputs)
  const units = layoutUnitsOf(inputs, collapse)

  // —— ①② 边分类 + 折叠（proxy/组成员 → 单元，去自环） ——
  const unitEdges: DirectedEdge[] = []
  const unitEdgeLineIds: string[] = []
  for (const line of lines ?? []) {
    if (!isFlowLine(line)) continue
    if (!byId.has(line.source) || !byId.has(line.target)) continue
    const fromUnit = collapse.get(line.source) ?? line.source
    const toUnit = collapse.get(line.target) ?? line.target
    if (fromUnit === toUnit) continue // 组内连线 / 虚拟节点自指：不参与分层
    unitEdges.push({ source: fromUnit, target: toUnit })
    unitEdgeLineIds.push(line.id)
  }
  const participating = new Set<string>()
  for (const edge of unitEdges) {
    participating.add(edge.source)
    participating.add(edge.target)
  }
  const participatingUnits = units.filter((unit) => participating.has(unit.id))
  const isolatedUnits = units.filter((unit) => !participating.has(unit.id))

  // —— ③④ 分层（环检测 + 最长路径，环上节点与环边被剔除） ——
  const layering = layerGraph(participatingUnits.map((unit) => unit.id), unitEdges)
  const forwardEdges: DirectedEdge[] = []
  const forwardLineIds = new Set<string>()
  const reversedLineIds: string[] = []
  unitEdges.forEach((edge, index) => {
    const layerFrom = layering.layerOf.get(edge.source)
    const layerTo = layering.layerOf.get(edge.target)
    if (layerFrom === undefined || layerTo === undefined || layerTo <= layerFrom) {
      // 回流边（环）或环上节点：不参与分层与排序，仅登记供 UI 标注
      reversedLineIds.push(unitEdgeLineIds[index])
      return
    }
    forwardEdges.push(edge)
    forwardLineIds.add(unitEdgeLineIds[index])
  })

  // —— ⑤⑥ 层内排序（跨层长边拆段参与重心计算） ——
  const layerMembers = new Map<number, string[]>()
  for (const unit of participatingUnits) {
    const layer = layering.layerOf.get(unit.id) ?? 0
    layerMembers.set(layer, [...(layerMembers.get(layer) ?? []), unit.id])
  }
  const rawLayers: string[][] = Array.from(
    { length: Math.max(1, ...[...layerMembers.keys()].map((layer) => layer + 1)) },
    () => [],
  )
  for (const [layer, ids] of layerMembers) rawLayers[layer] = ids
  const spanEdges = spanEdgesOf(forwardEdges, layering.layerOf)
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const edge of spanEdges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
    reverse.set(edge.target, [...(reverse.get(edge.target) ?? []), edge.source])
  }
  const orderedLayers = orderLayers({ layers: rawLayers, adjacency, reverse, rounds })

  // —— ⑦ 坐标生成 ——
  const layerOfUnit = new Map<string, number>()
  orderedLayers.forEach((layer, index) => {
    for (const id of layer) layerOfUnit.set(id, index)
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
  // 列宽：单元自身宽与其组内成员宽的较大者（成员写在卡片内，不额外占列宽）
  const columnWidths = orderedLayers.map((layer) => {
    let width = 0
    for (const id of layer) {
      width = Math.max(width, widthOf(id))
      const unit = byId.get(id)
      if (unit?.kind !== 'group') continue
      for (const memberId of unit.memberIds ?? []) {
        const member = byId.get(memberId)
        if (member && memberId !== unit.id) width = Math.max(width, Number(member.width) || 0)
      }
    }
    return width
  })
  const columnHeights = orderedLayers.map((layer) => (
    layer.reduce((sum, id) => sum + heightOf(id), 0) + Math.max(0, layer.length - 1) * gutterY
  ))
  const tallestColumn = Math.max(0, ...columnHeights)
  const columnX: number[] = []
  let cursorX = originX
  for (let index = 0; index < orderedLayers.length; index += 1) {
    columnX.push(cursorX)
    cursorX += (columnWidths[index] ?? 0) + gutterX
  }
  /** 列内落点：各列相对最高列竖向居中，视觉更稳。 */
  const placeInColumn = (layer: number, id: string): { x: number; y: number } => {
    const column = orderedLayers[layer] ?? []
    const index = column.indexOf(id)
    const before = column.slice(0, Math.max(0, index)).reduce((sum, other) => sum + heightOf(other) + gutterY, 0)
    const offset = Math.max(0, (tallestColumn - (columnHeights[layer] ?? 0)) / 2)
    return { x: columnX[layer] ?? originX, y: originY + offset + before }
  }
  for (const [id, layer] of layerOfUnit) {
    const unit = byId.get(id)
    const position = placeInColumn(layer, id)
    positions.set(id, position)
    colOf.set(id, layer)
    if (unit?.kind !== 'group') continue
    // 组内成员：顺序 = memberIds 顺序（去重），坐标写在组卡片矩形内；不参与全局分层与重叠判定
    const memberIds = [...new Set(unit.memberIds ?? [])].filter((memberId) => memberId !== unit.id && byId.has(memberId))
    memberIds.forEach((memberId, index) => {
      positions.set(memberId, {
        x: position.x + GROUP_MEMBER_PADDING,
        y: position.y + GROUP_MEMBER_LIST_TOP + index * GROUP_MEMBER_ROW_H,
      })
      colOf.set(memberId, layer)
    })
    const needed = groupCardMinHeight({ data: { memberIds, size: { h: unit.height } } })
    if (needed > (Number(unit.height) || 0)) {
      warnings.push(`协作组「${unit.id}」卡片高度不足，建议加高到 ${Math.round(needed)}px 以容纳 ${memberIds.length} 名成员`)
    }
  }
  // 未参与流程的单元：单独成列放在流程最右侧之外（不与流程混排）
  if (isolatedUnits.length > 0) {
    const orphanX = columnX.length > 0
      ? (columnX[columnX.length - 1] ?? originX) + (columnWidths[columnWidths.length - 1] ?? 0) + gutterX
      : originX
    let cursorY = originY
    for (const unit of isolatedUnits) {
      positions.set(unit.id, { x: orphanX, y: cursorY })
      colOf.set(unit.id, orderedLayers.length)
      cursorY += (Number(unit.height) || 0) + gutterY
      for (const memberId of unit.memberIds ?? []) {
        if (memberId === unit.id || !byId.has(memberId)) continue
        positions.set(memberId, { x: orphanX + GROUP_MEMBER_PADDING, y: cursorY })
      }
    }
  }
  // 虚拟节点：不占槽位，沿用主节点坐标（与既有渲染行为一致）；悬空引用给确定坐标 + 告警
  for (const node of inputs) {
    if (positions.has(node.id)) continue
    const mainPosition = positions.get(node.sourceId ?? '') ?? positions.get(collapse.get(node.id) ?? '')
    if (mainPosition) {
      positions.set(node.id, { x: mainPosition.x, y: mainPosition.y })
      // 列号与主节点一致（虚拟节点不占位置槽，但列号语义必须与主节点对齐，
      // 否则「proxy 不推主节点」这条不变量在结果里无法被断言/消费）
      const mainCol = colOf.get(node.sourceId ?? '') ?? colOf.get(collapse.get(node.id) ?? '')
      if (mainCol !== undefined) colOf.set(node.id, mainCol)
      continue
    }
    const fallbackLayer = Math.max(0, orderedLayers.length - 1)
    positions.set(node.id, { x: columnX[fallbackLayer] ?? originX, y: originY })
    colOf.set(node.id, fallbackLayer)
    warnings.push(`虚拟节点「${node.id}」引用的主节点不在画布上，已放在末尾列`)
  }
  return {
    positions,
    colOf,
    maxCol: Math.max(-1, orderedLayers.length - 1),
    reversedLineIds: [...new Set(reversedLineIds)],
    warnings,
  }
}

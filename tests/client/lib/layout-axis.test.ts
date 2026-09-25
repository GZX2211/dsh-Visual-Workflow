// tests/client/lib/layout-axis.test.ts
//
// 主轴共线 + 数据节点 (n-1) 列分布（用户裁决 2026-09，见 assets/imgs/布局算法调整.png 批注）：
//   - 主干（start/end/pause/角色/协作组/proxy）保持一条水平直线，各列主干卡片共线于主轴 Y；
//   - 同列多个主干节点以主轴为中心上下均分；
//   - 数据节点（file/database）不占主干通道，放到与其关联角色所在列 n 的 **n-1** 列，
//     并在该列内贴主轴上下堆叠（关联角色在主轴上方 → 数据节点贴上方，反之贴下方）；
//   - 列右对齐；列间距 = 前一列最右边界 → 后一列最左边界 = columnGap；
//   - 未关联角色的数据节点与未参与流程的主干节点进「孤立列」（流程最右侧之外）。
//
// 环境：纯函数测试，无需 jsdom（不触碰 DOM）。

import { describe, expect, it } from 'vitest'
import { axisOffsets, layoutGraph, DATA_KINDS, SPINE_KINDS } from '../../../src/client/lib/layout.js'
import { findLayoutOverlaps, layoutBoxesOf, collapsedIdsOf } from '../../../src/client/lib/layout-fit.js'
import { LAYOUT_DEFAULTS, groupCardMinHeight } from '../../../src/client/lib/layout-types.js'
import { GRAPH_GROUP_HEIGHT, GRAPH_GROUP_WIDTH, GRAPH_NODE_HEIGHT, GRAPH_STAGE_HEIGHT, GRAPH_STAGE_WIDTH } from '../../../src/client/lib/card-geometry.js'
import type { LayoutNodeInput } from '../../../src/client/lib/layout-types.js'
import type { Line } from '../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 构造帮手
// ---------------------------------------------------------------------------

function node(id: string, kind: string, extra: Partial<LayoutNodeInput> = {}): LayoutNodeInput {
  const size = extra.width !== undefined && extra.height !== undefined
    ? { width: extra.width, height: extra.height }
    : kind === 'group'
      ? { width: GRAPH_GROUP_WIDTH, height: GRAPH_GROUP_HEIGHT }
      : kind === 'start' || kind === 'end' || kind === 'pause'
        ? { width: GRAPH_STAGE_WIDTH, height: GRAPH_STAGE_HEIGHT }
        : { width: 208, height: GRAPH_NODE_HEIGHT }
  return { id, kind, ...size, ...extra }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

function ctxLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }
}

function dbLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'db-out', targetHandle: 'db-in' }
}

/** 渲染盒子（排除组内成员；与真实渲染口径一致）。 */
function renderBoxes(nodes: LayoutNodeInput[], positions: Map<string, { x: number; y: number }>) {
  const inputs = nodes.map((item) => ({ id: item.id, kind: item.kind, width: item.width, height: item.height, memberIds: item.memberIds, sourceId: item.sourceId }))
  const excluded = collapsedIdsOf(inputs)
  return layoutBoxesOf(
    nodes.map((item) => ({
      id: item.id,
      kind: item.kind,
      position: positions.get(item.id) ?? { x: 0, y: 0 },
      data: item.memberIds ? { memberIds: item.memberIds } : {},
    })),
    (item) => {
      const source = nodes.find((entry) => entry.id === item.id) as LayoutNodeInput
      return { w: source.width, h: source.height }
    },
    excluded,
  )
}

/** 列 → 该列节点 id（按列号聚合，便于断言「谁和谁同列」）。 */
function columnsOf(nodes: LayoutNodeInput[], colOf: Map<string, number>): Map<number, string[]> {
  const columns = new Map<number, string[]>()
  for (const item of nodes) {
    const column = colOf.get(item.id) ?? -1
    columns.set(column, [...(columns.get(column) ?? []), item.id])
  }
  return columns
}

/** 卡片右边缘（右对齐判定用）。 */
function rightEdgeOf(id: string, nodes: LayoutNodeInput[], positions: Map<string, { x: number; y: number }>): number {
  const source = nodes.find((item) => item.id === id) as LayoutNodeInput
  return (positions.get(id)?.x ?? 0) + source.width
}

/** 卡片左边缘。 */
function leftEdgeOf(id: string, positions: Map<string, { x: number; y: number }>): number {
  return positions.get(id)?.x ?? 0
}

/** 卡片垂直中心。 */
function centerYOf(id: string, nodes: LayoutNodeInput[], positions: Map<string, { x: number; y: number }>): number {
  const source = nodes.find((item) => item.id === id) as LayoutNodeInput
  return (positions.get(id)?.y ?? 0) + source.height / 2
}

// ---------------------------------------------------------------------------
// ① 节点分类契约
// ---------------------------------------------------------------------------

describe('节点分类：主干 / 数据', () => {
  it('主干 = start/end/pause/parent/agent/group/proxy；数据 = file/database（proxy 属主干）', () => {
    expect([...SPINE_KINDS].sort()).toEqual(['agent', 'end', 'group', 'parent', 'pause', 'proxy', 'start'])
    expect([...DATA_KINDS].sort()).toEqual(['database', 'file'])
    expect([...SPINE_KINDS].some((kind) => DATA_KINDS.has(kind))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ② 主轴共线
// ---------------------------------------------------------------------------

describe('主轴：主干卡片共线于同一水平线', () => {
  it('串行主干（start → role → end）各列主干卡片中心的 Y 完全一致，且等于结果里的主轴 Y', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')]
    const result = layoutGraph(nodes, lines)
    expect(centerYOf('s', nodes, result.positions)).toBe(result.axisY)
    expect(centerYOf('a1', nodes, result.positions)).toBe(result.axisY)
    expect(centerYOf('e', nodes, result.positions)).toBe(result.axisY)
    // 默认主轴 = originY + 最高主干卡片高/2（角色卡 116 高于阶段卡 88）
    expect(result.axisY).toBe(LAYOUT_DEFAULTS.originY + GRAPH_NODE_HEIGHT / 2)
  })

  it('同列多个主干节点以主轴为中心上下均分：列内间隔不小于 rowGap，且块中心落在主轴上', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 's', 'a2'), flowLine('l3', 'a1', 'e'), flowLine('l4', 'a2', 'e')]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('a1')).toBe(result.colOf.get('a2'))
    const first = result.positions.get('a1') as { x: number; y: number }
    const second = result.positions.get('a2') as { x: number; y: number }
    const [upper, lower] = first.y <= second.y ? [first, second] : [second, first]
    const gap = lower.y - (upper.y + GRAPH_NODE_HEIGHT)
    expect(gap).toBeGreaterThanOrEqual(LAYOUT_DEFAULTS.rowGap)
    expect(upper.y + (GRAPH_NODE_HEIGHT * 2 + gap) / 2).toBe(result.axisY)
  })
})

// ---------------------------------------------------------------------------
// ③ 数据节点 (n-1) 列与上下侧判定
// ---------------------------------------------------------------------------

describe('数据节点：列 = 关联角色列 - 1，贴主轴上下堆叠', () => {
  it('单个数据节点关联第 2 列角色 → 落在第 1 列，且与关联角色不同列', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('f1', 'file'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e'), ctxLine('c1', 'f1', 'a1')]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('a1')).toBe(1)
    expect(result.colOf.get('f1')).toBe(0)
    // 主干仍在自己的列上：start 在第 0 列、end 在最后一列
    expect(result.colOf.get('s')).toBe(0)
    expect(result.colOf.get('e')).toBe(2)
    // 数据节点不占用主干通道：同列主干卡片仍共线于主轴
    expect(centerYOf('s', nodes, result.positions)).toBe(result.axisY)
  })

  it('数据库节点关联第 3 列角色 → 落在第 2 列（n-1）', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('d1', 'database'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'a2'), flowLine('l3', 'a2', 'e'),
      dbLine('b1', 'd1', 'a2'),
    ]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('a2')).toBe(2)
    expect(result.colOf.get('d1')).toBe(1)
  })

  it('上下侧判定：关联角色位于主轴上方 → 数据节点贴主轴上方；位于下方 → 贴下方', () => {
    // 主干：start → {up, down}（同列并行）→ end；该列两个主干节点以主轴为中心上下展开
    const roles = [node('up', 'agent'), node('down', 'agent')]
    const nodes = [node('s', 'start'), ...roles, node('e', 'end'), node('fUp', 'file'), node('fDown', 'file')]
    const lines = [
      flowLine('l1', 's', 'up'), flowLine('l2', 's', 'down'),
      flowLine('l3', 'up', 'e'), flowLine('l4', 'down', 'e'),
      ctxLine('c1', 'fUp', 'up'), ctxLine('c2', 'fDown', 'down'),
    ]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('up')).toBe(1)
    expect(result.colOf.get('down')).toBe(1)
    // 主轴上侧/下侧角色（不假设层内排序结果，按几何位置判定）
    const upperRole = centerYOf('up', nodes, result.positions) < centerYOf('down', nodes, result.positions) ? 'up' : 'down'
    const lowerRole = upperRole === 'up' ? 'down' : 'up'
    const upperFile = upperRole === 'up' ? 'fUp' : 'fDown'
    const lowerFile = upperFile === 'fUp' ? 'fDown' : 'fUp'
    expect(centerYOf(upperRole, nodes, result.positions)).toBeLessThan(result.axisY)
    expect(centerYOf(lowerRole, nodes, result.positions)).toBeGreaterThan(result.axisY)
    // 关联角色在主轴上方 → 其数据节点也贴主轴上方；反之贴下方
    expect(centerYOf(upperFile, nodes, result.positions)).toBeLessThan(result.axisY)
    expect(centerYOf(lowerFile, nodes, result.positions)).toBeGreaterThan(result.axisY)
    // 两者都在 (n-1) 列：角色在第 1 列 → 数据节点在第 0 列
    expect(result.colOf.get('fUp')).toBe(0)
    expect(result.colOf.get('fDown')).toBe(0)
  })

  it('同列多数据节点：贴轴优先序 = 关联角色在主轴上的序号（越靠上越先贴轴），间隔不小于 rowGap', () => {
    const nodes = [
      node('s', 'start'), node('r1', 'agent'), node('r2', 'agent'), node('r3', 'agent'), node('e', 'end'),
      node('f1', 'file'), node('f2', 'file'), node('f3', 'file'),
    ]
    const lines = [
      flowLine('l1', 's', 'r1'), flowLine('l2', 's', 'r2'), flowLine('l3', 's', 'r3'),
      flowLine('l4', 'r1', 'e'), flowLine('l5', 'r2', 'e'), flowLine('l6', 'r3', 'e'),
      ctxLine('c1', 'f1', 'r1'), ctxLine('c2', 'f2', 'r2'), ctxLine('c3', 'f3', 'r3'),
    ]
    const result = layoutGraph(nodes, lines)
    const yOf = (id: string): number => result.positions.get(id)?.y ?? Number.NaN
    // 数据节点同处第 0 列（角色在第 1 列）
    for (const id of ['f1', 'f2', 'f3']) expect(result.colOf.get(id)).toBe(0)
    // 贴轴优先序与关联角色的主轴序号一致：把数据节点按 Y 升序排列后，其关联角色的 Y 也升序
    const sortedFiles = ['f1', 'f2', 'f3'].sort((a, b) => yOf(a) - yOf(b))
    const sortedRoles = ['r1', 'r2', 'r3'].sort((a, b) => yOf(a) - yOf(b))
    expect(sortedFiles).toEqual(sortedRoles.map((role) => `f${role.slice(1)}`))
    // 同列相邻数据节点间隔不小于 rowGap
    expect(yOf(sortedFiles[1]) - (yOf(sortedFiles[0]) + GRAPH_NODE_HEIGHT)).toBeGreaterThanOrEqual(LAYOUT_DEFAULTS.rowGap)
    expect(yOf(sortedFiles[2]) - (yOf(sortedFiles[1]) + GRAPH_NODE_HEIGHT)).toBeGreaterThanOrEqual(LAYOUT_DEFAULTS.rowGap)
  })

  it('数据节点关联多个角色（跨列）：取最小列 - 1，保证确定且左靠', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('f1', 'file'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'a2'), flowLine('l3', 'a2', 'e'),
      ctxLine('c1', 'f1', 'a1'), ctxLine('c2', 'f1', 'a2'),
    ]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('a1')).toBe(1)
    expect(result.colOf.get('a2')).toBe(2)
    expect(result.colOf.get('f1')).toBe(0)
  })

  it('数据节点恒不与关联角色同列，且渲染盒子之间不重叠', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('d1', 'database'), node('f1', 'file'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e'),
      dbLine('b1', 'd1', 'a1'), ctxLine('c1', 'f1', 'a1'),
    ]
    const result = layoutGraph(nodes, lines)
    for (const dataId of ['d1', 'f1']) {
      expect(result.colOf.get(dataId)).not.toBe(result.colOf.get('a1'))
    }
    expect(findLayoutOverlaps(renderBoxes(nodes, result.positions))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ④ 列右对齐与列间距
// ---------------------------------------------------------------------------

describe('列几何：右对齐与列间距', () => {
  it('同列卡片右边缘对齐（阶段卡 168 与角色卡 208 混列时右边界一致）', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('p1', 'pause'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'p1'), flowLine('l3', 'p1', 'e')]
    const result = layoutGraph(nodes, lines)
    const columns = columnsOf(nodes, result.colOf)
    for (const [, ids] of columns) {
      if (ids.length < 2) continue
      const edges = ids.map((id) => Math.round(rightEdgeOf(id, nodes, result.positions)))
      expect(new Set(edges).size).toBe(1)
    }
    // 阶段卡（168）与角色卡（208）宽度不同但右边界一致 → 左边界必然不同
    const allEdges = nodes.map((item) => rightEdgeOf(item.id, nodes, result.positions) - item.width)
    expect(new Set(allEdges.map((edge) => Math.round(edge))).size).toBe(nodes.length)
  })

  it('列间距 = 前一列最右边界 → 后一列最左边界 = columnGap（缺省 72；可覆盖为其他值）', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('f1', 'file'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e'), ctxLine('c1', 'f1', 'a1')]
    const result = layoutGraph(nodes, lines)
    const columns = columnsOf(nodes, result.colOf)
    const sorted = [...columns.keys()].filter((column) => column >= 0).sort((a, b) => a - b)
    for (let index = 1; index < sorted.length; index += 1) {
      const previousIds = columns.get(sorted[index - 1]) ?? []
      const currentIds = columns.get(sorted[index]) ?? []
      const previousRight = Math.max(...previousIds.map((id) => rightEdgeOf(id, nodes, result.positions)))
      const currentLeft = Math.min(...currentIds.map((id) => leftEdgeOf(id, result.positions)))
      expect(currentLeft - previousRight).toBe(LAYOUT_DEFAULTS.columnGap)
    }
    const custom = layoutGraph(nodes, lines, { columnGap: 120 })
    const customColumns = columnsOf(nodes, custom.colOf)
    const customRight = Math.max(...(customColumns.get(0) ?? []).map((id) => rightEdgeOf(id, nodes, custom.positions)))
    const customLeft = Math.min(...(customColumns.get(1) ?? []).map((id) => leftEdgeOf(id, custom.positions)))
    expect(customLeft - customRight).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// ⑤ 虚拟节点独立占位
// ---------------------------------------------------------------------------

describe('虚拟节点：独立占位（不再与主节点重叠）', () => {
  it('proxy 与主节点同列时纵向错开、不重叠；主节点列号只由自身拓扑决定', () => {
    const nodes = [
      node('s', 'start'), node('m', 'agent'),
      node('x', 'proxy', { sourceId: 'm' }), node('y', 'proxy', { sourceId: 'm' }),
      node('e', 'end'),
    ]
    const lines = [
      flowLine('l1', 's', 'm'), flowLine('l2', 's', 'x'), flowLine('l3', 's', 'y'),
      flowLine('l4', 'm', 'e'), flowLine('l5', 'x', 'e'), flowLine('l6', 'y', 'e'),
    ]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('m')).toBe(1)
    expect(result.colOf.get('x')).toBe(1)
    expect(result.colOf.get('y')).toBe(1)
    const boxes = renderBoxes(nodes, result.positions)
    expect(boxes.map((box) => box.id).sort()).toEqual(['e', 'm', 's', 'x', 'y'])
    expect(findLayoutOverlaps(boxes)).toEqual([])
  })

  it('proxy 在自己列上时，主节点仍保留在原列（互不推动）', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('x', 'proxy', { sourceId: 'a1' }), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'x'), flowLine('l3', 'x', 'e')]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('a1')).toBe(1)
    expect(result.colOf.get('x')).toBe(2)
    expect(result.positions.get('x')).not.toEqual(result.positions.get('a1'))
  })
})

// ---------------------------------------------------------------------------
// ⑥ 孤立节点（未关联角色的数据节点 / 未参与流程的主干节点）
// ---------------------------------------------------------------------------

describe('孤立节点：单独成列排在流程最右侧之外', () => {
  it('未关联角色的数据节点进孤立列，并给出可读告警', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('f1', 'file'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('f1')).toBeGreaterThan(result.maxCol)
    expect(result.positions.get('f1')?.x).toBeGreaterThan(result.positions.get('e')?.x ?? Number.NaN)
    expect(result.warnings.join('')).toContain('未关联任何角色节点')
  })

  it('未参与流程的角色节点与未关联角色的数据节点同处孤立列，且不与流程混排', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('o1', 'agent'), node('d1', 'database'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')]
    const result = layoutGraph(nodes, lines)
    expect(result.colOf.get('o1')).toBe(result.orphanCol)
    expect(result.colOf.get('d1')).toBe(result.orphanCol)
    expect(result.orphanCol).toBe(result.maxCol + 1)
    for (const id of ['o1', 'd1']) {
      expect(result.positions.get(id)?.x).toBeGreaterThan(result.positions.get('e')?.x ?? Number.NaN)
    }
  })
})

// ---------------------------------------------------------------------------
// ⑦ 协作组：卡片包住成员（回归既有不变量）
// ---------------------------------------------------------------------------

describe('协作组：仍为超级节点，卡片包住成员', () => {
  it('组卡片按主轴居中，成员坐标落在卡片矩形内且按 memberIds 顺序排列', () => {
    const nodes = [
      node('s', 'start'),
      node('g1', 'group', { memberIds: ['a1', 'a2'] }),
      node('a1', 'agent'), node('a2', 'agent'),
      node('e', 'end'),
    ]
    const lines = [flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e')]
    const result = layoutGraph(nodes, lines)
    const group = result.positions.get('g1') as { x: number; y: number }
    const height = Math.max(GRAPH_GROUP_HEIGHT, groupCardMinHeight({ data: { memberIds: ['a1', 'a2'], size: { h: GRAPH_GROUP_HEIGHT } } }))
    for (const memberId of ['a1', 'a2']) {
      const member = result.positions.get(memberId) as { x: number; y: number }
      expect(member.x).toBeGreaterThanOrEqual(group.x)
      expect(member.x).toBeLessThanOrEqual(group.x + GRAPH_GROUP_WIDTH)
      expect(member.y).toBeGreaterThanOrEqual(group.y)
      expect(member.y).toBeLessThanOrEqual(group.y + height)
    }
    expect((result.positions.get('a1') as { y: number }).y).toBeLessThan((result.positions.get('a2') as { y: number }).y)
    // 组卡片中心落在主轴上
    expect(group.y + height / 2).toBe(result.axisY)
    // 组卡片是超级节点：组员不参与重叠判定
    expect(renderBoxes(nodes, result.positions).map((box) => box.id).sort()).toEqual(['e', 'g1', 's'])
  })
})

// ---------------------------------------------------------------------------
// ⑧ 主轴堆叠纯函数
// ---------------------------------------------------------------------------

describe('axisOffsets：主轴上下均分', () => {
  it('空输入返回空数组；单卡居中于轴', () => {
    expect(axisOffsets([], 200, 56)).toEqual([])
    expect(axisOffsets([116], 200, 56)).toEqual([142])
  })

  it('多卡以轴为中心均分：块中心落在轴上，且内部间隔不小于给定最小间隔', () => {
    // 均分值（100）> 最小间隔（20）→ 采用均分值，块中心仍在轴上
    const offsets = axisOffsets([100, 100], 200, 20)
    expect(offsets).toEqual([0, 300])
    expect(offsets[0] + (offsets[1] + 100 - offsets[0]) / 2).toBe(200)
    // 最小间隔（20）> 均分值（10）→ 采用最小间隔堆叠
    const tight = axisOffsets([100, 100], 105, 20)
    expect(tight[1] - (tight[0] + 100)).toBe(20)
  })
})

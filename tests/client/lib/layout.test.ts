// tests/client/lib/layout.test.ts
//
// 分层布局单测（自主编排方案 §7.4）：**断言不变量，不断言具体坐标**——
// 坐标数值属可调美观参数，不变量（列序/无重叠/组内包含/确定性）才是契约。
// 覆盖：9 条布局不变量 + 自动布局判定 + 重叠检测 + 整理布局入口（tidyNodes）。
//
// 环境：纯函数测试，无需 jsdom（不触碰 DOM）。
//
// 注（治理）：本文件曾 import host 侧 computeFlowLayers 并 `void` 掉（无任何断言），
// 既形成 Client 测试对 Host 运行时模块的跨层依赖，也不构成验证——已移除。
// client 侧流程线判定（layout.ts 的 isFlowLine）由下方「仅流程线参与分层」用例锁定。

import { describe, expect, it } from 'vitest'
import { layoutGraph, toLayoutInputs } from '../../../src/client/lib/layout.js'
import { needsAutoLayout, findLayoutOverlaps, layoutBoxesOf, tidyNodes, boxesOverlap, collapsedIdsOf } from '../../../src/client/lib/layout-fit.js'
import { groupCardSizeOf, GRAPH_GROUP_HEIGHT, GRAPH_GROUP_WIDTH, GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, GRAPH_STAGE_HEIGHT, GRAPH_STAGE_WIDTH } from '../../../src/client/lib/card-geometry.js'
import type { LayoutNodeInput } from '../../../src/client/lib/layout-types.js'
import type { CanvasNode } from '../../../src/client/studio/studio-state.js'
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
        : { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
  return { id, kind, ...size, ...extra }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

function ctxLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }
}

/** 节点矩形（校验无重叠/组内包含用；直接使用布局输出坐标）。 */
function rectOf(nodes: LayoutNodeInput[], positions: Map<string, { x: number; y: number }>) {
  return nodes.map((item) => {
    const position = positions.get(item.id) ?? { x: Number.NaN, y: Number.NaN }
    return { id: item.id, x: position.x, y: position.y, w: item.width, h: item.height }
  })
}

// ---------------------------------------------------------------------------
// ①～③ 分层不变量
// ---------------------------------------------------------------------------

describe('布局不变量：分层与列序', () => {
  it('① 同列 = 可并行：同列任意两单元之间不存在流程路径', () => {
    // start → a1/a2/a3（并行）→ b1 → end：a1/a2/a3 同列，彼此无路径
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('a3', 'agent'), node('b1', 'agent'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 's', 'a2'), flowLine('l3', 's', 'a3'),
      flowLine('l4', 'a1', 'b1'), flowLine('l5', 'a2', 'b1'), flowLine('l6', 'a3', 'b1'),
      flowLine('l7', 'b1', 'e'),
    ]
    const { colOf } = layoutGraph(nodes, lines)
    const byCol = new Map<number, string[]>()
    for (const item of nodes) {
      const col = colOf.get(item.id) ?? -1
      byCol.set(col, [...(byCol.get(col) ?? []), item.id])
    }
    const reachable = (from: string, to: string): boolean => {
      const queue = [from]
      const seen = new Set<string>()
      while (queue.length > 0) {
        const current = queue.shift() as string
        if (current === to) return true
        if (seen.has(current)) continue
        seen.add(current)
        for (const line of lines) if (line.source === current) queue.push(line.target)
      }
      return false
    }
    for (const ids of byCol.values()) {
      for (const from of ids) {
        for (const to of ids) {
          if (from === to) continue
          expect(reachable(from, to)).toBe(false)
        }
      }
    }
  })

  it('② 列序 = 拓扑序：每条流程边满足 col(u) < col(v)', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'a2'), flowLine('l3', 'a2', 'e')]
    const { colOf } = layoutGraph(nodes, lines)
    for (const line of lines) {
      expect(colOf.get(line.source) as number).toBeLessThan(colOf.get(line.target) as number)
    }
  })

  it('③ start 在最左列、end 在最右列（且串行链横向展开）', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('e', 'end')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'a2'), flowLine('l3', 'a2', 'e')]
    const { colOf, maxCol, positions } = layoutGraph(nodes, lines)
    expect(colOf.get('s')).toBe(0)
    expect(colOf.get('e')).toBe(maxCol)
    expect(positions.get('s')!.x).toBeLessThan(positions.get('a1')!.x)
    expect(positions.get('a1')!.x).toBeLessThan(positions.get('a2')!.x)
    expect(positions.get('a2')!.x).toBeLessThan(positions.get('e')!.x)
  })

  it('③′ 仅 flow-out → flow-in 参与分层：ctx 线与幽灵线都不算流程边', () => {
    // 幽灵线 = 单侧命中流程通道（源为上下文出、目标为流程入）的历史/手改数据。
    // 通道互斥，它不是流程边：不得影响列号（若被当成 a1 → s 的回边，start 列会漂移）。
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('e', 'end')]
    const lines: Line[] = [
      flowLine('l1', 's', 'a1'),
      flowLine('l2', 'a1', 'e'),
      ctxLine('c1', 'a1', 'e'),
      { id: 'g1', source: 'a1', target: 's', sourceHandle: 'ctx-out', targetHandle: 'flow-in' },
    ]
    const { colOf } = layoutGraph(nodes, lines)
    expect(colOf.get('s')).toBe(0)
    expect(colOf.get('a1')).toBe(1)
    expect(colOf.get('e')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// ④ 无重叠（含组卡片实际尺寸）
// ---------------------------------------------------------------------------

describe('布局不变量：几何', () => {
  it('④ 无重叠：任意两渲染盒子矩形不相交（阶段卡 168×88 / 角色卡 208×116 / 组卡 300×220 混合）', () => {
    const nodes = [
      node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('a3', 'agent'),
      node('g1', 'group', { memberIds: ['a4', 'a5'] }), node('a4', 'agent'), node('a5', 'agent'),
      node('p1', 'pause'), node('e', 'end'),
    ]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 's', 'a2'), flowLine('l3', 's', 'a3'),
      flowLine('l4', 'a1', 'g1'), flowLine('l5', 'a2', 'g1'), flowLine('l6', 'a3', 'g1'),
      flowLine('l7', 'g1', 'p1'), flowLine('l8', 'p1', 'e'),
      ctxLine('c1', 'a4', 'a1'), ctxLine('c2', 'a5', 'a2'),
    ]
    const { positions } = layoutGraph(nodes, lines)
    const rects = rectOf(nodes, positions)
    for (const rect of rects) {
      expect(Number.isFinite(rect.x) && Number.isFinite(rect.y)).toBe(true)
    }
    // 重叠判定只看实际渲染盒子（组卡片 + 独立节点；组内成员与虚拟节点不独立渲染）
    // 说明：这里刻意用「带 memberIds 的折叠清单」而不是 data——StudioState.CanvasNode 的
    // 投影把成员关系放在节点 data 里，而 Host 图模型放在 LayoutNodeInput.memberIds 上。
    const collapsed = collapsedIdsOf(nodes.map((item) => ({ id: item.id, kind: item.kind, memberIds: item.memberIds, sourceId: item.sourceId })))
    expect([...collapsed].sort()).toEqual(['a4', 'a5'])
    const boxes = layoutBoxesOf(
      rects.map((rect) => ({ id: rect.id, kind: nodes.find((item) => item.id === rect.id)!.kind, position: { x: rect.x, y: rect.y }, data: {} })),
      (item) => {
        const source = nodes.find((entry) => entry.id === item.id)!
        return { w: source.width, h: source.height }
      },
      collapsed,
    )
    // 组卡片 + 独立节点全部两两不重叠
    expect(findLayoutOverlaps(boxes)).toEqual([])
    expect(boxes.map((box) => box.id)).not.toContain('a4')
  })

  it('boxesOverlap：相交/贴边/零面积语义', () => {
    expect(boxesOverlap({ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    // 贴边（x 恰好等于右边界）不算相交：避免「零间隙」被误报
    expect(boxesOverlap({ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 10, y: 0, w: 10, h: 10 })).toBe(false)
    expect(boxesOverlap({ id: 'a', x: 0, y: 0, w: 0, h: 10 }, { id: 'b', x: 0, y: 0, w: 10, h: 10 })).toBe(false)
    expect(boxesOverlap({ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'a', x: 0, y: 0, w: 10, h: 10 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ⑤～⑦ 虚拟节点 / 协作组 / 孤立节点
// ---------------------------------------------------------------------------

describe('布局不变量：虚拟节点 / 协作组 / 孤立节点', () => {
  it('⑤ proxy 独立占位：主节点列号只由自身拓扑决定，虚拟节点不推主节点、不再与主节点重叠（回归 §7.1 缺陷 1）', () => {
    const base = [node('s', 'start'), node('m', 'agent'), node('n', 'agent'), node('e', 'end')]
    // 无 proxy：s → m → n → e
    const chain = [flowLine('l1', 's', 'm'), flowLine('l2', 'm', 'n'), flowLine('l3', 'n', 'e')]
    const withoutProxy = layoutGraph(base, chain)
    // 有 proxy：s → x(引用 m) → n → e，且 m 自身不被任何流程线驱动
    const withProxy = [
      node('s', 'start'),
      node('m', 'agent'),
      node('x', 'proxy', { sourceId: 'm' }),
      node('n', 'agent'),
      node('e', 'end'),
    ]
    const proxyLines = [flowLine('p1', 's', 'x'), flowLine('p2', 'x', 'n'), flowLine('p3', 'n', 'e')]
    const withProxyResult = layoutGraph(withProxy, proxyLines)
    // 无 proxy 图：m 在第 1 列（s → m → n → e）
    expect(withoutProxy.colOf.get('m')).toBe(1)
    expect(withoutProxy.colOf.get('n')).toBe(2)
    // 有 proxy 图：虚拟节点 x 作为独立主干节点按自身流程边落在第 1 列（s → x → n → e）
    expect(withProxyResult.colOf.get('x')).toBe(1)
    expect(withProxyResult.colOf.get('n')).toBe(2)
    // 回归要点（proxy 不推主节点）：m 始终在自己该在的列，不被虚拟节点推到引用方之后
    expect(withoutProxy.colOf.get('m')).toBe(1)
    expect(withProxyResult.colOf.get('m')).toBe(withProxyResult.orphanCol)
    expect(withoutProxy.colOf.get('n')).toBe(withProxyResult.colOf.get('n'))
    // 虚拟节点独立占位：不再与主节点共享坐标（画布上二者是两张不同位置的卡片）
    expect(withProxyResult.positions.get('x')).not.toEqual(withProxyResult.positions.get('m'))
    const boxes = layoutBoxesOf(
      withProxy.map((item) => ({ id: item.id, kind: item.kind, position: withProxyResult.positions.get(item.id)!, data: {} })),
      () => ({ w: GRAPH_NODE_WIDTH, h: GRAPH_NODE_HEIGHT }),
    )
    // 虚拟节点是实际渲染的卡片（带「引用」角标），参与重叠判定
    expect(boxes.map((box) => box.id)).toContain('x')
    expect(findLayoutOverlaps(boxes)).toEqual([])
  })

  it('⑥ 协作组卡片包住成员：成员坐标落在组卡片矩形内（顺序 = memberIds）', () => {
    const nodes = [
      node('s', 'start'),
      node('g1', 'group', { memberIds: ['a1', 'a2', 'a3'] }),
      node('a1', 'agent'), node('a2', 'agent'), node('a3', 'agent'),
      node('e', 'end'),
    ]
    const lines = [flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e')]
    const { positions } = layoutGraph(nodes, lines)
    const group = positions.get('g1')!
    const size = groupCardSizeOf({ id: 'g1', kind: 'group', position: group, data: { memberIds: ['a1', 'a2', 'a3'], size: { w: GRAPH_GROUP_WIDTH, h: GRAPH_GROUP_HEIGHT } } } as unknown as CanvasNode)
    for (const memberId of ['a1', 'a2', 'a3']) {
      const member = positions.get(memberId)!
      expect(member.x).toBeGreaterThanOrEqual(group.x)
      expect(member.x).toBeLessThanOrEqual(group.x + size.w)
      expect(member.y).toBeGreaterThanOrEqual(group.y)
      expect(member.y).toBeLessThanOrEqual(group.y + size.h)
    }
    // 成员按 memberIds 顺序纵向排列
    expect(positions.get('a1')!.y).toBeLessThan(positions.get('a2')!.y)
    expect(positions.get('a2')!.y).toBeLessThan(positions.get('a3')!.y)
    // 组卡片高度不足时给出告警（300×220 容纳 3 名成员：78 + 3×38 + 10 = 202 < 220 → 无告警）
    expect(layoutGraph([...nodes], lines).warnings).toEqual([])
    // 成员很多时卡片高度不足 → 非阻断告警
    const many = ['m1', 'm2', 'm3', 'm4', 'm5']
    const crowded = [
      node('s', 'start'),
      node('g1', 'group', { memberIds: many }),
      ...many.map((id) => node(id, 'agent')),
      node('e', 'end'),
    ]
    const result = layoutGraph(crowded, [flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e')])
    expect(result.warnings.join('')).toContain('卡片高度不足')
  })

  it('⑦ 孤立节点不与流程混排：单独成列放在流程最右侧之外', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('e', 'end'), node('o1', 'agent'), node('o2', 'agent')]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')]
    const { colOf, maxCol, positions } = layoutGraph(nodes, lines)
    expect(colOf.get('o1')).toBeGreaterThan(maxCol)
    expect(colOf.get('o2')).toBeGreaterThan(maxCol)
    expect(positions.get('o1')!.x).toBeGreaterThan(positions.get('e')!.x)
    expect(positions.get('o2')!.x).toBeGreaterThan(positions.get('e')!.x)
  })
})

// ---------------------------------------------------------------------------
// ⑧⑨ 确定性 / 环图
// ---------------------------------------------------------------------------

describe('布局不变量：确定性与环', () => {
  it('⑧ 确定性：同输入两次调用结果完全相同', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('a3', 'agent'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 's', 'a2'), flowLine('l3', 's', 'a3'),
      flowLine('l4', 'a1', 'e'), flowLine('l5', 'a2', 'e'), flowLine('l6', 'a3', 'e'),
    ]
    const first = layoutGraph(nodes, lines)
    const second = layoutGraph(nodes, lines)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
    expect([...first.colOf.entries()]).toEqual([...second.colOf.entries()])
  })

  it('⑨ 环图不崩：回流边被标记、节点都有坐标、不产生 NaN', () => {
    const nodes = [node('s', 'start'), node('a1', 'agent'), node('a2', 'agent'), node('e', 'end')]
    const lines = [
      flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'a2'),
      flowLine('l3', 'a2', 'a1'), // 回流边（环）
      flowLine('l4', 'a2', 'e'),
    ]
    const result = layoutGraph(nodes, lines)
    expect(result.reversedLineIds).toContain('l3')
    for (const item of nodes) {
      const position = result.positions.get(item.id)!
      expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true)
    }
  })

  it('空画布 / 单节点：返回空结果或不崩溃的确定坐标', () => {
    expect(layoutGraph([], []).positions.size).toBe(0)
    const single = layoutGraph([node('a1', 'agent')], [])
    expect(Number.isFinite(single.positions.get('a1')!.x)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 自动布局判定 / 重叠检测 / 统一入口
// ---------------------------------------------------------------------------

describe('自动布局判定与统一入口', () => {
  it('needsAutoLayout：缺坐标或哨兵 {0,0} 为真；正常坐标为假', () => {
    expect(needsAutoLayout([{ id: 'a', kind: 'agent', position: { x: 0, y: 0 } }])).toBe(true)
    expect(needsAutoLayout([{ id: 'a', kind: 'agent', position: { x: 70, y: 80 } }])).toBe(false)
    expect(needsAutoLayout([{ id: 'a', kind: 'agent', position: { x: Number.NaN, y: 0 } }])).toBe(true)
    expect(needsAutoLayout([])).toBe(false)
    expect(needsAutoLayout(undefined)).toBe(false)
  })

  it('findLayoutOverlaps：返回重叠的 id 对（字典序归一）；无重叠为空', () => {
    const boxes = [
      { id: 'b', x: 0, y: 0, w: 10, h: 10 },
      { id: 'a', x: 5, y: 5, w: 10, h: 10 },
      { id: 'c', x: 100, y: 100, w: 10, h: 10 },
    ]
    expect(findLayoutOverlaps(boxes)).toEqual([['a', 'b']])
    expect(findLayoutOverlaps([{ id: 'a', x: 0, y: 0, w: 10, h: 10 }])).toEqual([])
  })

  it('layoutBoxesOf：排除组内成员（组员不独立渲染，避免「永远重叠」的假告警），虚拟节点参与判定', () => {
    const nodes = [
      { id: 'g1', kind: 'group', position: { x: 0, y: 0 }, data: { memberIds: ['a1'] } },
      { id: 'a1', kind: 'agent', position: { x: 10, y: 88 }, data: { groupId: 'g1' } },
      { id: 'x', kind: 'proxy', position: { x: 300, y: 0 }, data: {} },
      { id: 'a2', kind: 'agent', position: { x: 300, y: 0 }, data: {} },
    ]
    const boxes = layoutBoxesOf(nodes, () => ({ w: 100, h: 50 }))
    // 组员 a1 被排除；虚拟节点 x 是实际渲染的卡片（独立占位后可能与其他节点重叠，必须参与判定）
    expect(boxes.map((box) => box.id).sort()).toEqual(['a2', 'g1', 'x'])
  })

  it('tidyNodes：统一入口（整理布局与自动布局共用）— 坐标写回且其余字段保持', () => {
    const nodes = [
      { id: 's', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '分析' } },
      { id: 'e', kind: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } },
    ]
    const lines = [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')]
    const { nodes: next, result } = tidyNodes(nodes, lines, { sizeOf: (item) => (item.kind === 'agent' ? { w: 208, h: 116 } : { w: 168, h: 88 }) })
    expect(result.maxCol).toBe(2)
    expect(next[0].data).toEqual({ label: '启动' })
    expect(next[1].position.x).toBeGreaterThan(next[0].position.x)
    expect(next[2].position.x).toBeGreaterThan(next[1].position.x)
    // 已是同一坐标时不产生新对象（避免无谓的 dispatch/保存）
    const again = tidyNodes(next, lines, { sizeOf: (item) => (item.kind === 'agent' ? { w: 208, h: 116 } : { w: 168, h: 88 }) })
    expect(again.nodes[1]).toBe(next[1])
  })

  it('toLayoutInputs：从画布节点投影出尺寸/关系元数据（含 proxy 引用与组员）', () => {
    const inputs = toLayoutInputs(
      [
        { id: 'x', kind: 'proxy', data: {}, proxySourceId: 'm' } as { id: string; kind: string; data: Record<string, unknown> },
        { id: 'g1', kind: 'group', data: { memberIds: ['m'] } },
        { id: 'm', kind: 'agent', data: { groupId: 'g1' } },
      ],
      (item) => (item.kind === 'group' ? { w: 300, h: 220 } : { w: 208, h: 116 }),
    )
    expect(inputs.find((item) => item.id === 'x')?.sourceId).toBe('m')
    expect(inputs.find((item) => item.id === 'g1')?.memberIds).toEqual(['m'])
    expect(inputs.find((item) => item.id === 'm')?.groupId).toBe('g1')
    expect(inputs.find((item) => item.id === 'g1')?.width).toBe(300)
  })
})

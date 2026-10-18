// tests/client/components/canvas/geometry.test.ts
//
// 画布渲染几何纯函数（Team/阶段节点适配）：阶段节点紧凑尺寸；组内成员连线锚点；
// Team 卡片流程接点居中；成员 → 组 预建索引（连线几何不得逐边全节点扫描）。
//
// 注（治理）：卡片尺寸常量与尺寸解析的唯一本体是 lib/card-geometry.ts（含
// GRAPH_STAGE_WIDTH / GRAPH_STAGE_HEIGHT / nodeSizeOf），因此该部分用例按源文件归属移至
// tests/client/lib/card-geometry.test.ts；DOM 命中检测（groupSurfaceFromElements /
// connectionTargetAt）归 lib/dom-hit-test.ts，其用例移至 tests/client/lib/dom-hit-test.test.ts。
// 本文件只覆盖组件层 geometry.ts 的渲染几何原语。

import { describe, expect, it } from 'vitest'
import {
  GROUP_CTX_IN_TOP,
  GROUP_MEMBER_HANDLE_INSET_X,
  MEMBER_HANDLE_TOP,
  edgeGeometry,
  memberAnchor,
  memberGroupIndexOf,
  memberInboundStubPath,
} from '../../../../src/client/components/canvas/geometry.js'
import type { MemberGroupIndex } from '../../../../src/client/components/canvas/geometry.js'
import { GROUP_MEMBER_LIST_TOP, GROUP_MEMBER_ROW_H, GROUP_MEMBER_ROW_HEIGHT } from '../../../../src/client/lib/card-geometry.js'
import type { CanvasEdge, CanvasNode } from '../../../../src/client/studio/studio-state.js'

function nodeOf(id: string, kind: CanvasNode['kind'], extra: Record<string, unknown> = {}): CanvasNode {
  return { id, kind, position: { x: 100, y: 200 }, data: { label: id, ...extra } } as CanvasNode
}

/** 成员的所属组反查走成员 → 组 预建索引（全量扫描只允许发生在预建时）。 */
function geometryIndex(byId: Map<string, CanvasNode>): MemberGroupIndex {
  return memberGroupIndexOf(byId)
}

/** 记录全节点扫描次数的 Map：`values()` 是按全量节点反查的唯一入口。 */
class ScanCountingMap extends Map<string, CanvasNode> {
  scans = 0
  override values(): ReturnType<Map<string, CanvasNode>['values']> {
    this.scans += 1
    return super.values()
  }
}

describe('画布几何（Team/阶段）', () => {
  it('memberGroupIndexOf：按 memberIds 反查成员所属组（含同成员属多组时先到者优先）', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1', 'a1'], size: { w: 300, h: 220 } })
    const later = nodeOf('g2', 'group', { memberIds: ['a1', 'a2'], size: { w: 300, h: 220 } })
    const byId = new Map<string, CanvasNode>([
      ['g', group], ['g2', later],
      ['a1', nodeOf('a1', 'agent', { groupId: 'g' })], ['a2', nodeOf('a2', 'agent', { groupId: 'g2' })],
    ])
    const index = memberGroupIndexOf(byId)
    // 与旧的全量扫描同口径：节点顺序先到的组胜出；重复 memberIds 不产生第二处条目
    expect(index.get('a1')?.id).toBe('g')
    expect(index.get('a2')?.id).toBe('g2')
    expect(index.get('nobody')).toBeUndefined()
  })

  it('memberAnchor：锚到成员行内的真实接点（卡片内侧 + 接点纵向比例）', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1', 'a2'], size: { w: 300, h: 220 } })
    const rowTop = 200 + GROUP_MEMBER_LIST_TOP + GROUP_MEMBER_ROW_H
    const ctxIn = memberAnchor(group, 'a2', 'ctx-in')
    const dbIn = memberAnchor(group, 'a2', 'db-in')
    const ctxOut = memberAnchor(group, 'a2', 'ctx-out')

    // x 是成员迷你卡边缘的接点中心，而不是 Team 卡片外缘
    expect(ctxIn?.x).toBe(100 + GROUP_MEMBER_HANDLE_INSET_X)
    expect(ctxOut?.x).toBe(100 + 300 - GROUP_MEMBER_HANDLE_INSET_X)
    // y 按接点自身在成员行内的比例（ctx-in 在行下部、db-in 在行上部），不再统一取行中心
    expect(ctxIn?.y).toBeCloseTo(rowTop + GROUP_MEMBER_ROW_HEIGHT * MEMBER_HANDLE_TOP['ctx-in'], 6)
    expect(dbIn?.y).toBeCloseTo(rowTop + GROUP_MEMBER_ROW_HEIGHT * MEMBER_HANDLE_TOP['db-in'], 6)
    expect(dbIn!.y).toBeLessThan(ctxIn!.y)
  })

  it('edgeGeometry：组流程接点居中；Team ctx-in 按 30% 高度；成员连线锚到成员接点', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1'], size: { w: 300, h: 220 } })
    const a1 = nodeOf('a1', 'agent', { groupId: 'g' })
    const second = nodeOf('b', 'agent')
    const task = nodeOf('task', 'task')
    const byId = new Map<string, CanvasNode>([['g', group], ['a1', a1], ['b', second], ['task', task]])

    // 组 → 下游（流程接点居中）
    const groupEdge = edgeGeometry(
      { id: 'e1', source: 'g', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      byId,
      geometryIndex(byId),
    )
    expect(groupEdge!.start.y).toBe(200 + 220 * 0.5)

    // task → Team 整体任务（ctx-in 位于卡片 30% 高度）
    const groupCtxEdge = edgeGeometry(
      { id: 'e-ctx', source: 'task', target: 'g', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      byId,
      geometryIndex(byId),
    )
    expect(groupCtxEdge!.end.x).toBe(100)
    expect(groupCtxEdge!.end.y).toBeCloseTo(200 + 220 * GROUP_CTX_IN_TOP, 6)

    // 组内成员 ctx-in：端点落在成员迷你卡的内侧接点，而不是 Team 卡片左缘
    const memberEdge = edgeGeometry(
      { id: 'e2', source: 'task', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      byId,
      geometryIndex(byId),
    )
    const anchor = memberAnchor(group, 'a1', 'ctx-in')!
    expect(memberEdge!.end.x).toBe(anchor.x)
    expect(memberEdge!.end.y).toBeCloseTo(anchor.y, 6)
  })

  it('memberInboundStubPath：从 Team 卡片边缘切到成员接点（覆盖层用），非成员目标返回 null', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1'], size: { w: 300, h: 220 } })
    group.position = { x: 400, y: 200 }
    const a1 = nodeOf('a1', 'agent', { groupId: 'g' })
    const task = nodeOf('task', 'task')
    task.position = { x: 0, y: 260 }
    const byId = new Map<string, CanvasNode>([['g', group], ['a1', a1], ['task', task]])
    const index = geometryIndex(byId)

    const anchor = memberAnchor(group, 'a1', 'ctx-in')!
    const stub = memberInboundStubPath(
      { id: 'e', source: 'task', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      byId,
      index,
    )
    const points = numbersOf(stub!)
    // M 起点（Team 卡片左缘）… C … 终点（成员接点）
    expect(points[0]).toBeCloseTo(400, 6)
    expect(points[points.length - 2]).toBeCloseTo(anchor.x, 6)
    expect(points[points.length - 1]).toBeCloseTo(anchor.y, 6)

    expect(memberInboundStubPath(
      { id: 'e2', source: 'task', target: 'g', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      byId,
      index,
    )).toBeNull()
  })

  it('edgeGeometry：交换连接点的节点——源出点在左缘、目标入点在右缘（用户批注：防交叉换向）', () => {
    const src = nodeOf('src', 'agent', { swapPorts: true })
    const tgt = nodeOf('tgt', 'agent', { swapPorts: true })
    const normal = nodeOf('n', 'agent')
    const normalTgt = nodeOf('nr', 'agent')
    const byId = new Map<string, CanvasNode>([['src', src], ['tgt', tgt], ['n', normal], ['nr', normalTgt]])

    // 源交换（出点移左侧）→ start.x 为源节点左缘（未交换为右缘 100+208）
    const e1 = edgeGeometry({ id: 'e1', source: 'src', target: 'n', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))
    expect(e1!.start.x).toBe(100)
    // 目标交换（入点移右侧）→ end.x 为目标节点右缘（未交换为左缘 100）
    const e2 = edgeGeometry({ id: 'e2', source: 'n', target: 'tgt', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))
    expect(e2!.end.x).toBe(100 + 208)
    // 未交换默认：源右缘、目标左缘（基线，防退化）
    const e3 = edgeGeometry({ id: 'e3', source: 'n', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))
    expect(e3!.start.x).toBe(100 + 208)
    expect(e3!.end.x).toBe(100)
  })

  it('edgeGeometry：控制点方向跟随端口朝向，而非默认朝右（用户批注）', () => {
    const normal = nodeOf('n', 'agent')
    const normalTgt = nodeOf('nr', 'agent')
    const srcSwap = nodeOf('ss', 'agent', { swapPorts: true })
    const tgtSwap = nodeOf('tt', 'agent', { swapPorts: true })
    const byId = new Map<string, CanvasNode>([
      ['n', normal], ['nr', normalTgt], ['ss', srcSwap], ['tt', tgtSwap],
    ])

    // 标准相对（未交换）：源出点在右缘 → c1 在 start 右侧；目标入点在左缘 → c2 在 end 左侧
    const std = edgeGeometry({ id: 'e', source: 'n', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))!
    expect(std.c1.x).toBeGreaterThan(std.start.x)
    expect(std.c2.x).toBeLessThan(std.end.x)

    // 源交换（出点移左缘）：控制点应向左伸出（start 左缘 100，c1<100），否则穿入自身卡片体被遮挡
    const srcEdge = edgeGeometry({ id: 'e', source: 'ss', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))!
    expect(srcEdge.c1.x).toBeLessThan(srcEdge.start.x)

    // 目标交换（入点移右缘）：控制点应从右侧进入（end 右缘 308，c2>308），否则穿入目标卡片体被遮挡
    const tgtEdge = edgeGeometry({ id: 'e', source: 'n', target: 'tt', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))!
    expect(tgtEdge.c2.x).toBeGreaterThan(tgtEdge.end.x)
  })

  it('edgeGeometry：同侧（都在右缘）——曲线不穿入左卡卡片体（批注：被隐藏到后面）', () => {
    // 左卡(交换,入点右缘 x=368)、右卡(正常,出点右缘 x=768)；流向右→左，端口同在右缘
    const L = nodeOf('L', 'agent', { swapPorts: true })
    L.position = { x: 160, y: 300 }
    const R = nodeOf('R', 'agent')
    R.position = { x: 560, y: 300 }
    const byId = new Map<string, CanvasNode>([['L', L], ['R', R]])

    const edge = edgeGeometry({ id: 'e', source: 'R', target: 'L', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId, geometryIndex(byId))!
    // 左卡卡片体 x∈[160,368]；曲线若穿入左卡，min x 会 < 368（旧逻辑为 351）。修复后应保持 >= 左卡右缘。
    const range = pathXRange(edge.path)
    expect(range.min).toBeGreaterThanOrEqual(368 - 0.5)
  })
})

describe('画布几何（连线不做逐边全节点扫描：D07-03）', () => {
  it('edgeGeometry 用预建索引逐边 O(1) 命中：边数增加不再触发全节点扫描', () => {
    const byId = new ScanCountingMap()
    byId.set('g', nodeOf('g', 'group', { memberIds: ['a1', 'a2'], size: { w: 300, h: 220 } }))
    byId.set('a1', nodeOf('a1', 'agent', { groupId: 'g' }))
    byId.set('a2', nodeOf('a2', 'agent', { groupId: 'g' }))
    byId.set('b', nodeOf('b', 'agent'))
    const memberGroups = geometryIndex(byId)
    const scansAtBuild = byId.scans

    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'a1', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'e2', source: 'a2', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'e3', source: 'g', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ]
    for (const edge of edges) {
      expect(edgeGeometry(edge, byId, memberGroups)?.path).toBeTypeOf('string')
    }
    // 预建索引是唯一一次全节点扫描：逐边若退回全节点反查（每条边扫两次），此处必然大于基准
    expect(scansAtBuild).toBe(1)
    expect(byId.scans).toBe(scansAtBuild)
  })
})

/** 路径中的数值序列（M/C 均按 x y 成对出现，用于断言端点）。 */
function numbersOf(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
}

/** 采样贝塞尔路径的横坐标范围（按控制点重建，用于断言曲线不穿入节点卡片体）。 */
function pathXRange(path: string): { min: number; max: number } {
  const m = path.match(/M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/)
  if (!m) return { min: NaN, max: NaN }
  const [, sx, , c1x, , c2x, , ex] = m.map(Number)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i <= 120; i++) {
    const t = i / 120
    const x = (1 - t) ** 3 * sx + 3 * (1 - t) ** 2 * t * c1x + 3 * (1 - t) * t ** 2 * c2x + t ** 3 * ex
    if (x < min) min = x
    if (x > max) max = x
  }
  return { min, max }
}

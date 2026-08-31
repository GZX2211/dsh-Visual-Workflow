// tests/client/geometry.test.ts
//
// 画布几何纯函数（协作组/阶段节点适配）：阶段节点紧凑尺寸；组内成员连线锚点；
// 组卡片流程接点居中；label 命中换算；入组落点（仅表面，连接点不具入组功能）。
// 入组落点需 document（jsdom），故本文件声明 @vitest-environment jsdom。

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  GRAPH_STAGE_SIZE,
  edgeGeometry,
  groupOfMember,
  groupSurfaceFromElements,
  memberAnchor,
  nodeSizeOf,
} from '../../src/client/components/canvas/geometry.js'
import type { CanvasNode } from '../../src/client/studio/studio-state.js'

function nodeOf(id: string, kind: CanvasNode['kind'], extra: Record<string, unknown> = {}): CanvasNode {
  return { id, kind, position: { x: 100, y: 200 }, data: { label: id, ...extra } } as CanvasNode
}

describe('画布几何（协作组/阶段）', () => {
  it('阶段节点使用紧凑尺寸；角色/组使用各自尺寸', () => {
    expect(nodeSizeOf(nodeOf('s', 'start'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('e', 'end'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('p', 'pause'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('a', 'agent'))).toEqual({ w: 208, h: 116 })
  })

  it('groupOfMember：按 memberIds 反查成员所属组', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1'], size: { w: 300, h: 220 } })
    const byId = new Map<string, CanvasNode>([['g', group], ['a1', nodeOf('a1', 'agent', { groupId: 'g' })]])
    expect(groupOfMember(byId, 'a1')?.id).toBe('g')
    expect(groupOfMember(byId, 'nobody')).toBeNull()
  })

  it('memberAnchor：成员行中心位于组卡片左右边缘', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1', 'a2'], size: { w: 300, h: 220 } })
    const left = memberAnchor(group, 'a2', 'left')
    const right = memberAnchor(group, 'a2', 'right')
    expect(left?.x).toBe(100)
    expect(right?.x).toBe(400)
    expect(left?.y).toBe(right?.y)
  })

  it('edgeGeometry：组流程接点居中；组内成员连线锚到成员行', () => {
    const group = nodeOf('g', 'group', { memberIds: ['a1'], size: { w: 300, h: 220 } })
    const a1 = nodeOf('a1', 'agent', { groupId: 'g' })
    const second = nodeOf('b', 'agent')
    const byId = new Map<string, CanvasNode>([['g', group], ['a1', a1], ['b', second]])

    // 组 → 下游（流程接点居中）
    const groupEdge = edgeGeometry(
      { id: 'e1', source: 'g', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      byId,
    )
    expect(groupEdge!.start.y).toBe(200 + 220 * 0.5)

    // 组内成员 ctx-out → 下游（锚到成员行，x 为组右缘）
    const memberEdge = edgeGeometry(
      { id: 'e2', source: 'a1', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      byId,
    )
    expect(memberEdge!.start.x).toBe(400)
  })

  it('edgeGeometry：交换连接点的节点——源出点在左缘、目标入点在右缘（用户批注：防交叉换向）', () => {
    const src = nodeOf('src', 'agent', { swapPorts: true })
    const tgt = nodeOf('tgt', 'agent', { swapPorts: true })
    const normal = nodeOf('n', 'agent')
    const normalTgt = nodeOf('nr', 'agent')
    const byId = new Map<string, CanvasNode>([['src', src], ['tgt', tgt], ['n', normal], ['nr', normalTgt]])

    // 源交换（出点移左侧）→ start.x 为源节点左缘（未交换为右缘 100+208）
    const e1 = edgeGeometry({ id: 'e1', source: 'src', target: 'n', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)
    expect(e1!.start.x).toBe(100)
    // 目标交换（入点移右侧）→ end.x 为目标节点右缘（未交换为左缘 100）
    const e2 = edgeGeometry({ id: 'e2', source: 'n', target: 'tgt', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)
    expect(e2!.end.x).toBe(100 + 208)
    // 未交换默认：源右缘、目标左缘（基线，防退化）
    const e3 = edgeGeometry({ id: 'e3', source: 'n', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)
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
    const std = edgeGeometry({ id: 'e', source: 'n', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)!
    expect(std.c1.x).toBeGreaterThan(std.start.x)
    expect(std.c2.x).toBeLessThan(std.end.x)

    // 源交换（出点移左缘）：控制点应向左伸出（start 左缘 100，c1<100），否则穿入自身卡片体被遮挡
    const srcEdge = edgeGeometry({ id: 'e', source: 'ss', target: 'nr', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)!
    expect(srcEdge.c1.x).toBeLessThan(srcEdge.start.x)

    // 目标交换（入点移右缘）：控制点应从右侧进入（end 右缘 308，c2>308），否则穿入目标卡片体被遮挡
    const tgtEdge = edgeGeometry({ id: 'e', source: 'n', target: 'tt', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)!
    expect(tgtEdge.c2.x).toBeGreaterThan(tgtEdge.end.x)
  })

  it('edgeGeometry：同侧（都在右缘）——曲线不穿入左卡卡片体（批注：被隐藏到后面）', () => {
    // 左卡(交换,入点右缘 x=368)、右卡(正常,出点右缘 x=768)；流向右→左，端口同在右缘
    const L = nodeOf('L', 'agent', { swapPorts: true })
    L.position = { x: 160, y: 300 }
    const R = nodeOf('R', 'agent')
    R.position = { x: 560, y: 300 }
    const byId = new Map<string, CanvasNode>([['L', L], ['R', R]])

    const edge = edgeGeometry({ id: 'e', source: 'R', target: 'L', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, byId)!
    // 左卡卡片体 x∈[160,368]；曲线若穿入左卡，min x 会 < 368（旧逻辑为 351）。修复后应保持 >= 左卡右缘。
    const range = pathXRange(edge.path)
    expect(range.min).toBeGreaterThanOrEqual(368 - 0.5)
  })
})

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

describe('groupSurfaceFromElements（入组落点：仅协作组表面，连接点不具入组功能）', () => {
  function groupEl(id: string): HTMLDivElement {
    const g = document.createElement('div')
    g.className = 'wf-graph__node wf-group-node'
    g.setAttribute('data-wf-node-id', id)
    return g
  }

  it('组卡片表面命中 → 返回组 id', () => {
    expect(groupSurfaceFromElements([groupEl('g')])).toBe('g')
  })

  it('连接点（把手）为本体首个元素 → 拒绝入组（返回 null）', () => {
    const g = groupEl('g')
    const handle = document.createElement('span')
    handle.className = 'wf-graph__handle'
    g.appendChild(handle)
    expect(groupSurfaceFromElements([handle, g])).toBeNull()
  })

  it('排除被拖拽本体节点（非组内元素被跳过）→ 命中组表面', () => {
    const node = document.createElement('div')
    node.className = 'wf-graph__node'
    node.setAttribute('data-wf-node-id', 'a')
    const g = groupEl('g')
    expect(groupSurfaceFromElements([node, g], 'a')).toBe('g')
  })

  it('非协作组表面 → 返回 null', () => {
    const node = document.createElement('div')
    node.className = 'wf-graph__node'
    node.setAttribute('data-wf-node-id', 'a')
    expect(groupSurfaceFromElements([node])).toBeNull()
  })
})

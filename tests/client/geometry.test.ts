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
})

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

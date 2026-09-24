// tests/client/lib/layout-fit.test.ts
//
// 统一布局入口 layoutNodes（「整理布局」与自动布局共用）与布局判定工具。

import { describe, expect, it } from 'vitest'
import { layoutNodes, needsAutoLayout, tidyNodes } from '../../../src/client/lib/layout-fit.js'
import type { CanvasNode } from '../../../src/client/lib/canvas-model.js'

describe('layoutNodes（统一布局入口）', () => {
  it('flow 边拓扑分层：下游节点排在上游右侧', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'B' } },
    ]
    const lines = [{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const layout = layoutNodes(nodes, lines)
    const ax = layout.find((item) => item.id === 'a')?.position.x ?? 0
    const bx = layout.find((item) => item.id === 'b')?.position.x ?? 0
    expect(bx).toBeGreaterThan(ax)
  })

  it('返回新数组且不修改入参坐标', () => {
    const nodes: CanvasNode[] = [{ id: 'a', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }]
    const layout = layoutNodes(nodes, [])
    expect(layout).not.toBe(nodes)
    expect(nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('needsAutoLayout / tidyNodes', () => {
  it('needsAutoLayout：缺坐标或哨兵 {0,0} 为真，正常坐标为假', () => {
    expect(needsAutoLayout([{ id: 'a', kind: 'agent', position: { x: 0, y: 0 } }])).toBe(true)
    expect(needsAutoLayout([{ id: 'a', kind: 'agent', position: { x: 120, y: 80 } }])).toBe(false)
  })

  it('tidyNodes：同时返回布局结果（positions 覆盖参与布局的节点）', () => {
    const nodes: CanvasNode[] = [{ id: 'a', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }]
    const { nodes: next, result } = tidyNodes(nodes, [], { sizeOf: () => ({ w: 208, h: 116 }) })
    expect(result.positions.has('a')).toBe(true)
    expect(next[0]?.position).toEqual({ x: Math.round(result.positions.get('a')!.x), y: Math.round(result.positions.get('a')!.y) })
  })
})

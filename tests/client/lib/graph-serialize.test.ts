// tests/client/lib/graph-serialize.test.ts
//
// 画布 → 存储写回归一化：剔除视图字段、虚拟节点 data（P3 闸门识别的事实源）保留规则、
// 阶段节点只保留 label、连线只保留语义字段。

import { describe, expect, it } from 'vitest'
import { serializeFlow } from '../../../src/client/lib/graph-serialize.js'
import type { CanvasEdge, CanvasNode } from '../../../src/client/lib/canvas-model.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument

describe('serializeFlow', () => {
  it('代理/阶段节点归一化（剔除视图字段）', () => {
    const nodes: CanvasNode[] = [
      { id: 'x', kind: 'proxy', position: { x: 1, y: 2 }, data: {}, proxySourceId: 'm' },
      { id: 's', kind: 'start', position: { x: 3, y: 4 }, data: { label: '启动' } },
    ]
    const out = serializeFlow(flow, nodes, [])
    expect(out.nodes[0]).toEqual({ id: 'x', kind: 'proxy', position: { x: 1, y: 2 }, proxySourceId: 'm' })
    expect(out.nodes[1]).toEqual({ id: 's', kind: 'start', position: { x: 3, y: 4 }, data: { label: '启动' } })
  })

  it('虚拟节点 data 的 label / role 随保存写回（闸门识别的事实源不能丢）', () => {
    const out = serializeFlow(flow, [
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n1', data: { label: '里程碑①', role: 'milestone', selected: true } },
    ], [])
    const proxy = out.nodes.find((n) => n.id === 'p1') as { data?: Record<string, unknown> }
    expect(proxy.data).toEqual({ label: '里程碑①', role: 'milestone' })
    expect((proxy as { proxySourceId?: string }).proxySourceId).toBe('n1')
  })

  it('虚拟节点 role 非法值不落盘（只接受 executor / milestone）', () => {
    const out = serializeFlow(flow, [
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n1', data: { role: 'gate' } },
    ], [])
    const proxy = out.nodes.find((n) => n.id === 'p1') as { data?: unknown }
    expect(proxy.data).toBeUndefined()
  })

  it('无 data 的虚拟节点不产出空 data 字段（形状最小）', () => {
    const out = serializeFlow(flow, [
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' },
    ], [])
    expect(Object.prototype.hasOwnProperty.call(out.nodes[0], 'data')).toBe(false)
  })

  it('连线只保留语义字段（颜色/条件标签等视图字段不落盘）', () => {
    const edges: CanvasEdge[] = [
      { id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
    ]
    const out = serializeFlow(flow, [], edges)
    expect(out.lines).toEqual([{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } }])
  })

  it('普通节点剔除 data.kind 历史残留字段', () => {
    const out = serializeFlow(flow, [
      { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A', kind: 'agent' } },
    ], [])
    const first = out.nodes[0] as { data?: Record<string, unknown> }
    expect(first.data).toEqual({ label: 'A' })
  })
})

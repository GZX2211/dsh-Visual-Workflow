// tests/client/lib/graph-serialize.test.ts
//
// 画布 → 存储写回投影（唯一本体）：字段保全（节点 data 原样，不做按 kind 的
// 白名单收敛）、虚拟节点顶层 proxySourceId 保留、连线只保留语义字段、文档其余
// 字段原样透传。三条保存路径共用本模块，跨路径一致性门禁见
// tests/client/hooks/graph-serialize-convergence.test.tsx。

import { describe, expect, it } from 'vitest'
import { serializeFlow, serializeLines, serializeNodes } from '../../../src/client/lib/graph-serialize.js'
import type { CanvasEdge, CanvasNode } from '../../../src/client/lib/canvas-model.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

const flow = {
  id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '实例', description: '说明', revision: 3,
} as WorkflowDocument

describe('serializeNodes', () => {
  it('普通节点 data 原样保留（含 data.kind 历史残留，不裁剪未知字段）', () => {
    const nodes: CanvasNode[] = [
      { id: 'n1', kind: 'agent', position: { x: 1, y: 2 }, data: { label: '节点一', kind: 'agent', systemPrompt: '', retryLimit: 3 } },
    ]
    expect(serializeNodes(nodes)).toEqual([
      { id: 'n1', kind: 'agent', position: { x: 1, y: 2 }, data: { label: '节点一', kind: 'agent', systemPrompt: '', retryLimit: 3 } },
    ])
  })

  it('虚拟节点保留顶层 proxySourceId 与空 data 对象', () => {
    const nodes: CanvasNode[] = [
      { id: 'p1', kind: 'proxy', position: { x: 10, y: 20 }, data: {}, proxySourceId: 'n1' },
    ]
    expect(serializeNodes(nodes)).toEqual([
      { id: 'p1', kind: 'proxy', position: { x: 10, y: 20 }, data: {}, proxySourceId: 'n1' },
    ])
  })

  it('非虚拟节点不产出 proxySourceId 字段（投影与序列化对称）', () => {
    const out = serializeNodes([{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }])
    expect(Object.prototype.hasOwnProperty.call(out[0], 'proxySourceId')).toBe(false)
  })

  it('阶段节点 data 原样保留', () => {
    const out = serializeNodes([{ id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }])
    expect(out).toEqual([{ id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }])
  })
})

describe('serializeLines', () => {
  it('只保留语义字段；带条件的连线携带 condition', () => {
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
    ]
    expect(serializeLines(edges)).toEqual([
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
    ])
  })

  it('无条件的连线不产出 condition 字段', () => {
    const out = serializeLines([{ id: 'e2', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }])
    expect(Object.prototype.hasOwnProperty.call(out[0], 'condition')).toBe(false)
  })
})

describe('serializeFlow', () => {
  it('文档其余字段原样透传，仅替换 nodes / lines', () => {
    const nodes: CanvasNode[] = [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }]
    const edges: CanvasEdge[] = [{ id: 'e1', source: 'n1', target: 'n1', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const out = serializeFlow(flow, nodes, edges)
    expect(out).toMatchObject({ id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '实例', description: '说明', revision: 3 })
    expect(out.nodes).toEqual(serializeNodes(nodes))
    expect(out.lines).toEqual(serializeLines(edges))
  })
})

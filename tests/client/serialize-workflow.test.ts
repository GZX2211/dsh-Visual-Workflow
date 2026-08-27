// tests/client/serialize-workflow.test.ts
//
// Bug 2 回归：画布 → 文档序列化必须保留虚拟节点顶层 proxySourceId
// （否则保存后后端 validateFlow 报 proxySourceMissing，虚拟节点全链路不可用）。

import { describe, expect, it } from 'vitest'
import { serializeWorkflow } from '../../src/client/hooks/useWorkflows.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'

describe('serializeWorkflow（Bug 2 回归）', () => {
  it('虚拟节点顶层 proxySourceId 保留', () => {
    const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument
    const nodes = [
      { id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' },
    ] as unknown as WorkflowDocument['nodes']
    const out = serializeWorkflow(flow, nodes as never, [] as never)
    const proxy = out.nodes.find((n) => n.id === 'p1') as { proxySourceId?: string }
    expect(proxy?.proxySourceId).toBe('n1')
  })

  it('非虚拟节点不带 proxySourceId 字段（投影与序列化对称）', () => {
    const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument
    const nodes = [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }] as unknown as WorkflowDocument['nodes']
    const out = serializeWorkflow(flow, nodes as never, [] as never)
    expect(Object.prototype.hasOwnProperty.call(out.nodes[0], 'proxySourceId')).toBe(false)
  })
})

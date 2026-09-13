// tests/client/serialize-workflow.test.ts
//
// Bug 2 回归：画布 → 文档序列化必须保留虚拟节点顶层 proxySourceId
// （否则保存后后端 validateFlow 报 proxySourceMissing，虚拟节点全链路不可用）。

import { describe, expect, it } from 'vitest'
import { serializeWorkflow } from '../../src/client/hooks/useWorkflows.js'
import { serializeFlow } from '../../src/client/lib/graph-model.js'
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

describe('serializeFlow（P3 虚拟节点 data 回归）', () => {
  const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument

  function canvas(nodes: unknown[]): never {
    return nodes as never
  }

  it('虚拟节点 data 的 label / role 随保存写回（闸门识别的事实源不能丢）', () => {
    const out = serializeFlow(flow, canvas([
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n1', data: { label: '里程碑①', role: 'milestone', selected: true } },
    ]), [] as never)
    const proxy = out.nodes.find((n) => n.id === 'p1') as { data?: Record<string, unknown> }
    expect(proxy.data).toEqual({ label: '里程碑①', role: 'milestone' })
    expect((proxy as { proxySourceId?: string }).proxySourceId).toBe('n1')
  })

  it('虚拟节点 role 非法值不落盘（只接受 executor / milestone）', () => {
    const out = serializeFlow(flow, canvas([
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n1', data: { role: 'gate' } },
    ]), [] as never)
    const proxy = out.nodes.find((n) => n.id === 'p1') as { data?: unknown }
    expect(proxy.data).toBeUndefined()
  })

  it('无 data 的虚拟节点不产出空 data 字段（形状最小）', () => {
    const out = serializeFlow(flow, canvas([
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n1' },
    ]), [] as never)
    expect(Object.prototype.hasOwnProperty.call(out.nodes[0], 'data')).toBe(false)
  })
})


// tests/client/studio/studio-projection.test.ts
//
// 文档 → 画布投影（studio/studio-projection.ts）：工作流文档与服务文档共用同一投影
// 实现，两者对同构输入必须给出同一结果——虚拟节点顶层 proxySourceId 保留（否则保存时
// 后端校验报缺主引用）、位置缺省落默认格点、协作组重复节点合并。

import { describe, expect, it } from 'vitest'
import { flowToCanvas, serviceToCanvas } from '../../../src/client/studio/studio-projection.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../../src/host/shared/types.js'

interface RawNode {
  id: string
  kind: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  proxySourceId?: string
}

function nodesOf(): RawNode[] {
  return [
    { id: 'n1', kind: 'agent', position: { x: 10, y: 20 }, data: { label: '成员一' } },
    { id: 'p1', kind: 'proxy', data: { label: '' }, proxySourceId: 'n1' },
    { id: 'n2', kind: 'file', data: {} },
    { id: 'g1', kind: 'group', position: { x: 300, y: 300 }, data: { memberIds: ['n1', 'n1'] } },
    { id: 'g1', kind: 'group', position: { x: 300, y: 300 }, data: { memberIds: ['n2'] } },
  ]
}

function linesOf(): Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> {
  return [{ id: 'l1', source: 'n1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
}

function asFlow(): Pick<WorkflowDocument, 'nodes' | 'lines'> {
  return { nodes: nodesOf(), lines: linesOf() } as unknown as Pick<WorkflowDocument, 'nodes' | 'lines'>
}

function asService(): ServiceState {
  return { nodes: nodesOf(), lines: linesOf() } as unknown as ServiceState
}

describe('文档 → 画布投影', () => {
  it('虚拟节点顶层 proxySourceId 保留（两条路径都不丢）', () => {
    const fromFlow = flowToCanvas(asFlow())
    const fromService = serviceToCanvas(asService())
    expect(fromFlow.nodes.find((node) => node.id === 'p1')?.proxySourceId).toBe('n1')
    expect(fromService.nodes.find((node) => node.id === 'p1')?.proxySourceId).toBe('n1')
  })

  it('位置缺省落默认格点 { x: 120, y: 80 }', () => {
    const flow = flowToCanvas(asFlow())
    expect(flow.nodes.find((node) => node.id === 'n2')?.position).toEqual({ x: 120, y: 80 })
    expect(flow.nodes.find((node) => node.id === 'n1')?.position).toEqual({ x: 10, y: 20 })
  })

  it('重复 协作组节点合并为一条且成员并集去重；连线按字段口径投影', () => {
    const flow = flowToCanvas(asFlow())
    const groups = flow.nodes.filter((node) => node.kind === 'group')
    expect(groups).toHaveLength(1)
    expect(groups[0].data.memberIds).toEqual(['n1', 'n2'])
    expect(flow.edges).toEqual([{ id: 'l1', source: 'n1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }])
  })

  it('工作流与服务两条投影路径对同构输入结果一致', () => {
    expect(flowToCanvas(asFlow())).toEqual(serviceToCanvas(asService()))
  })
})

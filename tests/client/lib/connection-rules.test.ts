// tests/client/lib/connection-rules.test.ts
//
// 连接校验矩阵（与 Host graph/validate 规则一致）。
// 类型收敛后画布节点/连线直接传入，无需 `as never` 断言——本文件即是该契约的守卫。

import { describe, expect, it } from 'vitest'
import { connectionProblem, connectionProblemMessage } from '../../../src/client/lib/connection-rules.js'
import type { CanvasEdge, CanvasNode } from '../../../src/client/lib/canvas-model.js'

const nodes: CanvasNode[] = [
  { id: 'a', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } },
  { id: 'b', kind: 'agent', position: { x: 300, y: 0 }, data: { label: 'B' } },
  { id: 's', kind: 'start', position: { x: 0, y: 200 }, data: { label: '启动' } },
  { id: 'e', kind: 'end', position: { x: 300, y: 200 }, data: { label: '结束' } },
]
const lines: CanvasEdge[] = []

describe('连接校验', () => {
  it('合法：flow-out → flow-in', () => {
    const problem = connectionProblem(nodes, lines, { source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    expect(problem.valid).toBe(true)
  })

  it('非法：自环', () => {
    const problem = connectionProblem(nodes, lines, { source: 'a', target: 'a' })
    expect(problem.code).toBe('selfLoop')
  })

  it('非法：通道不匹配（ctx × flow）', () => {
    const problem = connectionProblem(nodes, lines, { source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'flow-in' })
    expect(problem.code).toBe('channelMismatch')
  })

  it('非法：协作组成员不可连流程线（仅 ctx/db）', () => {
    const groupNodes: CanvasNode[] = [
      { id: 'g', kind: 'group', position: { x: 0, y: 0 }, data: { label: '组', memberIds: ['m'] } },
      { id: 'm', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '成员', groupId: 'g' } },
      { id: 'b', kind: 'agent', position: { x: 300, y: 0 }, data: { label: 'B' } },
    ]
    expect(connectionProblem(groupNodes, [], { source: 'b', target: 'm', sourceHandle: 'flow-out', targetHandle: 'flow-in' }).code).toBe('groupMemberFlow')
    expect(connectionProblem(groupNodes, [], { source: 'm', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }).code).toBe('groupMemberFlow')
    expect(connectionProblem(groupNodes, [], { source: 'm', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }).valid).toBe(true)
  })

  it('非法：目标为启动节点（无入点）', () => {
    const problem = connectionProblem(nodes, lines, { source: 'a', target: 's' })
    expect(problem.code).toBe('invalidHandle')
  })

  it('非法：重复连线', () => {
    const withLine: CanvasEdge[] = [{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const problem = connectionProblem(nodes, withLine, { source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    expect(problem.code).toBe('duplicateConnection')
  })

  it('非法：主节点与虚拟节点连入同一连接点（防并行）', () => {
    const withProxy: CanvasNode[] = [
      { id: 'm', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '主' } },
      { id: 'x', kind: 'proxy', position: { x: 0, y: 100 }, data: {}, proxySourceId: 'm' },
      { id: 'b', kind: 'agent', position: { x: 300, y: 0 }, data: { label: 'B' } },
    ]
    const withLine: CanvasEdge[] = [{ id: 'e-0', source: 'm', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const problem = connectionProblem(withProxy, withLine, { source: 'x', target: 'b' })
    expect(problem.code).toBe('proxyParallel')
  })

  it('错误文案映射', () => {
    const copy = { selfLoop: 'no', invalidConnection: 'bad', duplicateConnection: 'dup' }
    expect(connectionProblemMessage({ valid: false, code: 'selfLoop' }, copy)).toBe('no')
    expect(connectionProblemMessage({ valid: false, code: 'unknown' }, copy)).toBe('bad')
  })
})

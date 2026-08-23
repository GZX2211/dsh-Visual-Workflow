// tests/host/graph-model.test.ts
//
// 图模型与校验测试（T-013）：连接点兼容矩阵、非法用例拒绝（自环/重复/主虚互斥/
// 条件仅流程线/阶段唯一/父代理唯一/协作组边界/模式差异）、归一化默认值、入口解析
// 与拓扑助手。断言依据：架构文档 §4.2 校验规则 + 需求文档 §4.2/§4.3/§4.2.5。

import { describe, expect, it } from 'vitest'
import {
  NODE_HANDLES,
  NODE_KINDS,
  newRoleNode,
  newFileNode,
  newDatabaseNode,
  newStageNode,
  newGroupNode,
  newProxyNode,
  newLine,
  entryNodes,
  flowOutEdges,
  ctxInEdges,
  dbInEdges,
  upstreamCtxNodeIds,
  proxiesOf,
  isGroupMember,
  stageLabel,
} from '../../src/host/graph/model.js'
import { connectionProblem, validateFlow, normalizeFlow, missingStageNodes } from '../../src/host/graph/validate.js'
import type { GraphNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

/** 组装最小工作流（mode 可选，默认 mode1）。 */
function makeFlow(nodes: GraphNode[], lines: WorkflowDocument['lines'] = [], mode: 'mode1' | 'mode2' = 'mode1'): Partial<WorkflowDocument> {
  return { id: 'f1', sessionId: 's1', mode, name: 't', description: '', nodes, lines }
}

function codes(flow: Partial<WorkflowDocument>): string[] {
  return validateFlow(flow).issues.map((i) => i.code)
}

describe('连接点兼容矩阵（NODE_HANDLES）', () => {
  it('9 类节点矩阵齐全且与需求连接点定义一致', () => {
    expect(NODE_KINDS).toHaveLength(9)
    expect(NODE_HANDLES.parent.inputs).toEqual(['flow-in', 'ctx-in', 'db-in'])
    expect(NODE_HANDLES.parent.outputs).toEqual(['flow-out', 'ctx-out'])
    expect(NODE_HANDLES.file).toEqual({ inputs: [], outputs: ['ctx-out'] })
    expect(NODE_HANDLES.database).toEqual({ inputs: [], outputs: ['db-out'] })
    expect(NODE_HANDLES.start).toEqual({ inputs: [], outputs: ['flow-out', 'ctx-out'] })
    expect(NODE_HANDLES.end.outputs).toEqual([])
    expect(NODE_HANDLES.pause).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.group).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.proxy).toEqual(NODE_HANDLES.agent)
  })
})

describe('单连线检测 connectionProblem：合法矩阵', () => {
  const start = newStageNode('start', 'mode1')
  const end = newStageNode('end', 'mode1')
  const agent = newRoleNode('agent', 'a')
  const parent = newRoleNode('parent', 'p')
  const file = newFileNode('text','f')
  const db = newDatabaseNode('local','db')
  const proxy = newProxyNode(agent.id)

  it.each([
    ['流程：start→agent', newLine(start.id, agent.id, 'flow-out', 'flow-in')],
    ['流程：agent→end', newLine(agent.id, end.id, 'flow-out', 'flow-in')],
    ['上下文：agent→agent', newLine(agent.id, parent.id, 'ctx-out', 'ctx-in')],
    ['文件→上下文入', newLine(file.id, agent.id, 'ctx-out', 'ctx-in')],
    ['数据库→db-in', newLine(db.id, agent.id, 'db-out', 'db-in')],
    ['虚拟节点流出入', newLine(proxy.id, end.id, 'flow-out', 'flow-in')],
    ['条件流程线（内容）', { ...newLine(agent.id, end.id, 'flow-out', 'flow-in'), condition: { type: 'content' as const, label: 'routing' } }],
  ])('%s 通过', (_name, line) => {
    const nodes = [start, end, agent, parent, file, db, proxy]
    expect(connectionProblem(nodes, line).valid).toBe(true)
  })
})

describe('单连线检测 connectionProblem：非法用例', () => {
  const a = newRoleNode('agent', 'a')
  const b = newRoleNode('agent', 'b')
  const file = newFileNode('text','f')
  const db = newDatabaseNode('local','db')
  const nodes = [a, b, file, db]

  it('自环拒绝', () => {
    expect(connectionProblem(nodes, newLine(a.id, a.id, 'flow-out', 'flow-in')).code).toBe('selfLoop')
  })
  it('端点不存在拒绝', () => {
    expect(connectionProblem(nodes, newLine(a.id, 'ghost', 'flow-out', 'flow-in')).code).toBe('invalidNode')
  })
  it('源节点无该出点拒绝', () => {
    expect(connectionProblem(nodes, newLine(file.id, a.id, 'flow-out', 'flow-in')).code).toBe('invalidHandle')
  })
  it('目标节点无该入点拒绝（数据库无 ctx-in）', () => {
    expect(connectionProblem(nodes, newLine(a.id, db.id, 'ctx-out', 'ctx-in')).code).toBe('invalidHandle')
  })
  it('通道配对错位：ctx-out→flow-in 拒绝', () => {
    expect(connectionProblem(nodes, newLine(a.id, b.id, 'ctx-out', 'flow-in')).code).toBe('handleMismatch')
  })
  it('通道配对错位：db-out→ctx-in 拒绝', () => {
    expect(connectionProblem(nodes, newLine(db.id, a.id, 'db-out', 'ctx-in')).code).toBe('handleMismatch')
  })
  it('条件仅流程线：ctx 线带条件拒绝', () => {
    const line = { ...newLine(a.id, b.id, 'ctx-out', 'ctx-in'), condition: { type: 'pass' as const } }
    expect(connectionProblem(nodes, line).code).toBe('conditionOnNonFlow')
  })
})

describe('validateFlow 全量校验', () => {
  it('合法工作流（mode1 完整链路）ok', () => {
    const start = newStageNode('start', 'mode1')
    const end = newStageNode('end', 'mode1')
    const a = newRoleNode('agent', 'a')
    const flow = makeFlow([start, end, a], [
      newLine(start.id, a.id, 'flow-out', 'flow-in'),
      newLine(a.id, end.id, 'flow-out', 'flow-in'),
    ])
    expect(validateFlow(flow).ok).toBe(true)
  })

  it('节点 id 重复 → dupNode', () => {
    const a = newRoleNode('agent', 'a')
    const dup = { ...a }
    expect(codes(makeFlow([a, dup]))).toContain('dupNode')
  })

  it('kind 非法 → badNode', () => {
    const bad = { id: 'x', kind: 'memory', position: { x: 0, y: 0 } } as unknown as GraphNode
    expect(codes(makeFlow([bad]))).toContain('badNode')
  })

  it('重复连线 → dupEdge', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const l1 = newLine(a.id, b.id, 'flow-out', 'flow-in')
    const l2 = { ...newLine(a.id, b.id, 'flow-out', 'flow-in'), id: 'l2' }
    expect(codes(makeFlow([a, b], [l1, l2]))).toContain('dupEdge')
  })

  it('条件类型非法 → badCondition', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const line = { ...newLine(a.id, b.id, 'flow-out', 'flow-in'), condition: { type: 'weird' } as unknown as { type: 'pass'; label?: string } }
    expect(codes(makeFlow([a, b], [line]))).toContain('badCondition')
  })

  it('content 条件缺 label → contentLabelRequired', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const line = { ...newLine(a.id, b.id, 'flow-out', 'flow-in'), condition: { type: 'content' as const, label: '  ' } }
    expect(codes(makeFlow([a, b], [line]))).toContain('contentLabelRequired')
  })

  it('启动节点重复 → startUnique；结束节点重复 → endUnique', () => {
    const s1 = newStageNode('start', 'mode1')
    const s2 = { ...newStageNode('start', 'mode1'), id: 'start-2' }
    const e1 = newStageNode('end', 'mode1')
    const e2 = { ...newStageNode('end', 'mode1'), id: 'end-2' }
    const cs = codes(makeFlow([s1, s2, e1, e2]))
    expect(cs).toContain('startUnique')
    expect(cs).toContain('endUnique')
  })

  it('模式二出现暂停节点 → pauseMode2', () => {
    const p = newStageNode('pause', 'mode1')
    const start = newStageNode('start', 'mode2')
    const end = newStageNode('end', 'mode2')
    expect(codes(makeFlow([start, end, p], [], 'mode2'))).toContain('pauseMode2')
  })

  it('父代理重复 → parentUnique；模式二缺父代理 → parentRequiredMode2', () => {
    const p1 = newRoleNode('parent', 'p1')
    const p2 = newRoleNode('parent', 'p2')
    expect(codes(makeFlow([p1, p2]))).toContain('parentUnique')
    const a = newRoleNode('agent', 'a')
    expect(codes(makeFlow([a], [], 'mode2'))).toContain('parentRequiredMode2')
    expect(codes(makeFlow([p1], [], 'mode2'))).not.toContain('parentRequiredMode2')
  })

  it('虚拟节点引用缺失 → proxySourceMissing；引用非角色 → proxySourceKind', () => {
    const ghost = newProxyNode('nope')
    expect(codes(makeFlow([ghost]))).toContain('proxySourceMissing')
    const file = newFileNode('text','f')
    const p2 = newProxyNode(file.id)
    expect(codes(makeFlow([file, p2]))).toContain('proxySourceKind')
  })

  it('主/虚同时连入同一目标同一连接点 → proxyParallel', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const target = newRoleNode('agent', 'target')
    const l1 = newLine(main.id, target.id, 'ctx-out', 'ctx-in')
    const l2 = newLine(proxy.id, target.id, 'ctx-out', 'ctx-in')
    expect(codes(makeFlow([main, proxy, target], [l1, l2]))).toContain('proxyParallel')
  })

  it('主/虚连入不同连接点合法', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const target = newRoleNode('agent', 'target')
    const l1 = newLine(main.id, target.id, 'flow-out', 'flow-in')
    const l2 = newLine(proxy.id, target.id, 'ctx-out', 'ctx-in')
    expect(validateFlow(makeFlow([main, proxy, target], [l1, l2])).ok).toBe(true)
  })

  it('协作组边界：成员节点 flow 连接点拒绝 → groupMemberFlowHandle', () => {
    const g = newGroupNode('g')
    const member = newRoleNode('agent', 'm')
    member.data.groupId = g.id
    g.data.memberIds = [member.id]
    const other = newRoleNode('agent', 'o')
    const line = newLine(member.id, other.id, 'flow-out', 'flow-in')
    expect(codes(makeFlow([g, member, other], [line]))).toContain('groupMemberFlowHandle')
  })

  it('协作组成员跨组 ctx 连线合法（§4.2.5.2 规则 4）', () => {
    const g = newGroupNode('g')
    const member = newRoleNode('agent', 'm')
    member.data.groupId = g.id
    g.data.memberIds = [member.id]
    const outside = newRoleNode('agent', 'o')
    const line = newLine(outside.id, member.id, 'ctx-out', 'ctx-in')
    expect(validateFlow(makeFlow([g, member, outside], [line])).ok).toBe(true)
  })

  it('协作组卡片 ctx/db 连线被矩阵层拒绝（组卡片仅 flow 连接点，§4.2.5.2）', () => {
    const g = newGroupNode('g')
    const a = newRoleNode('agent', 'a')
    // 组卡片无 ctx-out：源侧矩阵拒绝
    const l1 = newLine(g.id, a.id, 'ctx-out', 'ctx-in')
    // 组卡片无 ctx-in：目标侧矩阵拒绝
    const l2 = newLine(a.id, g.id, 'ctx-out', 'ctx-in')
    const cs = codes(makeFlow([g, a], [l1, l2]))
    expect(cs).toContain('invalidHandle')
  })

  it('mode1 下 start 的 ctx-out 拒绝、end 的 ctx-in 拒绝；mode2 下允许', () => {
    const s1 = newStageNode('start', 'mode1')
    const e1 = newStageNode('end', 'mode1')
    const a = newRoleNode('agent', 'a')
    const l1 = newLine(s1.id, a.id, 'ctx-out', 'ctx-in')
    const l2 = newLine(a.id, e1.id, 'ctx-out', 'ctx-in')
    const cs1 = codes(makeFlow([s1, e1, a], [l1, l2]))
    expect(cs1).toContain('mode1StartCtxOut')
    expect(cs1).toContain('mode1EndCtxIn')
    // mode2：start（输入）ctx-out 与 end（输出）ctx-in 合法
    const s2 = newStageNode('start', 'mode2')
    const e2 = newStageNode('end', 'mode2')
    const p = newRoleNode('parent', 'p')
    const l3 = newLine(s2.id, a.id, 'ctx-out', 'ctx-in')
    const l4 = newLine(a.id, e2.id, 'ctx-out', 'ctx-in')
    expect(validateFlow(makeFlow([s2, e2, a, p], [l3, l4], 'mode2')).ok).toBe(true)
  })

  it('阶段节点属性锁定 → stageLabelLocked', () => {
    const s = newStageNode('start', 'mode1')
    s.data.label = '自定义名称'
    expect(codes(makeFlow([s]))).toContain('stageLabelLocked')
  })

  it('协作组成员不存在 → groupMemberMissing；成员种类非法 → groupMemberKind', () => {
    const g = newGroupNode('g')
    g.data.memberIds = ['ghost']
    expect(codes(makeFlow([g]))).toContain('groupMemberMissing')
    const g2 = newGroupNode('g2')
    const f = newFileNode('text','f')
    g2.data.memberIds = [f.id]
    expect(codes(makeFlow([g2, f]))).toContain('groupMemberKind')
  })
})

describe('normalizeFlow 归一化', () => {
  it('角色节点补默认值（retryLimit=3、reactLimit=null、presetId=null、空串字段）', () => {
    const a = newRoleNode('agent', 'a')
    a.data.retryLimit = undefined as unknown as number
    a.data.systemPrompt = undefined as unknown as string
    const flow = normalizeFlow(makeFlow([a]))
    const n = flow.nodes[0]
    expect(n.kind).toBe('agent')
    if (n.kind === 'agent' || n.kind === 'parent') {
      expect(n.data.retryLimit).toBe(3)
      expect(n.data.reactLimit).toBeNull()
      expect(n.data.presetId).toBeNull()
      expect(n.data.systemPrompt).toBe('')
      expect(n.data.inputSchema).toBe('')
      expect(n.data.outputSchema).toBe('')
      expect(n.data.groupId).toBeNull()
    }
  })

  it('阶段节点 label 按模式硬编码锁定（mode1 启动/结束，mode2 输入/输出）', () => {
    const s = newStageNode('start', 'mode1')
    const e = newStageNode('end', 'mode1')
    const flow1 = normalizeFlow(makeFlow([s, e]))
    expect(flow1.nodes.map((n) => (n as { data: { label: string } }).data.label)).toEqual(['启动', '结束'])
    const s2 = newStageNode('start', 'mode2')
    const e2 = newStageNode('end', 'mode2')
    const flow2 = normalizeFlow(makeFlow([s2, e2], [], 'mode2'))
    expect(flow2.nodes.map((n) => (n as { data: { label: string } }).data.label)).toEqual(['输入', '输出'])
    expect(stageLabel('pause', 'mode1')).toBe('暂停')
  })

  it('归一化不改写入参（深拷贝语义，§4.2.1）', () => {
    const a = newRoleNode('agent', 'a')
    const original = JSON.parse(JSON.stringify(a))
    normalizeFlow(makeFlow([a]))
    expect(a).toEqual(original)
  })

  it('模式缺省为 mode1', () => {
    const flow = normalizeFlow({ id: 'x', sessionId: 's', nodes: [], lines: [] })
    expect(flow.mode).toBe('mode1')
    expect(flow.description).toBe('')
  })
})

describe('入口解析与拓扑助手', () => {
  it('entryNodes：start 即显式入口；缺失时为空（§4.2 入口解析）', () => {
    const s = newStageNode('start', 'mode1')
    const a = newRoleNode('agent', 'a')
    expect(entryNodes(makeFlow([s, a])).map((n) => n.id)).toEqual([s.id])
    expect(entryNodes(makeFlow([a]))).toEqual([])
  })

  it('flowOutEdges/ctxInEdges/dbInEdges/upstreamCtxNodeIds 正确', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const c = newRoleNode('agent', 'c')
    const db = newDatabaseNode('local','db')
    const f = newFileNode('text','f')
    const lines = [
      newLine(a.id, b.id, 'flow-out', 'flow-in'),
      newLine(f.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(a.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(db.id, c.id, 'db-out', 'db-in'),
    ]
    const flow = makeFlow([a, b, c, db, f], lines)
    expect(flowOutEdges(flow, a.id).map((l) => l.target)).toEqual([b.id])
    expect(ctxInEdges(flow, c.id).map((l) => l.source).sort()).toEqual([a.id, f.id].sort())
    expect(dbInEdges(flow, c.id).map((l) => l.source)).toEqual([db.id])
    expect(upstreamCtxNodeIds(flow, c.id).sort()).toEqual([a.id, f.id].sort())
  })

  it('proxiesOf/isGroupMember 正确', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const g = newGroupNode('g')
    const member = newRoleNode('agent', 'm')
    member.data.groupId = g.id
    const flow = makeFlow([main, proxy, g, member])
    expect(proxiesOf(flow, main.id).map((n) => n.id)).toEqual([proxy.id])
    expect(isGroupMember(flow, member.id)).toBe(true)
    expect(isGroupMember(flow, main.id)).toBe(false)
  })
})

describe('运行前完整性检查 missingStageNodes', () => {
  it('缺启动/结束逐项报告（§4.2.5.1 规则 6）', () => {
    const a = newRoleNode('agent', 'a')
    expect(missingStageNodes(makeFlow([a])).sort()).toEqual(['end', 'start'])
    const s = newStageNode('start', 'mode1')
    expect(missingStageNodes(makeFlow([s, a]))).toEqual(['end'])
    const e = newStageNode('end', 'mode1')
    expect(missingStageNodes(makeFlow([s, e, a]))).toEqual([])
  })
})

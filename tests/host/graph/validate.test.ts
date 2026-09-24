// tests/host/graph/validate.test.ts
//
// 图结构校验测试（原 tests/host/graph-model.test.ts 拆分）：单连线检测、全量校验
// （自环/重复/主虚互斥/条件仅流程线/阶段唯一/父代理唯一/协作组边界/模式差异）与
// 运行前完整性检查。
// 数据模型与拓扑助手（model.ts）见 ./model.test.ts。
// 断言依据：架构文档 §4.2 校验规则 + 需求文档 §4.2/§4.3/§4.2.5。
// 注：原「normalizeFlow 归一化」用例已随该函数删除（2026.10 治理：生产零调用且实现为
// 字段白名单重写）；其中真正生效的角色节点 data 补全断言迁移到
// tests/host/tools/wf-graph-patch/apply.test.ts（normalizeRoleNodeData）。

import { describe, expect, it } from 'vitest'
import {
  connectionProblem,
  newDatabaseNode,
  newFileNode,
  newGroupNode,
  newLine,
  newProxyNode,
  newRoleNode,
  newStageNode,
  stageLabel,
  validateFlow,
} from '../../../src/host/graph/index.js'
import type { GraphNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { makeFlow } from './fixtures/flow-fixture.js'

/** 校验问题码提取（断言用）。 */
function codes(flow: Partial<WorkflowDocument>): string[] {
  return validateFlow(flow).issues.map((i) => i.code)
}

describe('单连线检测 connectionProblem：合法矩阵', () => {
  const start = newStageNode('start', 'mode1')
  const end = newStageNode('end', 'mode1')
  const agent = newRoleNode('agent', 'a')
  const parent = newRoleNode('parent', 'p')
  const file = newFileNode('text', 'f')
  const db = newDatabaseNode('local', 'db')
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
  const file = newFileNode('text', 'f')
  const db = newDatabaseNode('local', 'db')
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
    const file = newFileNode('text', 'f')
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
    const f = newFileNode('text', 'f')
    g2.data.memberIds = [f.id]
    expect(codes(makeFlow([g2, f]))).toContain('groupMemberKind')
  })
})

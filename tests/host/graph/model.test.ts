// tests/host/graph/model.test.ts
//
// 图模型运行时测试（原 tests/host/graph-model.test.ts 拆分）：
//   - 连接点兼容矩阵与拓扑查询助手（入口解析、出/入边、流程线判定、虚拟节点、协作组成员）；
//   - 虚拟节点角色与闸门语义（P3 里程碑闸门判定与标记目标归一化，
//     原 tests/host/milestone-gate.test.ts 的纯函数段按镜像规则并入）。
// 校验与归一化（validate.ts）见 ./validate.test.ts；元参数见 ./org-meta.test.ts。
// 断言依据：架构文档 §4.2 + 需求文档 §4.2/§4.3/§4.2.5。

import { describe, expect, it } from 'vitest'
import {
  NODE_HANDLES,
  NODE_KINDS,
  activeMilestoneGateOf,
  ctxInEdges,
  dbInEdges,
  entryNodes,
  flowOutEdges,
  flowInEdges,
  isFlowLine,
  isGroupMember,
  mainNodeIdOf,
  milestoneProxiesOf,
  newDatabaseNode,
  newFileNode,
  newGroupNode,
  newLine,
  newProxyNode,
  newRoleNode,
  newStageNode,
  nodeHasFlowIn,
  nodeParticipatesInFlow,
  proxiesOf,
  proxyRoleOf,
  stageLabel,
  upstreamCtxNodeIds,
} from '../../../src/host/graph/index.js'
import type { GraphNode, Line, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { makeFlow } from './fixtures/flow-fixture.js'

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

describe('拓扑助手（连线查询）', () => {
  it('flowOutEdges/ctxInEdges/dbInEdges/upstreamCtxNodeIds 正确', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const c = newRoleNode('agent', 'c')
    const db = newDatabaseNode('local', 'db')
    const f = newFileNode('text', 'f')
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
})

describe('入口解析与节点归属判定', () => {
  it('entryNodes：start 即显式入口；缺失时为空（§4.2 入口解析）', () => {
    const s = newStageNode('start', 'mode1')
    const a = newRoleNode('agent', 'a')
    expect(entryNodes(makeFlow([s, a])).map((n) => n.id)).toEqual([s.id])
    expect(entryNodes(makeFlow([a]))).toEqual([])
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

// ---------------------------------------------------------------------------
// 流程线判定与流程参与度（三通道互斥；编排清单判定依据）
// ---------------------------------------------------------------------------

describe('流程线判定（isFlowLine）与流程参与度', () => {
  it('仅 flow-out → flow-in 是流程线；ctx / db 通道不参与流程', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const db = newDatabaseNode('local', 'db')
    const f = newFileNode('text', 'f')
    expect(isFlowLine(newLine(a.id, b.id, 'flow-out', 'flow-in'))).toBe(true)
    expect(isFlowLine(newLine(f.id, b.id, 'ctx-out', 'ctx-in'))).toBe(false)
    expect(isFlowLine(newLine(db.id, b.id, 'db-out', 'db-in'))).toBe(false)
  })

  it('幽灵线（单侧命中流程通道）不算流程线，也不让节点「参与流程」', () => {
    // 历史/手改数据可能出现 ctx-out → flow-in 这类非法线：通道互斥，它不在流程
    // 子图中，因此不能被算作「参与流程」（否则编排清单会多出无效节点）。
    const a = newRoleNode('agent', 'a')
    const ghost = newRoleNode('agent', 'ghost')
    const ghostLine = newLine(a.id, ghost.id, 'ctx-out', 'flow-in')
    const flow = makeFlow([a, ghost], [ghostLine])
    expect(isFlowLine(ghostLine)).toBe(false)
    expect(nodeParticipatesInFlow(flow, ghost.id)).toBe(false)
    expect(nodeHasFlowIn(flow, ghost.id)).toBe(false)
    // 流程边查询与判定同源：幽灵线不出现在流程出/入边列表里
    expect(flowOutEdges(flow, a.id)).toEqual([])
    expect(flowInEdges(flow, ghost.id)).toEqual([])
  })

  it('nodeParticipatesInFlow：主节点或其虚拟节点被流程线触及即算参与', () => {
    const main = newRoleNode('agent', 'main')
    const other = newRoleNode('agent', 'other')
    const proxy = newProxyNode(main.id)
    const flow = makeFlow([main, other, proxy], [newLine(other.id, proxy.id, 'flow-out', 'flow-in')])
    expect(nodeParticipatesInFlow(flow, main.id)).toBe(true)
    expect(nodeParticipatesInFlow(flow, other.id)).toBe(true)
    // 只有流程出、没有流程入 → 参与流程，但未被驱动
    expect(nodeHasFlowIn(flow, other.id)).toBe(false)
    expect(nodeHasFlowIn(flow, main.id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 虚拟节点角色与闸门语义（P3 里程碑闸门 / 自主编排方案 §5.2 扩展1）
// 运行时行为（不自动 ok / 显式标记生效 / 预算递减 / 续跑继承）见
// tests/host/orchestrator/ 与 tests/host/tools/wf-graph-patch/。
// ---------------------------------------------------------------------------

/** 阶段节点（label 锁定，固定 id 便于断言）。 */
function stageNode(id: string, kind: 'start' | 'end'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

/** 角色节点（固定 id；默认已配置，避免与配置完整性软规则耦合）。 */
function roleNodeOf(kind: 'parent' | 'agent', id: string, label = id): GraphNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

/** 虚拟节点（固定 id；data 缺省 = executor）。 */
function proxyNode(id: string, sourceId: string, data?: { label?: string; role?: 'executor' | 'milestone' }): GraphNode {
  return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: sourceId, ...(data ? { data } : {}) }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

/** 含闸门的最小合法图：start → m1(→p1) → a1 → end。 */
function gateFlow(role?: 'executor' | 'milestone'): WorkflowDocument {
  return {
    id: 'wf-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '闸门流程',
    description: '',
    revision: 1,
    nodes: [
      stageNode('s', 'start'),
      roleNodeOf('parent', 'p1', 'CEO'),
      proxyNode('m1', 'p1', role ? { role } : undefined),
      roleNodeOf('agent', 'a1'),
      stageNode('e', 'end'),
    ],
    lines: [flowLine('l1', 's', 'm1'), flowLine('l2', 'm1', 'a1'), flowLine('l3', 'a1', 'e')],
  }
}

describe('虚拟节点角色判定', () => {
  it('proxyRoleOf：缺省 executor（向后兼容既有画布），显式 milestone 才识别为闸门', () => {
    expect(proxyRoleOf(proxyNode('m1', 'p1'))).toBe('executor')
    expect(proxyRoleOf(proxyNode('m1', 'p1', { role: 'executor' }))).toBe('executor')
    expect(proxyRoleOf(proxyNode('m1', 'p1', { role: 'milestone' }))).toBe('milestone')
    expect(proxyRoleOf(null)).toBe('executor')
  })

  it('milestoneProxiesOf：只挑出该主节点的 milestone 虚拟节点', () => {
    const flow = gateFlow('milestone')
    flow.nodes.push(proxyNode('x1', 'p1', { role: 'executor' }))
    expect(milestoneProxiesOf(flow, 'p1').map((n) => n.id)).toEqual(['m1'])
    expect(milestoneProxiesOf(flow, 'a1')).toEqual([])
  })

  it('activeMilestoneGateOf：闸门被流程驱动（有 flow-in）才算生效', () => {
    const live = gateFlow('milestone')
    expect(activeMilestoneGateOf(live, 'p1')).toEqual({ proxyId: 'm1' })
    // 去掉流程入口 → 闸门不会被驱动，视为未生效
    const dead = gateFlow('milestone')
    dead.lines = dead.lines.filter((line) => line.target !== 'm1')
    expect(activeMilestoneGateOf(dead, 'p1')).toBeNull()
  })

  it('activeMilestoneGateOf：executor 角色的虚拟节点不算闸门（保留既有自动完成行为）', () => {
    expect(activeMilestoneGateOf(gateFlow('executor'), 'p1')).toBeNull()
    expect(activeMilestoneGateOf(gateFlow(undefined), 'p1')).toBeNull()
  })

  it('activeMilestoneGateOf：带 label 时一并返回（画布显示名），多个闸门取画布顺序第一个', () => {
    const flow = gateFlow('milestone')
    ;(flow.nodes.find((n) => n.id === 'm1') as { data?: { label?: string; role?: 'milestone' } }).data = { label: '里程碑①：方案评审', role: 'milestone' }
    expect(activeMilestoneGateOf(flow, 'p1')).toEqual({ proxyId: 'm1', label: '里程碑①：方案评审' })
    flow.nodes.push(proxyNode('m2', 'p1', { role: 'milestone' }))
    flow.lines.push(flowLine('l4', 'a1', 'm2'))
    expect(activeMilestoneGateOf(flow, 'p1')?.proxyId).toBe('m1')
  })
})

describe('闸门标记目标归一化（mainNodeIdOf）', () => {
  it('普通节点返回自身 id；虚拟节点返回主节点 id；不存在返回 null', () => {
    const flow = gateFlow('milestone')
    expect(mainNodeIdOf(flow, 'p1')).toBe('p1')
    expect(mainNodeIdOf(flow, 'm1')).toBe('p1')
    expect(mainNodeIdOf(flow, 'a1')).toBe('a1')
    expect(mainNodeIdOf(flow, '不存在')).toBeNull()
  })

  it('悬挂虚拟节点（主节点已移除）返回 null（不把错目标当成闸门）', () => {
    const flow = gateFlow('milestone')
    flow.nodes = flow.nodes.filter((n) => n.id !== 'p1')
    expect(mainNodeIdOf(flow, 'm1')).toBeNull()
  })
})

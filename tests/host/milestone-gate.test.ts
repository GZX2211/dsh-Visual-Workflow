// tests/host/milestone-gate.test.ts
//
// P3 里程碑闸门（自主编排方案 §5.2 扩展1 + §10 P3 验收）——**纯函数部分**：
//   - 虚拟节点角色判定（proxyRoleOf / milestoneProxiesOf / activeMilestoneGateOf）；
//   - 闸门标记目标归一化（mainNodeIdOf：闸门虚拟节点 id ↔ 父代理节点 id）；
//   - 补丁层 proxy data 归一化（label/role 落盘；role 越界拒绝；executor 不进闸门预算）。
// 运行时行为（不自动 ok / 显式标记生效 / 预算递减 / 续跑继承）见 orchestrator.test.ts 的
// 「P3 里程碑闸门（运行时）」与 wf-graph-patch.test.ts 的 mark_node 状态机用例。
import { describe, expect, it } from 'vitest'
import { applyGraphOps } from '../../src/host/tools/wf-graph-patch/apply.js'
import {
  activeMilestoneGateOf,
  mainNodeIdOf,
  milestoneProxiesOf,
  proxyRoleOf,
} from '../../src/host/graph/model.js'
import { WfError } from '../../src/host/orchestrator/index.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { GraphNode, Line, WorkflowDocument } from '../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 图构造
// ---------------------------------------------------------------------------

function stage(id: string, kind: 'start' | 'end'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function agentNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

function parentNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

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
    nodes: [stage('s', 'start'), parentNode('p1', 'CEO'), proxyNode('m1', 'p1', role ? { role } : undefined), agentNode('a1'), stage('e', 'end')],
    lines: [flowLine('l1', 's', 'm1'), flowLine('l2', 'm1', 'a1'), flowLine('l3', 'a1', 'e')],
  }
}

// ---------------------------------------------------------------------------
// 角色与闸门判定（纯函数）
// ---------------------------------------------------------------------------

describe('P3 虚拟节点角色判定', () => {
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

describe('P3 闸门标记目标归一化（mainNodeIdOf）', () => {
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

describe('P3 补丁层 proxy data 归一化（applyGraphOps 纯函数）', () => {
  it('create_node：虚拟节点的 label / role 落盘（只保留这两个字段）', () => {
    const doc = gateFlow('milestone')
    const { doc: next } = applyGraphOps({
      doc,
      ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { label: '里程碑②', role: 'milestone', junk: 1 } } }],
    })
    const created = (next.nodes as GraphNode[]).find((n) => n.id === 'm2') as { data?: Record<string, unknown> }
    expect(created.data).toEqual({ label: '里程碑②', role: 'milestone' })
  })

  it('create_node：role 越界 → WF_GRAPH_INVALID（错误文本给出取值域）', () => {
    const doc = gateFlow('milestone')
    expect(() => applyGraphOps({ doc, ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { role: 'gate' } } }] }))
      .toThrowError(/executor|milestone/)
    try {
      applyGraphOps({ doc, ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { role: 'gate' } } }] })
    } catch (error) {
      expect((error as WfError).code).toBe('WF_GRAPH_INVALID')
    }
  })

  it('update_node_data：可把普通虚拟节点提升为闸门（并支持清空 role 退回 executor）', () => {
    const doc = gateFlow('executor')
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { role: 'milestone', label: '闸门' } }] })
    const upNodes = up.doc.nodes as GraphNode[]
    expect(proxyRoleOf(upNodes.find((n) => n.id === 'm1'))).toBe('milestone')
    // 清空 role / label → data 整体删除，退回缺省 executor
    const down = applyGraphOps({ doc: up.doc as unknown as WorkflowDocument, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { role: null, label: '' } }] })
    const downNodes = down.doc.nodes as GraphNode[]
    const node = downNodes.find((n) => n.id === 'm1') as { data?: unknown }
    expect(node.data).toBeUndefined()
    expect(proxyRoleOf(downNodes.find((n) => n.id === 'm1'))).toBe('executor')
  })

  it('update_node_data：虚拟节点仍可改引用主节点（回归：proxySourceId 顶层字段语义不变）', () => {
    const doc = gateFlow('milestone')
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: 'a1' } }] })
    expect((((up.doc.nodes as GraphNode[]).find((n) => n.id === 'm1')) as { proxySourceId?: string }).proxySourceId).toBe('a1')
  })

  it('update_node_data：引用不存在的主节点 → 拒绝（既有校验保留）', () => {
    const doc = gateFlow('milestone')
    expect(() => applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: '不存在' } }] }))
      .toThrowError(/必须引用已存在的角色节点/)
  })
})

// tests/host/tools/wf-graph-patch/apply.test.ts
//
// wf_graph_patch 纯函数内核的**虚拟节点 data 归一化**用例
// （原 tests/host/milestone-gate.test.ts 的「补丁层 proxy data 归一化」段，
//   按 tests/AGENTS.md 的镜像规则迁到被测源文件 apply.ts 旁）：
//   - create_node：虚拟节点只保留 label / role 两个字段；
//   - role 越界 → WF_GRAPH_INVALID（错误文本给出取值域）；
//   - update_node_data：提升为闸门 / 清空退回 executor（data 整体删除）；
//   - proxySourceId 顶层字段语义不变；引用不存在的主节点 → 拒绝。
// 角色语义判定（proxyRoleOf 等）与闸门归一化（mainNodeIdOf）见 tests/host/graph/model.test.ts。

import { describe, expect, it } from 'vitest'
import { applyGraphOps } from '../../../../src/host/tools/wf-graph-patch/apply.js'
import { proxyRoleOf, stageLabel } from '../../../../src/host/graph/index.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import type { GraphNode, Line, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

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

describe('补丁层 proxy data 归一化（applyGraphOps 纯函数）', () => {
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

// ---------------------------------------------------------------------------
// 角色节点 data 补全（apply.ts 的 normalizeRoleNodeData）
// ---------------------------------------------------------------------------
// 为什么归到这里：原 graph/validate.ts 的 normalizeFlow 也做「角色节点补默认值」，
// 但它从未被生产代码调用且实现为字段白名单重写（会丢 meta/lastPatch 与未来新增字段），
// 2026.10 治理中已删除。真正生效的补全入口是本模块的 normalizeRoleNodeData（父代理
// 经 wf_graph_patch 建/改节点时的唯一规范化点），故其补全语义的断言收敛于此。

describe('角色节点 data 补全（normalizeRoleNodeData）', () => {
  // 入参用严格契约 WorkflowDocument（applyGraphOps 输入类型）；出参 doc 是宽松的
  // GraphPatchResult.doc 形状，故断言后用 roleDataOf 读取节点 data。
  type PatchDoc = ReturnType<typeof applyGraphOps>['doc']
  const flowOf = (nodes: GraphNode[]): WorkflowDocument => ({
    id: 'wf-1', sessionId: 'session-1', mode: 'mode1', name: 'x', description: '', revision: 1,
    nodes, lines: [],
  })
  const roleDataOf = (doc: PatchDoc, id: string): Record<string, unknown> => {
    const node = (doc.nodes as GraphNode[]).find((n) => n.id === id)
    return (node as unknown as { data: Record<string, unknown> }).data
  }

  it('create_node：模型只给 label/systemPrompt 时补全运行必需字段（presetId=null、retryLimit=3 等）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{ op: 'create_node', node: { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '评审', systemPrompt: '你是评审' } } }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.label).toBe('评审')
    expect(data.systemPrompt).toBe('你是评审')
    expect(data.presetId).toBeNull() // 空 = 运行期零工具集（工具描述已写明契约）
    expect(data.retryLimit).toBe(3)
    expect(data.reactLimit).toBeNull()
    expect(data.provider).toBe('')
    expect(data.model).toBe('')
    expect(data.inputSchema).toBe('')
    expect(data.outputSchema).toBe('')
    expect(data.groupId).toBeNull()
    expect(data.injectSystemPrompt).toBe(true)
    expect(data.injectToolSections).toBe(true)
  })

  it('create_node：显式空串 / 数字 / 布尔原样保留（只把 null/undefined 视为未提供）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{
        op: 'create_node',
        node: {
          id: 'a1', kind: 'agent', position: { x: 0, y: 0 },
          data: { label: 'L', systemPrompt: '', provider: '', model: '', presetId: 'combo-x', retryLimit: 0, injectSystemPrompt: false },
        },
      }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.presetId).toBe('combo-x')
    expect(data.retryLimit).toBe(0)
    expect(data.injectSystemPrompt).toBe(false)
  })

  it('update_node_data：补全不剥离未知字段（systemPromptSource 等展示字段保留）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start'), agentNode('a1')]),
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '改', systemPromptSource: '角色说明.md' } }],
    })
    expect(roleDataOf(doc, 'a1').systemPromptSource).toBe('角色说明.md')
  })
})

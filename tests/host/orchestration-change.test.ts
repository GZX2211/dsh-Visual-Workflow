// tests/host/orchestration-change.test.ts
//
// 「编排变更」新机制纯函数单测：
//   - flow-diff：编排语义变更判定（几何改动不算、连线语义键去 id、节点配置变化）；
//   - orchestration-change：注入通知文案（标记/事实源路径/语言规则/纯函数字节稳定）。
// DoD：拖动坐标与组卡片缩放绝不触发注入；节点/连线增删改必须触发。

import { describe, expect, it } from 'vitest'
import { lineKeyOf, nodeConfigKeyOf, summarizeFlowChange } from '../../src/host/orchestrator/flow-diff.js'
import { ORCH_CHANGE_MARKER, buildOrchestrationChangeText } from '../../src/host/prompts/orchestration-change.js'
import type { GraphNode, RoleNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

/** 角色节点（固定 id + 可覆盖数据/坐标）。 */
function agent(id: string, label: string, extra: Partial<RoleNode['data']> = {}, position = { x: 0, y: 0 }): RoleNode {
  return {
    id,
    kind: 'agent',
    position,
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      ...extra,
    },
  }
}

/** 基准流程：start → a1 → a2 → end。 */
function baseFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '',
    revision: 1,
    nodes: [
      { id: 'n-start', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      agent('n-a1', '任务A', {}, { x: 10, y: 10 }),
      agent('n-a2', '任务B', {}, { x: 20, y: 20 }),
      { id: 'n-end', kind: 'end', position: { x: 30, y: 30 }, data: { label: '结束' } },
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 覆盖节点 data（测试辅助：GraphNode 联合含无 data 的 proxy 分支，需按结构取值）。 */
function withData(node: GraphNode, patch: Record<string, unknown>): GraphNode {
  const data = (node as { data?: Record<string, unknown> }).data ?? {}
  return { ...node, data: { ...data, ...patch } } as GraphNode
}

describe('flow-diff 编排语义变更判定', () => {
  it('同一份文档：无变更', () => {
    const summary = summarizeFlowChange(baseFlow(), baseFlow())
    expect(summary.changed).toBe(false)
    expect(summary.addedNodeIds).toEqual([])
    expect(summary.removedNodeIds).toEqual([])
    expect(summary.changedNodeIds).toEqual([])
    expect(summary.addedLineKeys).toEqual([])
    expect(summary.removedLineKeys).toEqual([])
  })

  it('纯坐标拖动：不算编排变更（用户裁决：XY 拖动直接忽略）', () => {
    const flow = baseFlow()
    const moved: WorkflowDocument = { ...flow, nodes: flow.nodes.map((node) => ({ ...node, position: { x: 999, y: 888 } })) }
    expect(summarizeFlowChange(flow, moved).changed).toBe(false)
  })

  it('协作组卡片尺寸与左右连接点交换：不算编排变更（纯几何）', () => {
    const flow: WorkflowDocument = {
      ...baseFlow(),
      nodes: [...baseFlow().nodes, {
        id: 'n-group',
        kind: 'group',
        position: { x: 0, y: 0 },
        data: { label: '组', collabPrompt: '', memberIds: [], size: { w: 300, h: 220 } },
      } as GraphNode],
    }
    const resized: WorkflowDocument = {
      ...flow,
      nodes: flow.nodes.map((node) => (
        node.id === 'n-group'
          ? withData(node, { size: { w: 500, h: 400 } })
          : node.id === 'n-a1'
            ? withData(node, { swapPorts: true })
            : node
      )),
    }
    expect(summarizeFlowChange(flow, resized).changed).toBe(false)
  })

  it('节点新增/删除：判定为变更', () => {
    const flow = baseFlow()
    const added: WorkflowDocument = { ...flow, nodes: [...flow.nodes, agent('n-a3', '任务C')] }
    const addSummary = summarizeFlowChange(flow, added)
    expect(addSummary.changed).toBe(true)
    expect(addSummary.addedNodeIds).toEqual(['n-a3'])

    const removeSummary = summarizeFlowChange(added, flow)
    expect(removeSummary.changed).toBe(true)
    expect(removeSummary.removedNodeIds).toEqual(['n-a3'])
  })

  it('节点配置变化（systemPrompt/模型/重试上限）：判定为变更', () => {
    const flow = baseFlow()
    const patched: WorkflowDocument = {
      ...flow,
      nodes: flow.nodes.map((node) => (node.id === 'n-a1' ? withData(node, { systemPrompt: '新任务' }) : node)),
    }
    const summary = summarizeFlowChange(flow, patched)
    expect(summary.changed).toBe(true)
    expect(summary.changedNodeIds).toEqual(['n-a1'])
  })

  it('连线增删：判定为变更；同语义连线仅 id 变化不算变更', () => {
    const flow = baseFlow()
    const withExtra: WorkflowDocument = {
      ...flow,
      lines: [...flow.lines, { id: 'l4', source: 'n-a1', target: 'n-end', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }],
    }
    const addSummary = summarizeFlowChange(flow, withExtra)
    expect(addSummary.changed).toBe(true)
    expect(addSummary.addedLineKeys).toEqual([lineKeyOf({ id: 'l4', source: 'n-a1', target: 'n-end', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })])

    // 删除后重连：id 变化、语义相同 → 不算变更
    const reconnected: WorkflowDocument = {
      ...flow,
      lines: flow.lines.map((line) => (line.id === 'l2' ? { ...line, id: 'l2-new' } : line)),
    }
    expect(summarizeFlowChange(flow, reconnected).changed).toBe(false)

    const dropped = summarizeFlowChange(withExtra, flow)
    expect(dropped.changed).toBe(true)
    expect(dropped.removedLineKeys).toHaveLength(1)
  })

  it('连线条件标签变化：判定为变更', () => {
    const flow = baseFlow()
    const conditional: WorkflowDocument = {
      ...flow,
      lines: flow.lines.map((line) => (line.id === 'l2' ? { ...line, condition: { type: 'content' as const, label: '通过' } } : line)),
    }
    expect(summarizeFlowChange(flow, conditional).changed).toBe(true)
  })

  it('nodeConfigKeyOf：忽略 position，保留其余配置（键序无关）', () => {
    const a = agent('n-a1', '任务A', {}, { x: 1, y: 1 })
    const b = agent('n-a1', '任务A', {}, { x: 888, y: 999 })
    expect(nodeConfigKeyOf(a)).toBe(nodeConfigKeyOf(b))
    const c = agent('n-a1', '任务A2', {}, { x: 1, y: 1 })
    expect(nodeConfigKeyOf(a)).not.toBe(nodeConfigKeyOf(c))
  })
})

describe('orchestration-change 注入文案', () => {
  it('含【编排变更】标记、事实源路径与「不是新指令」澄清', () => {
    const text = buildOrchestrationChangeText({
      workflowName: '测试流程',
      definitionPath: 'D:/ws/orchestrations/run-1.json',
      systemLanguage: '中文',
    })
    expect(text).toContain(ORCH_CHANGE_MARKER)
    expect(text).toContain('D:/ws/orchestrations/run-1.json')
    expect(text).toContain('不是用户的新指令')
    expect(text).toContain('已完成的节点不要重跑')
    expect(text).toContain('所有对话回复、注释、思考过程必须使用中文')
  })

  it('系统语言缺省：不注入语言规则；纯函数字节稳定', () => {
    const params = { workflowName: '测试流程', definitionPath: 'p.json' }
    const first = buildOrchestrationChangeText(params)
    const second = buildOrchestrationChangeText(params)
    expect(first).toBe(second)
    expect(first).not.toContain('所有对话回复')
  })
})

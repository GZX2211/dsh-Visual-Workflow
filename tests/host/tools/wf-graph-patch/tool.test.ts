// tests/host/tools/wf-graph-patch/tool.test.ts
//
// wf_graph_patch 工具单测（自主编排方案 §4.2 + 决策 D-04/D-05/D-07/D-12/D-16）：
//   - A 组图结构：创建/删除（级联）/改数据/连线/断线/组一致性 → 检查器校验 + 落盘 revision；
//   - 混组拒绝（WF_PATCH_MIXED_GROUPS 与未知 op 名）；
//   - scope 与目标类型不匹配（WF_SCOPE_INVALID，按真实类型判定）；目标不存在（WF_ORG_NOT_FOUND）；
//   - revision 冲突不重试（WF_PATCH_CONFLICT）；
//   - 检查器阻断（WF_GRAPH_INVALID，错误文本含修复建议）；
//   - 元参数硬护栏仅对 origin='agent'（D-05）+ set_meta 自身复检；
//   - mark_node（C 组）：无运行拒绝、节点不存在拒绝、闸门预算用尽拒绝、成功改写快照；
//   - 虚拟节点引用校验；阶段节点属性锁定；坐标不入补丁（哨兵 {0,0}）。
//
// 说明：所有用例的「补丁后图」都构造为通过图检查器的合法图（error 级阻断是预期行为之一，
// 故非法中间态不能出现在同一个补丁里——这正是「先建后连」需要拆两次提交的原因）。

import { describe, expect, it } from 'vitest'
import { executeGraphPatch, registerWfGraphPatch, type GraphPatchHost } from '../../../../src/host/tools/wf-graph-patch/tool.js'
import { WfError } from '../../../../src/host/orchestrator/seams.js'
import { stageLabel } from '../../../../src/host/graph/model.js'
import type { GraphNode, Line, WorkflowDocument, WorkflowTemplate } from '../../../../src/host/shared/graph-model.js'
import type { RunEntry } from '../../../../src/host/orchestrator/run-types.js'
import type { RunSnapshot } from '../../../../src/host/shared/types.js'

// ---------------------------------------------------------------------------
// fake 宿主（store + orchestrator）
// ---------------------------------------------------------------------------

interface FakeStoreState {
  workflows: Map<string, WorkflowDocument>
  templates: Map<string, WorkflowTemplate>
  services: Map<string, WorkflowDocument>
  /** 保存时模拟一次 revision 冲突。 */
  conflictOnce: boolean
}

function makeStore(state: FakeStoreState) {
  return {
    async getFlowTemplate(id: string): Promise<WorkflowTemplate | null> {
      return state.templates.get(id) ?? null
    },
    async saveFlowTemplate(template: WorkflowTemplate, _options: { expectedRevision: number }): Promise<WorkflowTemplate> {
      const revision = (state.templates.get(template.id)?.revision ?? 0) + 1
      const saved = { ...template, revision }
      state.templates.set(saved.id, saved)
      return saved
    },
    async getWorkflow(_sessionId: string, flowId: string): Promise<WorkflowDocument | null> {
      return state.workflows.get(flowId) ?? null
    },
    async saveWorkflow(doc: WorkflowDocument, _sessionId: string, options: { expectedRevision: number }): Promise<WorkflowDocument> {
      if (state.conflictOnce) {
        state.conflictOnce = false
        throw Object.assign(new Error('revision 冲突'), { code: 'FLOW_REVISION_CONFLICT' })
      }
      const revision = (state.workflows.get(doc.id)?.revision ?? options.expectedRevision ?? 0) + 1
      const saved = { ...doc, revision }
      state.workflows.set(saved.id, saved)
      return saved
    },
    async getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null> {
      return state.services.get(serviceId) ?? null
    },
    async getRun(): Promise<unknown> {
      return null
    },
    async listRuns(): Promise<unknown[]> {
      return []
    },
  }
}

function makeRunEntry(flowId: string, nodeIds: string[]): RunEntry {
  const snapshot: RunSnapshot = {
    id: 'run-1',
    flowId,
    flowName: '流程',
    sessionId: 'session-1',
    mode: 'mode1',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    summary: '',
    nodes: nodeIds.map((nodeId) => ({
      nodeId, status: 'pending' as const, attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '',
    })),
  }
  return {
    controller: new AbortController(),
    snapshot,
    baseFlow: { id: flowId, sessionId: 'session-1', mode: 'mode1', name: '流程', description: '', nodes: [], lines: [] },
    inflight: new Set(),
    attempts: new Map(),
    callCount: 0,
    lastActiveAt: 0,
    waiters: new Map(),
    asks: new Map(),
  }
}

function makeHost(overrides: Partial<GraphPatchHost> = {}, state?: FakeStoreState) {
  const storeState: FakeStoreState = state ?? { workflows: new Map(), templates: new Map(), services: new Map(), conflictOnce: false }
  const touched: string[] = []
  const refreshed: string[] = []
  const entries = new Map<string, RunEntry>()
  const host: GraphPatchHost = {
    store: makeStore(storeState) as GraphPatchHost['store'],
    orchestrator: {
      activeRunForSession: (sessionId: string) => entries.get(sessionId) ?? null,
      flowLockInfo: () => null,
      currentResolvedFlow: async (entry: RunEntry) => entry.baseFlow,
      touchRunForSession: (sessionId: string) => { touched.push(sessionId); return true },
      refreshActiveDefinitions: async (flowId: string) => { refreshed.push(flowId) },
    },
    ...overrides,
  }
  return { host, storeState, touched, refreshed, entries }
}

// ---------------------------------------------------------------------------
// 图构造
// ---------------------------------------------------------------------------

function stageNode(id: string, kind: 'start' | 'end' | 'pause'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function roleNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label, systemPrompt: '', provider: '', model: '', presetId: null,
      retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
    },
  }
}

function groupNode(id: string, memberIds: string[]): GraphNode {
  return { id, kind: 'group', position: { x: 0, y: 0 }, data: { label: id, collabPrompt: '', memberIds } }
}

function proxyNode(id: string, sourceId: string): GraphNode {
  return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: sourceId }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

/** 健康基线实例：start → a1 → end。 */
function makeFlow(id = 'wf-1', extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id,
    sessionId: 'session-1',
    mode: 'mode1',
    name: '流程',
    description: '',
    revision: 3,
    nodes: [stageNode('s', 'start'), roleNode('a1'), stageNode('e', 'end')],
    lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    ...extra,
  }
}

function makeTemplate(id = 'tpl-1', extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id,
    mode: 'mode1',
    name: '模板',
    description: '',
    revision: 2,
    nodes: [stageNode('s', 'start'), roleNode('a1'), stageNode('e', 'end')],
    lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    ...extra,
  }
}

async function expectWfError(run: () => Promise<unknown>, code: string): Promise<WfError> {
  try {
    await run()
    throw new Error('期望抛出 ' + code + '，但调用成功')
  } catch (error) {
    const wf = error as WfError
    expect(wf.name).toBe('WfError')
    expect(wf.code).toBe(code)
    return wf
  }
}

const ctxInput = { sessionId: 'session-1' }

// ---------------------------------------------------------------------------
// A 组：图结构变更
// ---------------------------------------------------------------------------

describe('wf_graph_patch · A 组图结构变更', () => {
  it('create_node + connect + disconnect：落盘 revision 递增、事实源刷新', async () => {
    const { host, storeState, refreshed } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', systemPrompt: '', retryLimit: 3, provider: '', model: '' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.revision).toBe(4)
    expect(result.created).toEqual(['a2'])
    expect(result.connected).toHaveLength(2)
    expect(refreshed).toEqual(['wf-1'])
    const saved = storeState.workflows.get('wf-1')
    expect(saved?.nodes.map((node) => node.id)).toContain('a2')
    expect(saved?.lines.some((line) => line.source === 'a1' && line.target === 'a2')).toBe(true)
    expect(saved?.lines.some((line) => line.id === 'l2')).toBe(false)
  })

  it('create_node：坐标不入补丁 —— 缺省写哨兵 {0,0} 交由客户端自动布局（D-16）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    // 先建（孤立但允许：本补丁只做「记哨兵」语义），再连（第二个补丁把图连回合法）
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } }],
    }).catch(() => undefined) // 检查器可能因孤立阻断；哨兵语义与是否落盘无关
    const created = (await import('../../../../src/host/tools/wf-graph-patch/apply.js')).applyGraphOps({
      doc: makeFlow(),
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } }],
    })
    const node = (created.doc.nodes as GraphNode[]).find((item) => item.id === 'a2')
    expect(node?.position).toEqual({ x: 0, y: 0 })
  })

  it('create_node：阶段节点 label 由系统锁定（忽略补丁传入值）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), roleNode('a1'), stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    }))
    const applied = (await import('../../../../src/host/tools/wf-graph-patch/apply.js')).applyGraphOps({
      doc: makeFlow('wf-1', { nodes: [roleNode('a1')], lines: [] }),
      ops: [{ op: 'create_node', node: { id: 's', kind: 'start', data: { label: '我自己起的名字' } } }],
    })
    const node = (applied.doc.nodes as GraphNode[]).find((item) => item.id === 's') as { data?: { label?: string } }
    expect(node?.data?.label).toBe('启动')
    void host
  })

  it('create_node：虚拟节点必须引用已存在的角色节点', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'p1', kind: 'proxy', proxySourceId: '不存在' } }],
    }), 'WF_GRAPH_INVALID')
  })

  // 回归（2026.09）：create_node 曾把 raw.data 原样落盘，父代理最自然的写法
  // { kind:'agent', data:{ label, systemPrompt } } 会产出 presetId=undefined 的空壳节点，
  // 运行期 resolveAgentTools 判定为零工具集（连 read/write 都调不到）。
  it('create_node：角色节点 data 缺省字段被补全（presetId 归一为 null、retryLimit/inject* 补默认）', async () => {
    const { applyGraphOps } = await import('../../../../src/host/tools/wf-graph-patch/apply.js')
    const applied = applyGraphOps({
      doc: makeFlow('wf-1', { nodes: [stageNode('s', 'start')], lines: [] }),
      ops: [{ op: 'create_node', node: { id: 'a9', kind: 'agent', data: { label: '新角色', systemPrompt: '你是分析员' } } }],
    })
    const node = (applied.doc.nodes as GraphNode[]).find((item) => item.id === 'a9') as {
      data?: Record<string, unknown>
    }
    expect(node.data).toMatchObject({
      label: '新角色',
      systemPrompt: '你是分析员',
      presetId: null,
      provider: '',
      model: '',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      injectSystemPrompt: true,
      injectToolSections: true,
      groupId: null,
    })
  })

  it('create_node：角色节点完全缺 data 也不崩（按空对象补全）', async () => {
    const { applyGraphOps } = await import('../../../../src/host/tools/wf-graph-patch/apply.js')
    const applied = applyGraphOps({
      doc: makeFlow('wf-1', { nodes: [stageNode('s', 'start')], lines: [] }),
      ops: [{ op: 'create_node', node: { id: 'a9', kind: 'parent' } }],
    })
    const node = (applied.doc.nodes as GraphNode[]).find((item) => item.id === 'a9') as {
      data?: Record<string, unknown>
    }
    expect(node.data).toMatchObject({ label: '', systemPrompt: '', presetId: null, retryLimit: 3 })
  })

  it('update_node_data：角色节点合并后仍过一次补全（被抹掉的 presetId/provider 补回默认）', async () => {
    const { applyGraphOps } = await import('../../../../src/host/tools/wf-graph-patch/apply.js')
    const applied = applyGraphOps({
      doc: makeFlow('wf-1'),
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { systemPrompt: '新任务' } }],
    })
    const node = (applied.doc.nodes as GraphNode[]).find((item) => item.id === 'a1') as {
      data?: Record<string, unknown>
    }
    expect(node.data).toMatchObject({ systemPrompt: '新任务', presetId: null, retryLimit: 3 })
  })

  it('create_node：presetId 显式给出时原样保留（只归一空值为 null）', async () => {
    const { applyGraphOps } = await import('../../../../src/host/tools/wf-graph-patch/apply.js')
    const applied = applyGraphOps({
      doc: makeFlow('wf-1', { nodes: [stageNode('s', 'start')], lines: [] }),
      ops: [{ op: 'create_node', node: { id: 'a9', kind: 'agent', data: { label: 'x', presetId: 'combo-1' } } }],
    })
    const node = (applied.doc.nodes as GraphNode[]).find((item) => item.id === 'a9') as {
      data?: Record<string, unknown>
    }
    expect(node.data?.presetId).toBe('combo-1')
  })

  it('remove_node：级联删除虚拟节点与其连线，并从协作组成员清单移除', async () => {
    const { host, storeState } = makeHost()
    // 基线：s → a1 → g1 → e；a2/a3 为组内成员（无流程线，但组成员由组卡片承载）
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), roleNode('a1'), groupNode('g1', ['a2', 'a3']), roleNode('a2'), roleNode('a3'), proxyNode('p2', 'a2'), stageNode('e', 'end')],
      lines: [
        flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'g1'), flowLine('l3', 'g1', 'e'),
        // 组成员经上下文线参与流程（组内成员没有流程连接点，§4.2.5.2 规则 4）
        { id: 'c2', source: 'a2', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
        { id: 'c3', source: 'a3', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      ],
    }))
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'remove_node', nodeId: 'a2', cascade: true }],
    })
    const saved = storeState.workflows.get('wf-1')
    expect(saved?.nodes.some((node) => node.id === 'a2')).toBe(false)
    expect(saved?.nodes.some((node) => node.id === 'p2')).toBe(false)
    const group = saved?.nodes.find((node) => node.id === 'g1') as { data?: { memberIds?: string[] } } | undefined
    expect(group?.data?.memberIds).toEqual(['a3'])
    expect(ctxInput.sessionId).toBe('session-1')
  })

  it('update_node_data：浅合并；成员字段被忽略（关系只能经 set_group_members 维护）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '改过的名字', memberIds: ['x'], systemPrompt: '新提示' } }],
    })
    const node = storeState.workflows.get('wf-1')?.nodes.find((item) => item.id === 'a1') as { data: Record<string, unknown> }
    expect(node.data.label).toBe('改过的名字')
    expect(node.data.systemPrompt).toBe('新提示')
    expect('memberIds' in node.data).toBe(false)
  })

  it('update_node_data：阶段节点属性锁定（拒绝）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 's', data: { label: '强行改名' } }],
    }), 'WF_GRAPH_INVALID')
  })

  it('create_group + set_group_members：成员 groupId 与组 memberIds 双向一致', async () => {
    const { host, storeState } = makeHost()
    // 基线：s → g1（空组，流程门）→ e；a1 → a2 走上下文线（两者都不参与流程，但非孤儿）。
    // 说明：组卡片只有流程连接点、组内成员只有 ctx/db 连接点（§4.2.5.2 规则 4），
    // 故「把 a1/a2 入组」不会破坏结构校验。
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), groupNode('g1', []), roleNode('a1'), roleNode('a2'), stageNode('e', 'end')],
      lines: [
        flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e'),
        { id: 'c1', source: 'a1', target: 'a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      ],
    }))
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_group_members', groupId: 'g1', memberIds: ['a2'] }],
    })
    let saved = storeState.workflows.get('wf-1')
    let group = saved?.nodes.find((node) => node.id === 'g1') as { data: { memberIds: string[] } }
    let member = saved?.nodes.find((node) => node.id === 'a2') as { data: { groupId?: string | null } }
    expect(group.data.memberIds).toEqual(['a2'])
    expect(member.data.groupId).toBe('g1')

    // 换成员：a1 入组、a2 出组（a2 保留 ctx 线，不是孤儿）
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_group_members', groupId: 'g1', memberIds: ['a2', 'a1'] }],
    })
    saved = storeState.workflows.get('wf-1')
    group = saved?.nodes.find((node) => node.id === 'g1') as { data: { memberIds: string[] } }
    expect(group.data.memberIds).toEqual(['a2', 'a1'])
    expect((saved?.nodes.find((node) => node.id === 'a1') as { data: { groupId?: string | null } }).data.groupId).toBe('g1')

    // 空组清空成员 → 检查器阻断（groupNoMembers）
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_group_members', groupId: 'g1', memberIds: [] }],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('groupNoMembers')
  })

  it('connect：重复连线拒绝；disconnect：未匹配连线拒绝', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
    }), 'WF_GRAPH_INVALID')
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'disconnect', lineId: '不存在' }],
    }), 'WF_GRAPH_INVALID')
  })

  it('模板作用域：改工作流模板并落盘（scope=template）', async () => {
    const { host, storeState } = makeHost()
    storeState.templates.set('tpl-1', makeTemplate())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'tpl-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '模板里的分析' } }],
    })
    expect(result.revision).toBe(3)
    const saved = storeState.templates.get('tpl-1')
    expect((saved?.nodes.find((node) => node.id === 'a1') as { data: { label: string } }).data.label).toBe('模板里的分析')
  })
})

// ---------------------------------------------------------------------------
// 参数层：混组 / scope / 冲突 / 未知 op
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 参数层校验', () => {
  it('混组拒绝：WF_PATCH_MIXED_GROUPS 并写明分区原因', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: {} } },
        { op: 'set_meta', meta: { nodeMax: 5 } },
      ],
    }), 'WF_PATCH_MIXED_GROUPS')
    expect(error.message).toContain('graph')
    expect(error.message).toContain('meta')
  })

  it('未知 op 名拒绝（WF_GRAPH_INVALID，错误文本点名未知操作）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'move', nodeId: 'a1' }],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('move')
  })

  it('scope 与目标类型不匹配：WF_SCOPE_INVALID（实例当模板 / 模板当实例）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    storeState.templates.set('tpl-1', makeTemplate())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: 'x' } }],
    }), 'WF_SCOPE_INVALID')
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'tpl-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: 'x' } }],
    }), 'WF_SCOPE_INVALID')
  })

  it('目标不存在：WF_ORG_NOT_FOUND（模板与实例两条路径）', async () => {
    const { host } = makeHost()
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'nope',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: {} }],
    }), 'WF_ORG_NOT_FOUND')
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'nope',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: {} }],
    }), 'WF_ORG_NOT_FOUND')
  })

  it('revision 冲突：WF_PATCH_CONFLICT（不自动重试）', async () => {
    const state: FakeStoreState = { workflows: new Map([['wf-1', makeFlow()]]), templates: new Map(), services: new Map(), conflictOnce: true }
    const { host } = makeHost({}, state)
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      expectRevision: 3,
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: 'x' } }],
    }), 'WF_PATCH_CONFLICT')
  })

  it('空补丁拒绝（WF_BAD_ARGS）', async () => {
    const { host } = makeHost()
    await expectWfError(() => executeGraphPatch(host, 'session-1', { scope: 'instance', targetId: 'wf-1', ops: [] }), 'WF_BAD_ARGS')
  })
})

// ---------------------------------------------------------------------------
// 检查器阻断与元参数护栏
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 检查器与元参数护栏', () => {
  it('检查器 error 阻断（新增孤立节点 → orphanNode），错误文本含修复建议', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: '孤儿', kind: 'agent', data: { label: '孤儿' } } }],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('orphanNode')
    expect(error.message).toContain('建议')
  })

  it('元参数硬护栏：origin=agent 超 nodeMax 被拒；origin=user 放行（D-05）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', { meta: { nodeMax: 1 } }))
    const ops = [
      { op: 'create_node' as const, node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
      { op: 'connect' as const, source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect' as const, source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'disconnect' as const, lineId: 'l2' },
    ]
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', ops,
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('metaLimitExceeded')
    const userResult = await executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', origin: 'user', ops,
    })
    expect(userResult.ok).toBe(true)
  })

  it('set_meta：写入归一化后的元参数（未知字段丢弃、数值取整）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_meta', meta: { nodeMax: 12.9 } as never }],
    })
    expect(result.meta).toEqual({ nodeMax: 12 })
    expect(storeState.workflows.get('wf-1')?.meta).toEqual({ nodeMax: 12 })
  })

  it('set_meta：收紧到违反当前规模的组上限时拒绝（新预算复检）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), roleNode('a1'), groupNode('g1', ['a1']), stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e')],
    }))
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_meta', meta: { membersMax: 1, groupMax: 1, nodeMax: 1 } }],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('metaLimitExceeded')
  })
})

// ---------------------------------------------------------------------------
// C 组：运行状态标记
// ---------------------------------------------------------------------------

describe('wf_graph_patch · C 组运行状态标记', () => {
  it('mark_node：无运行拒绝（WF_MILESTONE_INVALID）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
  })

  it('mark_node：成功改写快照并落盘；节点不在快照 → 拒绝', async () => {
    let persisted = 0
    const { host, entries, touched } = makeHost({
      persistRun: async () => { persisted += 1 },
      milestoneUsedOf: () => 0,
    })
    const entry = makeRunEntry('wf-1', ['s', 'a1', 'e'])
    entry.snapshot.meta = { milestoneMax: 2 }
    // P3 闸门状态机：只有闸门轮（executorIsMilestone + executorParentId）才可标记
    entry.executorParentId = 'a1'
    entry.executorIsMilestone = true
    entry.milestoneProxyId = 'm1'
    entries.set('session-1', entry)
    const ok = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok', summary: '里程碑通过' }],
    })
    expect(ok.revision).toBe(0) // C 组不改文档：revision 来自运行快照（baseFlow.revision 缺省 0）
    expect(ok.marked).toEqual({ nodeId: 'a1', status: 'ok', runId: 'run-1' })
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'a1')?.status).toBe('ok')
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'a1')?.stopReason).toBe('milestone')
    expect(persisted).toBe(1)
    // 双保险：mark_node 期间顺带刷新空闲基准（方案 §5.1）
    expect(touched).toEqual(['session-1'])

    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: '不存在', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
  })

  it('mark_node：闸门预算用尽后拒绝（不含首次编排，D-21）', async () => {
    const { host, entries } = makeHost({ milestoneUsedOf: () => 2, persistRun: async () => {} })
    const entry = makeRunEntry('wf-1', ['a1'])
    // 预算口径唯一来源是快照（P3）：已用 2 次 / 上限 2 次
    entry.snapshot.meta = { milestoneMax: 2 }
    entry.snapshot.milestoneUsed = 2
    entry.executorParentId = 'a1'
    entry.executorIsMilestone = true
    entries.set('session-1', entry)
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
    expect(error.message).toContain('已用尽')
  })
})

// ---------------------------------------------------------------------------
// create 通路：新建模板（用户裁决 2026.09；修正方案 §4.2 的自相矛盾）
// 规划期主用例「无模板 → 产出模板」必须可走通；create 只与 graph 组同用。
// ---------------------------------------------------------------------------

/** 新建一份完整合法图的 graph 组 ops（start → a1 → end）。 */
function createOps() {
  return [
    { op: 'create_node', node: { id: 's', kind: 'start', data: { label: stageLabel('start', 'mode1') } } },
    { op: 'create_node', node: { id: 'a1', kind: 'agent', data: { label: '分析', systemPrompt: '', retryLimit: 3, provider: '', model: '' } } },
    { op: 'create_node', node: { id: 'e', kind: 'end', data: { label: stageLabel('end', 'mode1') } } },
    { op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { op: 'connect', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
  ]
}

describe('wf_graph_patch · create 新建模板', () => {
  it('省略 targetId：服务端生成新模板 id，落盘 name/description/mode 与完整节点集', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-new1' })
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: '内容生产流水线', description: '采集→成稿→发布', mode: 'mode1' },
      ops: createOps(),
    })
    expect(result.ok).toBe(true)
    expect(result.newTemplate).toBe(true)
    expect(result.targetId).toBe('tpl-new1')
    expect(result.revision).toBe(1)
    expect(result.created?.slice().sort()).toEqual(['a1', 'e', 's'])
    const saved = storeState.templates.get('tpl-new1')
    expect(saved?.name).toBe('内容生产流水线')
    expect(saved?.description).toBe('采集→成稿→发布')
    expect(saved?.mode).toBe('mode1')
    expect(saved?.lines).toHaveLength(2)
  })

  it('显式给出尚未存在的 targetId：沿用该 id 新建（供父代理按意图起名）', async () => {
    const { host, storeState } = makeHost()
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'tpl-plan-a',
      create: { name: '规划产物' },
      ops: createOps(),
    })
    expect(result.targetId).toBe('tpl-plan-a')
    expect(result.newTemplate).toBe(true)
    expect(storeState.templates.has('tpl-plan-a')).toBe(true)
  })

  it('目标模板已存在：WF_PATCH_CONFLICT，且绝不覆盖既有模板', async () => {
    const { host, storeState } = makeHost()
    storeState.templates.set('tpl-1', makeTemplate())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'tpl-1',
      create: { name: '想覆盖' },
      ops: createOps(),
    }), 'WF_PATCH_CONFLICT')
    expect(error.message).toContain('已存在')
    expect(storeState.templates.get('tpl-1')?.name).toBe('模板')
  })

  it('create 形状非法：WF_BAD_ARGS（name 空白 / 非对象 / mode 越界）', async () => {
    const { host } = makeHost()
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '   ' }, ops: createOps(),
    }), 'WF_BAD_ARGS')
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template', create: 'tpl', ops: createOps(),
    }), 'WF_BAD_ARGS')
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: 'x', mode: 'mode9' }, ops: createOps(),
    }), 'WF_BAD_ARGS')
  })

  it('create 用于 scope=instance：WF_SCOPE_INVALID（新建的是模板，不是实例）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      create: { name: 'x' },
      ops: createOps(),
    }), 'WF_SCOPE_INVALID')
  })

  it('create 与 meta 组同用：WF_SCOPE_INVALID（一次补丁一个 op 组）', async () => {
    const { host } = makeHost()
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: 'x' },
      ops: [{ op: 'set_meta', meta: { nodeMax: 5 } }],
    }), 'WF_SCOPE_INVALID')
  })

  it('create 与 expectRevision 互斥：WF_BAD_ARGS', async () => {
    const { host } = makeHost()
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: 'x' },
      expectRevision: 0,
      ops: createOps(),
    }), 'WF_BAD_ARGS')
  })

  it('新模板的图不合法（缺 end）：WF_GRAPH_INVALID 且不落盘', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-bad' })
    const ops = createOps()
      .filter((op) => !(op.op === 'create_node' && (op.node as { id: string }).id === 'e'))
      .filter((op) => !(op.op === 'connect' && (op as { target?: string }).target === 'e'))
    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '半成品' }, ops,
    }), 'WF_GRAPH_INVALID')
    expect(storeState.templates.has('tpl-bad')).toBe(false)
  })

  it('新建后可用更新语义继续打补丁：expectRevision 生效、revision 递增', async () => {
    const { host } = makeHost({ newTemplateId: () => 'tpl-new1' })
    const created = await executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '内容生产流水线' }, ops: createOps(),
    })
    expect(created.revision).toBe(1)
    const updated = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'tpl-new1',
      expectRevision: 1,
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '采集' } }],
    })
    expect(updated.newTemplate).toBeUndefined()
    expect(updated.revision).toBe(2)
  })

  it('检查器 warning 不阻断新建（同名角色提示保留在 warnings 里）', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-warn' })
    const ops = [
      { op: 'create_node', node: { id: 's', kind: 'start', data: { label: stageLabel('start', 'mode1') } } },
      { op: 'create_node', node: { id: 'a1', kind: 'agent', data: { label: '分析', systemPrompt: '', retryLimit: 3, provider: '', model: '' } } },
      { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', systemPrompt: '', retryLimit: 3, provider: '', model: '' } } },
      { op: 'create_node', node: { id: 'e', kind: 'end', data: { label: stageLabel('end', 'mode1') } } },
      { op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ]
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '重复角色' }, ops,
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.code === 'duplicateRoleLabel')).toBe(true)
    expect(storeState.templates.has('tpl-warn')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P3 闸门状态机（mark_node 三关：闸门轮 / 当前闸门 / 预算）
// ---------------------------------------------------------------------------

/** 让 fake run 的 baseFlow 带上「父代理 + 闸门虚拟节点」，供目标归一化使用。 */
function withGateFlow(entry: RunEntry, role: 'executor' | 'milestone' = 'milestone'): RunEntry {
  entry.baseFlow = {
    ...entry.baseFlow,
    nodes: [
      { id: 'p1', kind: 'parent', position: { x: 0, y: 0 }, data: { label: 'CEO' } },
      { id: 'm1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'p1', data: { role } },
    ] as RunEntry['baseFlow']['nodes'],
    lines: [{ id: 'l1', source: 's', target: 'm1', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
  }
  return entry
}

describe('wf_graph_patch · P3 闸门状态机（mark_node）', () => {
  it('非闸门轮：executorIsMilestone 缺失 → WF_MILESTONE_INVALID（纯编排/普通执行轮没有可标记的闸门）', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {} })
    const entry = makeRunEntry('wf-1', ['a1'])
    entry.executorParentId = 'a1'
    entries.set('session-1', entry)
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
    expect(error.message).toContain('闸门轮')
  })

  it('目标不是当前闸门：其它节点 id → WF_MILESTONE_INVALID（错误文本给出当前闸门）', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {} })
    const entry = withGateFlow(makeRunEntry('wf-1', ['p1', 'a1']))
    entry.executorParentId = 'p1'
    entry.executorIsMilestone = true
    entry.milestoneProxyId = 'm1'
    entries.set('session-1', entry)
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
    expect(error.message).toContain('m1')
  })

  it('用闸门虚拟节点 id 标记：归一化到父代理节点、写 ok + milestone、快照预算递增', async () => {
    let persisted = 0
    const { host, entries } = makeHost({ persistRun: async () => { persisted += 1 } })
    const entry = withGateFlow(makeRunEntry('wf-1', ['p1', 'a1']))
    entry.executorParentId = 'p1'
    entry.executorIsMilestone = true
    entry.milestoneProxyId = 'm1'
    entry.snapshot.meta = { milestoneMax: 3 }
    entries.set('session-1', entry)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'm1', status: 'ok', summary: '方案评审通过' }],
    })
    expect(result.marked).toEqual({ nodeId: 'p1', status: 'ok', runId: 'run-1' })
    expect(result.milestoneUsed).toBe(1)
    const node = entry.snapshot.nodes.find((item) => item.nodeId === 'p1')
    expect(node?.status).toBe('ok')
    expect(node?.stopReason).toBe('milestone')
    expect(entry.snapshot.milestoneUsed).toBe(1)
    expect(persisted).toBe(1)
  })

  it('多闸门连续标记：预算逐次累计；达到上限后拒绝（不含首次编排 D-21）', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {} })
    const entry = withGateFlow(makeRunEntry('wf-1', ['p1']))
    entry.executorParentId = 'p1'
    entry.executorIsMilestone = true
    entry.milestoneProxyId = 'm1'
    entry.snapshot.meta = { milestoneMax: 1 }
    entries.set('session-1', entry)
    const first = await executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', ops: [{ op: 'mark_node', nodeId: 'm1', status: 'ok' }],
    })
    expect(first.milestoneUsed).toBe(1)
    const second = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', ops: [{ op: 'mark_node', nodeId: 'p1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
    expect(second.message).toContain('已用尽')
    // fail 不消耗预算：同一次已用计数下仍允许标记失败
    const failed = await executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', ops: [{ op: 'mark_node', nodeId: 'p1', status: 'fail' }],
    })
    expect(failed.marked?.status).toBe('fail')
    expect(failed.milestoneUsed).toBe(1)
  })

  it('meta.milestoneMax=0（不限制）：闸门可连续标记，预算只记录不阻断', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {} })
    const entry = withGateFlow(makeRunEntry('wf-1', ['p1']))
    entry.executorParentId = 'p1'
    entry.executorIsMilestone = true
    entries.set('session-1', entry)
    for (let i = 1; i <= 3; i += 1) {
      const result = await executeGraphPatch(host, 'session-1', {
        scope: 'instance', targetId: 'wf-1', ops: [{ op: 'mark_node', nodeId: 'p1', status: 'ok' }],
      })
      expect(result.milestoneUsed).toBe(i)
    }
  })

  it('跨运行继承：续跑新 run 的闸门预算从旧快照带入（不重读元参数）', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {} })
    const entry = withGateFlow(makeRunEntry('wf-1', ['p1']))
    entry.executorParentId = 'p1'
    entry.executorIsMilestone = true
    entry.snapshot.milestoneUsed = 2
    entry.snapshot.meta = { milestoneMax: 2 }
    entries.set('session-1', entry)
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'wf-1', ops: [{ op: 'mark_node', nodeId: 'p1', status: 'ok' }],
    }), 'WF_MILESTONE_INVALID')
    expect(error.message).toContain('已用尽')
  })
})

// ---------------------------------------------------------------------------
// P4 代理补丁标注（lastPatch → 画布「AI 调整」角标）
// ---------------------------------------------------------------------------

describe('wf_graph_patch · P4 代理补丁标注（lastPatch）', () => {
  it("origin='agent'：图结构补丁在文档上留下 lastPatch（节点集 = 新增+修改）", async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', systemPrompt: '', retryLimit: 3, provider: '', model: '' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    const saved = storeState.workflows.get('wf-1') as { lastPatch?: { origin?: string; at?: string; nodeIds?: string[] } }
    expect(saved.lastPatch?.origin).toBe('agent')
    expect(saved.lastPatch?.nodeIds).toEqual(['a2'])
    expect(String(saved.lastPatch?.at ?? '').length).toBeGreaterThan(0)
  })

  it("origin='user'：不写 lastPatch（用户改动不应被标注为 AI 调整）", async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      origin: 'user',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '用户改名' } }],
    })
    const saved = storeState.workflows.get('wf-1') as { lastPatch?: unknown }
    expect(saved.lastPatch).toBeUndefined()
  })

  it('create 新建模板同样记录 lastPatch（模板画布显示角标）', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-mark' })
    await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: '带标注的模板' },
      ops: createOps(),
    })
    const saved = storeState.templates.get('tpl-mark') as { lastPatch?: { nodeIds?: string[] } }
    expect(saved.lastPatch?.nodeIds?.slice().sort()).toEqual(['a1', 'e', 's'])
  })
})

// ---------------------------------------------------------------------------
// 工具注册面：output schema 必须覆盖 executeGraphPatch 的全部返回字段
// ---------------------------------------------------------------------------
// 宿主对工具返回体做 JSON Schema 校验（additionalProperties:false + properties 声明表）：
// 漏声明字段会被判为 "returned invalid output: value.x is not a declared property"，
// 一次**成功**的补丁在模型侧表现为错误。2026.09 实机验证发现：graph 组的
// created/removed/updated/connected/disconnected 与 meta/mark 两组的 meta/marked 均未声明，
// 三个 op 组全部不可用（单元测试直调 executeGraphPatch 会绕过该校验，故补注册面断言）。

describe('wf_graph_patch · output schema 覆盖（工具注册面回归）', () => {
  interface SchemaLike {
    additionalProperties?: boolean
    properties?: Record<string, unknown>
  }

  /** 捕获注册面的工具定义（fake tools 服务），返回其 output.schema。 */
  function captureSchema(host: GraphPatchHost): SchemaLike {
    const captured: Array<{ output?: { schema?: unknown } }> = []
    const ctx = {
      get: () => ({
        register: (def: { output?: { schema?: unknown } }) => {
          captured.push(def)
          return () => {}
        },
      }),
    }
    registerWfGraphPatch(ctx, host)
    expect(captured).toHaveLength(1)
    return captured[0].output?.schema as SchemaLike
  }

  /** 返回 value 顶层未被 schema 声明的键（additionalProperties:false 时才有意义）。 */
  function undeclaredKeys(value: unknown, schema: SchemaLike): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    if (schema.additionalProperties !== false) return []
    const declared = new Set(Object.keys(schema.properties ?? {}))
    return Object.keys(value as Record<string, unknown>).filter((key) => !declared.has(key))
  }

  it('graph 组：created/removed/updated/connected/disconnected 已声明且确实返回', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-schema-1' })
    const schema = captureSchema(host)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: 'schema 覆盖用例' },
      ops: createOps(),
    })
    expect(undeclaredKeys(result, schema)).toEqual([])
    // 反面保障：字段确实出现在返回体里（否则上面的断言会空转通过）
    expect(result.created?.slice().sort()).toEqual(['a1', 'e', 's'])
    expect(result.connected).toHaveLength(2)
    expect(storeState.templates.has('tpl-schema-1')).toBe(true)
  })

  it('meta 组：meta 已声明且确实返回', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const schema = captureSchema(host)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_meta', meta: { nodeMax: 12 } as never }],
    })
    expect(undeclaredKeys(result, schema)).toEqual([])
    expect(result.meta).toEqual({ nodeMax: 12 })
  })

  it('mark 组：marked 已声明且确实返回', async () => {
    const { host, entries } = makeHost({ persistRun: async () => {}, milestoneUsedOf: () => 0 })
    const entry = makeRunEntry('wf-1', ['s', 'a1', 'e'])
    entry.snapshot.meta = { milestoneMax: 2 }
    entry.executorParentId = 'a1'
    entry.executorIsMilestone = true
    entry.milestoneProxyId = 'm1'
    entries.set('session-1', entry)
    const schema = captureSchema(host)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    })
    expect(undeclaredKeys(result, schema)).toEqual([])
    expect(result.marked).toMatchObject({ nodeId: 'a1', status: 'ok' })
  })
})

// ---------------------------------------------------------------------------
// D 组：参数层契约守卫（2026-09 实机取证回归）
//
// 三起真实故障（模型侧全部表现为「报错指向图，但真因在入参形状」）：
//   1. connect 的端点字段猜成 from/to → 旧报错「源节点不存在「」」（空字符串，无法定位）；
//   2. create_node 把 kind 平铺到 op 顶层（少了 node 包装）→ 旧报错「非法节点种类「」」；
//   3. connect 省略 sourceHandle/targetHandle → 旧实现兜底成 ''，写出 isFlowLine()=false 的
//      幽灵线，检查器随后报「启动节点没有流程出线」（真因被完全掩盖）。
// 本组用例把「参数层 = WF_BAD_ARGS + 可自修正的错误文本」与「handle 缺省按流程通道补全」
// 两条契约钉死，防止再次回退。
// ---------------------------------------------------------------------------

describe('wf_graph_patch · D 组参数层契约守卫', () => {
  function fileNode(id: string): GraphNode {
    return { id, kind: 'file', position: { x: 0, y: 0 }, data: { label: id, fileKind: 'text', content: '素材' } }
  }

  it('connect 端点写成 from/to：WF_BAD_ARGS，并把正确字段名说清楚', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', from: 's', to: 'a1' } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('source/target')
  })

  it('connect 缺 source/target：WF_BAD_ARGS（不再误报成「源节点不存在」）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', source: 's' } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('source/target 必填')
    expect(err.message).toContain("op:'connect'")
  })

  it('create_node 把 kind 平铺到 op 顶层：WF_BAD_ARGS 且指出需要 node 包装', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', kind: 'agent', id: 'a9' } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('node 对象')
    expect(err.message).toContain('顶层')
  })

  it('connect 省略 handle：按流程通道补全 flow-out/flow-in（不再写出幽灵线）', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-handle-1' })
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      create: { name: '省略 handle 用例' },
      ops: [
        { op: 'create_node', node: { id: 's', kind: 'start' } },
        { op: 'create_node', node: { id: 'a1', kind: 'agent', data: { label: 'A' } } },
        { op: 'create_node', node: { id: 'e', kind: 'end' } },
        { op: 'connect', source: 's', target: 'a1' },
        { op: 'connect', source: 'a1', target: 'e' },
      ] as never,
    })
    expect(result.ok).toBe(true)
    expect(result.connected).toHaveLength(2)
    const saved = storeState.templates.get('tpl-handle-1')
    expect(saved?.lines).toHaveLength(2)
    expect(saved?.lines.every((line) => line.sourceHandle === 'flow-out' && line.targetHandle === 'flow-in')).toBe(true)
  })

  it('connect 的 handle 与该节点种类不匹配：WF_GRAPH_INVALID 并列出可用连接点', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), roleNode('a1'), fileNode('f1'), stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    }))
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', source: 'f1', target: 'a1' } as never],
    }), 'WF_GRAPH_INVALID')
    expect(err.message).toContain('ctx-out')
  })

  it('condition 缺 type：WF_BAD_ARGS（条件线不得静默退化成普通流程线）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', source: 's', target: 'a1', condition: { label: '通过' } } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('condition.type')
  })

  it('set_group_members 缺 memberIds：WF_BAD_ARGS（不再静默清空全组成员）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), roleNode('a1'), groupNode('g1', ['a1']), stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'g1'), flowLine('l2', 'g1', 'e')],
    }))
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_group_members', groupId: 'g1' } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('memberIds')
  })
})

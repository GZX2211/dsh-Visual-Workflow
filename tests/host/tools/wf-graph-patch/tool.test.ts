// tests/host/tools/wf-graph-patch/tool.test.ts
//
// wf_graph_patch 工具单测：
//   - 图结构组：创建/删除（级联）/改数据/连线/断线/组一致性 → 检查器校验 + 落盘 revision；
//   - 参数层：未知 op 名拒绝（WF_BAD_ARGS）、空补丁拒绝；
//   - scope 与目标类型不匹配（WF_SCOPE_INVALID，按真实类型判定）；目标不存在（WF_ORG_NOT_FOUND）；
//   - revision 冲突不重试（WF_PATCH_CONFLICT）；
//   - 检查器阻断（WF_GRAPH_INVALID，错误文本含修复suggestion）；
//   - 元参数硬护栏恒生效 + 元参数组已下线（set_meta 被拒、来源参数不存在）；
//   - 已退役的 mark_node 按未知 op 拒绝（单组工具）；
//   - 虚拟节点引用校验；阶段节点属性锁定；坐标不入补丁（哨兵 {0,0}）；
//   - 工具注册面：参数与 output schema 必须与实际行为一致。
//
// 说明：所有用例的"补丁后图"都构造为通过图检查器的合法图（error 级阻断是预期行为之一，
// 故非法中间态不能出现在同一个补丁里——这正是"先建后连"需要拆两次提交的原因）。

import { describe, expect, it } from 'vitest'
import { executeGraphPatch, registerWfGraphPatch, type GraphPatchHost } from '../../../../src/host/tools/wf-graph-patch/tool.js'
import { WfError, type RunEntry } from '../../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import { OP_FIELD_SHAPES } from '../../../../src/host/prompts/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../../src/host/shared/protocol.js'
import type { GraphNode, Line, WorkflowDocument, WorkflowTemplate } from '../../../../src/host/shared/graph-model.js'
import type { RoleAssetDetail, WorkflowAssetDetail } from '../../../../src/host/shared/asset-types.js'

// ---------------------------------------------------------------------------
// fake 宿主（store + orchestrator）
// ---------------------------------------------------------------------------

interface FakeStoreState {
  workflows: Map<string, WorkflowDocument>
  templates: Map<string, WorkflowTemplate>
  services: Map<string, WorkflowDocument>
  /** 保存时模拟一次 revision 冲突。 */
  conflictOnce: boolean
  /** 工具组合 id 清单（presetId 存在性校验的数据源）。 */
  combos: string[]
  /** 官方 preset id 清单（best-effort 生态缝；空清单 = 枚举不可用，放弃判定）。 */
  presets: string[]
  /** 模型清单（provider/model/reasoning 存在性校验的数据源；空清单 = 枚举不可用，放弃判定）。 */
  models: Array<{ provider: string; model: string; efforts?: string[] }>
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
    async listToolCombos(): Promise<unknown[]> {
      return state.combos.map((id) => ({ id }))
    },
  }
}

/**
 * 角色引用取数样本：字段与目录清单的可用组合/模型配对保持一致，
 * 使「资产展开后的值仍走存在性校验」这条链路可以被真实覆盖。
 */
function roleAssetFixture(overrides: Partial<RoleAssetDetail> = {}): RoleAssetDetail {
  return {
    assetId: 'role-1',
    versionId: 3,
    rowId: 'rar-1',
    kind: 'agent',
    roleAssetType: 'standalone',
    name: '分析员',
    systemPrompt: '你是分析员',
    provider: 'commandcode',
    model: 'inclusionai/ling-3.0-flash-sante:free',
    reasoning: 'high',
    presetId: 'combo-1',
    retryLimit: 3,
    inputSchema: '上游结论',
    outputSchema: '分析报告路径',
    systemPromptSource: '分析员.md',
    referenceWorkflowIds: [],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 工作流资产样本：a1 为内联角色，roleVersionIds 指向 role-1（用于来源回溯）。 */
function workflowAssetFixture(overrides: Partial<WorkflowAssetDetail> = {}): WorkflowAssetDetail {
  return {
    assetId: 'flow-1',
    versionId: 2,
    rowId: 'war-2',
    mode: 'mode1',
    name: '评审流程',
    description: '',
    nodes: [
      { id: 's', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      {
        id: 'a1',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: {
          label: '流程内角色',
          systemPrompt: '你是流程内角色',
          presetId: 'combo-1',
          provider: 'commandcode',
          model: 'inclusionai/ling-3.0-flash-sante:free',
          reasoning: 'low',
          retryLimit: 3,
          inputSchema: '流程输入',
          outputSchema: '流程输出',
          sourceAssetId: 'role-1',
        },
      },
      {
        id: 'p1',
        kind: 'parent',
        position: { x: 0, y: 0 },
        data: {
          label: '父代理',
          systemPrompt: '父代理提示词',
          presetId: null,
          provider: '',
          model: '',
          retryLimit: 3,
        },
      },
      { id: 'e', kind: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } },
    ],
    lines: [],
    roleVersionIds: [{ nodeId: 'a1', roleVersionId: 'rar-1' }],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 当前运行实例样本：a1 有来源资产、a2 是无来源的内联角色。 */
function instanceFlowFixture(): WorkflowDocument {
  return {
    id: 'wf-live',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '在跑实例',
    description: '',
    revision: 7,
    nodes: [
      { id: 's', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      {
        id: 'a1',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: {
          label: '在跑角色',
          systemPrompt: '你是在跑角色',
          presetId: 'combo-1',
          provider: 'commandcode',
          model: 'inclusionai/ling-3.0-flash-sante:free',
          reasoning: 'max',
          inputSchema: '实例输入',
          outputSchema: '实例输出',
          retryLimit: 3,
          sourceAssetId: 'role-1',
        },
      },
      {
        id: 'a2',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: { label: '无来源角色', systemPrompt: '无来源提示词', presetId: 'combo-1', provider: '', model: '', retryLimit: 3 },
      },
      { id: 'e', kind: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } },
    ],
    lines: [],
  }
}

type GraphPatchHostOverrides = Omit<Partial<GraphPatchHost>, 'assets'> & {
  assets?: Partial<NonNullable<GraphPatchHost['assets']>>
}

function makeHost(overrides: GraphPatchHostOverrides = {}, state?: FakeStoreState) {
  const storeState: FakeStoreState = state ?? {
    workflows: new Map(),
    templates: new Map(),
    services: new Map(),
    conflictOnce: false,
    combos: ['combo-1'],
    presets: ['preset-1'],
    models: [
      { provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' },
      { provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' },
      { provider: 'deepseek-official', model: 'deepseek-flash', efforts: ['off', 'low', 'high', 'max'] },
    ],
  }
  const touched: string[] = []
  const refreshed: string[] = []
  const entries = new Map<string, RunEntry>()
  const roleAssets = new Map<string, RoleAssetDetail>([
    ['role-1', roleAssetFixture()],
    ['role-parent', roleAssetFixture({ assetId: 'role-parent', name: '父代理', kind: 'parent' })],
    ['role-retired', roleAssetFixture({ assetId: 'role-retired', retired: true })],
  ])
  const workflowAssets = new Map<string, WorkflowAssetDetail>([['flow-1', workflowAssetFixture()]])
  const defaultAssets = {
    async getRoleAsset(assetId: string): Promise<RoleAssetDetail | null> {
      return roleAssets.get(assetId) ?? null
    },
    async getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null> {
      return workflowAssets.get(assetId) ?? null
    },
    async getRoleAssetVersion(rowId: string): Promise<RoleAssetDetail | null> {
      return rowId === 'rar-1' ? roleAssets.get('role-1') ?? null : null
    },
  }
  const { assets: assetsOverride, ...restOverrides } = overrides
  const host: GraphPatchHost = {
    store: makeStore(storeState) as GraphPatchHost['store'],
    listPresets: async () => storeState.presets.map((id) => ({ id })),
    listModels: async () => storeState.models,
    assets: defaultAssets,
    getActiveRunFlow: async () => instanceFlowFixture(),
    orchestrator: {
      activeRunForSession: (sessionId: string) => entries.get(sessionId) ?? null,
      flowLockInfo: () => null,
      currentResolvedFlow: async (entry: RunEntry) => entry.baseFlow,
      touchRunForSession: (sessionId: string) => { touched.push(sessionId); return true },
      refreshActiveDefinitions: async (flowId: string) => { refreshed.push(flowId) },
    },
    ...restOverrides,
  }
  // overrides 中的 assets 只替换指定方法（保持其余默认缝可用），
  // 避免每条用例都要重复构造整套资产 fake。
  host.assets = { ...defaultAssets, ...(assetsOverride ?? {}) }
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

describe('wf_graph_patch · 图结构变更组', () => {
  it('create_node + connect + disconnect：落盘 revision 递增、编排基线刷新', async () => {
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
    // 合法 op 序列：新建节点后立即接回主流程，避免检查器因孤立节点阻断（本用例要断言的是工具落盘结果）
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.created).toEqual(['a2'])
    const saved = storeState.workflows.get('wf-1')
    const node = saved?.nodes.find((item) => item.id === 'a2') as GraphNode | undefined
    expect(node?.position).toEqual({ x: 0, y: 0 })
  })

  it('create_node：阶段节点 label 由系统锁定（忽略补丁传入值）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    // 先删旧启动节点再重建同名阶段节点：既覆盖 label 锁定，又保持「恰好一个启动节点」的结构合法
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'remove_node', nodeId: 's' },
        { op: 'create_node', node: { id: 's', kind: 'start', data: { label: '我自己起的名字' } } },
        { op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    })
    expect(result.ok).toBe(true)
    const saved = storeState.workflows.get('wf-1')
    const node = saved?.nodes.find((item) => item.id === 's') as { data?: { label?: string } } | undefined
    expect(node?.data?.label).toBe('启动')
  })

  it('create_node：a proxy node must reference an existing role node', async () => {
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
  it('create_node：角色节点 data 缺省字段被补全（presetId 归一为 null、retryLimit 补默认、注入开关固定关闭）', async () => {
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
      // 输出契约默认文本随创建落盘（与画布新建一致；空串 = 明确清空）
      outputSchema: DEFAULT_OUTPUT_CONTRACT_TEXT,
      injectSystemPrompt: false,
      injectToolSections: false,
      groupId: null,
    })
  })

  it('create_node：角色节点完全缺 data 也不崩（按空对象补全）', async () => {
    const { applyGraphOps } = await import('../../../../src/host/tools/wf-graph-patch/apply.js')
    const applied = applyGraphOps({
      doc: makeFlow('wf-1', { nodes: [stageNode('s', 'start')], lines: [] }),
      ops: [{ op: 'create_node', node: { id: 'a9', kind: 'agent' } }],
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

  it('remove_node：级联删除虚拟节点与其连线，并从 Team 成员清单移除', async () => {
    const { host, storeState } = makeHost()
    // 基线：s → a1 → g1 → e；a2/a3 为组内成员（无流程线，但组成员由 Team 卡片承载）
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
    // 说明：Team 卡片只有流程连接点、组内成员只有 ctx/db 连接点（§4.2.5.2 规则 4），
    // 故"把 a1/a2 入组"不会破坏结构校验。
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
  it('mark_node 已退役：按未知 op 拒绝（WF_BAD_ARGS），且磁盘零变更', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const before = JSON.stringify(storeState.workflows.get('wf-1'))
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'mark_node', nodeId: 'a1', status: 'ok' }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('mark_node')
    expect(JSON.stringify(storeState.workflows.get('wf-1'))).toBe(before)
  })

  it('未知 op 名拒绝（WF_BAD_ARGS，错误文本点名未知操作与允许的 op 组）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'move', nodeId: 'a1' }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('move')
    expect(error.message).toContain('create_node')
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
    const state: FakeStoreState = {
      workflows: new Map([['wf-1', makeFlow()]]),
      templates: new Map(),
      services: new Map(),
      conflictOnce: true,
      combos: ['combo-1'],
      presets: ['preset-1'],
      models: [{ provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' }],
    }
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
  it('检查器 error 阻断（新增孤立节点 → orphanNode），错误文本含修复suggestion', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: '孤儿', kind: 'agent', data: { label: '孤儿' } } }],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('orphanNode')
    expect(error.message).toContain('suggestion')
  })

  it('元参数硬护栏：超 nodeMax 的改图一律被拒，且磁盘零变更', async () => {
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
    expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
  })

  it('元参数组已下线：set_meta → WF_BAD_ARGS，且文档元参数零变更', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', { meta: { nodeMax: 3 } }))
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'set_meta', meta: { nodeMax: 99 } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('set_meta')
    expect(storeState.workflows.get('wf-1')?.meta).toEqual({ nodeMax: 3 })
  })
})

// ---------------------------------------------------------------------------
// 聚合失败项：一次列全 + nothing was persisted
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 聚合失败项', () => {
  it('一批多条同时写错：一次返回全部错误项（含各自错误码），且磁盘零变更', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'remove_node', nodeId: '不存在' },
        { op: 'connect', source: 'a1', target: '也不存在' },
        { op: 'connect', from: 'a1', to: 'e' },
      ],
    }), 'WF_GRAPH_INVALID')
    // 三条失败项一次列全，且每条带自己的稳定错误码
    expect(error.message).toContain('#1 remove_node [WF_GRAPH_INVALID]')
    expect(error.message).toContain('#2 connect [WF_GRAPH_INVALID]')
    expect(error.message).toContain('#3 connect [WF_BAD_ARGS]')
    expect(error.message).toContain('nothing was persisted')
    // 磁盘零变更：revision 未推进，也没有留下代理改动标注
    expect(storeState.workflows.get('wf-1')?.revision).toBe(3)
    expect(storeState.workflows.get('wf-1')).not.toHaveProperty('lastPatch')
  })

  it('全部为参数层错误时：批次级错误码为 WF_BAD_ARGS', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', kind: 'agent', data: { label: '少了一层 node 包装' } },
        { op: 'set_group_members', groupId: 'g1' },
      ],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('#1 create_node [WF_BAD_ARGS]')
    expect(error.message).toContain('#2 set_group_members [WF_BAD_ARGS]')
  })

  it('失败项不污染后续 op 的判定基础：前一条失败后，后一条仍按原文档判定', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    // 第 1 条想删掉不存在的节点，第 2 条再删一次同一节点：
    // 若失败项留下中间状态，第 2 条的报错会变成"节点不存在"之外的其它形状
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'remove_node', nodeId: '不存在的节点' },
        { op: 'remove_node', nodeId: '不存在的节点' },
      ],
    }), 'WF_GRAPH_INVALID')
    expect(error.message).toContain('#1 remove_node')
    expect(error.message).toContain('#2 remove_node')
  })
})

// ---------------------------------------------------------------------------
// presetId 存在性校验（只校验本批写入值）
// ---------------------------------------------------------------------------

describe('wf_graph_patch · presetId 存在性校验', () => {
  it('本批写入不存在的 presetId：聚合错误并列出可用 id', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', presetId: 'combo-typo' } } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('combo-typo')
    expect(error.message).toContain('combo-1')
    expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
  })

  it('presetId 取自官方 preset 清单：通过（两个来源都算合法）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', presetId: 'preset-1' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    const node = storeState.workflows.get('wf-1')?.nodes.find((item) => item.id === 'a2')
    expect((node?.data as { presetId?: string } | undefined)?.presetId).toBe('preset-1')
  })

  it('只校验本批写入值：节点上的历史脏 presetId 不阻断只改标签的补丁', async () => {
    const { host, storeState } = makeHost()
    const legacy = roleNode('a1', '旧节点')
    legacy.data = { ...legacy.data, presetId: 'legacy-bogus' } as typeof legacy.data
    storeState.workflows.set('wf-1', makeFlow('wf-1', { nodes: [stageNode('s', 'start'), legacy, stageNode('e', 'end')] }))
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '新标签' } }],
    })
    expect(result.ok).toBe(true)
    const node = storeState.workflows.get('wf-1')?.nodes.find((item) => item.id === 'a1')
    expect((node?.data as { presetId?: string; label?: string }).presetId).toBe('legacy-bogus')
    expect((node?.data as { label?: string }).label).toBe('新标签')
  })

  it('空 presetId 不是错误：只由检查器告警提示（保留"先建骨架、后配组合"的中间态）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '待配置', systemPrompt: '做点事' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.map((item) => item.code)).toContain('roleNodeNoPreset')
  })

  it('目录枚举为空（生态缝不可用）时放弃存在性判定，不误杀合法引用', async () => {
    const state: FakeStoreState = {
      workflows: new Map([['wf-1', makeFlow()]]),
      templates: new Map(),
      services: new Map(),
      conflictOnce: false,
      combos: [],
      presets: [],
      models: [{ provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' }],
    }
    const { host } = makeHost({}, state)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', presetId: 'preset-x' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// provider/model/reasoning 存在性校验（只校验本批写入值；模型清单是 best-effort 生态缝）
// ---------------------------------------------------------------------------
// 实机背景（2026.09）：清单里是 provider=commandcode / model=inclusionai/ling-3.0-flash-sante:free，
// 父代理把 model 的"组织/"前缀当成 provider，写进去的配对静默落盘；画布下拉只列清单内的值，
// 清单外的值在面板上退化成显示 (default)，表现为"工具传了、界面不回显"。

describe('wf_graph_patch · provider/model/reasoning 存在性校验', () => {
  /** 把 a1 的现值换成一组"历史脏"配对（用于验证只校验本批写入值）。 */
  function makeFlowWithNodeData(data: Record<string, unknown>): WorkflowDocument {
    const node = roleNode('a1', '旧节点')
    node.data = { ...node.data, ...data } as typeof node.data
    return makeFlow('wf-1', { nodes: [stageNode('s', 'start'), node, stageNode('e', 'end')] })
  }

  it('实机复现：provider 与 model 写反 → WF_BAD_ARGS，错误文本给出正确配对且磁盘零变更', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{
        op: 'update_node_data',
        nodeId: 'a1',
        data: { provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' },
      }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('provider "inclusionai" is not in the model catalog')
    expect(error.message).toContain('write provider="commandcode", model="inclusionai/ling-3.0-flash-sante:free"')
    // nothing was persisted：revision 未递增、节点现值未被改写
    const saved = storeState.workflows.get('wf-1')
    expect(saved?.revision).toBe(3)
    expect((saved?.nodes.find((node) => node.id === 'a1')?.data as { provider?: string } | undefined)?.provider).toBe('')
  })

  it('合法配对通过：model 里的"组织/"前缀原样保留', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{
        op: 'update_node_data',
        nodeId: 'a1',
        data: { provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' },
      }],
    })
    expect(result.ok).toBe(true)
    const data = storeState.workflows.get('wf-1')?.nodes.find((node) => node.id === 'a1')?.data as { provider?: string; model?: string }
    expect(data).toMatchObject({ provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' })
  })

  it('provider 合法但 model 不属于该 provider → 拒绝并列出该 provider 的可用模型', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { provider: 'commandcode', model: 'deepseek-flash' } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('is not in provider "commandcode" model catalog')
    expect(error.message).toContain('deepseek/deepseek-v4.1-flash')
  })

  it('create_node 通路同样校验：新建节点带清单外的 provider → 整批拒绝且不落盘', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析', provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('#1 create_node')
    expect(error.message).toContain('provider "inclusionai" is not in the model catalog')
    expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
  })

  it('与 presetId 校验同批聚合：一次列出全部取值错误（同一个 WF_BAD_ARGS 批次）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{
        op: 'update_node_data',
        nodeId: 'a1',
        data: { presetId: 'combo-typo', provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' },
      }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('presetId "combo-typo"')
    expect(error.message).toContain('provider "inclusionai" is not in the model catalog')
  })

  it('只校验本批写入值：节点上的历史脏配对不阻断只改标签的补丁', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlowWithNodeData({ provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' }))
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '新标签' } }],
    })
    expect(result.ok).toBe(true)
    const data = storeState.workflows.get('wf-1')?.nodes.find((node) => node.id === 'a1')?.data as { label?: string; provider?: string }
    expect(data).toMatchObject({ label: '新标签', provider: 'inclusionai' })
  })

  it('模型清单枚举为空时放弃判定，不误杀合法引用', async () => {
    const state: FakeStoreState = {
      workflows: new Map([['wf-1', makeFlow()]]),
      templates: new Map(),
      services: new Map(),
      conflictOnce: false,
      combos: ['combo-1'],
      presets: ['preset-1'],
      models: [],
    }
    const { host } = makeHost({}, state)
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' } }],
    })
    expect(result.ok).toBe(true)
  })

  it('模型清单缝整体缺失（未注入 listModels）时同样放弃判定', async () => {
    const { host, storeState } = makeHost({ listModels: undefined })
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' } }],
    })
    expect(result.ok).toBe(true)
  })

  it('reasoning：模型公布了档位时写入清单外档位被拒（错误文本列出可用档位）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlowWithNodeData({ provider: 'deepseek-official', model: 'deepseek-flash' }))
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { reasoning: 'medium' } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('reasoning "medium"')
    expect(error.message).toContain('available: off/low/high/max')
  })

  it('reasoning：模型未公布档位（实机 ling-3.0）时任意档位不判定，保留模型默认行为', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlowWithNodeData({ provider: 'commandcode', model: 'inclusionai/ling-3.0-flash-sante:free' }))
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { reasoning: 'medium' } }],
    })
    expect(result.ok).toBe(true)
    const data = storeState.workflows.get('wf-1')?.nodes.find((node) => node.id === 'a1')?.data as { reasoning?: string }
    expect(data.reasoning).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// 只读预算（两组返回体都带；元参数不可由补丁调整，父代理只能据此自查边界）
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 只读预算', () => {
  it('图结构组：budget 取补丁后的规模与生效元参数上限', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow('wf-1', { meta: { nodeMax: 5, groupMax: 2, patchOpsMax: 10 } }))
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
        { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'connect', source: 'a2', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    // 可执行节点 = agent/parent/group（阶段节点不计入）：补丁后为 a1 + a2
    expect(result.budget).toMatchObject({
      nodeUsed: 2,
      nodeMax: 5,
      nodeRemaining: 3,
      groupUsed: 0,
      groupMax: 2,
      groupRemaining: 2,
      patchOpsMax: 10,
      patchOpsRemaining: 6,
    })
  })

  it('图结构组：未声明的上限为 0，对应剩余量为 null（不限制）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '改名' } }],
    })
    expect(result.budget.nodeMax).toBe(0)
    expect(result.budget.nodeRemaining).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// create 通路：新建模板（用户裁决 2026.09；修正方案 §4.2 的自相矛盾）
// 规划期主用例"无模板 → 产出模板"必须可走通；create 只与 graph 组同用。
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
    expect(error.message).toContain('already exists')
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
// P4 代理补丁标注（lastPatch → 画布"AI 调整"角标）
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 代理补丁标注（lastPatch）', () => {
  it('图结构补丁在文档上留下 lastPatch（节点集 = 新增+修改）', async () => {
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
// 工具注册面：参数与 output schema 必须与执行层实际行为一致
// ---------------------------------------------------------------------------
// 宿主对工具返回体做 JSON Schema 校验（additionalProperties:false + properties 声明表）：
// 漏声明字段会被判为 "returned invalid output: value.x is not a declared property"，
// 一次**成功**的补丁在模型侧表现为错误；单元测试直调 executeGraphPatch 会绕过该校验，
// 故补注册面断言。已下线的能力（来源参数、元参数组）同样在此断言其不再出现在注册面，
// 防止被无意中重新引入。

describe('wf_graph_patch · 工具注册面回归', () => {
  interface SchemaLike {
    additionalProperties?: boolean
    properties?: Record<string, unknown>
  }

  interface CapturedDef {
    description?: string
    parameters?: { properties?: Record<string, unknown> }
    output?: { schema?: unknown }
  }

  /** 捕获注册面的工具定义（fake tools 服务）。 */
  function captureDef(host: GraphPatchHost): CapturedDef {
    const captured: CapturedDef[] = []
    const ctx = {
      get: () => ({
        register: (def: CapturedDef) => {
          captured.push(def)
          return () => {}
        },
      }),
    }
    registerWfGraphPatch(ctx, host)
    expect(captured).toHaveLength(1)
    return captured[0]
  }

  /** 返回注册面的 output.schema。 */
  function captureSchema(host: GraphPatchHost): SchemaLike {
    return captureDef(host).output?.schema as SchemaLike
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

  it('已下线能力不再出现在注册面：origin 参数、元参数 op 与输出 meta 均不存在', () => {
    const { host } = makeHost()
    const def = captureDef(host)
    const parameters = def.parameters?.properties ?? {}
    expect(parameters.origin).toBeUndefined()
    expect(String((parameters.ops as { description?: string })?.description ?? '')).not.toContain('set_meta')
    const declared = Object.keys((def.output?.schema as SchemaLike)?.properties ?? {})
    expect(declared).not.toContain('meta')
    // 闸门退役：标记组的输出字段一并从注册面移除
    expect(declared).not.toContain('marked')
    expect(declared).not.toContain('milestoneUsed')
  })

  it('描述已瘦身：op 字段形状不再常驻，改为指向 catalog rules 的契约指引', () => {
    const { host } = makeHost()
    const def = captureDef(host)
    const description = def.description ?? ''
    const ops = String((def.parameters?.properties?.ops as { description?: string })?.description ?? '')
    // 逐条 op 形状（含最易踩坑的 set_group_members / connect）不再写进常驻描述
    expect(description).not.toContain(OP_FIELD_SHAPES.set_group_members)
    expect(ops).not.toContain(OP_FIELD_SHAPES.set_group_members)
    expect(ops).not.toContain(OP_FIELD_SHAPES.connect)
    // 常驻描述不再复述提交规则/契约指针（字段形状由 ops 参数里的指引单点转达），
    // 描述只保留影响「是否/如何调用本工具」的内容
    expect(description).not.toContain('rules.patchContract')
    expect(description).not.toContain('submission rules')
    expect(ops).toContain('rules.patchContract')
    // 契约条款的复述句由 rules.patchContract 单点承载，常驻描述不再重复
    expect(description).not.toMatch(/ops are grouped/i)
    expect(description).not.toMatch(/atomic/i)
    // 图构成规则（start / 执行单元 / end）与「op 按数组顺序生效」同样由契约承载
    expect(description).not.toMatch(/start \+ executable units \+ end/)
    expect(ops).not.toMatch(/array order/i)
    // 闸门退役：常驻描述不再保留标记组的调用相位提示
    expect(description).not.toContain('mark group')
    expect(description).not.toContain('mark_node')
    // 起手可用的最小示例保留（漏写 node 包装 / 端点字段名是历史高频错因）
    expect(ops).toContain('"op": "connect"')
    expect(ops).toContain('"node"')
    // 角色引用是「只写流程与框架」的主入口：常驻描述必须给出字段名与三类 id
    expect(ops).toContain('roleAssetId')
    expect(ops).toContain('role-')
    expect(ops).toContain('flow-')
    expect(ops).toContain('instance#')
  })
})

// ---------------------------------------------------------------------------
// D 组：参数层契约守卫（2026-09 实机取证回归）
//
// 三起真实故障（模型侧全部表现为"报错指向图，但真因在入参形状"）：
//   1. connect 的端点字段猜成 from/to → 旧报错"源节点不存在"""（空字符串，无法定位）；
//   2. create_node 把 kind 平铺到 op 顶层（少了 node 包装）→ 旧报错"非法节点种类"""；
//   3. connect 省略 sourceHandle/targetHandle → 旧实现兜底成 ''，写出 isFlowLine()=false 的
//      幽灵线，检查器随后报"启动节点没有流程出线"（真因被完全掩盖）。
// 本组用例把"参数层 = WF_BAD_ARGS + 可自修正的错误文本"与"handle 缺省按流程通道补全"
// 两条契约钉死，防止再次回退。
// ---------------------------------------------------------------------------

describe('wf_graph_patch · 参数层契约守卫', () => {
  function taskNode(id: string): GraphNode {
    return { id, kind: 'task', position: { x: 0, y: 0 }, data: { label: id, content: '素材' } }
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

  it('connect 缺 source/target：WF_BAD_ARGS（不再误报成"源节点不存在"）', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const err = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'connect', source: 's' } as never],
    }), 'WF_BAD_ARGS')
    expect(err.message).toContain('source/target are required')
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
    expect(err.message).toContain('missing the node object')
    expect(err.message).toContain('written directly on the op')
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
      nodes: [stageNode('s', 'start'), roleNode('a1'), taskNode('f1'), stageNode('e', 'end')],
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

  it('批次级聚合码与契约一致：全参数层错 → WF_BAD_ARGS；含任一条图语义错 → WF_GRAPH_INVALID', async () => {
    // 契约 ERROR_CODE_SEMANTICS 写明的取码规则与实现 throwPatchErrors 的聚合行为同源；
    // 本用例锁定实现侧口径（预设 id 不存在属参数层，未知节点种类属图语义层）。
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())

    await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { presetId: 'combo-does-not-exist' } } as never],
    }), 'WF_BAD_ARGS')

    const mixed = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'update_node_data', nodeId: 'a1', data: { presetId: 'combo-does-not-exist' } },
        { op: 'create_node', node: { kind: 'not-a-kind', id: 'bad-1' } },
      ] as never,
    }), 'WF_GRAPH_INVALID')
    expect(mixed.message).toContain('WF_BAD_ARGS') // 每条失败仍带自己的码
  })

  it('画布字段的提交后果不变：update 剥离传入值并保留节点现值（G1 只删提示文本）', async () => {
    // G1 只删契约提示文本，不改变校验与剥离行为（PARENT_UNCONFIGURABLE_ROLE_FIELDS 语义冻结）；
    // 单元级剥离行为由 apply.test.ts 覆盖，此处锁定工具全路径仍不把画布字段写进画布。
    const { host, storeState } = makeHost()
    storeState.templates.set('tpl-canvas-1', {
      id: 'tpl-canvas-1',
      name: '画布字段探针',
      mode: 'mode1',
      revision: 0,
      nodes: [stageNode('s', 'start'), roleNode('a1'), stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    } as never)

    const nodeOf = (id: string) => (storeState.templates.get('tpl-canvas-1') as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.find((node) => node.id === id)!
    const before = { ...nodeOf('a1').data }

    // update：传入画布字段被剥离，节点现值一律不被覆盖
    await executeGraphPatch(host, 'session-1', {
      scope: 'template',
      targetId: 'tpl-canvas-1',
      ops: [{
        op: 'update_node_data',
        nodeId: 'a1',
        data: { label: '改后标签', retryLimit: 9, promptFilePath: 'D:/x.md', injectSystemPrompt: false, injectToolSections: true, sourceAssetId: 'asset-x' },
      }] as never,
    })
    const after = nodeOf('a1').data
    expect(after.label).toBe('改后标签')
    // 补丁传入值与现值可区分，故「保持现值」可证剥离确实生效
    expect(before.retryLimit).not.toBe(9)
    expect(after.retryLimit).toBe(before.retryLimit)
    expect(after.reactLimit).toBe(before.reactLimit)
    // 现值缺失的两个开关：归一化后回到系统默认，而非补丁想要的值
    expect(after.injectSystemPrompt).toBe(true)
    expect(after.injectToolSections).toBe(true)
    // 节点现值没有的键不得被补丁创建出来
    expect(after).not.toHaveProperty('promptFilePath')
    expect(after).not.toHaveProperty('sourceAssetId')
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

describe('wf_graph_patch：任务节点写入归一化', () => {
  it('写任务节点：只落 label/content，旧受管字段被丢弃且不再产生归一化 warning', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-task1' })
    const ops = [
      { op: 'create_node', node: { id: 's', kind: 'start', data: { label: stageLabel('start', 'mode1') } } },
      { op: 'create_node', node: { id: 'a1', kind: 'agent', data: { label: '执行', systemPrompt: 'x', presetId: 'combo-1', retryLimit: 3, provider: '', model: '' } } },
      { op: 'create_node', node: { id: 'f1', kind: 'task', data: { label: '交付任务', content: '任务正文', fileKind: 'file', managedPath: 'data/files/x.md' } } },
      { op: 'create_node', node: { id: 'e', kind: 'end', data: { label: stageLabel('end', 'mode1') } } },
      { op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'f1', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    ]

    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '任务节点模板' }, ops,
    })

    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.code === 'fileNodeTextOnly')).toBe(false)
    const saved = storeState.templates.get('tpl-task1') as { nodes: Array<{ id: string; kind: string; data: Record<string, unknown> }> }
    const task = saved.nodes.find((node) => node.id === 'f1')
    expect(task?.kind).toBe('task')
    expect(task?.data).toEqual({ label: '交付任务', content: '任务正文' })
  })

  it('旧 kind=file 输入：读取兼容归一化为任务节点', async () => {
    const { host, storeState } = makeHost({ newTemplateId: () => 'tpl-task2' })
    const ops = [
      { op: 'create_node', node: { id: 's', kind: 'start', data: { label: stageLabel('start', 'mode1') } } },
      { op: 'create_node', node: { id: 'a1', kind: 'agent', data: { label: '执行', systemPrompt: 'x', presetId: 'combo-1', retryLimit: 3, provider: '', model: '' } } },
      { op: 'create_node', node: { id: 'f1', kind: 'file', data: { label: '旧任务', content: '正文', fileKind: 'file', managedPath: 'data/files/x.md' } } },
      { op: 'create_node', node: { id: 'e', kind: 'end', data: { label: stageLabel('end', 'mode1') } } },
      { op: 'connect', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { op: 'connect', source: 'f1', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    ]

    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'template', create: { name: '旧输入兼容' }, ops,
    })

    expect(result.ok).toBe(true)
    const saved = storeState.templates.get('tpl-task2') as { nodes: Array<{ id: string; kind: string; data: Record<string, unknown> }> }
    const task = saved.nodes.find((node) => node.id === 'f1')
    expect(task?.kind).toBe('task')
    expect(task?.data).toEqual({ label: '旧任务', content: '正文' })
  })
})

// ---------------------------------------------------------------------------
// 角色引用（data.roleAssetId）：写图只写流程与框架，角色配置按 ID 复用
// ---------------------------------------------------------------------------
// 语义（用户裁决 2026-10）：
//   - 支持 role-*（角色资产 Active 版本）、flow-*#<节点>（工作流资产内联角色固定版本）、
//     instance#<节点>（当前运行实例的内联角色）；
//   - 展开后的配置仍走既有的 presetId / provider / model 存在性校验；
//   - 显式 data 字段覆盖带入值；update 以资产为基线整体重置，再叠加显式字段；
//   - 来源写入 data.sourceAssetId（内联角色无来源时 update 清除旧绑定）；
//   - 引用失败按参数层错误聚合，整批不落盘。

describe('wf_graph_patch · 角色引用（data.roleAssetId）', () => {
  function dataOf(storeState: FakeStoreState, id: string): Record<string, unknown> {
    const node = storeState.workflows.get('wf-1')?.nodes.find((item) => item.id === id)
    return (node?.data ?? {}) as Record<string, unknown>
  }

  it('create_node：role-* 展开为完整角色配置并写入来源资产', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'role-1' } } },
        { op: 'connect', source: 'a1', target: 'a2' },
        { op: 'connect', source: 'a2', target: 'e' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    const data = dataOf(storeState, 'a2')
    expect(data).toMatchObject({
      label: '分析员',
      systemPrompt: '你是分析员',
      presetId: 'combo-1',
      provider: 'commandcode',
      model: 'inclusionai/ling-3.0-flash-sante:free',
      reasoning: 'high',
      inputSchema: '上游结论',
      outputSchema: '分析报告路径',
      sourceAssetId: 'role-1',
    })
    // 引用字段只作为入参，不落盘；画布字段仍由系统默认接管
    expect('roleAssetId' in data).toBe(false)
    expect(data.retryLimit).toBe(3)
    expect(data.injectSystemPrompt).toBe(false)
  })

  it('create_node：显式 data 覆盖资产值，未覆盖字段继续来自资产', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        {
          op: 'create_node',
          node: {
            id: 'a2',
            kind: 'agent',
            data: {
              roleAssetId: 'role-1',
              label: '自定义名称',
              systemPrompt: '覆盖后的提示词',
              provider: 'deepseek-official',
              model: 'deepseek-flash',
              reasoning: 'low',
            },
          },
        },
        { op: 'connect', source: 'a1', target: 'a2' },
        { op: 'connect', source: 'a2', target: 'e' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(result.ok).toBe(true)
    const data = dataOf(storeState, 'a2')
    expect(data).toMatchObject({
      label: '自定义名称',
      systemPrompt: '覆盖后的提示词',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoning: 'low',
      // 未覆盖的字段仍来自资产
      presetId: 'combo-1',
      inputSchema: '上游结论',
      outputSchema: '分析报告路径',
      sourceAssetId: 'role-1',
    })
  })

  it('update_node_data：以资产为基线整体重置，再叠加显式 data；画布字段保留现值', async () => {
    const { host, storeState } = makeHost()
    const before = roleNode('a1', '旧名')
    before.data = { ...before.data, retryLimit: 7, reactLimit: 11, systemPrompt: '旧提示词', presetId: null } as typeof before.data
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), before, stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    }))
    const result = await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { roleAssetId: 'role-1', label: '新名' } }],
    })
    expect(result.ok).toBe(true)
    const data = dataOf(storeState, 'a1')
    expect(data).toMatchObject({
      label: '新名',
      systemPrompt: '你是分析员',
      presetId: 'combo-1',
      provider: 'commandcode',
      model: 'inclusionai/ling-3.0-flash-sante:free',
      reasoning: 'high',
      inputSchema: '上游结论',
      outputSchema: '分析报告路径',
      sourceAssetId: 'role-1',
    })
    // 画布字段不在资产引用面内：保留节点现值
    expect(data.retryLimit).toBe(7)
    expect(data.reactLimit).toBe(11)
  })

  it('flow-*#node：工作流资产内联角色按固定版本展开，来源回溯到角色资产', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'flow-1#a1' } } },
        { op: 'connect', source: 'a1', target: 'a2' },
        { op: 'connect', source: 'a2', target: 'e' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(dataOf(storeState, 'a2')).toMatchObject({
      label: '流程内角色',
      systemPrompt: '你是流程内角色',
      presetId: 'combo-1',
      provider: 'commandcode',
      model: 'inclusionai/ling-3.0-flash-sante:free',
      reasoning: 'low',
      inputSchema: '流程输入',
      outputSchema: '流程输出',
      sourceAssetId: 'role-1',
    })
  })

  it('instance#node：运行实例内联角色复用，写入节点现有来源资产', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'instance#a1' } } },
        { op: 'connect', source: 'a1', target: 'a2' },
        { op: 'connect', source: 'a2', target: 'e' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect(dataOf(storeState, 'a2')).toMatchObject({
      label: '在跑角色',
      systemPrompt: '你是在跑角色',
      presetId: 'combo-1',
      reasoning: 'max',
      inputSchema: '实例输入',
      outputSchema: '实例输出',
      sourceAssetId: 'role-1',
    })
  })

  it('instance#node：无来源的内联角色在 update 时清除节点旧来源绑定', async () => {
    const { host, storeState } = makeHost()
    const before = roleNode('a1', '旧名')
    before.data = { ...before.data, sourceAssetId: 'role-1' } as typeof before.data
    storeState.workflows.set('wf-1', makeFlow('wf-1', {
      nodes: [stageNode('s', 'start'), before, stageNode('e', 'end')],
      lines: [flowLine('l1', 's', 'a1'), flowLine('l2', 'a1', 'e')],
    }))
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { roleAssetId: 'instance#a2' } }],
    })
    const data = dataOf(storeState, 'a1')
    expect(data.label).toBe('无来源角色')
    expect(data.systemPrompt).toBe('无来源提示词')
    expect('sourceAssetId' in data).toBe(false)
  })

  it('引用失败：不存在 / 父代理 / 已归档 / 非法形状均单条报错并整批拒绝', async () => {
    const cases: Array<{ roleAssetId: string; contains: string }> = [
      { roleAssetId: 'role-missing', contains: 'role-missing' },
      { roleAssetId: 'role-parent', contains: 'parent' },
      { roleAssetId: 'role-retired', contains: 'retired' },
      { roleAssetId: 'flow-1', contains: 'role references only' },
      { roleAssetId: 'flow-1#p1', contains: 'parent' },
      { roleAssetId: 'flow-1#missing', contains: 'missing' },
      { roleAssetId: 'instance#missing', contains: 'missing' },
    ]
    for (const item of cases) {
      const { host, storeState } = makeHost()
      storeState.workflows.set('wf-1', makeFlow())
      const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
        scope: 'instance',
        targetId: 'wf-1',
        ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: item.roleAssetId } } }],
      }), 'WF_BAD_ARGS')
      expect(error.message).toContain(item.contains)
      // 整批不落盘
      expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
    }
  })

  it('引用失败：无活跃实例时 instance#node 报可行动错误', async () => {
    const { host, storeState } = makeHost({ getActiveRunFlow: async () => null })
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'instance#a1' } } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('no instance')
  })

  it('引用展开后的配置仍走存在性校验：资产里的失效 presetId 整批拒绝', async () => {
    const { host, storeState } = makeHost({
      assets: {
        async getRoleAsset() {
          return roleAssetFixture({ presetId: 'combo-missing' })
        },
      },
    })
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'role-1' } } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('combo-missing')
    expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
  })

  it('引用展开后的配置仍走存在性校验：资产里的失效 provider 整批拒绝', async () => {
    const { host, storeState } = makeHost({
      assets: {
        async getRoleAsset() {
          return roleAssetFixture({ provider: 'bad-provider' })
        },
      },
    })
    storeState.workflows.set('wf-1', makeFlow())
    const error = await expectWfError(() => executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'role-1' } } }],
    }), 'WF_BAD_ARGS')
    expect(error.message).toContain('bad-provider')
    expect(storeState.workflows.get('wf-1')?.nodes.map((node) => node.id)).toEqual(['s', 'a1', 'e'])
  })

  it('资产库取数失败向上抛出，不伪装成参数错误', async () => {
    const { host, storeState } = makeHost({
      assets: {
        async getRoleAsset() {
          throw new Error('assets down')
        },
      },
    })
    storeState.workflows.set('wf-1', makeFlow())
    await expect(executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { roleAssetId: 'role-1' } } }],
    })).rejects.toThrow('assets down')
  })

  it('模型伪造内部来源字段：入口剥离，不写 data.sourceAssetId', async () => {
    const { host, storeState } = makeHost()
    storeState.workflows.set('wf-1', makeFlow())
    await executeGraphPatch(host, 'session-1', {
      scope: 'instance',
      targetId: 'wf-1',
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '手写角色' } }, __roleSourceAssetId: 'role-evil' } as never,
        { op: 'connect', source: 'a1', target: 'a2' },
        { op: 'connect', source: 'a2', target: 'e' },
        { op: 'disconnect', lineId: 'l2' },
      ],
    })
    expect('sourceAssetId' in dataOf(storeState, 'a2')).toBe(false)
  })
})

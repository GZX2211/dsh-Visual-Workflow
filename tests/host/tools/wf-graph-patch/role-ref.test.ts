// tests/host/tools/wf-graph-patch/role-ref.test.ts
//
// 角色引用展开层（role-ref.ts）单测：
//   - 三类 id：role-* / flow-*#<node> / instance#<node> 的取数与字段映射；
//   - 显式 data 覆盖资产值；引用字段 roleAssetId 不落盘；
//   - 来源资产回溯（roleVersionIds → 角色资产 id，回退节点 data.sourceAssetId）；
//   - 单条引用失败只记错误与跳过索引，不阻塞同批其余引用；
//   - 取数去重（同批同一资产只读一次）；资产库抛错向上抛（不伪装成参数错误）。

import { describe, expect, it } from 'vitest'
import { expandRoleRefs, type RoleRefHost } from '../../../../src/host/tools/wf-graph-patch/role-ref.js'
import type { RoleAssetDetail, WorkflowAssetDetail } from '../../../../src/host/shared/asset-types.js'
import type { GraphPatchOp } from '../../../../src/host/tools/wf-graph-patch/types.js'
import type { WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 样本
// ---------------------------------------------------------------------------

function roleAssetFixture(overrides: Partial<RoleAssetDetail> = {}): RoleAssetDetail {
  return {
    assetId: 'role-1',
    versionId: 3,
    rowId: 'rar-1',
    kind: 'agent',
    roleAssetType: 'standalone',
    name: '分析员',
    systemPrompt: '你是分析员',
    provider: 'provider-a',
    model: 'model-a',
    reasoning: 'high',
    presetId: 'combo-1',
    retryLimit: 3,
    inputSchema: '上游结论',
    outputSchema: '分析报告',
    referenceWorkflowIds: [],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function workflowAssetFixture(overrides: Partial<WorkflowAssetDetail> = {}): WorkflowAssetDetail {
  return {
    assetId: 'flow-1',
    versionId: 2,
    rowId: 'war-2',
    mode: 'mode1',
    name: '评审流程',
    description: '',
    nodes: [
      {
        id: 'a1',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: {
          label: '流程内角色',
          systemPrompt: '你是流程内角色',
          presetId: 'combo-1',
          provider: 'provider-a',
          model: 'model-a',
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
    ],
    lines: [],
    roleVersionIds: [{ nodeId: 'a1', roleVersionId: 'rar-1' }],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function instanceFlowFixture(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: 'wf-live',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '在跑实例',
    description: '',
    revision: 1,
    nodes: [
      {
        id: 'a1',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: {
          label: '实例角色',
          systemPrompt: '你是实例角色',
          presetId: 'combo-1',
          provider: 'provider-a',
          model: 'model-a',
          retryLimit: 3,
          sourceAssetId: 'role-1',
        },
      },
      {
        id: 'a2',
        kind: 'agent',
        position: { x: 0, y: 0 },
        data: { label: '无来源角色', systemPrompt: '无来源', presetId: 'combo-1', provider: '', model: '', retryLimit: 3 },
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
    ],
    lines: [],
    ...overrides,
  }
}

interface Calls {
  roleReads: string[]
  workflowReads: string[]
  roleVersionReads: string[]
  activeRunFlows: string[]
}

type RoleRefHostOverrides = Omit<Partial<RoleRefHost>, 'assets'> & {
  assets?: Partial<NonNullable<RoleRefHost['assets']>>
}

function makeRoleRefHost(overrides: RoleRefHostOverrides = {}): { host: RoleRefHost; calls: Calls } {
  const calls: Calls = { roleReads: [], workflowReads: [], roleVersionReads: [], activeRunFlows: [] }
  const defaults: RoleRefHost = {
    assets: {
      async getRoleAsset(assetId: string) {
        calls.roleReads.push(assetId)
        if (assetId === 'role-1') return roleAssetFixture()
        if (assetId === 'role-parent') return roleAssetFixture({ assetId: 'role-parent', kind: 'parent' })
        if (assetId === 'role-retired') return roleAssetFixture({ assetId: 'role-retired', retired: true })
        return null
      },
      async getWorkflowAsset(assetId: string) {
        calls.workflowReads.push(assetId)
        return assetId === 'flow-1' ? workflowAssetFixture() : null
      },
      async getRoleAssetVersion(rowId: string) {
        calls.roleVersionReads.push(rowId)
        return rowId === 'rar-1' ? roleAssetFixture() : null
      },
    },
    async getActiveRunFlow(sessionId: string) {
      calls.activeRunFlows.push(sessionId)
      return instanceFlowFixture()
    },
  }
  const { assets: assetsOverride, ...restOverrides } = overrides
  const host: RoleRefHost = { ...defaults, ...restOverrides }
  // overrides.assets 只替换指定方法；显式传 undefined 表示「宿主没有资产缝」。
  if (assetsOverride) {
    host.assets = { ...defaults.assets, ...assetsOverride } as NonNullable<RoleRefHost['assets']>
  } else if ('assets' in overrides) {
    host.assets = undefined
  } else {
    host.assets = defaults.assets
  }
  return { host, calls }
}

function createOp(roleAssetId: string, data: Record<string, unknown> = {}): GraphPatchOp {
  return { op: 'create_node', node: { id: 'n1', kind: 'agent', data: { roleAssetId, ...data } } }
}

/** 取展开后 create_node 的 data。 */
function expandedDataOf(ops: GraphPatchOp[], index = 0): Record<string, unknown> {
  const op = ops[index] as unknown as { node: { data: Record<string, unknown> } }
  return op.node.data
}

/** 取展开后 op 顶层注入的来源资产字段。 */
function sourceAssetIdOf(ops: GraphPatchOp[], index = 0): string {
  return String((ops[index] as unknown as Record<string, unknown>).__roleSourceAssetId ?? '')
}

// ---------------------------------------------------------------------------
// 正常展开
// ---------------------------------------------------------------------------

describe('expandRoleRefs · 正常展开', () => {
  it('role-*：展开完整角色配置并注入来源资产；引用字段不落盘', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-1')], 'session-1')
    expect(out.errors).toEqual([])
    expect(out.skipped.size).toBe(0)
    expect(expandedDataOf(out.ops)).toMatchObject({
      label: '分析员',
      systemPrompt: '你是分析员',
      presetId: 'combo-1',
      provider: 'provider-a',
      model: 'model-a',
      reasoning: 'high',
      inputSchema: '上游结论',
      outputSchema: '分析报告',
    })
    expect('roleAssetId' in expandedDataOf(out.ops)).toBe(false)
    expect(sourceAssetIdOf(out.ops)).toBe('role-1')
  })

  it('显式 data 覆盖资产值；未覆盖字段继续来自资产', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-1', { label: '自定义', presetId: 'preset-1' })], 'session-1')
    expect(expandedDataOf(out.ops)).toMatchObject({
      label: '自定义',
      presetId: 'preset-1',
      systemPrompt: '你是分析员',
      provider: 'provider-a',
    })
  })

  it('flow-*#node：内联角色按固定版本展开，来源优先走 roleVersionIds 回溯', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('flow-1#a1')], 'session-1')
    expect(out.errors).toEqual([])
    expect(expandedDataOf(out.ops)).toMatchObject({
      label: '流程内角色',
      systemPrompt: '你是流程内角色',
      reasoning: 'low',
      inputSchema: '流程输入',
      outputSchema: '流程输出',
    })
    expect(sourceAssetIdOf(out.ops)).toBe('role-1')
  })

  it('instance#node：展开运行实例内联角色；无来源时来源字段为空串', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('instance#a2')], 'session-1')
    expect(out.errors).toEqual([])
    expect(expandedDataOf(out.ops)).toMatchObject({
      label: '无来源角色',
      systemPrompt: '无来源',
      presetId: 'combo-1',
    })
    expect(sourceAssetIdOf(out.ops)).toBe('')
  })

  it('update_node_data：同样展开并保留 op 形状', async () => {
    const { host } = makeRoleRefHost()
    const op: GraphPatchOp = { op: 'update_node_data', nodeId: 'n1', data: { roleAssetId: 'role-1', label: '改名' } }
    const out = await expandRoleRefs(host, [op], 'session-1')
    expect(out.errors).toEqual([])
    const data = (out.ops[0] as unknown as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ label: '改名', systemPrompt: '你是分析员', presetId: 'combo-1' })
    expect('roleAssetId' in data).toBe(false)
    expect(sourceAssetIdOf(out.ops)).toBe('role-1')
  })

  it('同批重复引用同一资产只读一次（批内缓存）', async () => {
    const { host, calls } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-1'), createOp('role-1')], 'session-1')
    expect(out.errors).toEqual([])
    expect(calls.roleReads).toEqual(['role-1'])
  })
})

// ---------------------------------------------------------------------------
// 引用失败
// ---------------------------------------------------------------------------

describe('expandRoleRefs · 引用失败', () => {
  it('不存在的角色资产：单条错误 + 跳过该索引，同批其余引用正常展开', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-missing'), createOp('role-1')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0]).toMatchObject({ index: 0, op: 'create_node', code: 'WF_BAD_ARGS' })
    expect(out.errors[0].message).toContain('role-missing')
    expect(out.skipped).toEqual(new Set([0]))
    expect(expandedDataOf(out.ops, 1)).toMatchObject({ label: '分析员' })
  })

  it('父代理提示词不可召回：role-* 与内联节点都拒绝', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-parent'), createOp('flow-1#p1'), createOp('instance#p1')], 'session-1')
    expect(out.errors).toHaveLength(3)
    expect(out.errors.every((item) => item.code === 'WF_BAD_ARGS')).toBe(true)
    expect(out.errors.every((item) => item.message.includes('parent'))).toBe(true)
  })

  it('已归档角色资产：拒绝并提示 retired', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('role-retired')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('retired')
  })

  it('整图资产 id（无 # 节点）不属于角色引用：拒绝并说明支持范围', async () => {
    const { host } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('flow-1')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('role references only')
  })

  it('无活跃实例：instance#node 报可行动错误', async () => {
    const { host } = makeRoleRefHost({ getActiveRunFlow: async () => null })
    const out = await expandRoleRefs(host, [createOp('instance#a1')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('no instance')
  })

  it('宿主未提供运行实例缝：instance#node 报可行动错误', async () => {
    const { host } = makeRoleRefHost({ getActiveRunFlow: undefined })
    const out = await expandRoleRefs(host, [createOp('instance#a1')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('active-run seam')
  })

  it('工作流资产内联角色：版本回溯缝缺失时回退节点 data.sourceAssetId', async () => {
    const { host, calls } = makeRoleRefHost({
      assets: { getRoleAssetVersion: undefined },
    })
    const out = await expandRoleRefs(host, [createOp('flow-1#a1')], 'session-1')
    expect(out.errors).toEqual([])
    expect(sourceAssetIdOf(out.ops)).toBe('role-1')
    expect(calls.roleVersionReads).toEqual([])
  })

  it('宿主未提供资产缝：引用失败而不是静默忽略', async () => {
    const { host } = makeRoleRefHost({ assets: undefined })
    const out = await expandRoleRefs(host, [createOp('role-1')], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('assets')
  })

  it('资产库取数抛错：向上抛，不收集为参数错误', async () => {
    const { host } = makeRoleRefHost({
      assets: {
        async getRoleAsset() {
          throw new Error('assets down')
        },
      },
    })
    await expect(expandRoleRefs(host, [createOp('role-1')], 'session-1')).rejects.toThrow('assets down')
  })

  it('roleAssetId 非字符串：参数层错误，不触发资产取数', async () => {
    const { host, calls } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [{
      op: 'create_node',
      node: { id: 'n1', kind: 'agent', data: { roleAssetId: 123 } },
    } as never], 'session-1')
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].message).toContain('must be a string')
    expect(calls.roleReads).toEqual([])
  })

  it('空白 roleAssetId：不视为引用，并清理空字段避免落盘', async () => {
    const { host, calls } = makeRoleRefHost()
    const out = await expandRoleRefs(host, [createOp('   ')], 'session-1')
    expect(out.errors).toEqual([])
    expect('roleAssetId' in expandedDataOf(out.ops)).toBe(false)
    expect(calls.roleReads).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 无引用
// ---------------------------------------------------------------------------

describe('expandRoleRefs · 无引用', () => {
  it('没有 roleAssetId 的 op 原样通过，且不触发任何资产取数', async () => {
    const { host, calls } = makeRoleRefHost()
    const op: GraphPatchOp = { op: 'create_node', node: { id: 'n1', kind: 'agent', data: { label: '手写角色' } } }
    const out = await expandRoleRefs(host, [op], 'session-1')
    expect(out.errors).toEqual([])
    expect(out.skipped.size).toBe(0)
    expect(expandedDataOf(out.ops)).toEqual({ label: '手写角色' })
    expect(calls.roleReads).toEqual([])
    expect(calls.workflowReads).toEqual([])
    expect(calls.activeRunFlows).toEqual([])
  })
})

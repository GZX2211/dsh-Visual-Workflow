// tests/host/tools/wf-org-catalog/tool.test.ts
//
// wf_org_catalog 执行层单测（两次调用模型）：
//   - 分派：不传 ids（含空数组 / 空串 / 空白项）→ 资产索引；传 ids → 批量详情；
//   - 三类详情：flow-* 骨架（含角色节点的固定引用版本）、role-* 完整 systemPrompt、
//     <flow-id>#<node-id> 内联角色；
//   - 经验已彻底移出本工具：索引段没有 experiences，ex-* 不再是可识别 id；
//   - 参数层错误：ids 非数组、超单次上限 → WF_BAD_ARGS；
//   - 容错：坏 id / 不存在 / 已退役 / 单条读失败都只单条报错，不阻塞同批其余；
//   - 效率与确定性：批内去重、同一资产只读一次、两次同输入结果一致；
//   - 注册面：仅父代理可调（子代理 WF_NOT_ROOT）、无法识别会话 WF_BAD_CALLER、
//     tools 服务不可用时注册失败必须显式。

import { describe, expect, it } from 'vitest'
import { executeOrgCatalog, registerWfOrgCatalog } from '../../../../src/host/tools/wf-org-catalog/tool.js'
import { listEcosystemModels } from '../../../../src/host/ecosystem-directory.js'
import { CATALOG_LIMITS } from '../../../../src/host/tools/wf-org-catalog/types.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { makeCatalogHost } from './fixtures.js'
import type { CatalogDetails, CatalogIndex, CatalogRoleNodeEntry, CatalogWorkflowDetail } from '../../../../src/host/tools/wf-org-catalog/types.js'
import type { ToolDefinitionLike } from '../../../../src/host/tools/infrastructure/define-tool.js'

/** 工具注册用的最小 ctx fake（把注册到的定义收集起来）。 */
function registerFixture(): { ctx: { get(name: string): unknown }; registered: Array<ToolDefinitionLike> } {
  const registered: Array<ToolDefinitionLike> = []
  const ctx = {
    get(name: string): unknown {
      if (name !== 'tools') return undefined
      return { register: (def: ToolDefinitionLike) => { registered.push(def); return () => {} } }
    },
  }
  return { ctx, registered }
}

/** 工具执行上下文 fake（callerOf 只读 agent.session.header 与 agent.id）。 */
function execOf(agent: unknown): { signal: AbortSignal; agent: unknown } {
  return { signal: new AbortController().signal, agent }
}

/** 取详情返回体里某个工作流骨架的角色节点（测试专用窄化）。 */
function roleNodeOf(details: CatalogDetails, containerIndex: number, nodeId: string): CatalogRoleNodeEntry {
  const skeleton = details.assets[containerIndex] as CatalogWorkflowDetail
  return skeleton.nodes.find(
    (node): node is CatalogRoleNodeEntry => node.id === nodeId && (node.kind === 'agent' || node.kind === 'parent'),
  )!
}

describe('executeOrgCatalog：索引 / 详情分派', () => {
  it('不传 ids → 资产索引（不含 experiences 段）', async () => {
    const { host, calls } = makeCatalogHost()
    const out = await executeOrgCatalog(host, {}) as CatalogIndex
    expect(out.kind).toBe('index')
    expect(out.combos[0].id).toBe('combo-1')
    expect(out.assets.workflows[0].id).toBe('flow-1')
    expect(out.assets.roles[0].id).toBe('role-1')
    expect(Object.hasOwn(out, 'experiences')).toBe(false)
    expect(calls.workflowLists).toBe(1)
    expect(calls.roleLists).toBe(1)
  })

  it('空数组 / 空串 / 全空白项 → 资产索引（不是错误）', async () => {
    const { host } = makeCatalogHost()
    expect((await executeOrgCatalog(host, { ids: [] })).kind).toBe('index')
    expect((await executeOrgCatalog(host, { ids: '' })).kind).toBe('index')
    expect((await executeOrgCatalog(host, { ids: ['', '   '] })).kind).toBe('index')
  })

  it('传工作流资产 id → 自足骨架（含固定引用的角色资产与版本）', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['flow-1'] }) as CatalogDetails
    expect(out.kind).toBe('details')
    expect(out.errors).toEqual([])
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({ type: 'workflow', id: 'flow-1', assetId: 'flow-1', versionId: 2, name: '评审流程' })
    expect(out.assets[0]).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ id: 'a1', roleAssetId: 'role-1', roleVersionId: 3 })]) })
  })

  it('传角色资产 id → 完整 systemPrompt（不截断）与资产类型', async () => {
    const long = '角'.repeat(6000)
    const { host } = makeCatalogHost()
    const patched = makeCatalogHost({
      assets: {
        ...host.assets,
        async getRoleAsset() {
          return { ...(await host.assets.getRoleAsset('role-1'))!, systemPrompt: long, roleAssetType: 'shared' }
        },
      },
    }).host
    const out = await executeOrgCatalog(patched, { ids: ['role-1'] }) as CatalogDetails
    const asset = out.assets[0]
    expect(asset.type).toBe('role')
    expect(asset).toMatchObject({ id: 'role-1', assetId: 'role-1', versionId: 3, roleAssetType: 'shared' })
    expect((asset as { systemPrompt: string }).systemPrompt).toHaveLength(6000)
  })

  it('传复合 id → 工作流资产内联角色详情（含固定引用版本）', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['flow-1#a1'] }) as CatalogDetails
    expect(out.assets[0]).toMatchObject({
      type: 'inlineRole',
      id: 'flow-1#a1',
      containerId: 'flow-1',
      nodeId: 'a1',
      roleAssetId: 'role-1',
      roleVersionId: 3,
      systemPrompt: '你是分析员',
    })
  })

  it('ex-* 不再是可识别 id：单条报 WF_BAD_ARGS，不触发任何资产读盘', async () => {
    const { host, calls } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['ex-1'] }) as CatalogDetails
    expect(out.assets).toEqual([])
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0]).toMatchObject({ id: 'ex-1', code: 'WF_BAD_ARGS' })
    expect(out.errors[0].message).toContain('ex-1')
    expect(calls.workflowReads).toEqual([])
    expect(calls.roleReads).toEqual([])
  })

  it('坏 id 只单条报错，不阻塞同批其余 id', async () => {
    const { host, calls } = makeCatalogHost()
    const out = await executeOrgCatalog(
      host,
      { ids: ['flow-1', 'nope-1', 'flow-1#missing', 'flow-1#f1', 'role-404', 'tpl-1', 'ex-1'] },
    ) as CatalogDetails
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({ type: 'workflow', id: 'flow-1' })
    expect(out.errors.map((item) => item.id)).toEqual(['nope-1', 'flow-1#missing', 'flow-1#f1', 'role-404', 'tpl-1', 'ex-1'])
    expect(out.errors.map((item) => item.code)).toEqual([
      'WF_BAD_ARGS', // 形状无法识别
      'WF_ORG_NOT_FOUND', // 节点不存在
      'WF_BAD_ARGS', // 非角色节点（无 systemPrompt）
      'WF_ORG_NOT_FOUND', // 角色资产不存在
      'WF_BAD_ARGS', // 旧模版前缀不再支持
      'WF_BAD_ARGS', // 经验不再由本工具召回
    ])
    expect(out.errors[2].message).toContain('file')
    // 形状非法的 id 不为它触发资产读盘
    expect(calls.workflowReads).toEqual(['flow-1'])
    expect(calls.roleReads).toEqual(['role-404'])
  })

  it('重复 id 只召回一次（批内去重）', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['flow-1', 'flow-1', 'role-1', 'role-1'] }) as CatalogDetails
    expect(out.assets.map((asset) => asset.id)).toEqual(['flow-1', 'role-1'])
  })

  it('同一资产的骨架与内联角色共读一次（批内缓存）', async () => {
    const { host, calls } = makeCatalogHost()
    await executeOrgCatalog(host, { ids: ['flow-1', 'flow-1#a1'] })
    expect(calls.workflowReads).toEqual(['flow-1'])
  })

  it('角色版本回溯按版本行 id 缓存：骨架多个内联角色只读一次（可选缝）', async () => {
    const { host, calls } = makeCatalogHost()
    await executeOrgCatalog(host, { ids: ['flow-1', 'flow-1#a1'] })
    expect(calls.roleVersionReads).toEqual(['rar-1'])
  })

  it('宿主没有角色版本回溯缝时：骨架照常返回，只省略 roleAssetId', async () => {
    const base = makeCatalogHost().host
    const host = { ...base, assets: { ...base.assets, getRoleAssetVersion: undefined } }
    const out = await executeOrgCatalog(host, { ids: ['flow-1'] }) as CatalogDetails
    const node = roleNodeOf(out, 0, 'a1')
    expect(node).not.toHaveProperty('roleAssetId')
    expect(node).not.toHaveProperty('roleVersionId')
  })

  it('角色版本回溯抛错只丢 roleAssetId，骨架主体照常返回', async () => {
    const base = makeCatalogHost().host
    const host = {
      ...base,
      assets: { ...base.assets, getRoleAssetVersion: async () => { throw new Error('版本表损坏') } },
    }
    const out = await executeOrgCatalog(host, { ids: ['flow-1'] }) as CatalogDetails
    expect(out.errors).toEqual([])
    const node = roleNodeOf(out, 0, 'a1')
    expect(node).not.toHaveProperty('roleAssetId')
    expect((out.assets[0] as CatalogWorkflowDetail).type).toBe('workflow')
  })

  it('单条资产读失败只记为该 id 的错误（同批其余照常召回）', async () => {
    const base = makeCatalogHost().host
    const host = {
      ...base,
      assets: {
        ...base.assets,
        async getWorkflowAsset(assetId: string) {
          if (assetId === 'flow-broken') throw new WfError('资产库读取失败', 'WF_ORG_NOT_FOUND')
          return base.assets.getWorkflowAsset(assetId)
        },
      },
    }
    const out = await executeOrgCatalog(host, { ids: ['flow-broken', 'flow-1'] }) as CatalogDetails
    expect(out.assets.map((asset) => asset.id)).toEqual(['flow-1'])
    expect(out.errors).toEqual([{ id: 'flow-broken', code: 'WF_ORG_NOT_FOUND', message: '资产库读取失败' }])
  })

  it('连续两次同输入结果完全一致（确定性、无隐藏状态）', async () => {
    const { host } = makeCatalogHost()
    const first = await executeOrgCatalog(host, { ids: ['flow-1', 'role-1'] })
    const second = await executeOrgCatalog(host, { ids: ['flow-1', 'role-1'] })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('清单读取失败向上抛（不伪装成空目录）', async () => {
    const base = makeCatalogHost().host
    const host = { ...base, assets: { ...base.assets, async listWorkflowAssets(): Promise<never> { throw new Error('权限不足') } } }
    await expect(executeOrgCatalog(host, {})).rejects.toThrowError(/权限不足/)
  })

  it('组合清单读取失败同样向上抛（核心清单不降级）', async () => {
    const host = makeCatalogHost({ async listToolCombos(): Promise<never> { throw new Error('组合表损坏') } }).host
    await expect(executeOrgCatalog(host, {})).rejects.toThrowError(/组合表损坏/)
  })

  it('preset / 模型目录失败按空清单降级（best-effort，不影响资产索引）', async () => {
    const host = makeCatalogHost({
      listPresets: async () => { throw new Error('preset 服务不可用') },
      listModels: async () => { throw new Error('模型服务不可用') },
    }).host
    const out = await executeOrgCatalog(host, {}) as CatalogIndex
    expect(out.presets).toEqual([])
    expect(out.models).toEqual([])
    expect(out.assets.workflows).toHaveLength(1)
  })

  it('宿主未提供 preset / 模型缝时按空清单处理', async () => {
    const host = makeCatalogHost({ listPresets: undefined, listModels: undefined }).host
    const out = await executeOrgCatalog(host, {}) as CatalogIndex
    expect(out.presets).toEqual([])
    expect(out.models).toEqual([])
  })

  it('模型档位经生态枚举进入索引 models[]（官方只经 resolveModelInfo 公布档位）', async () => {
    // 链路闭合：官方 llm 服务 → listEcosystemModels（逐模型扇出 resolveModelInfo）→ 索引 models[].efforts。
    // 旧实现在目录项上读 efforts（官方 LlmModelInfo 不含该字段）→ 索引与召回里的档位恒为空。
    const models = await listEcosystemModels({
      get: (name: string) => (name === 'llm'
        ? {
            listProviders: () => ['deepseek-official'],
            listModels: async () => [{ id: 'deepseek-flash' }],
            resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] } }),
          }
        : undefined),
    })
    const out = await executeOrgCatalog(makeCatalogHost({ listModels: async () => models }).host, {}) as CatalogIndex
    expect(out.models).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-flash', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] },
    ])
  })
})

describe('executeOrgCatalog：参数层校验', () => {
  it('ids 非数组（单字符串 / 数字 / 对象）→ WF_BAD_ARGS', async () => {
    const { host } = makeCatalogHost()
    for (const ids of ['flow-1', 42, { id: 'flow-1' }]) {
      const error = await executeOrgCatalog(host, { ids }).catch((reason: unknown) => reason)
      expect(error).toBeInstanceOf(WfError)
      expect((error as WfError).code).toBe('WF_BAD_ARGS')
    }
  })

  it('ids 超过单次上限 → WF_BAD_ARGS（提示分批）', async () => {
    const { host } = makeCatalogHost()
    const ids = Array.from({ length: CATALOG_LIMITS.detailIds + 1 }, (_item, index) => `flow-1#node-${index}`)
    const error = await executeOrgCatalog(host, { ids }).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_BAD_ARGS')
    expect((error as WfError).message).toContain('分批')
  })
})

describe('registerWfOrgCatalog：注册面与调用方身份', () => {
  it('子代理调用被拒（WF_NOT_ROOT）', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const error = await Promise.resolve(
      registered[0].execute({}, execOf({ id: 'child-1', session: { header: { origin: 'subagent', parentSession: 'session-1' } } })),
    ).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_NOT_ROOT')
  })

  it('无法识别调用者会话 → WF_BAD_CALLER', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const error = await Promise.resolve(registered[0].execute({}, execOf({}))).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_BAD_CALLER')
  })

  it('父代理（根会话）调用 → 返回资产索引', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const out = await registered[0].execute({}, execOf({ id: 'session-1' })) as CatalogIndex
    expect(out.kind).toBe('index')
    expect(out.rules.graphSemantics.length).toBeGreaterThan(0)
    expect(out.assets.workflows[0].id).toBe('flow-1')
  })

  it('工具描述公布三种 id 形状与两段调用模型，且不再提经验（模型据此构造调用）', () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const description = registered[0].description
    for (const expected of ['flow-*', 'role-*', '<flow-id>#<node-id>']) {
      expect(description).toContain(expected)
    }
    expect(description).not.toContain('ex-*')
    expect(description).not.toContain('experience index')
    expect(description).toContain('NOT listed here')
    expect(description).toContain('WF_NOT_ROOT')
  })

  it('tools 服务不可用 → 注册显式失败（不静默跳过）', () => {
    const { host } = makeCatalogHost()
    expect(() => registerWfOrgCatalog({ get: () => undefined }, host)).toThrowError(/tools 服务不可用/)
  })
})

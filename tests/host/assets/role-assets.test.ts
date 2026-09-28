// tests/host/assets/role-assets.test.ts
//
// 角色资产语义测试：晋升（含同模版新版本）、内容去重三分支、类型晋升、
// 资产态保存、回滚、退役、引用统计单调递增。
// 断言依据：算法 B/C/D/F/G 与「历史不可变、Active 即指针」的不变量。

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERR_ASSET_DUPLICATE, ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND } from '../../../src/host/shared/protocol.js'
import { ASSET_DB_FILE, AssetStore, type AssetError } from '../../../src/host/assets/index.js'
import { flowLine, makeStore, removeTempRoot, roleNode, roleTemplate } from './fixtures/asset-fixture.js'

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

describe('角色模版晋升（算法 C）', () => {
  it('test_晋升_角色模版_新建standalone资产且Active指向版本1', async () => {
    const result = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    expect(result).toMatchObject({ versionId: 1, unchanged: false })
    expect(result.assetId).toMatch(/^role-/)
    expect(result.rowId).toBe(`${result.assetId}@1`)
    expect(result.roleAssetType).toBe('standalone')
    expect(result.sharedRoleAssetIds).toEqual([])

    const detail = await store.getRoleAsset(result.assetId)
    expect(detail).toMatchObject({
      assetId: result.assetId,
      versionId: 1,
      kind: 'agent',
      roleAssetType: 'standalone',
      name: '研究员',
      systemPrompt: '你是研究员。',
      provider: 'deepseek',
      model: 'deepseek-chat',
      retryLimit: 2,
      reasoning: '',
      injectSystemPrompt: true,
      injectToolSections: true,
      referenceWorkflowIds: [],
      sourceTemplateId: 'tpl-role-1',
    })
    expect(detail?.createdAt).toBeGreaterThan(0)
  })

  it('test_晋升_同模版内容未变_短路返回unchanged且不新增版本', async () => {
    const first = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    const second = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    expect(second).toMatchObject({ assetId: first.assetId, versionId: 1, unchanged: true })
    expect(await store.listRoleVersions(first.assetId)).toHaveLength(1)
  })

  it('test_晋升_同模版内容已改_同一资产新增版本且Active指向新版本', async () => {
    const first = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    const second = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-2',
      role: roleTemplate({ systemPrompt: '你是资深研究员。' }),
      source: 'human',
    })

    expect(second).toMatchObject({ assetId: first.assetId, versionId: 2, unchanged: false })
    expect(second.roleAssetType).toBe('standalone')
    const detail = await store.getRoleAsset(first.assetId)
    expect(detail?.versionId).toBe(2)
    expect(detail?.systemPrompt).toBe('你是资深研究员。')
    expect(await store.listRoleAssets()).toHaveLength(1)
  })
})

describe('角色内容去重（算法 B）', () => {
  it('test_晋升_另一模版内容全等且均为standalone_抛重复错误并指明资产id', async () => {
    await store.promoteRole({ templateId: 'tpl-role-1', fingerprint: 'fp-1', role: roleTemplate(), source: 'human' })

    const error = await store
      .promoteRole({ templateId: 'tpl-role-2', fingerprint: 'fp-2', role: roleTemplate({ id: 'tpl-role-2' }), source: 'human' })
      .catch((caught: AssetError) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as AssetError).code).toBe(ERR_ASSET_DUPLICATE)
    expect((error as Error).message).toContain('role-')
    expect(await store.listRoleAssets()).toHaveLength(1)
  })

  it('test_晋升_内容与工作流内联角色全等_不新建资产而升级为shared', async () => {
    await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })
    const inline = (await store.listRoleAssets())[0]
    expect(inline.roleAssetType).toBe('inline')

    const merged = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    expect(merged).toMatchObject({ assetId: inline.assetId, versionId: 1, unchanged: true, roleAssetType: 'shared' })
    expect(merged.sharedRoleAssetIds).toEqual([inline.assetId])
    expect(await store.listRoleAssets()).toHaveLength(1)
    expect((await store.getRoleAsset(inline.assetId))?.roleAssetType).toBe('shared')
  })

  it('test_晋升_不同kind同提示词_视为不同内容各自建资产', async () => {
    const agent = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    const parent = await store.promoteRole({
      templateId: 'tpl-role-2',
      fingerprint: 'fp-2',
      role: roleTemplate({ id: 'tpl-role-2', kind: 'parent' }),
      source: 'human',
    })

    expect(parent.assetId).not.toBe(agent.assetId)
    expect(await store.listRoleAssets()).toHaveLength(2)
  })

  it('test_晋升_已退役资产内容全等_不参与去重可新建资产', async () => {
    const first = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    await store.retireRoleAsset(first.assetId)

    const second = await store.promoteRole({
      templateId: 'tpl-role-2',
      fingerprint: 'fp-2',
      role: roleTemplate({ id: 'tpl-role-2' }),
      source: 'human',
    })

    expect(second.assetId).not.toBe(first.assetId)
    expect(second.unchanged).toBe(false)
  })
})

describe('资产态保存（算法 D）', () => {
  it('test_保存_内容与Active全等_返回unchanged且不新增版本', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    const saved = await store.saveRoleVersion({ assetId: promoted.assetId, role: roleTemplate(), source: 'human' })

    expect(saved).toMatchObject({ assetId: promoted.assetId, versionId: 1, unchanged: true })
  })

  it('test_保存_内容已改_新增版本并继承来源模版绑定', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    const saved = await store.saveRoleVersion({
      assetId: promoted.assetId,
      role: roleTemplate({ systemPrompt: '你是主编。', name: '主编' }),
      source: 'agent',
    })

    expect(saved).toMatchObject({ assetId: promoted.assetId, versionId: 2, unchanged: false })
    const detail = await store.getRoleAsset(promoted.assetId)
    expect(detail).toMatchObject({ name: '主编', sourceTemplateId: 'tpl-role-1' })
    const versions = await store.listRoleVersions(promoted.assetId)
    expect(versions.map((entry) => [entry.versionId, entry.active])).toEqual([
      [2, true],
      [1, false],
    ])
    // 来源 source 记录在该版本行上（v2 为 agent 生成）
    expect(versions[0].source).toBe('agent')
  })

  it('test_保存_资产不存在_抛资产不存在错误', async () => {
    const error = await store
      .saveRoleVersion({ assetId: 'role-missing', role: roleTemplate(), source: 'human' })
      .catch((caught: AssetError) => caught)

    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })

  it('test_保存_资产已退役_抛资产不存在错误', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    await store.retireRoleAsset(promoted.assetId)

    const error = await store
      .saveRoleVersion({ assetId: promoted.assetId, role: roleTemplate({ name: '改名' }), source: 'human' })
      .catch((caught: AssetError) => caught)

    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })
})

describe('回滚与退役（算法 F/G）', () => {
  it('test_回滚_目标为旧版本_只移动Active指针且历史不变', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    await store.saveRoleVersion({
      assetId: promoted.assetId,
      role: roleTemplate({ systemPrompt: '你是资深研究员。', name: '资深研究员' }),
      source: 'human',
    })

    const rolledBack = await store.rollbackRoleAsset(promoted.assetId, 1)

    expect(rolledBack).toMatchObject({ versionId: 1, name: '研究员', systemPrompt: '你是研究员。' })
    expect(rolledBack.rowId).toBe(`${promoted.assetId}@1`)
    const versions = await store.listRoleVersions(promoted.assetId)
    expect(versions).toHaveLength(2)
    expect(versions.map((entry) => [entry.versionId, entry.active])).toEqual([
      [2, false],
      [1, true],
    ])
    expect((await store.getRoleAsset(promoted.assetId))?.versionId).toBe(1)
  })

  it('test_回滚_版本号非法_抛版本不存在错误且Active不变', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    const error = await store.rollbackRoleAsset(promoted.assetId, 9).catch((caught: AssetError) => caught)

    expect((error as AssetError).code).toBe(ERR_ASSET_VERSION_NOT_FOUND)
    expect((await store.getRoleAsset(promoted.assetId))?.versionId).toBe(1)
  })

  it('test_回滚_资产已退役_抛资产不存在错误', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    await store.retireRoleAsset(promoted.assetId)

    const error = await store.rollbackRoleAsset(promoted.assetId, 1).catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })

  it('test_退役_get与list均不可见但历史版本仍可查询', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    await store.retireRoleAsset(promoted.assetId)

    expect(await store.getRoleAsset(promoted.assetId)).toBeNull()
    expect(await store.listRoleAssets()).toEqual([])
    // 历史保留：已退役资产的版本列表属于不可用资产，读接口报「资产不存在」
    const error = await store.listRoleVersions(promoted.assetId).catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })

  it('test_退役_历史保留_仍可被工作流按引用重建', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1', data: { label: '研究员', systemPrompt: '你是研究员。', provider: 'deepseek', model: 'deepseek-chat', retryLimit: 2, sourceAssetId: promoted.assetId } })],
      lines: [],
      source: 'human',
    })

    await store.retireRoleAsset(promoted.assetId)

    const detail = await store.getWorkflowAsset(flow.assetId)
    expect(detail?.nodes).toHaveLength(1)
    expect((detail?.nodes[0] as { data: { systemPrompt: string } }).data.systemPrompt).toBe('你是研究员。')
  })

  it('test_退役_资产不存在_抛资产不存在错误', async () => {
    const error = await store.retireRoleAsset('role-missing').catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })
})

describe('来源引用与绑定刷新', () => {
  it('test_晋升_同模版二次晋升_来源指纹随Active版本刷新', async () => {
    await store.promoteRole({ templateId: 'tpl-role-1', fingerprint: 'fp-1', role: roleTemplate(), source: 'human' })
    await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-2',
      role: roleTemplate({ systemPrompt: '改过' }),
      source: 'human',
    })

    const summary = (await store.listRoleAssets())[0]
    expect(summary.sourceTemplateId).toBe('tpl-role-1')
    expect(summary.sourceFingerprint).toBe('fp-2')
    // currentTemplateFingerprint 由 API 边界读模版后填充，本模块不读模版
    expect(summary.currentTemplateFingerprint).toBeUndefined()
  })

  it('test_晋升_工作流内联角色_不带来源模版绑定且同内容按去重合并', async () => {
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' }), roleNode({ id: 'n2', position: { x: 40, y: 60 } })],
      lines: [flowLine('l1', 'n1', 'n2')],
      source: 'human',
    })

    // 两个节点内容全等 → 内容去重命中，合并为同一个角色资产（不产两份相同资产）；
    // 去重命中即视为「重复登记」，按算法 E 第 3 步把类型升为 shared
    const roles = await store.listRoleAssets()
    expect(roles).toHaveLength(1)
    expect(roles[0].sourceTemplateId).toBeUndefined()
    expect(roles[0].roleAssetType).toBe('shared')
    expect(flow.sharedRoleAssetIds).toEqual([roles[0].assetId])
    const detail = await store.getRoleAsset(roles[0].assetId)
    expect(detail?.referenceWorkflowIds).toHaveLength(1)
    expect(detail?.referenceWorkflowIds[0]).toBe(`${flow.assetId}@${flow.versionId}`)
  })
})

describe('目录消费面：索引摘要与按钉住版本回溯', () => {
  it('test_列表_摘要取Active版本提示词前60字并标注截断', async () => {
    const created = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate({ systemPrompt: '长'.repeat(200) }),
      source: 'human',
    })

    const list = await store.listRoleAssets()

    expect(list).toHaveLength(1)
    expect(list[0].assetId).toBe(created.assetId)
    // 摘要在列表查询里 JOIN Active 版本行产出（父代理据此判断适用性），不额外读盘
    expect(list[0].summary).toBe(`${'长'.repeat(60)}…（已截断）`)
  })

  it('test_列表_摘要对短提示词只做空白压缩', async () => {
    await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate({ systemPrompt: '  你是\n研究员。  ' }),
      source: 'human',
    })

    const list = await store.listRoleAssets()

    expect(list[0].summary).toBe('你是 研究员。')
  })

  it('test_按版本行回溯_升版后仍返回被钉住的旧版本内容', async () => {
    const first = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate({ systemPrompt: '第一版' }),
      source: 'human',
    })
    await store.saveRoleVersion({
      assetId: first.assetId,
      role: roleTemplate({ systemPrompt: '第二版' }),
      source: 'human',
    })

    const pinned = await store.getRoleAssetVersion(first.rowId)
    const active = await store.getRoleAsset(first.assetId)

    // 目录把工作流资产里钉住的版本标注为可召回角色资产：必须按钉住版本返回，不能读 Active
    expect(pinned?.versionId).toBe(1)
    expect(pinned?.systemPrompt).toBe('第一版')
    expect(active?.versionId).toBe(2)
    expect(active?.systemPrompt).toBe('第二版')
  })

  it('test_按版本行回溯_行不存在或资产已退役返回null', async () => {
    const created = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    expect(await store.getRoleAssetVersion(`${created.assetId}@99`)).toBeNull()
    expect(await store.getRoleAssetVersion('形状非法')).toBeNull()

    await store.retireRoleAsset(created.assetId)

    // 退役即退出召回面：钉住行仍在历史里，但不再被标注为可召回资产
    expect(await store.getRoleAssetVersion(created.rowId)).toBeNull()
  })
})

describe('交接契约文本列（input_schema / output_schema）', () => {
  it('test_晋升_结构字段为空串_落库为NULL且二次晋升判定未变更', async () => {
    const first = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      // 客户端模版草稿与节点默认值给的就是空串，不是缺字段
      role: roleTemplate({ inputSchema: '', outputSchema: '   ' }),
      source: 'human',
    })

    // 缺省空串必须落 NULL：写空串会让「未配置」与「配置了空文本」两种事实撞上约束
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(root, ASSET_DB_FILE))
    try {
      const row = db
        .prepare('SELECT typeof(input_schema) AS input_type, typeof(output_schema) AS output_type FROM role_asset_history')
        .get() as Record<string, unknown>
      expect(row).toMatchObject({ input_type: 'null', output_type: 'null' })
    } finally {
      db.close()
    }

    // 读侧把 NULL 还原为 undefined：再晋升一次必须判定「未变更」，不能凭空新增版本
    const second = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate({ inputSchema: undefined, outputSchema: undefined }),
      source: 'human',
    })

    expect(second).toMatchObject({ assetId: first.assetId, versionId: 1, unchanged: true })
    expect(await store.listRoleVersions(first.assetId)).toHaveLength(1)
  })

  it('test_晋升_结构字段为自由文本_原样落库并按版本行读回', async () => {
    const input = '上游结论；产出文件路径列表；关键决策'
    const output = '复核结论：{verdict: pass|fail, reasons: string[]}'

    const created = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: roleTemplate({ inputSchema: input, outputSchema: output }),
      source: 'human',
    })

    // 字段语义是柔性交接契约说明（不做结构校验），非 JSON 文本也必须可持久化
    const detail = await store.getRoleAsset(created.assetId)
    expect(detail).toMatchObject({ inputSchema: input, outputSchema: output })
  })
})

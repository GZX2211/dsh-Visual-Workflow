// tests/host/assets/workflow-assets.test.ts
//
// 工作流资产语义测试：首次晋升（内联角色登记）、同模版二次晋升新版本、指纹短路、
// 节点壳重建等价、回滚、退役、引用统计单调递增与新版本重置。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND } from '../../../src/host/shared/protocol.js'
import type { RoleNode } from '../../../src/host/shared/graph-model.js'
import { AssetStore, type AssetError } from '../../../src/host/assets/index.js'
import { flowLine, makeStore, orgMeta, removeTempRoot, roleNode, stageNode } from './fixtures/asset-fixture.js'

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

describe('工作流模版晋升（算法 E）', () => {
  it('test_晋升_工作流模版_新建资产且角色节点登记为inline', async () => {
    const result = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1' })],
      lines: [flowLine('l1', 's1', 'n1', 'flow-out', 'flow-in')],
      meta: orgMeta(),
      source: 'human',
    })

    expect(result).toMatchObject({ versionId: 1, rowId: `${result.assetId}@1`, unchanged: false })
    expect(result.assetId).toMatch(/^flow-/)
    expect(result.sharedRoleAssetIds).toEqual([])
    const roles = await store.listRoleAssets()
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ name: '研究员', kind: 'agent', roleAssetType: 'inline' })

    const detail = await store.getWorkflowAsset(result.assetId)
    expect(detail).toMatchObject({ mode: 'mode1', name: '工作流A', description: '说明A', sourceTemplateId: 'tpl-flow-1' })
    expect(detail?.meta).toEqual({ nodeMax: 12 })
    expect(detail?.roleVersionIds).toEqual([{ nodeId: 'n1', roleVersionId: `${roles[0].assetId}@${roles[0].versionId}` }])
    expect(detail?.lines).toEqual([flowLine('l1', 's1', 'n1', 'flow-out', 'flow-in')])
  })

  it('test_晋升_角色节点结构字段为缺省空串与自由文本_均入库成功且按资产重建', async () => {
    /** 角色节点 data 的必填部分（结构字段按用例叠加）。 */
    const nodeData = (
      label: string,
      systemPrompt: string,
      schemas: { inputSchema?: string; outputSchema?: string },
    ): RoleNode['data'] => ({ label, systemPrompt, provider: 'deepseek', model: 'deepseek-chat', retryLimit: 2, ...schemas })

    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [
        // 客户端新建的节点默认把两个结构字段写成空串（存量模版数据同形）
        roleNode({ id: 'n1', data: nodeData('研究员', '你是研究员。', { inputSchema: '', outputSchema: '' }) }),
        // 交接契约说明是自由文本，不是 JSON
        roleNode({
          id: 'n2',
          data: nodeData('审查员', '你是审查员。', {
            inputSchema: '上游结论；产出文件路径列表',
            outputSchema: '复核结论：{verdict: pass|fail, reasons: string[]}',
          }),
        }),
      ],
      lines: [flowLine('l1', 'n1', 'n2', 'ctx-out', 'ctx-in')],
      source: 'human',
    })

    expect(flow).toMatchObject({ versionId: 1, unchanged: false })

    const detail = await store.getWorkflowAsset(flow.assetId)
    expect(detail?.roleVersionIds).toHaveLength(2)
    // 重建后的节点：未配置的结构字段读回 undefined（NULL 往返），自由文本原样往返
    const rebuilt = (detail?.nodes ?? []).filter((node): node is RoleNode => node.kind === 'agent')
    expect(rebuilt).toHaveLength(2)
    expect(rebuilt[0].data.inputSchema).toBeUndefined()
    expect(rebuilt[0].data.outputSchema).toBeUndefined()
    expect(rebuilt[1].data).toMatchObject({
      inputSchema: '上游结论；产出文件路径列表',
      outputSchema: '复核结论：{verdict: pass|fail, reasons: string[]}',
    })
  })

  it('test_晋升_同模版二次晋升内容已改_同资产新版本且Active指向新版本', async () => {
    const first = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })

    const second = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-2',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A（改）',
      nodes: [roleNode({ id: 'n1' }), roleNode({ id: 'n2', position: { x: 60, y: 70 } })],
      lines: [flowLine('l1', 'n1', 'n2')],
      source: 'human',
    })

    expect(second).toMatchObject({ assetId: first.assetId, versionId: 2, unchanged: false })
    expect(await store.listWorkflowAssets()).toHaveLength(1)
    const detail = await store.getWorkflowAsset(first.assetId)
    expect(detail?.versionId).toBe(2)
    expect(detail?.description).toBe('说明A（改）')
    // 第二个角色节点内容与第一个全等 → 引用同一角色版本行（去重命中）
    expect(detail?.roleVersionIds).toHaveLength(2)
    expect(detail?.roleVersionIds[1].roleVersionId).toBe(detail?.roleVersionIds[0].roleVersionId)
  })

  it('test_晋升_指纹与Active相同_短路返回unchanged且不新增版本', async () => {
    const first = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })

    const second = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })

    expect(second).toMatchObject({ assetId: first.assetId, versionId: 1, unchanged: true })
    expect(await store.listWorkflowVersions(first.assetId)).toHaveLength(1)
  })

  it('test_晋升_不同模版_各自建资产（内容相同也不合并）', async () => {
    const first = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })
    const second = await store.promoteWorkflow({
      templateId: 'tpl-flow-2',
      fingerprint: 'fp-2',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(second.assetId).not.toBe(first.assetId)
    expect(await store.listWorkflowAssets()).toHaveLength(2)
  })

  it('test_晋升_来源模版绑定_可由列表摘要读回', async () => {
    await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode2',
      name: '服务A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    const summary = (await store.listWorkflowAssets())[0]
    expect(summary).toMatchObject({
      versionId: 1,
      name: '服务A',
      description: '说明A',
      sourceTemplateId: 'tpl-flow-1',
      sourceFingerprint: 'fp-flow-1',
    })
    expect(summary.assetId).toMatch(/^flow-/)
    expect(summary.currentTemplateFingerprint).toBeUndefined()
  })
})

describe('节点壳重建（算法 H）', () => {
  it('test_重建_含position与groupId与sourceAssetId_与原始图等价', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: {
        id: 'tpl-role-1',
        kind: 'agent',
        name: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
        reactLimit: 5,
        reasoning: 'high',
        presetId: 'preset-1',
        inputSchema: '{"type":"object"}',
        outputSchema: '{"type":"string"}',
        systemPromptSource: 'role.md',
        injectSystemPrompt: false,
        injectToolSections: false,
        promptFilePath: '/tmp/role.md',
      },
      source: 'human',
    })

    const node = roleNode({
      id: 'n1',
      kind: 'agent',
      position: { x: 120, y: 240 },
      data: {
        label: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
        reactLimit: 5,
        reasoning: 'high',
        presetId: 'preset-1',
        inputSchema: '{"type":"object"}',
        outputSchema: '{"type":"string"}',
        systemPromptSource: 'role.md',
        injectSystemPrompt: false,
        injectToolSections: false,
        promptFilePath: '/tmp/role.md',
        groupId: 'g1',
        sourceAssetId: promoted.assetId,
      },
    })

    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), node, { id: 'g1', kind: 'group', position: { x: 0, y: 0 }, data: { label: '组', collabPrompt: '协作', memberIds: ['n1'] } }],
      lines: [flowLine('l1', 's1', 'n1'), flowLine('l2', 'n1', 'g1', 'ctx-out', 'ctx-in')],
      source: 'human',
    })

    const detail = await store.getWorkflowAsset(flow.assetId)
    expect(detail?.nodes).toHaveLength(3)
    expect(detail?.nodes).toStrictEqual([
      stageNode('s1'),
      node,
      { id: 'g1', kind: 'group', position: { x: 0, y: 0 }, data: { label: '组', collabPrompt: '协作', memberIds: ['n1'] } },
    ])
    expect(detail?.roleVersionIds).toEqual([{ nodeId: 'n1', roleVersionId: promoted.rowId }])
  })

  it('test_重建_节点壳损坏_抛带路径错误而非半张图', async () => {
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-flow-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })
    // 制造异常数据：把角色版本映射抹掉（模拟外部改写/旧版迁移残留）
    store.close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(`${root}/assets.db`)
    db.prepare('UPDATE workflow_asset_history SET role_version_ids = ? WHERE asset_id = ?').run('[]', flow.assetId)
    db.close()
    const reopened = new AssetStore(root)
    await reopened.init()
    try {
      await expect(reopened.getWorkflowAsset(flow.assetId)).rejects.toThrow(/role_version_ids|缺少角色版本映射/)
    } finally {
      reopened.close()
    }
  })
})

describe('工作流资产回滚与退役', () => {
  it('test_回滚_只移动Active指针_不新增版本且历史不变', async () => {
    const first = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })
    await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-2',
      mode: 'mode1',
      name: '工作流A',
      description: '说明B',
      nodes: [roleNode({ id: 'n1' }), roleNode({ id: 'n2', position: { x: 9, y: 9 } })],
      lines: [],
      source: 'human',
    })

    const rolled = await store.rollbackWorkflowAsset(first.assetId, 1)

    expect(rolled).toMatchObject({ versionId: 1, description: '说明A', sourceTemplateId: 'tpl-flow-1' })
    expect(rolled.nodes).toHaveLength(1)
    const versions = await store.listWorkflowVersions(first.assetId)
    expect(versions.map((entry) => [entry.versionId, entry.active])).toEqual([
      [2, false],
      [1, true],
    ])
  })

  it('test_回滚_版本号非法_抛版本不存在错误', async () => {
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    const error = await store.rollbackWorkflowAsset(flow.assetId, 7).catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_VERSION_NOT_FOUND)
  })

  it('test_退役_get与list不可见但角色引用统计保留', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: {
        id: 'tpl-role-1',
        kind: 'agent',
        name: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
      },
      source: 'human',
    })
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [
        roleNode({
          id: 'n1',
          data: {
            label: '研究员',
            systemPrompt: '你是研究员。',
            provider: 'deepseek',
            model: 'deepseek-chat',
            retryLimit: 2,
            sourceAssetId: promoted.assetId,
          },
        }),
      ],
      lines: [],
      source: 'human',
    })

    await store.retireWorkflowAsset(flow.assetId)

    expect(await store.getWorkflowAsset(flow.assetId)).toBeNull()
    expect(await store.listWorkflowAssets()).toEqual([])
    const roleDetail = await store.getRoleAsset(promoted.assetId)
    expect(roleDetail?.referenceWorkflowIds).toEqual([`${flow.assetId}@${flow.versionId}`])
  })

  it('test_退役_资产不存在_抛资产不存在错误', async () => {
    const error = await store.retireWorkflowAsset('flow-missing').catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })
})

describe('引用统计与 shared 晋升', () => {
  it('test_引用统计_同一角色版本被两个工作流引用_单调递增并升shared', async () => {
    const role = roleNode({ id: 'n1' })
    const first = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [role],
      lines: [],
      source: 'human',
    })
    const inlineAssetId = (await store.listRoleAssets())[0].assetId

    const second = await store.promoteWorkflow({
      templateId: 'tpl-flow-2',
      fingerprint: 'fp-2',
      mode: 'mode1',
      name: '工作流B',
      description: '说明B',
      nodes: [roleNode({ id: 'm1' })],
      lines: [],
      source: 'human',
    })

    expect(second.sharedRoleAssetIds).toEqual([inlineAssetId])
    const detail = await store.getRoleAsset(inlineAssetId)
    expect(detail?.referenceWorkflowIds).toEqual([`${first.assetId}@1`, `${second.assetId}@1`])
    expect(detail?.roleAssetType).toBe('shared')
  })

  it('test_引用统计_角色升版后新版本引用数组重置为空', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: {
        id: 'tpl-role-1',
        kind: 'agent',
        name: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
      },
      source: 'human',
    })
    const flowA = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [
        roleNode({
          id: 'n1',
          data: {
            label: '研究员',
            systemPrompt: '你是研究员。',
            provider: 'deepseek',
            model: 'deepseek-chat',
            retryLimit: 2,
            sourceAssetId: promoted.assetId,
          },
        }),
      ],
      lines: [],
      source: 'human',
    })
    expect((await store.getRoleAsset(promoted.assetId))?.referenceWorkflowIds).toEqual([`${flowA.assetId}@1`])

    await store.saveRoleVersion({
      assetId: promoted.assetId,
      role: { id: 'tpl-role-1', kind: 'agent', name: '研究员', systemPrompt: '改过的提示词', provider: 'deepseek', model: 'deepseek-chat', retryLimit: 2 },
      source: 'human',
    })

    const detail = await store.getRoleAsset(promoted.assetId)
    expect(detail?.versionId).toBe(2)
    expect(detail?.referenceWorkflowIds).toEqual([])
  })

  it('test_引用统计_命中已存在的standalone资产_升shared且不新建资产', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: {
        id: 'tpl-role-1',
        kind: 'agent',
        name: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
      },
      source: 'human',
    })

    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })

    expect(flow.sharedRoleAssetIds).toEqual([promoted.assetId])
    const roles = await store.listRoleAssets()
    expect(roles).toHaveLength(1)
    expect(roles[0].roleAssetType).toBe('shared')
  })

  it('test_节点带sourceAssetId且内容已改_在源资产下升版而非新建资产', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-role-1',
      fingerprint: 'fp-1',
      role: {
        id: 'tpl-role-1',
        kind: 'agent',
        name: '研究员',
        systemPrompt: '你是研究员。',
        provider: 'deepseek',
        model: 'deepseek-chat',
        retryLimit: 2,
      },
      source: 'human',
    })

    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [
        roleNode({
          id: 'n1',
          data: {
            label: '资深研究员',
            systemPrompt: '你是资深研究员。',
            provider: 'deepseek',
            model: 'deepseek-chat',
            retryLimit: 2,
            sourceAssetId: promoted.assetId,
          },
        }),
      ],
      lines: [],
      source: 'human',
    })

    expect(flow.sharedRoleAssetIds).toEqual([])
    expect(await store.listRoleAssets()).toHaveLength(1)
    const detail = await store.getRoleAsset(promoted.assetId)
    expect(detail).toMatchObject({ versionId: 2, name: '资深研究员', roleAssetType: 'standalone' })
    const workflowDetail = await store.getWorkflowAsset(flow.assetId)
    expect(workflowDetail?.roleVersionIds).toEqual([{ nodeId: 'n1', roleVersionId: `${promoted.assetId}@2` }])
    // 节点壳保留 sourceAssetId（重建后仍能追溯来源资产）
    expect((workflowDetail?.nodes[0] as RoleNode).data.sourceAssetId).toBe(promoted.assetId)
  })
})

describe('资产态保存工作流', () => {
  it('test_保存_指定资产_新增版本并保留来源绑定', async () => {
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    const saved = await store.saveWorkflowVersion({
      assetId: flow.assetId,
      mode: 'mode2',
      name: '服务A',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(saved).toMatchObject({ assetId: flow.assetId, versionId: 2, unchanged: false })
    const detail = await store.getWorkflowAsset(flow.assetId)
    expect(detail).toMatchObject({ mode: 'mode2', name: '服务A', description: '说明B' })
    const summary = (await store.listWorkflowAssets())[0]
    expect(summary.sourceTemplateId).toBe('tpl-flow-1')
    expect(summary.sourceFingerprint).toBe('fp-1')
  })

  it('test_保存_资产不存在_抛资产不存在错误', async () => {
    const error = await store
      .saveWorkflowVersion({
        assetId: 'flow-missing',
        mode: 'mode1',
        name: '工作流A',
        description: '说明A',
        nodes: [],
        lines: [],
        source: 'human',
      })
      .catch((caught: AssetError) => caught)

    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })
})

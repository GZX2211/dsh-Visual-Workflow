// tests/host/assets/workflow-assets.test.ts
//
// 工作流资产语义测试：首次晋升（内联角色登记）、同模版二次晋升新版本、指纹短路、
// 节点壳重建等价、回滚、退役、引用统计单调递增与新版本重置。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND } from '../../../src/host/shared/protocol.js'
import type { RoleNode } from '../../../src/host/shared/graph-model.js'
import { AssetStore, type AssetError } from '../../../src/host/assets/index.js'
import { flowLine, makeStore, orgMeta, removeTempRoot, roleNode, roleTemplate, stageNode } from './fixtures/asset-fixture.js'

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

  it('test_归档_移出活跃列表且角色引用统计保留', async () => {
    // 行为变化（用户裁决）：工作流资产归档后详情仍可读（历史资产需能打开做版本迭代与
    // 重新启用），旧行为是 getWorkflowAsset 返回 null；且归档不触发角色资产归档（流程与角色解耦）。
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

    expect(await store.listWorkflowAssets()).toEqual([])
    expect((await store.listRetiredWorkflowAssets()).map((item) => item.assetId)).toEqual([flow.assetId])
    expect(await store.getWorkflowAsset(flow.assetId)).toMatchObject({ assetId: flow.assetId, retired: true })
    // 流程归档不触发角色归档：内联/被引用的角色资产仍是活跃资产
    const roleDetail = await store.getRoleAsset(promoted.assetId)
    expect(roleDetail?.retired).toBeUndefined()
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

// ---------------------------------------------------------------------------
// 保存内容查重（bug 修复：工作流资产原先没有查重，重复保存与纯坐标拖动都会堆版本）
// ---------------------------------------------------------------------------

describe('保存内容查重（忽略节点坐标）', () => {
  /** 晋升一个最小工作流资产（一个阶段节点 + 一个角色节点）。 */
  async function promoteMinimal(): Promise<string> {
    const promoted = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1', position: { x: 10, y: 20 } })],
      lines: [],
      source: 'human',
    })
    return promoted.assetId
  }

  it('test_保存_仅节点坐标变动_不新增版本', async () => {
    const assetId = await promoteMinimal()

    const saved = await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1', position: { x: 900, y: 800 } })],
      lines: [],
      source: 'human',
    })

    expect(saved).toMatchObject({ unchanged: true, versionId: 1 })
    expect(await store.listWorkflowVersions(assetId)).toHaveLength(1)
    expect(await store.listRoleAssets()).toHaveLength(1)
  })

  it('test_保存_内容与Active全等_重复点击保存不新增版本', async () => {
    const assetId = await promoteMinimal()
    const nodes = [stageNode('s1'), roleNode({ id: 'n1' })]

    const first = await store.saveWorkflowVersion({ assetId, mode: 'mode1', name: '工作流A', description: '说明A', nodes, lines: [], source: 'human' })
    const second = await store.saveWorkflowVersion({ assetId, mode: 'mode1', name: '工作流A', description: '说明A', nodes, lines: [], source: 'human' })

    expect(first).toMatchObject({ assetId })
    expect(second).toMatchObject({ unchanged: true, versionId: 1 })
    expect(await store.listWorkflowVersions(assetId)).toHaveLength(1)
  })

  it('test_保存_角色提示词变动_新增版本', async () => {
    const assetId = await promoteMinimal()

    const saved = await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1', data: { systemPrompt: '你是资深研究员。' } })],
      lines: [],
      source: 'human',
    })

    expect(saved).toMatchObject({ unchanged: false, versionId: 2 })
  })

  it('test_保存_连线条件变动_新增版本', async () => {
    const assetId = await promoteMinimal()

    const saved = await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1' })],
      lines: [{ ...flowLine('l1', 's1', 'n1', 'ctx-out', 'ctx-in'), condition: { type: 'fail' } }],
      source: 'human',
    })

    expect(saved).toMatchObject({ unchanged: false, versionId: 2 })
  })
})

// ---------------------------------------------------------------------------
// 归档资产的读写（历史资产：保存只迭代版本，回滚即重新启用）
// ---------------------------------------------------------------------------

describe('归档资产的读写（历史资产）', () => {
  async function archivedAsset(): Promise<string> {
    const promoted = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })
    await store.retireWorkflowAsset(promoted.assetId)
    return promoted.assetId
  }

  it('test_归档_详情取最新版本行且带retired标记', async () => {
    const assetId = await archivedAsset()
    expect(await store.getWorkflowAsset(assetId)).toMatchObject({ assetId, versionId: 1, retired: true })
  })

  it('test_归档_保存_在最新版本上续版且保持归档状态', async () => {
    const assetId = await archivedAsset()

    const saved = await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(saved).toMatchObject({ unchanged: false, versionId: 2 })
    expect(await store.listWorkflowAssets()).toEqual([])
    expect((await store.listRetiredWorkflowAssets()).map((item) => item.assetId)).toEqual([assetId])
    expect(await store.getWorkflowAsset(assetId)).toMatchObject({ versionId: 2, description: '说明B', retired: true })
  })

  it('test_归档_保存内容全等_不新增版本', async () => {
    const assetId = await archivedAsset()

    const saved = await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(saved).toMatchObject({ unchanged: true, versionId: 1 })
  })

  it('test_归档_回滚任一版本_重新启用并移回活跃列表', async () => {
    const assetId = await archivedAsset()
    await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })

    const rolled = await store.rollbackWorkflowAsset(assetId, 1)

    expect(rolled).toMatchObject({ versionId: 1, description: '说明A' })
    expect(rolled.retired).toBeUndefined()
    expect(await store.listRetiredWorkflowAssets()).toEqual([])
    expect((await store.listWorkflowAssets()).map((item) => item.assetId)).toEqual([assetId])
  })

  it('test_恢复_归档资产_取最新版本行重建Active指针', async () => {
    const assetId = await archivedAsset()
    await store.saveWorkflowVersion({
      assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })

    const restored = await store.restoreWorkflowAsset(assetId)

    // 恢复取最新版本（v2）：需要旧版本时恢复后再回滚
    expect(restored).toMatchObject({ assetId, versionId: 2, description: '说明B' })
    expect(restored.retired).toBeUndefined()
    expect(await store.listRetiredWorkflowAssets()).toEqual([])
    expect((await store.listWorkflowAssets()).map((item) => item.assetId)).toEqual([assetId])
  })

  it('test_恢复_已活跃资产_幂等无操作且不移动指针', async () => {
    const promoted = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })
    await store.saveWorkflowVersion({
      assetId: promoted.assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })
    await store.rollbackWorkflowAsset(promoted.assetId, 1)

    const restored = await store.restoreWorkflowAsset(promoted.assetId)

    expect(restored).toMatchObject({ versionId: 1, description: '说明A' })
    expect((await store.getWorkflowAsset(promoted.assetId))?.versionId).toBe(1)
  })

  it('test_恢复_完全不存在的资产_抛资产不存在错误', async () => {
    const error = await store.restoreWorkflowAsset('flow-missing').catch((caught: AssetError) => caught)
    expect((error as AssetError).code).toBe(ERR_ASSET_NOT_FOUND)
  })
})

// ---------------------------------------------------------------------------
// 引用解除与角色资产自动归档（内联资产的「退役：当前工作流不再使用」结算）
// ---------------------------------------------------------------------------

describe('引用解除与角色资产自动归档', () => {
  it('test_保存_删除唯一引用的角色节点_角色资产自动归档并降级为独立资产', async () => {
    const flow = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1'), roleNode({ id: 'n1' })],
      lines: [],
      source: 'human',
    })
    const inlineAssetId = (await store.listRoleAssets())[0].assetId
    expect((await store.listRoleAssets())[0].roleAssetType).toBe('inline')

    // 画布上删除角色节点后保存：本工作流的引用解除，且已无任何工作流引用它
    const saved = await store.saveWorkflowVersion({
      assetId: flow.assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [stageNode('s1')],
      lines: [],
      source: 'human',
    })

    expect(saved.archivedRoleAssetIds).toEqual([inlineAssetId])
    expect(await store.listRoleAssets()).toEqual([])
    expect(await store.listRetiredRoleAssets()).toEqual([
      expect.objectContaining({ assetId: inlineAssetId, roleAssetType: 'standalone' }),
    ])
    // 归档不是删除：历史版本行仍可查（重新启用入口）
    expect(await store.listRoleVersions(inlineAssetId)).toHaveLength(1)
  })

  it('test_保存_共享角色资产仍被其他工作流引用_只解除本工作流引用不归档', async () => {
    const role = roleNode({ id: 'n1' })
    const flowA = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [role],
      lines: [],
      source: 'human',
    })
    const sharedAssetId = (await store.listRoleAssets())[0].assetId
    // 第二个工作流以相同内容引用同一角色资产 → 升 shared
    const flowB = await store.promoteWorkflow({
      templateId: 'tpl-flow-2',
      fingerprint: 'fp-2',
      mode: 'mode1',
      name: '工作流B',
      description: '说明B',
      nodes: [roleNode({ id: 'm1' })],
      lines: [],
      source: 'human',
    })

    const releasedByA = await store.saveWorkflowVersion({
      assetId: flowA.assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(releasedByA.archivedRoleAssetIds).toEqual([])
    const detail = await store.getRoleAsset(sharedAssetId)
    expect(detail?.referenceWorkflowIds).toEqual([`${flowB.assetId}@1`])
    expect(detail?.roleAssetType).toBe('shared')

    // 第二个工作流也移除引用 → 完全无引用关系时归档 + 降级
    const releasedByB = await store.saveWorkflowVersion({
      assetId: flowB.assetId,
      mode: 'mode1',
      name: '工作流B',
      description: '说明B',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(releasedByB.archivedRoleAssetIds).toEqual([sharedAssetId])
    expect(await store.listRetiredRoleAssets()).toEqual([
      expect.objectContaining({ assetId: sharedAssetId, roleAssetType: 'standalone' }),
    ])
  })

  it('test_保存_独立资产被移除引用_不自动归档（由用户在左侧栏管理）', async () => {
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

    const saved = await store.saveWorkflowVersion({
      assetId: flow.assetId,
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [],
      lines: [],
      source: 'human',
    })

    expect(saved.archivedRoleAssetIds).toEqual([])
    expect((await store.listRoleAssets()).map((item) => item.assetId)).toEqual([promoted.assetId])
    expect((await store.getRoleAsset(promoted.assetId))?.referenceWorkflowIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 影响面预览（保存前的级联告知；只读，与登记路径同判据）
// ---------------------------------------------------------------------------

describe('影响面预览', () => {
  /** 造出「角色资产被工作流A与B共同引用」的局面，返回共享角色资产与两个工作流资产 id。 */
  async function sharedSetup(): Promise<{ roleAssetId: string; workflowAId: string; otherWorkflowId: string }> {
    const role = roleNode({ id: 'n1' })
    const flowA = await store.promoteWorkflow({
      templateId: 'tpl-flow-1',
      fingerprint: 'fp-1',
      mode: 'mode1',
      name: '工作流A',
      description: '说明A',
      nodes: [role],
      lines: [],
      source: 'human',
    })
    const roleAssetId = (await store.listRoleAssets())[0].assetId
    const flowB = await store.promoteWorkflow({
      templateId: 'tpl-flow-2',
      fingerprint: 'fp-2',
      mode: 'mode1',
      name: '工作流B',
      description: '说明B',
      nodes: [roleNode({ id: 'm1' })],
      lines: [],
      source: 'human',
    })
    return { roleAssetId, workflowAId: flowA.assetId, otherWorkflowId: flowB.assetId }
  }

  it('test_预览_节点内容已改且源资产被其他工作流引用_列出牵连方并排除自己', async () => {
    const { roleAssetId, workflowAId, otherWorkflowId } = await sharedSetup()

    const affected = await store.previewAssetCascade({
      kind: 'workflow',
      workflowAssetId: workflowAId,
      nodes: [
        roleNode({
          id: 'n1',
          data: {
            label: '研究员',
            systemPrompt: '你是资深研究员。',
            sourceAssetId: roleAssetId,
          },
        }),
      ],
    })

    expect(affected).toEqual([{ assetId: otherWorkflowId, name: '工作流B', versionCount: 1 }])
  })

  it('test_预览_节点内容与源资产Active全等_不触发牵连', async () => {
    const { roleAssetId } = await sharedSetup()

    const affected = await store.previewAssetCascade({
      kind: 'workflow',
      workflowAssetId: null,
      nodes: [roleNode({ id: 'n1', data: { sourceAssetId: roleAssetId } })],
    })

    expect(affected).toEqual([])
  })

  it('test_预览_角色资产内容已改_返回引用它的全部工作流资产', async () => {
    const { roleAssetId, workflowAId, otherWorkflowId } = await sharedSetup()

    const affected = await store.previewAssetCascade({
      kind: 'role',
      assetId: roleAssetId,
      role: roleTemplate({ systemPrompt: '改过的提示词' }),
    })

    // 角色资产自身的保存没有「排除自己」的概念：引用它的工作流资产全部受影响
    expect(affected).toEqual([
      { assetId: workflowAId, name: '工作流A', versionCount: 1 },
      { assetId: otherWorkflowId, name: '工作流B', versionCount: 1 },
    ])

    const unchanged = await store.previewAssetCascade({ kind: 'role', assetId: roleAssetId, role: roleTemplate() })
    expect(unchanged).toEqual([])
  })
})

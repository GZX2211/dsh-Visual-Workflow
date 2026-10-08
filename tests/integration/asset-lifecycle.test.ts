// tests/integration/asset-lifecycle.test.ts
//
// 资产闭环集成测试：真实 cordis 宿主 + 真实 SQLite 资产库 + 真实 `wf_org_catalog` 装配缝。
// 覆盖链路：宿主启动建库 → 模版晋升为资产 → 内容去重与引用统计 → 索引召回（含角色摘要）
// → 详情召回（工作流骨架按**钉住版本**标注角色资产）。
//
// 为什么直取宿主的装配缝（而不是自建 seam）：本测试要证明的正是「宿主把资产库接进了勘察
// 工具」，用自建 seam 替换会把这唯一的断言变成同义反复（它正是宿主装配的回归位）。
//
// 运行环境：node（host 测试默认）。

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VisualWorkflowHost, VisualWorkflowHostServiceName } from '../../src/host/index.js'
import { resolveConfig } from '../../src/host/config.js'
import { contentFingerprint, type AssetStore } from '../../src/host/assets/index.js'
import { executeOrgCatalog, type OrgCatalogHost } from '../../src/host/tools/wf-org-catalog/tool.js'
import type { CatalogDetails, CatalogIndex, CatalogWorkflowDetail } from '../../src/host/tools/wf-org-catalog/types.js'
import type { ExperienceInsertRow } from '../../src/host/shared/asset-types.js'
import type { RoleNode, WorkflowTemplate } from '../../src/host/shared/graph-model.js'
import type { RoleTemplate } from '../../src/host/shared/template-types.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/**
 * 直接经资产库写入一条经验（检索文本与向量在真实链路里由经验域在事务外生成；
 * 集成测试只关心中间那层「召回面读取」，故用固定向量避免依赖本地嵌入模型加载）。
 */
async function insertExperience(store: AssetStore): Promise<string> {
  const prompt = await store.getActivePrompt('agent')
  if (!prompt) throw new Error('缺少 agent 类型的活跃生成 Prompt（迁移播种未生效）')
  const row: ExperienceInsertRow = {
    id: store.nextId(),
    experienceType: 'agent',
    responsibility: '对插件资产的状态正确性负责',
    taskType: '软件开发',
    decisionDomain: '状态与版本',
    situation: '同一条记录既要能归档又要能恢复',
    trigger: '设计状态转换时',
    principle: '状态转换与版本指针必须分开建模',
    recommendedAction: '把状态列与版本指针分别承载，互不代偿',
    exclusions: ['不存在历史版本时'],
    evidence: ['归档与回滚曾互相干扰'],
    taskRetrievalText: 'responsibility: 对插件资产的状态正确性负责',
    taskEmbedding: new Float64Array([1, 0, 0]),
    decisionRetrievalText: 'decision_domain: 状态与版本',
    decisionEmbedding: new Float64Array([0, 1, 0]),
    embeddingModel: 'test-fixture',
    embeddingDimension: 3,
    sourceRunId: 'run-experience-1',
    generationPromptId: prompt.id,
    generationPromptVersion: prompt.promptVersion,
  }
  const result = await store.insertChecked({ rows: [row], duplicateOf: () => ({ duplicate: false }) })
  expect(result.inserted).toHaveLength(1)
  return row.id
}

/** 角色模版（与工作流内联角色的提示词一致：用于验证内容去重命中）。 */
function roleTemplate(): RoleTemplate {
  return {
    id: 'role-tpl-1',
    kind: 'agent',
    name: '分析员',
    systemPrompt: '你是分析员，负责拆解问题。',
    provider: 'deepseek',
    model: 'deepseek-chat',
    retryLimit: 3,
  }
}

/** 含一个角色节点的工作流模版。 */
function flowTemplate(): WorkflowTemplate {
  const node: RoleNode = {
    id: 'n1',
    kind: 'agent',
    position: { x: 120, y: 80 },
    data: {
      label: '分析员',
      systemPrompt: roleTemplate().systemPrompt,
      provider: 'deepseek',
      model: 'deepseek-chat',
      retryLimit: 3,
    },
  }
  return {
    id: 'flow-tpl-1',
    mode: 'mode1',
    name: '调研工作流',
    description: '面向调研的组织结构参考',
    nodes: [node],
    lines: [],
  }
}

describe('资产闭环（宿主装配 + SQLite + 勘察召回）', () => {
  it('test_晋升到召回_内容去重命中既有角色资产并升shared且骨架标注钉住版本', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-asset-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, resolveConfig({ dataDir: dir }))
    cleanups.push(async () => {
      await root.fiber.dispose()
    })

    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    // ① 宿主装配：资产库已就绪（未就绪时 catalog 会以明确错误失败，而不是伪装成空资产）
    expect(host.assets).toBeDefined()
    expect(existsSync(join(dir, 'assets.db'))).toBe(true)

    // ② 晋升：角色模版先入库，工作流模版随后入库；工作流内联角色与既有角色资产内容全等
    const role = roleTemplate()
    const flow = flowTemplate()
    await host.store.saveTemplate('role', role)
    await host.store.saveFlowTemplate(flow)

    const rolePromotion = await host.assets!.promoteRole({
      templateId: role.id,
      fingerprint: contentFingerprint(role),
      role,
      source: 'human',
    })
    const flowPromotion = await host.assets!.promoteWorkflow({
      templateId: flow.id,
      fingerprint: contentFingerprint(flow),
      mode: flow.mode,
      name: flow.name,
      description: flow.description,
      nodes: flow.nodes,
      lines: flow.lines,
      source: 'human',
    })

    // ③ 去重命中：不新建第二个角色资产，既有 standalone 资产被引用后升为 shared
    const roleAssets = await host.assets!.listRoleAssets()
    expect(roleAssets).toHaveLength(1)
    expect(roleAssets[0].assetId).toBe(rolePromotion.assetId)
    expect(roleAssets[0].roleAssetType).toBe('shared')
    expect(flowPromotion.sharedRoleAssetIds).toEqual([rolePromotion.assetId])

    // ④ 引用统计：工作流版本行被登记进角色版本的引用数组
    const roleDetail = await host.assets!.getRoleAsset(rolePromotion.assetId)
    expect(roleDetail?.referenceWorkflowIds).toEqual([flowPromotion.rowId])

    // ⑤ 勘察索引（经宿主装配缝）：资产条目 + 角色摘要
    // 经验召回已按用户裁决移交 wf_experience_recall，故索引里不再有经验段（下面显式断言其缺席）。
    const seam = (host as unknown as { ecosystemAdapters(): OrgCatalogHost }).ecosystemAdapters()
    const index = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(index.kind).toBe('index')
    expect(index.assets.workflows.map((item) => item.id)).toEqual([flowPromotion.assetId])
    expect(index.assets.roles[0]).toMatchObject({
      id: rolePromotion.assetId,
      name: '分析员',
      roleAssetType: 'shared',
      // 摘要由资产库在列表查询里 JOIN Active 版本行产出（不是空串、也不是完整提示词）
      summary: '你是分析员，负责拆解问题。',
    })
    expect((index as { experiences?: unknown }).experiences).toBeUndefined()

    // ⑥ 详情召回：工作流骨架按钉住版本标注角色资产（依赖宿主 seam 的 getRoleAssetVersion）
    const details = (await executeOrgCatalog(seam, { ids: [flowPromotion.assetId] })) as CatalogDetails
    expect(details.errors).toEqual([])
    const skeleton = details.assets[0] as CatalogWorkflowDetail
    expect(skeleton.type).toBe('workflow')
    expect(skeleton.assetId).toBe(flowPromotion.assetId)
    const roleEntry = skeleton.nodes.find((node) => node.kind === 'agent')
    expect(roleEntry).toMatchObject({
      id: 'n1',
      roleAssetId: rolePromotion.assetId,
      // 目录对模型公布的是可读版本号 vN（持久化层的角色版本行 id 是另一套值，见 types.ts 注释）
      roleVersionId: rolePromotion.versionId,
    })
    // 角色节点的 systemPrompt 不进骨架（最长字段走按需召回）
    expect((roleEntry as { systemPrompt?: unknown }).systemPrompt).toBeUndefined()
    expect(skeleton.inlineRoles).toEqual([`${flowPromotion.assetId}#n1`])
  })

  it('test_归档到恢复_资产与经验退出召回面后可经恢复重新进入', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-asset-retire-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, resolveConfig({ dataDir: dir }))
    cleanups.push(async () => {
      await root.fiber.dispose()
    })
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    // ① 备好一个工作流资产与一条经验（两条召回面各一类）
    const flow = flowTemplate()
    await host.store.saveFlowTemplate(flow)
    const promoted = await host.assets!.promoteWorkflow({
      templateId: flow.id,
      fingerprint: contentFingerprint(flow),
      mode: flow.mode,
      name: flow.name,
      description: flow.description,
      nodes: flow.nodes,
      lines: flow.lines,
      source: 'human',
    })
    // ① 备好一条经验（与工作流资产构成两个召回面）：经验的召回面读取由经验域经资产库完成，
    //    勘察工具不再承担经验召回，因此这里断言召回面读取（activeOnly）与界面列表两条路径。
    const assets = host.assets!
    const experienceDomain = host.experience!
    const experienceId = await insertExperience(assets)

    const seam = (host as unknown as { ecosystemAdapters(): OrgCatalogHost }).ecosystemAdapters()
    const before = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(before.assets.workflows.map((item) => item.id)).toEqual([promoted.assetId])
    expect((await assets.getRows([experienceId], { activeOnly: true })).map((item) => item.id)).toEqual([experienceId])

    // ② 归档：资产退出勘察召回面，经验退出经验召回面（归档即不可召回）
    await assets.retireWorkflowAsset(promoted.assetId)
    await experienceDomain.retire({ experienceId })

    const retiredIndex = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(retiredIndex.assets.workflows).toEqual([])
    // 流程归档不触发角色资产归档（流程与角色解耦）：工作流带来的内联角色资产仍是活跃资产
    expect(retiredIndex.assets.roles.map((item) => item.roleAssetType)).toEqual(['inline'])
    // 归档经验在召回面读取处即不可见（语义在读取处生效，不靠调用方自觉过滤）
    expect(await assets.getRows([experienceId], { activeOnly: true })).toEqual([])

    // ③ 界面数据源仍持有它们（否则用户无从恢复）：资产进历史资产、经验以非活跃条目返回
    expect((await assets.listRetiredWorkflowAssets()).map((item) => item.assetId)).toEqual([promoted.assetId])
    expect((await experienceDomain.list({ limit: 10 })).map((item) => [item.id, item.active])).toEqual([[experienceId, false]])

    // ④ 恢复：资产取最新版本行重建 Active 指针，经验置回活跃；两者重新进入召回面
    await assets.restoreWorkflowAsset(promoted.assetId)
    await experienceDomain.restore({ experienceId })

    const restoredIndex = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(restoredIndex.assets.workflows.map((item) => item.id)).toEqual([promoted.assetId])
    expect((await assets.getRows([experienceId], { activeOnly: true })).map((item) => item.id)).toEqual([experienceId])
    expect(await assets.listRetiredWorkflowAssets()).toEqual([])
  })
})

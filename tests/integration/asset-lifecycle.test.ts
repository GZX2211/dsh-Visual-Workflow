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
import { contentFingerprint } from '../../src/host/assets/index.js'
import { executeOrgCatalog, type OrgCatalogHost } from '../../src/host/tools/wf-org-catalog/tool.js'
import type { CatalogDetails, CatalogIndex, CatalogWorkflowDetail } from '../../src/host/tools/wf-org-catalog/types.js'
import type { RoleNode, WorkflowTemplate } from '../../src/host/shared/graph-model.js'
import type { RoleTemplate } from '../../src/host/shared/template-types.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

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

    // ⑤ 勘察索引（经宿主装配缝）：资产条目 + 角色摘要 + 经验段
    const inserted = await host.assets!.insertExperiences(
      [{ taskType: '软件开发', taskContext: '移动端外卖 App', insight: '长任务应提前结构化交接', sourceRunId: 'run-1' }],
      Date.now(),
    )
    expect(inserted.inserted).toHaveLength(1)

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
    expect(index.experiences).toEqual([{ id: inserted.inserted[0].id, taskContext: '移动端外卖 App' }])

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
    const inserted = await host.assets!.insertExperiences(
      [{ taskType: '软件开发', taskContext: '插件资产管理', insight: '状态转换与版本指针必须分开' }],
      Date.now(),
    )
    const experienceId = inserted.inserted[0].id

    const seam = (host as unknown as { ecosystemAdapters(): OrgCatalogHost }).ecosystemAdapters()
    const before = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(before.assets.workflows.map((item) => item.id)).toEqual([promoted.assetId])
    expect(before.experiences.map((item) => item.id)).toEqual([experienceId])

    // ② 归档：资产与经验同时退出父代理召回面（索引与按 id 详情两条路径都不可见）
    await host.assets!.retireWorkflowAsset(promoted.assetId)
    await host.assets!.setExperienceActive(experienceId, false)

    const retiredIndex = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(retiredIndex.assets.workflows).toEqual([])
    // 流程归档不触发角色资产归档（流程与角色解耦）：工作流带来的内联角色资产仍是活跃资产
    expect(retiredIndex.assets.roles.map((item) => item.roleAssetType)).toEqual(['inline'])
    expect(retiredIndex.experiences).toEqual([])
    // 归档经验按 id 也不能召回（召回面语义在读取处生效，不靠调用方自觉过滤）
    const retiredDetails = (await executeOrgCatalog(seam, { ids: [experienceId] })) as CatalogDetails
    expect(retiredDetails.assets).toEqual([])
    expect(retiredDetails.errors.map((error) => error.id)).toEqual([experienceId])

    // ③ 界面数据源仍持有它们（否则用户无从恢复）：资产进历史资产、经验以非活跃条目返回
    expect((await host.assets!.listRetiredWorkflowAssets()).map((item) => item.assetId)).toEqual([promoted.assetId])
    expect((await host.assets!.listExperiences(10)).map((item) => [item.id, item.active])).toEqual([[experienceId, false]])

    // ④ 恢复：资产取最新版本行重建 Active 指针，经验置回活跃；两者重新进入召回面
    await host.assets!.restoreWorkflowAsset(promoted.assetId)
    await host.assets!.setExperienceActive(experienceId, true)

    const restoredIndex = (await executeOrgCatalog(seam, {})) as CatalogIndex
    expect(restoredIndex.assets.workflows.map((item) => item.id)).toEqual([promoted.assetId])
    expect(restoredIndex.experiences.map((item) => item.id)).toEqual([experienceId])
    expect(await host.assets!.listRetiredWorkflowAssets()).toEqual([])
  })
})

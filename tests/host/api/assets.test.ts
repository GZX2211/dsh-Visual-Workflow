// tests/host/api/assets.test.ts
//
// 资产端点组的边界职责（api/assets.ts）：模版读取与指纹填充、请求形状校验（400）、
// 领域错误码映射（404/409）、能力缝缺失（501），以及「边界传了什么给资产库」的翻译契约。
// 资产事实本身由 assets 模块拥有，故此处用伪资产库隔离边界，不验证资产库语义。

import { afterEach, describe, expect, it } from 'vitest'
import { registerRoutes } from '../../../src/host/api/index.js'
import { contentFingerprint } from '../../../src/host/assets/index.js'
import type { RoleAssetDetail, RoleAssetSummary, WorkflowAssetSummary } from '../../../src/host/shared/asset-types.js'
import { ERR_ASSET_DUPLICATE } from '../../../src/host/shared/protocol.js'
import { cleanupAll, FakeAssetStore, makeHarness, type FakeAssets, type Harness } from './fixtures/api-harness.js'

/** 领域入参按能力缝签名派生（断言「边界传了什么」时与宿主契约零漂移）。 */
type RolePromoteInput = Parameters<FakeAssets['promoteRole']>[0]
type RoleSaveInput = Parameters<FakeAssets['saveRoleVersion']>[0]
type WorkflowPromoteInput = Parameters<FakeAssets['promoteWorkflow']>[0]
type WorkflowSaveInput = Parameters<FakeAssets['saveWorkflowVersion']>[0]

afterEach(cleanupAll)

/** 构造夹具：默认注入伪资产库（501 用例单独用 makeHarness()）。 */
async function makeAssetHarness(): Promise<{ h: Harness; assets: FakeAssetStore }> {
  const assets = new FakeAssetStore()
  const h = await makeHarness({ assets })
  return { h, assets }
}

/** 落盘一个角色模版（指纹用例需要「模版 → 资产」两侧都能读到同一份内容）。 */
async function putRoleTemplate(h: Harness, id: string, name: string, systemPrompt: string): Promise<void> {
  await h.store.saveTemplate('role', { id, kind: 'agent', name, systemPrompt, provider: 'deepseek', model: 'v4', presetId: null, retryLimit: 3 } as never)
}

describe('资产列表与详情端点', () => {
  it('listAssets 两种 kind 与缺省：按 kind 取索引，且填充模版当前指纹', async () => {
    const { h, assets } = await makeAssetHarness()
    await putRoleTemplate(h, 'role-1', '研究员', '任务：调研')
    await h.store.saveFlowTemplate({ id: 'tpl-1', mode: 'mode1', name: '流程模板', description: 'd', nodes: [], lines: [], revision: 0 })

    assets.seedRole({ assetId: 'a-role', name: '研究员', sourceTemplateId: 'role-1', sourceFingerprint: 'stale' })
    assets.seedWorkflow({ assetId: 'a-flow', name: '流程模板', sourceTemplateId: 'tpl-1', sourceFingerprint: 'stale' })

    const roleFingerprint = contentFingerprint(await h.store.getTemplate('role', 'role-1'))
    const workflowFingerprint = contentFingerprint(await h.store.getFlowTemplate('tpl-1'))

    const all = (await h.api.handle('listAssets', {})) as { workflows: WorkflowAssetSummary[]; roles: RoleAssetSummary[] }
    expect(all.workflows.map((item) => item.assetId)).toEqual(['a-flow'])
    expect(all.roles.map((item) => item.assetId)).toEqual(['a-role'])
    expect(all.workflows[0].currentTemplateFingerprint).toBe(workflowFingerprint)
    expect(all.roles[0].currentTemplateFingerprint).toBe(roleFingerprint)

    const onlyRoles = (await h.api.handle('listAssets', { kind: 'role' })) as { workflows: unknown[]; roles: unknown[] }
    expect(onlyRoles.roles).toHaveLength(1)
    expect(onlyRoles.workflows).toEqual([])
  })

  it('listAssets 模版已删除：省略 currentTemplateFingerprint（客户端视为未锁定）', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '研究员', sourceTemplateId: 'role-gone' })

    const result = (await h.api.handle('listAssets', {})) as { roles: Array<Record<string, unknown>> }
    expect(result.roles[0].sourceTemplateId).toBe('role-gone')
    expect(result.roles[0]).not.toHaveProperty('currentTemplateFingerprint')
  })

  it('getAsset 不存在：404 + 稳定错误码 ERR_ASSET_NOT_FOUND', async () => {
    const { h, assets } = await makeAssetHarness()
    await expect(h.api.handle('getAsset', { kind: 'workflow', assetId: 'nope' })).rejects.toMatchObject({
      status: 404,
      code: 'WF_ASSET_NOT_FOUND',
    })

    assets.seedRole({ assetId: 'a-role', name: '研究员' })
    const detail = (await h.api.handle('getAsset', { kind: 'role', assetId: 'a-role' })) as RoleAssetDetail
    expect(detail.name).toBe('研究员')
  })
})

describe('资产入库端点', () => {
  it('promoteAsset 角色模版：以模版内容指纹入库，来源恒为 human', async () => {
    const { h, assets } = await makeAssetHarness()
    await putRoleTemplate(h, 'role-1', '研究员', '任务：调研')
    const role = await h.store.getTemplate('role', 'role-1')

    // Arrange 前置失败路径：模版不存在 → 404（先于任何领域调用）
    await expect(h.api.handle('promoteAsset', { kind: 'role', templateId: 'role-gone' })).rejects.toMatchObject({
      status: 404,
      code: 'WF_ASSET_NOT_FOUND',
    })
    await expect(h.api.handle('promoteAsset', { kind: 'bad', templateId: 'role-1' })).rejects.toMatchObject({ status: 400 })
    await expect(h.api.handle('promoteAsset', { kind: 'role' })).rejects.toMatchObject({ status: 400 })
    expect(assets.calls.promoteRole).toHaveLength(0)

    const result = await h.api.handle('promoteAsset', { kind: 'role', templateId: 'role-1' })
    expect(result).toMatchObject({ assetId: 'role-1', versionId: 1, unchanged: false })

    // 指纹必须是「边界读到的那份模版内容」的指纹（不是客户端提交值）
    const input = assets.calls.promoteRole[0] as RolePromoteInput
    expect(input.source).toBe('human')
    expect(input.fingerprint).toBe(contentFingerprint(role))
    expect(input.role).toMatchObject({ id: 'role-1', name: '研究员', systemPrompt: '任务：调研' })
  })

  it('promoteAsset 工作流模版：转交 mode/name/description/nodes/lines/meta，指纹取自模版', async () => {
    const { h, assets } = await makeAssetHarness()
    await h.store.saveFlowTemplate({
      id: 'tpl-1',
      mode: 'mode1',
      name: '流程模板',
      description: '目标',
      nodes: [],
      lines: [],
      revision: 0,
      meta: { nodeMax: 5 },
    })
    const template = await h.store.getFlowTemplate('tpl-1')

    const result = await h.api.handle('promoteAsset', { kind: 'workflow', templateId: 'tpl-1' })
    expect(result).toMatchObject({ assetId: 'tpl-1', versionId: 1, unchanged: false })

    const input = assets.calls.promoteWorkflow[0] as WorkflowPromoteInput
    expect(input.source).toBe('human')
    expect(input.templateId).toBe('tpl-1')
    expect(input.fingerprint).toBe(contentFingerprint(template))
    expect(input.mode).toBe('mode1')
    expect(input.name).toBe('流程模板')
    expect(input.description).toBe('目标')
    expect(input.nodes).toEqual([])
    expect(input.lines).toEqual([])
    expect(input.meta).toEqual({ nodeMax: 5 })

    const listed = (await h.api.handle('listAssets', { kind: 'workflow' })) as { workflows: WorkflowAssetSummary[] }
    expect(listed.workflows[0].sourceFingerprint).toBe(contentFingerprint(template))
  })

  it('promoteAsset 重复入库：资产库抛 ERR_ASSET_DUPLICATE 时原样透出（路由映射 409）', async () => {
    const { h, assets } = await makeAssetHarness()
    await putRoleTemplate(h, 'role-1', '研究员', '任务：调研')
    assets.nextPromoteError = Object.assign(new Error('资产已存在且内容相同'), { code: ERR_ASSET_DUPLICATE })

    await expect(h.api.handle('promoteAsset', { kind: 'role', templateId: 'role-1' })).rejects.toMatchObject({
      code: 'WF_ASSET_DUPLICATE',
    })
  })
})

describe('资产态保存端点', () => {
  it('saveAssetVersion 角色：校验载荷并转交资产库（id 取资产 id，来源 human）', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '旧名字' })

    const result = await h.api.handle('saveAssetVersion', {
      kind: 'role',
      assetId: 'a-role',
      payload: { kind: 'parent', name: '新名字', systemPrompt: '新提示词', provider: 'deepseek', model: 'v4', presetId: null, retryLimit: 5 },
    })
    expect(result).toMatchObject({ assetId: 'a-role', versionId: 2, unchanged: false })

    const input = assets.calls.saveRole[0] as RoleSaveInput
    expect(input.assetId).toBe('a-role')
    expect(input.source).toBe('human')
    expect(input.role).toMatchObject({ id: 'a-role', kind: 'parent', name: '新名字', systemPrompt: '新提示词', retryLimit: 5 })

    // 历史版本条目保留（新版本 Active）
    const versions = (await h.api.handle('listAssetVersions', { kind: 'role', assetId: 'a-role' })) as Array<{ versionId: number; active: boolean }>
    expect(versions.map((item) => item.versionId)).toEqual([1, 2])
    expect(versions[1].active).toBe(true)
  })

  it('saveAssetVersion 工作流：转交 mode/name/description/nodes/lines/meta', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedWorkflow({ assetId: 'a-flow', name: '旧流程' })

    await h.api.handle('saveAssetVersion', {
      kind: 'workflow',
      assetId: 'a-flow',
      payload: { mode: 'mode2', name: '新流程', description: '目标', nodes: [], lines: [], meta: { groupMax: 2 } },
    })

    const input = assets.calls.saveWorkflow[0] as WorkflowSaveInput
    expect(input.assetId).toBe('a-flow')
    expect(input.source).toBe('human')
    expect(input.mode).toBe('mode2')
    expect(input.name).toBe('新流程')
    expect(input.description).toBe('目标')
    expect(input.nodes).toEqual([])
    expect(input.lines).toEqual([])
    expect(input.meta).toEqual({ groupMax: 2 })
  })

  it('saveAssetVersion 载荷形状非法：ERR_ASSET_BAD_ARGS 400（不触达资产库）', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '角色' })
    assets.seedWorkflow({ assetId: 'a-flow', name: '流程' })
    const badArgs = { status: 400, code: 'WF_ASSET_BAD_ARGS' }

    await expect(h.api.handle('saveAssetVersion', { kind: 'role', assetId: 'a-role' })).rejects.toMatchObject(badArgs)
    await expect(h.api.handle('saveAssetVersion', { kind: 'role', assetId: 'a-role', payload: 'x' })).rejects.toMatchObject(badArgs)
    await expect(h.api.handle('saveAssetVersion', { kind: 'role', assetId: 'a-role', payload: { name: 'x' } })).rejects.toMatchObject(badArgs)
    await expect(
      h.api.handle('saveAssetVersion', { kind: 'workflow', assetId: 'a-flow', payload: { name: 'x', description: '', nodes: {}, lines: [] } }),
    ).rejects.toMatchObject(badArgs)
    await expect(
      h.api.handle('saveAssetVersion', { kind: 'workflow', assetId: 'a-flow', payload: { name: 'x', description: '' } }),
    ).rejects.toMatchObject(badArgs)

    expect(assets.calls.saveRole).toHaveLength(0)
    expect(assets.calls.saveWorkflow).toHaveLength(0)
  })
})

describe('资产版本、回滚与退役端点', () => {
  it('listAssetVersions 返回资产库版本条目（含 Active 标记）', async () => {
    const { h, assets } = await makeAssetHarness()
    const seeded = assets.seedRole({ assetId: 'a-role', name: '角色' })
    assets.roleVersions.set('a-role', [
      { versionId: 1, rowId: seeded.rowId, name: '角色', createdAt: 1, source: 'human', active: false },
      { versionId: 2, rowId: 'a-role-r2', name: '角色 v2', createdAt: 2, source: 'agent', active: true },
    ])

    const versions = (await h.api.handle('listAssetVersions', { kind: 'role', assetId: 'a-role' })) as Array<Record<string, unknown>>
    expect(versions.map((item) => item.versionId)).toEqual([1, 2])
    expect(versions[1]).toMatchObject({ active: true, source: 'agent' })
  })

  it('rollbackAsset 转交版本号并返回回滚后的 Active 详情', async () => {
    const { h, assets } = await makeAssetHarness()
    const seeded = assets.seedRole({ assetId: 'a-role', name: '角色', versionId: 2, rowId: 'a-role-r2' })
    assets.roleVersions.set('a-role', [
      { versionId: 1, rowId: seeded.rowId, name: '角色 v1', createdAt: 1, source: 'human', active: false },
      { versionId: 2, rowId: 'a-role-r2', name: '角色 v2', createdAt: 2, source: 'human', active: true },
    ])

    const rolled = (await h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role', versionId: 1 })) as RoleAssetDetail
    expect(rolled.versionId).toBe(1)
    expect(assets.calls.rollback).toEqual([{ kind: 'role', assetId: 'a-role', versionId: 1 }])
  })

  it('rollbackAsset 版本号非正整数：ERR_ASSET_BAD_ARGS 400；版本不存在：领域码透出', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '角色' })
    const badArgs = { status: 400, code: 'WF_ASSET_BAD_ARGS' }

    await expect(h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role' })).rejects.toMatchObject(badArgs)
    await expect(h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role', versionId: 0 })).rejects.toMatchObject(badArgs)
    await expect(h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role', versionId: 1.5 })).rejects.toMatchObject(badArgs)
    await expect(h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role', versionId: '1' })).rejects.toMatchObject(badArgs)
    expect(assets.calls.rollback).toHaveLength(0)

    await expect(h.api.handle('rollbackAsset', { kind: 'role', assetId: 'a-role', versionId: 9 })).rejects.toMatchObject({
      code: 'WF_ASSET_VERSION_NOT_FOUND',
    })
  })

  it('listAssets 活跃与历史（已归档）分开返回，归档资产不进活跃召回面', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '角色' })
    assets.seedWorkflow({ assetId: 'a-flow', name: '流程' })
    await h.api.handle('retireAsset', { kind: 'workflow', assetId: 'a-flow' })

    const result = (await h.api.handle('listAssets', {})) as {
      workflows: WorkflowAssetSummary[]
      roles: RoleAssetSummary[]
      retiredWorkflows: WorkflowAssetSummary[]
      retiredRoles: RoleAssetSummary[]
    }
    expect(result.workflows).toEqual([])
    expect(result.roles.map((item) => item.assetId)).toEqual(['a-role'])
    expect(result.retiredWorkflows.map((item) => item.assetId)).toEqual(['a-flow'])
    expect(result.retiredRoles).toEqual([])

    // kind 限定只回该类的活跃 + 历史，另一类保持空数组（形状稳定）
    const onlyRoles = (await h.api.handle('listAssets', { kind: 'role' })) as {
      workflows: unknown[]
      retiredWorkflows: unknown[]
      roles: unknown[]
      retiredRoles: unknown[]
    }
    expect(onlyRoles.roles).toHaveLength(1)
    expect(onlyRoles.workflows).toEqual([])
    expect(onlyRoles.retiredWorkflows).toEqual([])
  })

  it('retireAsset 归档后 Active 详情仍可读（标 retired），历史版本条目保留', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedWorkflow({ assetId: 'a-flow', name: '流程' })

    const result = await h.api.handle('retireAsset', { kind: 'workflow', assetId: 'a-flow' })
    expect(result).toEqual({ kind: 'workflow', assetId: 'a-flow', retired: true })
    expect(assets.calls.retired).toEqual(['workflow:a-flow'])

    // 归档资产（历史资产）仍可读：属性栏/画布要能打开它做版本迭代与重新启用
    const detail = (await h.api.handle('getAsset', { kind: 'workflow', assetId: 'a-flow' })) as Record<string, unknown>
    expect(detail).toMatchObject({ assetId: 'a-flow', retired: true })
    expect(await h.api.handle('listAssetVersions', { kind: 'workflow', assetId: 'a-flow' })).toHaveLength(1)
  })
})

describe('资产影响面预览端点', () => {
  it('previewAssetCascade 工作流：转交节点集与（可空的）本资产 id，返回牵连清单', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.nextPreviewAffected = [{ assetId: 'a-other', name: '别的流程', versionCount: 2 }]

    const result = (await h.api.handle('previewAssetCascade', {
      kind: 'workflow',
      assetId: 'a-flow',
      payload: { nodes: [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }] },
    })) as { kind: string; affected: Array<Record<string, unknown>> }

    expect(result.kind).toBe('workflow')
    expect(result.affected).toEqual([{ assetId: 'a-other', name: '别的流程', versionCount: 2 }])
    expect(assets.calls.preview).toEqual([
      {
        kind: 'workflow',
        workflowAssetId: 'a-flow',
        nodes: [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }],
      },
    ])
  })

  it('previewAssetCascade 角色：以 payload 内容构造模版转交，assetId 必填', async () => {
    const { h, assets } = await makeAssetHarness()
    assets.seedRole({ assetId: 'a-role', name: '角色' })

    const result = (await h.api.handle('previewAssetCascade', {
      kind: 'role',
      assetId: 'a-role',
      payload: { name: '角色', systemPrompt: '任务：调研', provider: 'deepseek', model: 'v4', kind: 'agent' },
    })) as { kind: string; affected: unknown[] }

    expect(result).toEqual({ kind: 'role', affected: [] })
    expect(assets.calls.preview[0]).toMatchObject({
      kind: 'role',
      assetId: 'a-role',
      role: { id: 'a-role', name: '角色', systemPrompt: '任务：调研', kind: 'agent' },
    })

    await expect(h.api.handle('previewAssetCascade', { kind: 'role', payload: { nodes: [] } })).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('资产端点参数校验与能力缝', () => {
  it('参数缺失或 kind 非法：400（先于任何资产库调用）', async () => {
    const { h, assets } = await makeAssetHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['listAssets', { kind: 'asset' }],
      ['getAsset', { kind: 'role' }],
      ['getAsset', { assetId: 'a-role' }],
      ['getAsset', { kind: 'flow', assetId: 'a-role' }],
      ['promoteAsset', { kind: 'role' }],
      ['saveAssetVersion', { kind: 'role', assetId: 'a-role' }],
      ['listAssetVersions', { kind: 'role' }],
      ['listAssetVersions', { kind: 'role', assetId: '   ' }],
      ['rollbackAsset', { kind: 'role', assetId: 'a-role' }],
      ['retireAsset', { kind: 'role' }],
      ['previewAssetCascade', { kind: 'workflow' }],
      ['previewAssetCascade', { kind: 'role', assetId: 'a-role' }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 400 })
    }
    expect(assets.calls.promoteRole).toHaveLength(0)
    expect(assets.calls.saveRole).toHaveLength(0)
    expect(assets.calls.retired).toHaveLength(0)
  })

  it('host.assets 缺失：501（明确不可用，不静默返回空资产库）', async () => {
    const h = await makeHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['listAssets', {}],
      ['getAsset', { kind: 'role', assetId: 'a' }],
      ['promoteAsset', { kind: 'role', templateId: 't' }],
      ['saveAssetVersion', { kind: 'role', assetId: 'a', payload: { name: 'x', systemPrompt: 'x', provider: '', model: '' } }],
      ['listAssetVersions', { kind: 'role', assetId: 'a' }],
      ['rollbackAsset', { kind: 'role', assetId: 'a', versionId: 1 }],
      ['retireAsset', { kind: 'role', assetId: 'a' }],
      ['previewAssetCascade', { kind: 'workflow', payload: { nodes: [] } }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 501, message: expect.stringContaining('资产库尚未装配') })
    }
  })

  it('未知端点：404（既有分发行为不回归）', async () => {
    const { h } = await makeAssetHarness()
    await expect(h.api.handle('assetWhatever', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('资产错误码到 HTTP 状态的映射（路由层）', () => {
  /** 注册路由并返回一个可发 POST 的调用器（响应状态与 body 收集在 responses）。 */
  function registerRoute(h: Harness, responses: Array<{ status: number; body: string }>) {
    let registered: { handler?: (req: unknown, res: unknown) => Promise<void> } | null = null
    h.ctx.services.set('webServer', {
      register(route: { handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {
          registered = null
        }
      },
    })
    registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    const res = {
      writeHead(status: number) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    return (endpoint: string, args: unknown) => {
      const body = JSON.stringify({ args })
      const req = {
        method: 'POST',
        url: `/visual-workflow/${endpoint}`,
        on(event: string, cb: (chunk?: unknown) => void) {
          if (event === 'data') cb(body)
          if (event === 'end') cb()
        },
        destroy() {},
      }
      return registered!.handler!(req, res)
    }
  }

  it('领域抛出的资产错误码按 ERROR_STATUS 映射：不存在的资产 404、重复入库 409、版本不存在 404', async () => {
    const { h, assets } = await makeAssetHarness()
    const responses: Array<{ status: number; body: string }> = []
    const post = registerRoute(h, responses)

    // 领域码 ERR_ASSET_NOT_FOUND（非 HttpError）→ 404
    await post('getAsset', { kind: 'workflow', assetId: 'nope' })
    expect(responses[0].status).toBe(404)
    expect(JSON.parse(responses[0].body)).toMatchObject({ ok: false, error: { code: 'WF_ASSET_NOT_FOUND' } })

    // 领域码 ERR_ASSET_DUPLICATE → 409
    await putRoleTemplate(h, 'role-1', '研究员', '任务：调研')
    assets.nextPromoteError = Object.assign(new Error('已存在内容相同的 standalone 资产'), { code: ERR_ASSET_DUPLICATE })
    await post('promoteAsset', { kind: 'role', templateId: 'role-1' })
    expect(responses[1].status).toBe(409)
    expect(JSON.parse(responses[1].body)).toMatchObject({ ok: false, error: { code: 'WF_ASSET_DUPLICATE' } })

    // 领域码 ERR_ASSET_VERSION_NOT_FOUND → 404
    await post('rollbackAsset', { kind: 'role', assetId: 'role-1', versionId: 9 })
    expect(responses[2].status).toBe(404)
    expect(JSON.parse(responses[2].body)).toMatchObject({ ok: false, error: { code: 'WF_ASSET_VERSION_NOT_FOUND' } })

    // 边界自身的参数错误仍为 400（kind 缺失/非法按既有约定抛 HttpError，不带领域码）
    await post('listAssets', { kind: 'asset' })
    expect(responses[3].status).toBe(400)
    expect(JSON.parse(responses[3].body)).toMatchObject({ ok: false, error: { message: 'requires kind: workflow|role' } })
  })
})

// tests/host/api/asset-prompts.test.ts
//
// 提示词资产在 GUI API 边界的翻译契约：
// - 复用现有资产端点（listAssets / getAsset / saveAssetVersion / listAssetVersions / rollbackAsset）；
// - 归档 / 恢复被明确拒绝（409 稳定码），因为提示词资产必须保持活跃；
// - 保存只接受正文，名称 / 描述等不可变字段不得随载荷出现。

import { afterEach, describe, expect, it } from 'vitest'
import type { PromptAssetDetail, PromptAssetSummary } from '../../../src/host/shared/asset-types.js'
import { ERR_PROMPT_ASSET_ACTIVE_ONLY } from '../../../src/host/shared/protocol.js'
import { cleanupAll, FakeAssetStore, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

async function makePromptHarness(): Promise<{ h: Awaited<ReturnType<typeof makeHarness>>; assets: FakeAssetStore }> {
  const assets = new FakeAssetStore()
  assets.seedPrompt({ assetId: 'ep-agent', experienceType: 'agent', prompt: 'agent 正文' })
  assets.seedPrompt({ assetId: 'ep-orchestrator', experienceType: 'orchestrator', prompt: '编排正文' })
  const h = await makeHarness({ assets })
  return { h, assets }
}

describe('提示词资产列表与详情', () => {
  it('listAssets 返回 prompts，并支持 kind=prompt 过滤', async () => {
    const { h } = await makePromptHarness()

    const all = (await h.api.handle('listAssets', {})) as { prompts: PromptAssetSummary[]; workflows: unknown[] }
    expect(all.prompts.map((item) => item.assetId).sort()).toEqual(['ep-agent', 'ep-orchestrator'])
    expect(all.prompts.find((item) => item.assetId === 'ep-agent')).toMatchObject({
      experienceType: 'agent',
      prompt: 'agent 正文',
      promptVersion: 'V1',
    })

    const onlyPrompts = (await h.api.handle('listAssets', { kind: 'prompt' })) as {
      prompts: PromptAssetSummary[]
      workflows: unknown[]
      roles: unknown[]
    }
    expect(onlyPrompts.prompts).toHaveLength(2)
    expect(onlyPrompts.workflows).toEqual([])
    expect(onlyPrompts.roles).toEqual([])

    const onlyRoles = (await h.api.handle('listAssets', { kind: 'role' })) as { prompts: unknown[] }
    expect(onlyRoles.prompts).toEqual([])
  })

  it('getAsset kind=prompt 返回 Active 版本详情', async () => {
    const { h } = await makePromptHarness()

    const detail = (await h.api.handle('getAsset', { kind: 'prompt', assetId: 'ep-agent' })) as PromptAssetDetail
    expect(detail).toMatchObject({ assetId: 'ep-agent', rowId: 'ep-agent@1', prompt: 'agent 正文' })
  })
})

describe('提示词资产保存与版本切换', () => {
  it('saveAssetVersion 只把正文交给领域，并从当前版本继承固定字段', async () => {
    const { h, assets } = await makePromptHarness()

    const result = await h.api.handle('saveAssetVersion', {
      kind: 'prompt',
      assetId: 'ep-agent',
      payload: { prompt: '新正文' },
    })

    expect(result).toMatchObject({ assetId: 'ep-agent', versionId: 2, rowId: 'ep-agent@2', unchanged: false })
    expect(assets.calls.savePrompt).toEqual([{ assetId: 'ep-agent', prompt: '新正文' }])
    expect((await assets.getPromptAsset('ep-agent'))?.name).toBe('agent prompt')
  })

  it('saveAssetVersion 拒绝不可变字段（名称/描述不允许随正文提交）', async () => {
    const { h, assets } = await makePromptHarness()

    await expect(
      h.api.handle('saveAssetVersion', {
        kind: 'prompt',
        assetId: 'ep-agent',
        payload: { prompt: '新正文', name: '尝试改名' },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'WF_ASSET_BAD_ARGS' })
    expect(assets.calls.savePrompt).toEqual([])
  })

  it('saveAssetVersion 缺少正文：400', async () => {
    const { h, assets } = await makePromptHarness()

    await expect(
      h.api.handle('saveAssetVersion', { kind: 'prompt', assetId: 'ep-agent', payload: {} }),
    ).rejects.toMatchObject({ status: 400, code: 'WF_ASSET_BAD_ARGS' })
    expect(assets.calls.savePrompt).toEqual([])
  })

  it('listAssetVersions 与 rollbackAsset 复用资产版本端点', async () => {
    const { h, assets } = await makePromptHarness()
    await h.api.handle('saveAssetVersion', { kind: 'prompt', assetId: 'ep-agent', payload: { prompt: '第二版' } })

    const versions = await h.api.handle('listAssetVersions', { kind: 'prompt', assetId: 'ep-agent' })
    expect(versions).toMatchObject([
      { versionId: 2, rowId: 'ep-agent@2', active: true },
      { versionId: 1, rowId: 'ep-agent@1', active: false },
    ])

    const rolled = (await h.api.handle('rollbackAsset', {
      kind: 'prompt',
      assetId: 'ep-agent',
      versionId: 1,
    })) as PromptAssetDetail
    expect(rolled).toMatchObject({ versionId: 1, rowId: 'ep-agent@1' })
    expect(assets.calls.rollback).toContainEqual({ kind: 'prompt', assetId: 'ep-agent', versionId: 1 })
  })
})

describe('提示词资产必须保持活跃', () => {
  it('retireAsset / restoreAsset 对 prompt 返回 409 且不触达领域', async () => {
    const { h, assets } = await makePromptHarness()

    await expect(h.api.handle('retireAsset', { kind: 'prompt', assetId: 'ep-agent' })).rejects.toMatchObject({
      status: 409,
      code: ERR_PROMPT_ASSET_ACTIVE_ONLY,
    })
    await expect(h.api.handle('restoreAsset', { kind: 'prompt', assetId: 'ep-agent' })).rejects.toMatchObject({
      status: 409,
      code: ERR_PROMPT_ASSET_ACTIVE_ONLY,
    })
    expect(assets.calls.retired).toEqual([])
    expect(assets.calls.restored).toEqual([])
  })

  it('promoteAsset / previewAssetCascade 对 prompt 返回 400', async () => {
    const { h } = await makePromptHarness()

    await expect(
      h.api.handle('promoteAsset', { kind: 'prompt', templateId: 'anything' }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      h.api.handle('previewAssetCascade', { kind: 'prompt', assetId: 'ep-agent', payload: { prompt: 'x' } }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

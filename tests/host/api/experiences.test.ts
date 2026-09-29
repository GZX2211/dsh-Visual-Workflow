// tests/host/api/experiences.test.ts
//
// 经验端点组的边界职责（api/experiences.ts）：列表上限、请求形状校验（400）、
// 领域错误码映射（404）、能力缝缺失（501），以及「边界传了什么给资产库」的翻译契约。
// 经验事实本身由 assets 模块拥有，故此处用伪资产库隔离边界，不验证资产库语义。

import { afterEach, describe, expect, it } from 'vitest'
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_NOT_FOUND } from '../../../src/host/shared/protocol.js'
import { EXPERIENCE_INDEX_MAX_LIMIT } from '../../../src/host/assets/index.js'
import { cleanupAll, FakeAssetStore, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

/** 构造夹具：注入伪资产库（501 用例单独用 makeHarness()）。 */
async function makeExperienceHarness(): Promise<{ h: Awaited<ReturnType<typeof makeHarness>>; assets: FakeAssetStore }> {
  const assets = new FakeAssetStore()
  const h = await makeHarness({ assets })
  return { h, assets }
}

describe('经验列表与状态端点', () => {
  it('listExperiences 返回活跃与已归档两类条目（条目自带 active 标记）', async () => {
    const { h, assets } = await makeExperienceHarness()
    assets.seedExperience({ id: 'ex-1', active: true })
    assets.seedExperience({ id: 'ex-2', active: false })

    const items = (await h.api.handle('listExperiences', {})) as Array<Record<string, unknown>>

    expect(items.map((item) => item.id)).toEqual(['ex-1', 'ex-2'])
    expect(items.map((item) => item.active)).toEqual([true, false])
  })

  it('listExperiences 以召回上限拉取（界面不做无限全表拉取）', async () => {
    const { h, assets } = await makeExperienceHarness()
    const calls: number[] = []
    const original = assets.listExperiences.bind(assets)
    assets.listExperiences = async (limit: number) => {
      calls.push(limit)
      return await original(limit)
    }

    await h.api.handle('listExperiences', {})

    expect(calls).toEqual([EXPERIENCE_INDEX_MAX_LIMIT])
  })

  it('retireExperience / restoreExperience：转交状态切换并返回更新后的条目', async () => {
    const { h, assets } = await makeExperienceHarness()
    assets.seedExperience({ id: 'ex-1', active: true })

    const retired = (await h.api.handle('retireExperience', { experienceId: 'ex-1' })) as Record<string, unknown>
    expect(retired.active).toBe(false)
    const restored = (await h.api.handle('restoreExperience', { experienceId: 'ex-1' })) as Record<string, unknown>
    expect(restored.active).toBe(true)
    expect(assets.experienceCalls.active).toEqual([
      { id: 'ex-1', active: false },
      { id: 'ex-1', active: true },
    ])
  })

  it('saveExperience 转交可编辑字段补丁（只含补丁字段，不夹带只读元信息）', async () => {
    const { h, assets } = await makeExperienceHarness()
    assets.seedExperience({ id: 'ex-1' })

    const saved = (await h.api.handle('saveExperience', {
      experienceId: 'ex-1',
      patch: { taskType: '插件开发', insight: '改写后的经验', evidence: null },
    })) as Record<string, unknown>

    expect(saved).toMatchObject({ id: 'ex-1', taskType: '插件开发', insight: '改写后的经验' })
    expect(assets.experienceCalls.saved).toEqual([
      { id: 'ex-1', patch: { taskType: '插件开发', insight: '改写后的经验', evidence: null } },
    ])
  })
})

describe('经验端点参数校验与能力缝', () => {
  it('经验 id 缺失或空白：ERR_EXPERIENCE_BAD_ARGS 400（先于任何资产库调用）', async () => {
    const { h, assets } = await makeExperienceHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['saveExperience', { patch: { insight: '一' } }],
      ['saveExperience', { experienceId: '   ', patch: { insight: '一' } }],
      ['retireExperience', {}],
      ['restoreExperience', { experienceId: '' }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 400, code: ERR_EXPERIENCE_BAD_ARGS })
    }
    expect(assets.experienceCalls.saved).toHaveLength(0)
    expect(assets.experienceCalls.active).toHaveLength(0)
  })

  it('补丁形状非法：400（非对象 / 未知字段 / 类型不符 / 空补丁）', async () => {
    const { h, assets } = await makeExperienceHarness()
    assets.seedExperience({ id: 'ex-1' })
    const cases: unknown[] = [
      undefined,
      [],
      'insight',
      { unknownField: 'x' },
      { insight: 1 },
      { evidence: 1 },
      {},
    ]
    for (const patch of cases) {
      await expect(h.api.handle('saveExperience', { experienceId: 'ex-1', patch })).rejects.toMatchObject({
        status: 400,
        code: ERR_EXPERIENCE_BAD_ARGS,
      })
    }
    expect(assets.experienceCalls.saved).toHaveLength(0)
  })

  it('补丁允许 null 清空可空字段（与「缺省 = 不改」区分）', async () => {
    const { h, assets } = await makeExperienceHarness()
    assets.seedExperience({ id: 'ex-1', evidence: '旧证据' })

    await h.api.handle('saveExperience', { experienceId: 'ex-1', patch: { evidence: null, reviewFeedback: '再看一遍' } })

    expect(assets.experienceCalls.saved).toEqual([
      { id: 'ex-1', patch: { evidence: null, reviewFeedback: '再看一遍' } },
    ])
  })

  it('经验不存在：领域稳定码透出（HTTP 状态映射属路由层）', async () => {
    const { h } = await makeExperienceHarness()

    await expect(h.api.handle('saveExperience', { experienceId: 'ex-missing', patch: { insight: '一' } })).rejects.toMatchObject({
      code: ERR_EXPERIENCE_NOT_FOUND,
    })
    await expect(h.api.handle('retireExperience', { experienceId: 'ex-missing' })).rejects.toMatchObject({
      code: ERR_EXPERIENCE_NOT_FOUND,
    })
  })

  it('host.assets 缺失：501（明确不可用，不静默返回空经验库）', async () => {
    const h = await makeHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['listExperiences', {}],
      ['saveExperience', { experienceId: 'ex-1', patch: { insight: '一' } }],
      ['retireExperience', { experienceId: 'ex-1' }],
      ['restoreExperience', { experienceId: 'ex-1' }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 501 })
    }
  })
})

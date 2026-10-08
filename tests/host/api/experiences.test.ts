// tests/host/api/experiences.test.ts
//
// 经验端点组的边界职责（api/experiences.ts）：列表上限、请求形状校验（400）、
// 领域错误码映射（404）、能力缝缺失（501），以及「边界传了什么给经验域」的翻译契约。
// 经验事实与检索投影由经验域拥有，故此处用伪经验域隔离边界，不验证域内语义。

import { afterEach, describe, expect, it } from 'vitest'
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_NOT_FOUND } from '../../../src/host/shared/protocol.js'
import { EXPERIENCE_LIST_MAX_LIMIT } from '../../../src/host/assets/index.js'
import type { ExperienceStatsEntry } from '../../../src/host/shared/asset-types.js'
import { cleanupAll, FakeExperienceDomain, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

/** 一条完整的统计投影（派生事实；字段与 experience_stats 列一致）。 */
function statsFixture(overrides: Partial<ExperienceStatsEntry> = {}): ExperienceStatsEntry {
  return {
    experienceId: 'ex-1',
    effectiveSampleCount: 1.75,
    recalledCount: 3,
    usedCount: 2,
    fitMean: 0.75,
    empiricalValue: 0.4,
    variance: 0.01,
    stability: 0.9,
    evidenceStrength: 0.2,
    harmCount: 0,
    harmRate: 0,
    harmSeverity: 0,
    qualitySignal: 0.07,
    trust: 0.53,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 九个语义字段的完整补丁（字段域闭集；顺序无关）。 */
const FULL_PATCH = {
  responsibility: '负责插件发布链路',
  taskType: '插件开发',
  decisionDomain: '发布时机取舍',
  situation: '发布前发现回归缺陷',
  trigger: '再次进入发布流程',
  principle: '先跑端到端再发布',
  recommendedAction: '发布前补一轮端到端验证',
  exclusions: ['一次性脚本'],
  evidence: ['回归缺陷在端到端阶段暴露'],
}

/** 构造夹具：注入伪经验域（501 用例单独用 makeHarness()）。 */
async function makeExperienceHarness(): Promise<{ h: Awaited<ReturnType<typeof makeHarness>>; domain: FakeExperienceDomain }> {
  const domain = new FakeExperienceDomain()
  const h = await makeHarness({ experience: domain })
  return { h, domain }
}

describe('经验列表与状态端点', () => {
  it('listExperiences 返回活跃与已归档两类条目（条目自带 active 标记）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1', active: true })
    domain.seedExperience({ id: 'ex-2', active: false })

    const items = (await h.api.handle('listExperiences', {})) as Array<Record<string, unknown>>

    expect(items.map((item) => item.id)).toEqual(['ex-1', 'ex-2'])
    expect(items.map((item) => item.active)).toEqual([true, false])
  })

  it('listExperiences 以列表上限拉取（界面不做无限全表拉取）', async () => {
    const { h, domain } = await makeExperienceHarness()

    await h.api.handle('listExperiences', {})

    expect(domain.calls.list).toEqual([{ limit: EXPERIENCE_LIST_MAX_LIMIT }])
  })

  it('saveExperience 转交九个语义字段补丁（只含补丁字段，不夹带只读元信息）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1' })

    const saved = (await h.api.handle('saveExperience', {
      experienceId: 'ex-1',
      patch: { responsibility: '负责发布链路', principle: '先跑端到端', evidence: ['回归缺陷'] },
    })) as Record<string, unknown>

    expect(saved).toMatchObject({ id: 'ex-1', responsibility: '负责发布链路', principle: '先跑端到端', evidence: ['回归缺陷'] })
    expect(domain.calls.update).toEqual([
      { experienceId: 'ex-1', patch: { responsibility: '负责发布链路', principle: '先跑端到端', evidence: ['回归缺陷'] } },
    ])
  })

  it('saveExperience 接受九字段全量补丁（字段域闭集完整可用）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1' })

    const saved = (await h.api.handle('saveExperience', { experienceId: 'ex-1', patch: FULL_PATCH })) as Record<string, unknown>

    expect(domain.calls.update).toEqual([{ experienceId: 'ex-1', patch: FULL_PATCH }])
    expect(saved).toMatchObject(FULL_PATCH)
  })

  it('saveExperience 数组字段允许 null 清空（与「缺省 = 不改」区分）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1', exclusions: ['旧条件'], evidence: ['旧证据'] })

    const saved = (await h.api.handle('saveExperience', {
      experienceId: 'ex-1',
      patch: { evidence: null, exclusions: null },
    })) as Record<string, unknown>

    expect(domain.calls.update).toEqual([{ experienceId: 'ex-1', patch: { evidence: null, exclusions: null } }])
    expect(saved.evidence).toEqual([])
    expect(saved.exclusions).toEqual([])
  })

  it('saveExperience 缺省数组字段不参与补丁（不改而非清空）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1', evidence: ['既有证据'] })

    const saved = (await h.api.handle('saveExperience', { experienceId: 'ex-1', patch: { principle: '改原则' } })) as Record<string, unknown>

    expect(domain.calls.update).toEqual([{ experienceId: 'ex-1', patch: { principle: '改原则' } }])
    expect(saved.evidence).toEqual(['既有证据'])
  })

  it('saveExperience 返回领域重算后的检索投影与向量元信息', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({
      id: 'ex-1',
      taskRetrievalText: '旧任务投影',
      decisionRetrievalText: '旧决策投影',
    })

    const saved = (await h.api.handle('saveExperience', {
      experienceId: 'ex-1',
      patch: { responsibility: '负责发布链路', taskType: '插件开发', situation: '发布前发现缺陷', trigger: '再次发布', decisionDomain: '发布时机', principle: '先跑端到端', recommendedAction: '补验证' },
    })) as Record<string, unknown>

    expect(saved.taskRetrievalText).toBe('负责发布链路 / 插件开发 / 发布前发现缺陷 / 再次发布')
    expect(saved.decisionRetrievalText).toBe('发布时机 / 先跑端到端 / 补验证 / ')
    expect(saved.embeddingModel).toBe('fake-embed')
    expect(saved.embeddingDimension).toBe(4)
    expect(saved.sourceRunId).toBe('run-1')
    expect(saved.generationPromptId).toBe('prompt-1')
    expect(saved.generationPromptVersion).toBe('v1')
  })

  it('retireExperience / restoreExperience：转交状态切换并返回更新后的条目', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1', active: true })

    const retired = (await h.api.handle('retireExperience', { experienceId: 'ex-1' })) as Record<string, unknown>
    expect(retired.active).toBe(false)
    const restored = (await h.api.handle('restoreExperience', { experienceId: 'ex-1' })) as Record<string, unknown>
    expect(restored.active).toBe(true)
    expect(domain.calls.retired).toEqual(['ex-1'])
    expect(domain.calls.restored).toEqual(['ex-1'])
  })
})

describe('经验统计投影（只读透传）', () => {
  it('test_列表_条目自带stats时原样透传且无统计行的条目不伪造', async () => {
    const { h, domain } = await makeExperienceHarness()
    const stats = statsFixture()
    domain.seedExperience({ id: 'ex-1', stats })
    domain.seedExperience({ id: 'ex-2' })

    const items = (await h.api.handle('listExperiences', {})) as Array<Record<string, unknown>>

    expect(items[0].stats).toEqual(stats)
    // 没有统计行 ≠ 统计为 0：边界不得补一个假的 0.5 中性值
    expect(Object.hasOwn(items[1], 'stats')).toBe(false)
  })

  it('test_保存归档恢复_返回条目仍带stats（派生投影不因状态切换丢失）', async () => {
    const { h, domain } = await makeExperienceHarness()
    const stats = statsFixture()
    domain.seedExperience({ id: 'ex-1', stats })

    const saved = (await h.api.handle('saveExperience', { experienceId: 'ex-1', patch: { principle: '改原则' } })) as Record<string, unknown>
    const retired = (await h.api.handle('retireExperience', { experienceId: 'ex-1' })) as Record<string, unknown>
    const restored = (await h.api.handle('restoreExperience', { experienceId: 'ex-1' })) as Record<string, unknown>

    expect(saved.stats).toEqual(stats)
    expect(retired.stats).toEqual(stats)
    expect(restored.stats).toEqual(stats)
  })

  it('test_保存补丁携带统计字段_400拒绝（统计来自评价历史，人工不可编辑）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1', stats: statsFixture() })

    for (const patch of [{ trust: 0.99 }, { empiricalValue: 1 }, { stats: statsFixture() }]) {
      await expect(h.api.handle('saveExperience', { experienceId: 'ex-1', patch })).rejects.toMatchObject({
        status: 400,
        code: ERR_EXPERIENCE_BAD_ARGS,
      })
    }
    expect(domain.calls.update).toHaveLength(0)
  })
})

describe('经验端点参数校验与能力缝', () => {
  it('经验 id 缺失或空白：ERR_EXPERIENCE_BAD_ARGS 400（先于任何经验域调用）', async () => {
    const { h, domain } = await makeExperienceHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['saveExperience', { patch: { principle: '一' } }],
      ['saveExperience', { experienceId: '   ', patch: { principle: '一' } }],
      ['retireExperience', {}],
      ['restoreExperience', { experienceId: '' }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 400, code: ERR_EXPERIENCE_BAD_ARGS })
    }
    expect(domain.calls.update).toHaveLength(0)
    expect(domain.calls.retired).toHaveLength(0)
    expect(domain.calls.restored).toHaveLength(0)
  })

  it('补丁形状非法：400（非对象 / 未知字段 / 类型不符 / 空补丁）', async () => {
    const { h, domain } = await makeExperienceHarness()
    domain.seedExperience({ id: 'ex-1' })
    const cases: unknown[] = [
      undefined,
      [],
      'principle',
      { unknownField: 'x' },
      { insight: '旧字段已删除，一律视为未知字段' },
      { taskContext: '旧字段已删除，一律视为未知字段' },
      { reviewFeedback: '旧字段已删除，一律视为未知字段' },
      { principle: 1 },
      { evidence: 1 },
      { exclusions: '不是数组' },
      { evidence: ['正常', 2] },
      { exclusions: [{ text: '不是字符串' }] },
      {},
    ]
    for (const patch of cases) {
      await expect(h.api.handle('saveExperience', { experienceId: 'ex-1', patch })).rejects.toMatchObject({
        status: 400,
        code: ERR_EXPERIENCE_BAD_ARGS,
      })
    }
    expect(domain.calls.update).toHaveLength(0)
  })

  it('经验不存在：领域稳定码透出（HTTP 状态映射属路由层）', async () => {
    const { h } = await makeExperienceHarness()

    await expect(h.api.handle('saveExperience', { experienceId: 'ex-missing', patch: { principle: '一' } })).rejects.toMatchObject({
      code: ERR_EXPERIENCE_NOT_FOUND,
    })
    await expect(h.api.handle('retireExperience', { experienceId: 'ex-missing' })).rejects.toMatchObject({
      code: ERR_EXPERIENCE_NOT_FOUND,
    })
  })

  it('host.experience 缺失：501（明确不可用，不静默返回空经验库）', async () => {
    const h = await makeHarness()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['listExperiences', {}],
      ['saveExperience', { experienceId: 'ex-1', patch: { principle: '一' } }],
      ['retireExperience', { experienceId: 'ex-1' }],
      ['restoreExperience', { experienceId: 'ex-1' }],
    ]
    for (const [endpoint, args] of cases) {
      await expect(h.api.handle(endpoint, args)).rejects.toMatchObject({ status: 501 })
    }
  })
})

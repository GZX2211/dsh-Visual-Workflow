// tests/client/lib/experience-stats.test.ts
//
// experienceStatRowsOf（lib/experience-stats.ts）单测：统计事实 → 只读展示文本的投影口径。
//
// 为什么值得脱离渲染单测：精度（计数取整 / 比率两位小数）与「统计行缺失」的降级都属于
// 展示语义，不需要 DOM 即可确定性验证；一旦退回组件内联格式化，这层口径就没有守护。

import { describe, expect, it } from 'vitest'
import { EXPERIENCE_STAT_FIELDS, experienceStatRowsOf } from '../../../src/client/lib/experience-stats.js'
import type { ExperienceStatsEntry } from '../../../src/host/shared/asset-types.js'

/** 统计行样本：数值刻意取可精确表达的小数，避免浮点四舍五入带来的偶发差异。 */
function stats(overrides: Partial<ExperienceStatsEntry> = {}): ExperienceStatsEntry {
  return {
    experienceId: 'ex-1',
    effectiveSampleCount: 3.5,
    recalledCount: 7,
    usedCount: 4,
    fitMean: 0.8,
    empiricalValue: -0.25,
    variance: 0.02,
    stability: 0.9,
    evidenceStrength: 0.63,
    harmCount: 1,
    harmRate: 0.25,
    harmSeverity: 0.5,
    qualitySignal: 0.3,
    trust: 0.5,
    updatedAt: 1,
    ...overrides,
  }
}

describe('experienceStatRowsOf：六项只读统计的展示顺序与精度', () => {
  it('test_投影_有统计_按契约顺序给出六项且计数取整比率两位小数', () => {
    const rows = experienceStatRowsOf(stats())

    expect(rows).toEqual([
      { field: 'trust', text: '0.50' },
      { field: 'empiricalValue', text: '-0.25' },
      { field: 'evidenceStrength', text: '0.63' },
      { field: 'stability', text: '0.90' },
      { field: 'usedCount', text: '4' },
      { field: 'harmRate', text: '0.25' },
    ])
    expect(EXPERIENCE_STAT_FIELDS).toEqual(['trust', 'empiricalValue', 'evidenceStrength', 'stability', 'usedCount', 'harmRate'])
  })

  it('test_投影_中性信任度_展示0.50而不是被压成0或1', () => {
    const rows = experienceStatRowsOf(stats({ trust: 0.5 }))

    expect(rows?.find((row) => row.field === 'trust')?.text).toBe('0.50')
  })

  it('test_投影_使用次数_按整数展示不带小数位', () => {
    const rows = experienceStatRowsOf(stats({ usedCount: 12 }))

    expect(rows?.find((row) => row.field === 'usedCount')?.text).toBe('12')
  })
})

describe('experienceStatRowsOf：统计缺失与形状漂移的降级', () => {
  it('test_投影_统计缺失_返回null表示暂无统计', () => {
    expect(experienceStatRowsOf(undefined)).toBeNull()
    expect(experienceStatRowsOf(null)).toBeNull()
  })

  it('test_投影_缺少任一项统计值_整块降级为null', () => {
    const incomplete: Partial<ExperienceStatsEntry> = stats()
    delete incomplete.harmRate

    expect(experienceStatRowsOf(incomplete)).toBeNull()
  })

  it('test_投影_统计值不是有限数_整块降级为null', () => {
    expect(experienceStatRowsOf(stats({ trust: Number.NaN }))).toBeNull()
    expect(experienceStatRowsOf({ ...stats(), stability: '0.9' })).toBeNull()
  })
})

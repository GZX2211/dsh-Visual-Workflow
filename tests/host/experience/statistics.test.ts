// tests/host/experience/statistics.test.ts
//
// 评价 → 统计聚合门（§9～§13、§33 冷启动）。
//
// 为什么逐个子公式单独测、再测一次整体聚合：统计是「可完整重放」的派生投影（§3.2 / §25），
// 重放正确性由每个子公式的确定性保证；只测整体聚合无法指出是哪一项漂移，参数调整时
// 也就无法判断「变化只应影响这一项」。

import { describe, expect, it } from "vitest"
import type { ExperienceEvaluationScores } from "../../../src/host/shared/asset-types.js"
import { NEUTRAL_STATS } from "../../../src/host/experience/constants.js"
import {
  aggregateExperienceStats,
  buildEvaluationSamples,
  calculateEffectiveSampleCount,
  calculateEmpiricalValue,
  calculateEvidenceStrength,
  calculateFitMean,
  calculateHarmCount,
  calculateHarmRate,
  calculateHarmSeverity,
  calculateStability,
  calculateVariance,
  type EvaluationSample,
} from "../../../src/host/experience/statistics.js"

/** 四维评分工厂（默认全部取最高锚点，用例只覆盖关心的一维）。 */
function scores(overrides: Partial<ExperienceEvaluationScores> = {}): ExperienceEvaluationScores {
  return {
    fitScore: 1,
    decisionEffect: 1,
    informationGain: 1,
    causalConfidence: 1,
    ...overrides,
  }
}

/** 手算样本（权重与有效效果直接给出，用于隔离验证子公式）。 */
function sample(weight: number, effect: number, fit = 1): EvaluationSample {
  return { weight, fit, effect }
}

describe("buildEvaluationSamples", () => {
  it("test_评价序列_折算为权重与有效效果", () => {
    const samples = buildEvaluationSamples([
      scores({ fitScore: 1, causalConfidence: 1, decisionEffect: 1, informationGain: 1 }),
      scores({ fitScore: 0.5, causalConfidence: 0, decisionEffect: -1, informationGain: 1 }),
    ])

    expect(samples).toHaveLength(2)
    expect(samples[0]).toEqual({ weight: 1, fit: 1, effect: 1 })
    expect(samples[1]).toEqual({ weight: 0.125, fit: 0.5, effect: -1 })
  })
})

describe("calculateEvidenceStrength（§11 1 - exp(-n_eff / 8)）", () => {
  it("test_无样本_证据为 0", () => {
    expect(calculateEvidenceStrength(0)).toBe(0)
  })

  it("test_饱和尺度附近_逐值命中公式", () => {
    expect(calculateEvidenceStrength(8)).toBeCloseTo(0.6321205588285577, 12)
    expect(calculateEvidenceStrength(16)).toBeCloseTo(0.8646647167633873, 12)
  })

  it("test_样本增加_增量收益递减并趋于饱和", () => {
    const first = calculateEvidenceStrength(8) - calculateEvidenceStrength(0)
    const later = calculateEvidenceStrength(100) - calculateEvidenceStrength(50)

    expect(later).toBeLessThan(first)
    expect(calculateEvidenceStrength(100)).toBeGreaterThan(0.99999)
  })
})

describe("加权统计子公式", () => {
  it("test_有效样本量_为权重之和而非条数", () => {
    expect(calculateEffectiveSampleCount([sample(1, 1), sample(0.125, -1), sample(0, 1)])).toBeCloseTo(1.125, 12)
  })

  it("test_适用性均值_按权重加权", () => {
    expect(calculateFitMean([sample(1, 1, 1), sample(0.5, 1, 0.5)])).toBeCloseTo(0.8333333333333334, 12)
  })

  it("test_权重全为 0_均值按 0 解释而不是除零", () => {
    expect(calculateFitMean([sample(0, 1, 1)])).toBe(0)
    expect(calculateEmpiricalValue([sample(0, -1)])).toBe(0)
    expect(calculateVariance([sample(0, -1)])).toBe(0)
    expect(calculateHarmSeverity([sample(0, -1)])).toBe(0)
  })

  it("test_经验价值_按中性先验收缩", () => {
    // Σw = 1.5、Σ(w×v) = 0.5 → 0.5 / (3 + 1.5)
    expect(calculateEmpiricalValue([sample(1, 1), sample(0.5, -1)])).toBeCloseTo(0.1111111111111111, 12)
  })

  it("test_加权方差_命中定义", () => {
    expect(calculateVariance([sample(1, 0.8), sample(1, 0.7), sample(1, 0.9), sample(1, 0.8)])).toBeCloseTo(0.005, 12)
  })

  it("test_稳定性_由标准差映射并可低至 0", () => {
    expect(calculateStability([sample(1, 0.8), sample(1, 0.7), sample(1, 0.9), sample(1, 0.8)])).toBeCloseTo(0.9292893218813453, 12)
    expect(calculateStability([sample(1, 1), sample(1, -1)])).toBe(0)
  })

  it("test_无样本_稳定性为中性的 1", () => {
    expect(calculateStability([])).toBe(1)
    expect(calculateVariance([])).toBe(0)
  })

  it("test_有害统计_按条数与加权严重度分别计算", () => {
    const samples = [sample(0.5, -1), sample(0.5, 0.5), sample(1, 0)]

    expect(calculateHarmCount(samples)).toBe(1)
    expect(calculateHarmRate(samples)).toBeCloseTo(1 / 3, 12)
    expect(calculateHarmSeverity(samples)).toBeCloseTo(0.25, 12)
  })

  it("test_无样本_有害比例按 0 解释", () => {
    expect(calculateHarmCount([])).toBe(0)
    expect(calculateHarmRate([])).toBe(0)
  })
})

describe("aggregateExperienceStats（§33 冷启动与整体聚合）", () => {
  it("test_无评价_产出中性统计并原样带入注入次数", () => {
    const stats = aggregateExperienceStats({ evaluations: [], recalledCount: 4 })

    expect(stats).toEqual({ ...NEUTRAL_STATS, recalledCount: 4 })
  })

  it("test_单次满分评价_证据不足不足以拉高信任", () => {
    const stats = aggregateExperienceStats({ evaluations: [scores()], recalledCount: 1 })

    expect(stats.effectiveSampleCount).toBe(1)
    expect(stats.usedCount).toBe(1)
    expect(stats.empiricalValue).toBe(0.25)
    expect(stats.evidenceStrength).toBeCloseTo(0.11750309741540454, 12)
    expect(stats.stability).toBe(1)
    expect(stats.qualitySignal).toBeCloseTo(0.029375774353851136, 12)
    expect(stats.trust).toBeCloseTo(0.513219098459233, 12)
    expect(stats.trust).toBeLessThan(0.52)
  })

  it("test_评价次数增加_证据与信任单调上升且远离中性", () => {
    const one = aggregateExperienceStats({ evaluations: [scores()], recalledCount: 1 })
    const eight = aggregateExperienceStats({ evaluations: Array.from({ length: 8 }, () => scores()), recalledCount: 8 })

    expect(eight.effectiveSampleCount).toBe(8)
    expect(eight.usedCount).toBe(8)
    expect(eight.empiricalValue).toBeCloseTo(0.7272727272727273, 12)
    expect(eight.evidenceStrength).toBeCloseTo(0.6321205588285577, 12)
    expect(eight.qualitySignal).toBeCloseTo(0.4597240427844056, 12)
    expect(eight.trust).toBeCloseTo(0.7068758192529825, 12)
    expect(eight.trust).toBeGreaterThan(one.trust)
  })

  it("test_正负交错_稳定性归零且信任回到中性", () => {
    const stats = aggregateExperienceStats({
      evaluations: [
        scores({ decisionEffect: 1 }),
        scores({ decisionEffect: -1 }),
        scores({ decisionEffect: 1 }),
        scores({ decisionEffect: -1 }),
      ],
      recalledCount: 4,
    })

    expect(stats.variance).toBeCloseTo(1, 12)
    expect(stats.stability).toBe(0)
    expect(stats.empiricalValue).toBe(0)
    expect(stats.qualitySignal).toBe(0)
    expect(stats.trust).toBe(0.5)
    expect(stats.harmCount).toBe(2)
    expect(stats.harmRate).toBe(0.5)
    expect(stats.harmSeverity).toBeCloseTo(0.5, 12)
  })

  it("test_有害经验证据强_信任低于中性", () => {
    const stats = aggregateExperienceStats({
      evaluations: Array.from({ length: 8 }, () => scores({ decisionEffect: -1 })),
      recalledCount: 8,
    })

    expect(stats.empiricalValue).toBeCloseTo(-0.7272727272727273, 12)
    expect(stats.trust).toBeLessThan(0.35)
    expect(stats.harmRate).toBe(1)
    expect(stats.harmSeverity).toBe(1)
  })

  it("test_泛化正确但信息增益低_正向价值被抑制", () => {
    const generic = aggregateExperienceStats({ evaluations: [scores({ decisionEffect: 1, informationGain: 0 })], recalledCount: 1 })
    const useful = aggregateExperienceStats({ evaluations: [scores({ decisionEffect: 1, informationGain: 1 })], recalledCount: 1 })

    expect(generic.empiricalValue).toBeCloseTo(0.125, 12)
    expect(generic.empiricalValue).toBeLessThan(useful.empiricalValue)
  })

  it("test_适用性为 0 的评价_计入使用次数但不产生统计力", () => {
    const stats = aggregateExperienceStats({ evaluations: [scores({ fitScore: 0, decisionEffect: -1 })], recalledCount: 1 })

    expect(stats.usedCount).toBe(1)
    expect(stats.effectiveSampleCount).toBe(0)
    expect(stats.empiricalValue).toBe(0)
    expect(stats.harmCount).toBe(1)
    expect(stats.harmRate).toBe(1)
    expect(stats.harmSeverity).toBe(0)
    expect(stats.trust).toBe(0.5)
  })

  it("test_同一经验重复评价_每次都是独立使用事件", () => {
    const stats = aggregateExperienceStats({ evaluations: [scores(), scores()], recalledCount: 2 })

    expect(stats.usedCount).toBe(2)
    expect(stats.recalledCount).toBe(2)
  })

  it("test_同一输入两次聚合_逐字段一致（可重放）", () => {
    const input = { evaluations: [scores({ decisionEffect: -0.5 }), scores({ fitScore: 0.25 })], recalledCount: 3 }

    expect(aggregateExperienceStats(input)).toEqual(aggregateExperienceStats(input))
  })
})

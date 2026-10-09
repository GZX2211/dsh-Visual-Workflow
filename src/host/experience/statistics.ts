// src/host/experience/statistics.ts
//
// 评价历史 → 统计投影的确定性聚合（§9～§13、§22、§24～§26）。
//
// 为什么聚合必须是纯函数而不是 SQL 聚合：统计是可重建的派生投影，参数（先验强度、证据饱和
// 尺度等）会随口径演进而变（§25）。只有把「读全部历史 → 逐条折算 → 汇总」写成一处纯函数，
// 重建才能与增量更新走同一套公式，历史也才能被重新解释；散到 SQL 里则增量与重建必然两套。
//
// 全部输入即事实：不读时钟、不读全局、不依赖调用顺序（§26 离线模拟与 property test 的前提）。

import type {
  ExperienceEvaluationScores,
  ExperienceStatsAggregateInput,
  ExperienceStatsValues,
} from "../shared/asset-types.js"
import { EVIDENCE_STRENGTH_SCALE, PRIOR_STRENGTH } from "./constants.js"
import { calculateEffectiveEffect, calculateEvaluationWeight } from "./scoring.js"
import { calculateQualitySignal, calculateTrust } from "./trust.js"

/**
 * 一次评价折算后的统计样本。
 *
 * 为什么单独成型：折算（评分 → 权重与价值）与汇总（样本 → 统计）分开后，各汇总公式都能被
 * 独立验证，也让离线对比不同折算口径时无需重写汇总部分。
 */
export interface EvaluationSample {
  /** 该次评价的有效统计权重 `w`。 */
  weight: number
  /** 该次评价的适用性 `F`（用于加权均值）。 */
  fit: number
  /** 该次评价的有效价值 `v`。 */
  effect: number
}

/** 把评价历史折算为统计样本（顺序保留，重复评价各计一条独立样本）。 */
export function buildEvaluationSamples(evaluations: readonly ExperienceEvaluationScores[]): EvaluationSample[] {
  return evaluations.map((scores) => ({
    weight: calculateEvaluationWeight(scores),
    fit: scores.fitScore,
    effect: calculateEffectiveEffect(scores),
  }))
}

/** 有效样本量 `n_eff = Σ w`：不是使用次数，高置信高适用评价贡献更大（§10.2）。 */
export function calculateEffectiveSampleCount(samples: readonly EvaluationSample[]): number {
  return samples.reduce((sum, sample) => sum + sample.weight, 0)
}

/** 证据强度 `1 - exp(-n_eff / 8)`：随有效样本量增加而饱和（§11）。 */
export function calculateEvidenceStrength(effectiveSampleCount: number): number {
  return 1 - Math.exp(-effectiveSampleCount / EVIDENCE_STRENGTH_SCALE)
}

/** 加权适用性均值 `Σ(w × F) / Σw`；无有效权重时按 0 解释（不除零）。 */
export function calculateFitMean(samples: readonly EvaluationSample[]): number {
  const totalWeight = calculateEffectiveSampleCount(samples)
  if (totalWeight === 0) return 0
  return samples.reduce((sum, sample) => sum + sample.weight * sample.fit, 0) / totalWeight
}

/**
 * 收缩后的经验价值 `Σ(w × v) / (prior_strength + Σw)`（§10.3）。
 *
 * 先验均值为 0，因此分子不含先验项：一次满分评价也只能把价值推到 `1/(3+1)` 量级。
 */
export function calculateEmpiricalValue(samples: readonly EvaluationSample[]): number {
  const weightedValue = samples.reduce((sum, sample) => sum + sample.weight * sample.effect, 0)
  return weightedValue / (PRIOR_STRENGTH + calculateEffectiveSampleCount(samples))
}

/** 加权方差 `Σ(w × (v - m)²) / Σw`；无有效权重时 0（没有可归因的波动）。 */
export function calculateVariance(samples: readonly EvaluationSample[]): number {
  const totalWeight = calculateEffectiveSampleCount(samples)
  if (totalWeight === 0) return 0
  const mean = samples.reduce((sum, sample) => sum + sample.weight * sample.effect, 0) / totalWeight
  return samples.reduce((sum, sample) => sum + sample.weight * (sample.effect - mean) ** 2, 0) / totalWeight
}

/** 稳定性 `clamp(1 - sqrt(variance), 0, 1)`；无评价时为中性的 1（§12）。 */
export function calculateStability(samples: readonly EvaluationSample[]): number {
  const stability = 1 - Math.sqrt(calculateVariance(samples))
  return Math.min(1, Math.max(0, stability))
}

/** 有害评价条数：有效价值为负的条数（与权重无关，条数用于展示与治理）。 */
export function calculateHarmCount(samples: readonly EvaluationSample[]): number {
  return samples.filter((sample) => sample.effect < 0).length
}

/** 有害比例：负向条数 / 全部评价条数；无评价时为 0（§13）。 */
export function calculateHarmRate(samples: readonly EvaluationSample[]): number {
  if (samples.length === 0) return 0
  return calculateHarmCount(samples) / samples.length
}

/** 有害严重度 `Σ(w × max(-v, 0)) / Σw`；无有效权重时为 0。 */
export function calculateHarmSeverity(samples: readonly EvaluationSample[]): number {
  const totalWeight = calculateEffectiveSampleCount(samples)
  if (totalWeight === 0) return 0
  const weightedHarm = samples.reduce((sum, sample) => sum + sample.weight * Math.max(-sample.effect, 0), 0)
  return weightedHarm / totalWeight
}

/**
 * 聚合某经验的全部评价历史与使用事实，产出统计投影（§10～§14）。
 *
 * `recalledCount` 由调用方原样带入：注入次数来自使用事实表，不由评价推导（被注入不一定被评价）。
 */
export function aggregateExperienceStats(input: ExperienceStatsAggregateInput): ExperienceStatsValues {
  const samples = buildEvaluationSamples(input.evaluations)
  const effectiveSampleCount = calculateEffectiveSampleCount(samples)
  const empiricalValue = calculateEmpiricalValue(samples)
  const evidenceStrength = calculateEvidenceStrength(effectiveSampleCount)
  const stability = calculateStability(samples)
  const qualitySignal = calculateQualitySignal({ empiricalValue, evidenceStrength, stability })
  return {
    effectiveSampleCount,
    recalledCount: input.recalledCount,
    usedCount: input.evaluations.length,
    fitMean: calculateFitMean(samples),
    empiricalValue,
    variance: calculateVariance(samples),
    stability,
    evidenceStrength,
    harmCount: calculateHarmCount(samples),
    harmRate: calculateHarmRate(samples),
    harmSeverity: calculateHarmSeverity(samples),
    qualitySignal,
    trust: calculateTrust(qualitySignal),
  }
}

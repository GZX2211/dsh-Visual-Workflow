import type { ExperienceEvaluationScores, ExperienceStatsAggregateInput, ExperienceStatsValues } from "../shared/asset-types.js";
/**
 * 一次评价折算后的统计样本。
 *
 * 为什么单独成型：折算（评分 → 权重与价值）与汇总（样本 → 统计）分开后，各汇总公式都能被
 * 独立验证，也让离线对比不同折算口径时无需重写汇总部分。
 */
export interface EvaluationSample {
    /** 该次评价的有效统计权重 `w`。 */
    weight: number;
    /** 该次评价的适用性 `F`（用于加权均值）。 */
    fit: number;
    /** 该次评价的有效价值 `v`。 */
    effect: number;
}
/** 把评价历史折算为统计样本（顺序保留，重复评价各计一条独立样本）。 */
export declare function buildEvaluationSamples(evaluations: readonly ExperienceEvaluationScores[]): EvaluationSample[];
/** 有效样本量 `n_eff = Σ w`：不是使用次数，高置信高适用评价贡献更大（§10.2）。 */
export declare function calculateEffectiveSampleCount(samples: readonly EvaluationSample[]): number;
/** 证据强度 `1 - exp(-n_eff / 8)`：随有效样本量增加而饱和（§11）。 */
export declare function calculateEvidenceStrength(effectiveSampleCount: number): number;
/** 加权适用性均值 `Σ(w × F) / Σw`；无有效权重时按 0 解释（不除零）。 */
export declare function calculateFitMean(samples: readonly EvaluationSample[]): number;
/**
 * 收缩后的经验价值 `Σ(w × v) / (prior_strength + Σw)`（§10.3）。
 *
 * 先验均值为 0，因此分子不含先验项：一次满分评价也只能把价值推到 `1/(3+1)` 量级。
 */
export declare function calculateEmpiricalValue(samples: readonly EvaluationSample[]): number;
/** 加权方差 `Σ(w × (v - m)²) / Σw`；无有效权重时 0（没有可归因的波动）。 */
export declare function calculateVariance(samples: readonly EvaluationSample[]): number;
/** 稳定性 `clamp(1 - sqrt(variance), 0, 1)`；无评价时为中性的 1（§12）。 */
export declare function calculateStability(samples: readonly EvaluationSample[]): number;
/** 有害评价条数：有效价值为负的条数（与权重无关，条数用于展示与治理）。 */
export declare function calculateHarmCount(samples: readonly EvaluationSample[]): number;
/** 有害比例：负向条数 / 全部评价条数；无评价时为 0（§13）。 */
export declare function calculateHarmRate(samples: readonly EvaluationSample[]): number;
/** 有害严重度 `Σ(w × max(-v, 0)) / Σw`；无有效权重时为 0。 */
export declare function calculateHarmSeverity(samples: readonly EvaluationSample[]): number;
/**
 * 聚合某经验的全部评价历史与使用事实，产出统计投影（§10～§14）。
 *
 * `recalledCount` 由调用方原样带入：注入次数来自使用事实表，不由评价推导（被注入不一定被评价）。
 */
export declare function aggregateExperienceStats(input: ExperienceStatsAggregateInput): ExperienceStatsValues;

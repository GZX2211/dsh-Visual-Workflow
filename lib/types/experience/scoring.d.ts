import type { ExperienceEvaluationScores } from "../shared/asset-types.js";
/** 四维评分字段名（判据表的键，也是错误消息与调用方映射的唯一字段清单）。 */
export type EvaluationScoreField = "fitScore" | "decisionEffect" | "informationGain" | "causalConfidence";
/** 四维评分字段顺序（稳定的遍历与错误定位顺序）。 */
export declare const EVALUATION_SCORE_FIELDS: readonly EvaluationScoreField[];
/**
 * 待校验的四维评分载荷（字段全部可选且类型未知）。
 *
 * 为什么字段可为空：载荷来自模型侧 JSON，缺字段与字段类型错是同一类事实（调用方没给出可用的
 * 锚点），校验函数必须能对二者给出同一套可行动原因，而不是在类型层要求调用方先补齐。
 */
export interface EvaluationScoreCandidate {
    fitScore?: unknown;
    decisionEffect?: unknown;
    informationGain?: unknown;
    causalConfidence?: unknown;
}
/** 校验结果：合法时给出收窄后的评分，非法时给出字段与可行动原因。 */
export type EvaluationScoreValidation = {
    ok: true;
    scores: ExperienceEvaluationScores;
} | {
    ok: false;
    field: EvaluationScoreField;
    reason: string;
};
/**
 * 单次评价的有效统计权重（§9.1）：`w = F × (0.25 + 0.75 × C)`。
 *
 * 语义：Fit 决定这次评价对长期价值是否起作用；Causal Confidence 为 0 时仍保留最小统计权重，
 * 因为「有评价但归因不确定」与「没有评价」不是同一件事。
 */
export declare function calculateEvaluationWeight(scores: ExperienceEvaluationScores): number;
/**
 * 单次评价的价值贡献（§9.2）：正向按信息增益衰减，负向不削弱。
 *
 * 语义：泛化正确但信息量低的经验，其正向收益被抑制；有害经验的严重度不因「说得很空泛」而减刑。
 */
export declare function calculateEffectiveEffect(scores: ExperienceEvaluationScores): number;
/**
 * 校验四维评分并收窄为锚点联合类型。
 *
 * 只接受命中五级锚点的数值（容差见 `SCORE_ANCHOR_TOLERANCE`）；决策效果用独立的跨零取值域，
 * 因此 0.25 这类合法锚点在 decisionEffect 上仍然非法。
 */
export declare function validateEvaluationScores(input: EvaluationScoreCandidate): EvaluationScoreValidation;

// src/host/experience/scoring.ts
//
// 评分锚点的确定性校验与单次评价的两条折算公式（§6.1 / §9）。
//
// 为什么公式在本文件而不是统计聚合里：折算（一次评价 → 权重与有效效果）与聚合（多次评价 →
// 统计投影）是两个独立可演进的口径；混在一起后，调「因果权重下限」会与调「先验强度」
// 表现成同一处改动，无法单独重放与对比（§25 / §26）。
//
// 为什么校验必须确定性拒绝而不是就近取整：模型侧只允许选锚点，0.73 这类值表达的是不存在的
// 精度；若被悄悄吸附到最近锚点，评价历史就掺入了调用方从未表达过的语义，且事后无法从
// 数据里看出发生过吸附。
import { CAUSAL_WEIGHT_FLOOR, CAUSAL_WEIGHT_SPAN, DECISION_EFFECT_ANCHORS, EFFECT_INFO_BASE, EFFECT_INFO_SPAN, SCORE_ANCHORS, isDecisionEffectAnchor, isScoreAnchor, } from "./constants.js";
/** 四维字段与各自锚点判据的对应（唯一本体：字段清单与判据不会各自漂移）。 */
const ANCHOR_GUARDS = {
    fitScore: isScoreAnchor,
    decisionEffect: isDecisionEffectAnchor,
    informationGain: isScoreAnchor,
    causalConfidence: isScoreAnchor,
};
/** 四维评分字段顺序（稳定的遍历与错误定位顺序）。 */
export const EVALUATION_SCORE_FIELDS = Object.keys(ANCHOR_GUARDS);
/** 字段的中文语义与模型侧参数名（错误消息要直接告诉模型改哪一维的哪个参数）。 */
const FIELD_LABELS = {
    fitScore: "适用性（fit）",
    decisionEffect: "决策效果（decision_effect）",
    informationGain: "信息增益（information_gain）",
    causalConfidence: "因果归因置信度（causal_confidence）",
};
/** 锚点取值域的十进制文本（与常量本体同源，避免错误消息里出现第二份取值域）。 */
const SCORE_ANCHOR_TEXT = SCORE_ANCHORS.map((anchor) => String(anchor)).join(" / ");
const DECISION_EFFECT_ANCHOR_TEXT = DECISION_EFFECT_ANCHORS.map((anchor) => String(anchor)).join(" / ");
/**
 * 单次评价的有效统计权重（§9.1）：`w = F × (0.25 + 0.75 × C)`。
 *
 * 语义：Fit 决定这次评价对长期价值是否起作用；Causal Confidence 为 0 时仍保留最小统计权重，
 * 因为「有评价但归因不确定」与「没有评价」不是同一件事。
 */
export function calculateEvaluationWeight(scores) {
    return scores.fitScore * (CAUSAL_WEIGHT_FLOOR + CAUSAL_WEIGHT_SPAN * scores.causalConfidence);
}
/**
 * 单次评价的价值贡献（§9.2）：正向按信息增益衰减，负向不削弱。
 *
 * 语义：泛化正确但信息量低的经验，其正向收益被抑制；有害经验的严重度不因「说得很空泛」而减刑。
 */
export function calculateEffectiveEffect(scores) {
    if (scores.decisionEffect < 0)
        return scores.decisionEffect;
    return scores.decisionEffect * (EFFECT_INFO_BASE + EFFECT_INFO_SPAN * scores.informationGain);
}
/** 运行期判据：数值是否命中五级锚点之一（对外复用 constants 本体，不在此重写比较逻辑）。 */
function acceptedBy(field, value) {
    return ANCHOR_GUARDS[field](value);
}
/**
 * 校验四维评分并收窄为锚点联合类型。
 *
 * 只接受命中五级锚点的数值（容差见 `SCORE_ANCHOR_TOLERANCE`）；决策效果用独立的跨零取值域，
 * 因此 0.25 这类合法锚点在 decisionEffect 上仍然非法。
 */
export function validateEvaluationScores(input) {
    for (const field of EVALUATION_SCORE_FIELDS) {
        const value = input[field];
        if (acceptedBy(field, value))
            continue;
        const domain = field === "decisionEffect" ? DECISION_EFFECT_ANCHOR_TEXT : SCORE_ANCHOR_TEXT;
        return {
            ok: false,
            field,
            reason: `${FIELD_LABELS[field]} 只能是五级语义锚点之一：${domain}（实际为 ${String(value)}）；`
                + "请从锚点中选择最接近本次实际情形的一项后重新提交。",
        };
    }
    return {
        ok: true,
        scores: {
            fitScore: input.fitScore,
            decisionEffect: input.decisionEffect,
            informationGain: input.informationGain,
            causalConfidence: input.causalConfidence,
        },
    };
}
//# sourceMappingURL=scoring.js.map
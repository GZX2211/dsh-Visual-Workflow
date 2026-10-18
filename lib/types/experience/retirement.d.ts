import type { ExperienceAutoRetirementReason, ExperienceRetirementFacts } from "../shared/asset-types.js";
/**
 * 事实形状的公共入口再导出：调用方与测试从经验域取契约，不必知道资产库内部读法。
 * 形状本体仍在 shared（资产库读侧与经验域判侧必须消费同一份）。
 */
export type { ExperienceRetirementEvaluationFact, ExperienceRetirementFacts, ExperienceRetirementUsageFact, } from "../shared/asset-types.js";
/** 退役判定结果：不归档，或归档并给出原因与可诊断说明。 */
export type ExperienceRetirementDecision = {
    retire: false;
} | {
    retire: true;
    reason: ExperienceAutoRetirementReason;
    detail: string;
};
/**
 * 判定一条经验是否应退役。
 *
 * 顺序是硬约束：有害优先于长期无用。一次负向决策效果就是实际有害影响，即使这条经验
 * 同时满足长期无用的全部条件，也必须以 `harmful` 归档（原因决定界面解释与后续统计）。
 */
export declare function decideExperienceRetirement(facts: ExperienceRetirementFacts): ExperienceRetirementDecision;

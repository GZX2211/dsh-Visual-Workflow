import type { ExperienceSemanticFields } from "./validation.js";
/** 空列表的稳定占位（不因空数组缺行）。 */
export declare const PROJECTION_EMPTY_VALUE = "\uFF08\u65E0\uFF09";
/** 列表字段元素之间的固定分隔符。 */
export declare const PROJECTION_LIST_SEPARATOR = "\uFF1B";
/** 任务侧检索文本（responsibility + task_type + situation + trigger）。 */
export declare function buildTaskRetrievalText(fields: ExperienceSemanticFields): string;
/** 决策侧检索文本（decision_domain + principle + recommended_action + exclusions）。 */
export declare function buildDecisionRetrievalText(fields: ExperienceSemanticFields): string;
/** 一次投影同时产出两个检索文本（写入与编辑保存共用同一入口，避免两处格式分叉）。 */
export declare function buildRetrievalProjection(fields: ExperienceSemanticFields): {
    taskRetrievalText: string;
    decisionRetrievalText: string;
};
/**
 * 召回候选摘要（responsibility + decision_domain + exclusions + situation）。
 * 只给模型判断「是否需要按 id 取全文」的最少信息：不含量化细节（principle / recommended_action），
 * 避免候选阶段就挤占上下文。
 */
export declare function buildRecallSummary(fields: ExperienceSemanticFields): string;

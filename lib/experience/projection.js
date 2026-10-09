// src/host/experience/projection.ts
//
// 检索投影（系统生成，模型不得提交）。
//
// 为什么用固定 label-value 多行文本而不是自然语言散文：两个检索文本是 embedding 的输入，
// 字段顺序、标签与分隔符必须逐字节稳定，否则同一经验重算投影后与历史向量不可比；标签让
// 「哪一段来自哪个字段」在向量空间里保持可分离。为什么排除数组用固定占位而不是省略该行：
// 行数固定才能避免「空数组的经验」在向量里缺少决策侧段落。
import { normalizeWhitespace } from "./constants.js";
/** 空列表的稳定占位（不因空数组缺行）。 */
export const PROJECTION_EMPTY_VALUE = "（无）";
/** 列表字段元素之间的固定分隔符。 */
export const PROJECTION_LIST_SEPARATOR = "；";
/** 单行 label-value 渲染（值内部换行会被折叠，保证一段一行）。 */
function line(label, value) {
    return `${label}: ${normalizeWhitespace(value)}`;
}
/** 列表渲染：空列表使用稳定占位。 */
function list(values) {
    const items = values.map(normalizeWhitespace);
    return items.length === 0 ? PROJECTION_EMPTY_VALUE : items.join(PROJECTION_LIST_SEPARATOR);
}
/** 任务侧检索文本（responsibility + task_type + situation + trigger）。 */
export function buildTaskRetrievalText(fields) {
    return [
        line("responsibility", fields.responsibility),
        line("task_type", fields.taskType),
        line("situation", fields.situation),
        line("trigger", fields.trigger),
    ].join("\n");
}
/** 决策侧检索文本（decision_domain + principle + recommended_action + exclusions）。 */
export function buildDecisionRetrievalText(fields) {
    return [
        line("decision_domain", fields.decisionDomain),
        line("principle", fields.principle),
        line("recommended_action", fields.recommendedAction),
        line("exclusions", list(fields.exclusions)),
    ].join("\n");
}
/** 一次投影同时产出两个检索文本（写入与编辑保存共用同一入口，避免两处格式分叉）。 */
export function buildRetrievalProjection(fields) {
    return {
        taskRetrievalText: buildTaskRetrievalText(fields),
        decisionRetrievalText: buildDecisionRetrievalText(fields),
    };
}
/**
 * 召回候选摘要（responsibility + decision_domain + exclusions + situation）。
 * 只给模型判断「是否需要按 id 取全文」的最少信息：不含量化细节（principle / recommended_action），
 * 避免候选阶段就挤占上下文。
 */
export function buildRecallSummary(fields) {
    return [
        line("responsibility", fields.responsibility),
        line("decision_domain", fields.decisionDomain),
        line("exclusions", list(fields.exclusions)),
        line("situation", fields.situation),
    ].join("\n");
}
//# sourceMappingURL=projection.js.map
// src/host/experience/team-context.ts
//
// 协作组启动时的「Team 经验共享上下文」渲染（纯函数）。
//
// 为什么把渲染独立出来并固定段落锚点：同一份文本要注入协作组全部成员的初始任务上下文，
// 成员之间必须看到逐字相同的内容，测试与注入侧也据此识别段落边界；渲染纯函数保证
// 「同一次召回 → 同一段文本」，不掺入时间戳等每次变化的动态值。
import { normalizeWhitespace } from "./constants.js";
/** 共享上下文标题锚点（注入侧与测试据此识别段落起始）。 */
export const TEAM_EXPERIENCE_CONTEXT_HEADING = "【团队经验参考】";
/** 共享上下文引言：说明这段文本的性质与使用边界。 */
export const TEAM_EXPERIENCE_CONTEXT_INTRO = "以下为同类协作任务沉淀的团队经验，供本组全体成员共同参考；不适用情形已列出，请勿生搬硬套。";
/** 单条经验的分段锚点（后接经验 id，便于成员按 id 召回原文）。 */
export const TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER = "【经验】";
/** 无排除条件时的稳定占位。 */
export const TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST = "（无）";
/** 列表字段元素之间的固定分隔符。 */
export const TEAM_EXPERIENCE_CONTEXT_LIST_SEPARATOR = "；";
/** 单条经验的分段文本（字段顺序固定，逐字可复现）。 */
function renderEntry(entry) {
    const exclusions = entry.exclusions.map(normalizeWhitespace);
    return [
        `${TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER}${entry.id}`,
        `责任：${normalizeWhitespace(entry.responsibility)}`,
        `任务类型：${normalizeWhitespace(entry.taskType)}`,
        `决策领域：${normalizeWhitespace(entry.decisionDomain)}`,
        `触发信号：${normalizeWhitespace(entry.trigger)}`,
        `原则：${normalizeWhitespace(entry.principle)}`,
        `建议行动：${normalizeWhitespace(entry.recommendedAction)}`,
        `不适用：${exclusions.length === 0 ? TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST : exclusions.join(TEAM_EXPERIENCE_CONTEXT_LIST_SEPARATOR)}`,
    ].join("\n");
}
/** 渲染共享上下文；无经验时返回空串（调用方据此跳过注入）。 */
export function renderTeamExperienceContext(entries) {
    if (entries.length === 0)
        return "";
    return [TEAM_EXPERIENCE_CONTEXT_HEADING, TEAM_EXPERIENCE_CONTEXT_INTRO, ...entries.map(renderEntry)].join("\n\n");
}
//# sourceMappingURL=team-context.js.map
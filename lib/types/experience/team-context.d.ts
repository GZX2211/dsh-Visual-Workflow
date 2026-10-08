/** 共享上下文标题锚点（注入侧与测试据此识别段落起始）。 */
export declare const TEAM_EXPERIENCE_CONTEXT_HEADING = "\u3010\u56E2\u961F\u7ECF\u9A8C\u53C2\u8003\u3011";
/** 共享上下文引言：说明这段文本的性质与使用边界。 */
export declare const TEAM_EXPERIENCE_CONTEXT_INTRO = "\u4EE5\u4E0B\u4E3A\u540C\u7C7B\u534F\u4F5C\u4EFB\u52A1\u6C89\u6DC0\u7684\u56E2\u961F\u7ECF\u9A8C\uFF0C\u4F9B\u672C\u7EC4\u5168\u4F53\u6210\u5458\u5171\u540C\u53C2\u8003\uFF1B\u4E0D\u9002\u7528\u60C5\u5F62\u5DF2\u5217\u51FA\uFF0C\u8BF7\u52FF\u751F\u642C\u786C\u5957\u3002";
/** 单条经验的分段锚点（后接经验 id，便于成员按 id 召回原文）。 */
export declare const TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER = "\u3010\u7ECF\u9A8C\u3011";
/** 无排除条件时的稳定占位。 */
export declare const TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST = "\uFF08\u65E0\uFF09";
/** 列表字段元素之间的固定分隔符。 */
export declare const TEAM_EXPERIENCE_CONTEXT_LIST_SEPARATOR = "\uFF1B";
/** 渲染所需的经验事实（ExperienceEntry 结构上满足本形状）。 */
export interface TeamExperienceContextEntry {
    id: string;
    responsibility: string;
    taskType: string;
    decisionDomain: string;
    trigger: string;
    principle: string;
    recommendedAction: string;
    exclusions: string[];
}
/** 渲染共享上下文；无经验时返回空串（调用方据此跳过注入）。 */
export declare function renderTeamExperienceContext(entries: readonly TeamExperienceContextEntry[]): string;

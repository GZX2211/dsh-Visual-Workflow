// src/host/prompts/team-experience.ts
//
// Team 经验共享上下文块（纯函数）：协作组启动前，把一次召回得到的 Team 经验文本
// 组装成追加给**每个**成员的独立文本块。
//
// 为什么在提示词模块组装而不是让调用方拼字符串：块的首尾锚点属对外可识别的结构契约，
// 单一来源才能保证所有成员拿到同一份内容且结构与文案可测。
/** 注入文本的段落锚点（成员任务块与测试据此识别本段）。 */
export const TEAM_EXPERIENCE_MARKER = '【团队经验】';
/** 注入段落的意图说明（说明这段经验来自以往同类协作，不是本次任务的新指令）。 */
const TEAM_EXPERIENCE_LEAD = '以下经验来自以往同类协作任务的复盘沉淀，供本组成员在协作时参考；如与本次任务的实际约束冲突，以本次任务为准。';
/**
 * 组装分享给协作组全体成员的 Team 经验块（纯函数）。
 * 经验文本为空（含全空白）返回空串：调用方据此跳过追加，不产生空段落。
 */
export function buildTeamExperienceBlock(experienceText) {
    const text = String(experienceText ?? '').trim();
    if (!text)
        return '';
    return `${TEAM_EXPERIENCE_MARKER}${TEAM_EXPERIENCE_LEAD}\n\n${text}`;
}
//# sourceMappingURL=team-experience.js.map
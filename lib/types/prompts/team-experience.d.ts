/** 注入文本的段落锚点（成员任务块与测试据此识别本段）。 */
export declare const TEAM_EXPERIENCE_MARKER = "\u3010\u56E2\u961F\u7ECF\u9A8C\u3011";
/**
 * 组装分享给协作组全体成员的 Team 经验块（纯函数）。
 * 经验文本为空（含全空白）返回空串：调用方据此跳过追加，不产生空段落。
 */
export declare function buildTeamExperienceBlock(experienceText: string): string;

/** 查询标题标记（召回侧与测试据此识别入参性质）。 */
export declare const TEAM_EXPERIENCE_QUERY_MARKER = "\u3010\u56E2\u961F\u7ECF\u9A8C\u67E5\u8BE2\u3011";
/** 稳定的查询结束标记：其后跟完整输入的稳定摘要值。 */
export declare const TEAM_EXPERIENCE_QUERY_DIGEST_MARKER = "\u3010\u67E5\u8BE2\u6458\u8981\u3011";
/** 成员清单段落锚点（成员逐条列出）。 */
export declare const TEAM_EXPERIENCE_MEMBERS_FIELD = "\u3010\u6210\u5458\u4EFB\u52A1\u3011";
/** 警示段落锚点（召回侧据此识读「经验仅供参考、以本次任务约束为准」）。 */
export declare const TEAM_EXPERIENCE_CAUTION_FIELD = "\u3010\u5224\u5B9A\u53C2\u8003\u3011";
/** 无成员时的稳定占位（不因空成员产生空段或崩溃）。 */
export declare const TEAM_EXPERIENCE_QUERY_NONE = "\uFF08\u65E0\u6210\u5458\uFF09";
/** 单条成员文本归一化后的字符上限（截断保持查询长度有界）。 */
export declare const TEAM_EXPERIENCE_MEMBER_LIMIT = 200;
/** 单个字段（组名/协作 Prompt）归一化后的字符上限。 */
export declare const TEAM_EXPERIENCE_FIELD_LIMIT = 400;
/** 一条成员任务事实（按 group.data.memberIds 顺序给出）。 */
export interface TeamExperienceMemberTask {
    /** 成员角色名（节点 label）。 */
    label: string;
    /** 成员任务文本（角色 Prompt；召回侧只消费归一化摘要）。 */
    task: string;
}
/** Team 经验召回查询入参（全部来自本次运行事实，运行时不读盘）。 */
export interface TeamExperienceQueryInput {
    sessionId: string;
    flowId: string;
    /** 协作组节点 id。 */
    groupId: string;
    /** 协作组节点名。 */
    groupLabel: string;
    /** 组级协作 Prompt。 */
    collabPrompt: string;
    /** 成员任务（顺序即 group.data.memberIds 顺序）。 */
    members: TeamExperienceMemberTask[];
}
/**
 * 组装 Team 经验召回查询（纯函数：同一入参字节相同）。
 * 结构固定且只含归一化文本，动态值（摘要）仅出现在末尾。
 */
export declare function buildTeamExperienceQuery(input: TeamExperienceQueryInput): string;

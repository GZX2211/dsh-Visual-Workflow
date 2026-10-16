/**
 * 规划目标种类（三态；决定首段身份与改图语法的措辞）。
 * - create：按意图**新建**模板（规划期主用例）；
 * - template：在**既有模板**上继续规划；
 * - instance：为**既有工作流/服务实例**调整编排。
 */
export type OrgPlanTargetKind = 'create' | 'template' | 'instance';
/** 规划提示词入参。 */
export interface OrgPlanPromptParams {
    facts: {
        /** 规划目标种类（决定身份行与「新建 / 改既有」的语法指引）。 */
        target: OrgPlanTargetKind;
        /** 既有目标 id（target 为 template/instance 时必填；create 时可省略）。 */
        targetId?: string;
        /** 目标人类可读名称（create 时为「拟用名称」）。 */
        targetName?: string;
        /** 系统语言名（如 '中文'；缺省不注入语言规则）。 */
        systemLanguage?: string;
    };
    dynamic: {
        /** 用户本次规划意图。 */
        userIntent: string;
        /** L3 用户 SOP 注入点（D-19；当前无调用方，待「组织规划提示词可调项」UI 落地）。 */
        userSop?: string;
    };
}
/** 构建规划期父代理提示词（纯函数）。 */
export declare function buildOrgPlanPrompt(params: OrgPlanPromptParams): string;

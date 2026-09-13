/**
 * 规划目标种类（三态；决定首段身份与改图语法的措辞）。
 * - create：按意图**新建**模板（规划期主用例）；
 * - template：在**既有模板**上继续规划；
 * - instance：为**既有工作流/服务实例**调整编排。
 */
export type OrgPlanTargetKind = 'create' | 'template' | 'instance';
/**
 * 规划变体关键约束短语（首段与末段双位；测试经本常量引用断言，不绑定具体文案）。
 */
export declare const ORG_PLAN_HARD_CONSTRAINTS: {
    /** D-11：规划不自动投产。 */
    readonly templateOnly: "只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定";
    /** 主用例：新建模板（create 通路；修正 §4.2 的自相矛盾）。 */
    readonly createTemplate: "新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id";
    /** 次用例：改既有目标（必须带 targetId 与 expectRevision）。 */
    readonly updateTarget: "改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision";
    /** 先勘察后动手：wf_org_catalog 是规划的第一动作。 */
    readonly surveyFirst: "先勘察后动手：先调用 wf_org_catalog 摸清现有角色模板、组合、工具、预设与模板库，再提交补丁";
    /** §4.2 语义三分区：一次补丁只用同一 op 组。 */
    readonly patchOnly: "改图只经 wf_graph_patch，且一次补丁只能使用同一 op 组（图结构 / 元参数 / 运行状态标记）";
    /** D-16：父代理不产出坐标。 */
    readonly noPosition: "不产出坐标：节点坐标由客户端分层布局自动计算，补丁里不要写 position";
    /** §4.2：检查器 error 级阻断落盘。 */
    readonly checkerFixes: "图检查器 error 级会阻断落盘，必须按返回的修复建议修正后重新提交";
    /** P1 决策（2026.09 修订）：两工具由组合管理统一开关、默认开启；不可用时提示用户开启。 */
    readonly toolsMayBeClosed: "wf_org_catalog 与 wf_graph_patch 默认开启、由用户在组合管理中统一开关；工具不可用时提示用户到组合管理开启后重试";
};
/** 规划提示词入参：`facts` 为规划任务内字节稳定的静态事实，`dynamic` 仅注入末段。 */
export interface OrgPlanPromptParams {
    facts: {
        /** 规划目标种类（决定身份行与「新建 / 改既有」的语法指引）。 */
        target: OrgPlanTargetKind;
        /** 既有目标 id（target 为 template/instance 时必填；create 时可省略，亦可给建议 id）。 */
        targetId?: string;
        /** 目标人类可读名称（create 时为「拟用名称」；缺省回退为 id 或「新工作流模板」）。 */
        targetName?: string;
        /** 系统语言名（如 '中文'；缺省不注入语言规则）。 */
        systemLanguage?: string;
    };
    dynamic: {
        /** 用户本次规划意图（不稳定内容，仅末段注入）。 */
        userIntent: string;
        /** L3 用户 SOP 注入点（D-19 本轮只留位；空/缺省 = 不组装该段）。 */
        userSop?: string;
        /** 「本次组织预算」文本（buildOrgBudgetText 输出；仅末段注入）。 */
        orgBudgetText?: string;
    };
}
/**
 * 构建规划期父代理提示词（纯函数）。
 * @param params facts（目标种类/身份/语言）+ dynamic（用户意图/L3 SOP/预算文本）
 * @returns 完整提示词文本：HEAD 硬约束 → MID（L1 + L2）→ TAIL（重申 + 动态状态）
 */
export declare function buildOrgPlanPrompt(params: OrgPlanPromptParams): string;

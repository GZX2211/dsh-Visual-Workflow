// src/host/prompts/org-plan.ts
//
// 规划期父代理提示词变体（自主编排实施方案 §10 P2；§3 规划期数据流）。
//
// 与运行期编排指令（orchestration.ts 的情况1/2）的区别：
//   - 规划期**没有 run**：无流程事实源文件、无节点清单、无断点/暂停概念；
//   - 规划期的产物是**模板**：主用例是「无模板 → 按意图产出新模板」（create 通路），
//     其次才是「在既有模板/实例上继续规划」（targetId + expectRevision 的更新语义）；
//   - 组装完成后**不自动投产**（D-11）：是否创建实例并运行由用户点击决定。
//
// 稳定布局（架构文档 §13.1）：首段硬约束 → 中段 L1 图语义 + L2 模式库（长稳定文本）
// → 末段动态状态（用户意图 / L3 用户 SOP 注入点 / 组织预算文本）。
// 构建器为纯函数：不读 Date.now / 随机源，同一 params 两次构建字节相同。
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js';
import { ORG_SOP_L1_GRAPH_SEMANTICS, ORG_SOP_L2_PATTERN_LIBRARY } from './org-sop.js';
import { systemLanguageRule } from './node-task.js';
/**
 * 规划变体关键约束短语（首段与末段双位；测试经本常量引用断言，不绑定具体文案）。
 */
export const ORG_PLAN_HARD_CONSTRAINTS = {
    /** D-11：规划不自动投产。 */
    templateOnly: "只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定",
    /** 主用例：新建模板（create 通路；修正 §4.2 的自相矛盾）。 */
    createTemplate: "新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id",
    /** 次用例：改既有目标（必须带 targetId 与 expectRevision）。 */
    updateTarget: "改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision",
    /** 先勘察后动手：wf_org_catalog 是规划的第一动作。 */
    surveyFirst: "先勘察后动手：先调用 wf_org_catalog 摸清现有角色模板、组合、工具、预设与模板库，再提交补丁",
    /** §4.2 语义三分区：一次补丁只用同一 op 组。 */
    patchOnly: "改图只经 wf_graph_patch，且一次补丁只能使用同一 op 组（图结构 / 元参数 / 运行状态标记）",
    /** D-16：父代理不产出坐标。 */
    noPosition: "不产出坐标：节点坐标由客户端分层布局自动计算，补丁里不要写 position",
    /** §4.2：检查器 error 级阻断落盘。 */
    checkerFixes: "图检查器 error 级会阻断落盘，必须按返回的修复建议修正后重新提交",
    /** P1 决策（2026.09 修订）：两工具由组合管理统一开关、默认开启；不可用时提示用户开启。 */
    toolsMayBeClosed: "wf_org_catalog 与 wf_graph_patch 默认开启、由用户在组合管理中统一开关；工具不可用时提示用户到组合管理开启后重试",
};
/** 目标描述（首段身份行 + 中段目标行共用，避免两处措辞漂移）。 */
function describeTarget(facts) {
    const id = String(facts.targetId ?? '').trim();
    const name = String(facts.targetName ?? '').trim() || id || '新工作流模板';
    if (facts.target === 'template') {
        return {
            identity: '你是工作流模板「' + name + '」（id=' + (id || '（未指定）') + '）的组织规划师。',
            goal: '规划目标模板：' + name + '（id=' + (id || '（未指定）') + '）。规划产物先落盘为模板版本快照，再由用户决定是否投产。',
            grammar: ORG_PLAN_HARD_CONSTRAINTS.updateTarget,
        };
    }
    if (facts.target === 'instance') {
        return {
            identity: '你是工作流/服务实例「' + name + '」（id=' + (id || '（未指定）') + '）的编排规划师。',
            goal: '规划目标实例：' + name + '（id=' + (id || '（未指定）') + '）。对实例的编排改写会即时刷新运行事实源与画布回显。',
            grammar: ORG_PLAN_HARD_CONSTRAINTS.updateTarget,
        };
    }
    return {
        identity: '你是工作流模板的组织规划师：请按用户意图规划并新建一个工作流模板。',
        goal: '规划目标：新建工作流模板' + (String(facts.targetName ?? '').trim() ? '「' + String(facts.targetName).trim() + '」' : '')
            + '（模板 id 由 wf_graph_patch 的 create 通路生成并返回，无需你编造）。',
        grammar: ORG_PLAN_HARD_CONSTRAINTS.createTemplate,
    };
}
/**
 * 构建规划期父代理提示词（纯函数）。
 * @param params facts（目标种类/身份/语言）+ dynamic（用户意图/L3 SOP/预算文本）
 * @returns 完整提示词文本：HEAD 硬约束 → MID（L1 + L2）→ TAIL（重申 + 动态状态）
 */
export function buildOrgPlanPrompt(params) {
    const { facts, dynamic } = params;
    const lang = String(facts.systemLanguage ?? '').trim();
    const langRule = lang ? systemLanguageRule(lang) + '。' : '';
    const c = ORG_PLAN_HARD_CONSTRAINTS;
    const t = describeTarget(facts);
    const head = [
        HEAD_MARKER,
        '',
        t.identity,
        '',
        '1. ' + c.templateOnly + '。',
        '2. ' + t.grammar + '。',
        '3. ' + c.surveyFirst + '。',
        '4. ' + c.patchOnly + '。',
        '5. ' + c.noPosition + '。',
        '6. ' + c.checkerFixes + '。',
        '7. ' + c.toolsMayBeClosed + '。',
        ...(langRule ? ['8. ' + langRule] : []),
    ].join('\n');
    const mid = [
        MID_MARKER,
        '',
        t.goal,
        '',
        ORG_SOP_L1_GRAPH_SEMANTICS,
        '',
        ORG_SOP_L2_PATTERN_LIBRARY,
    ].join('\n');
    const tail = [
        TAIL_MARKER,
        '',
        TAIL_RESTATE_MARKER,
        '- ' + c.templateOnly + '。',
        '- ' + t.grammar + '。',
        '- ' + c.noPosition + '。',
        '- ' + c.checkerFixes + '。',
        ...(langRule ? ['- ' + langRule] : []),
        '',
        renderPlanDynamicState(dynamic),
    ].join('\n');
    return head + '\n\n' + mid + '\n\n' + tail + '\n';
}
/** 渲染末段动态状态（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。 */
function renderPlanDynamicState(dynamic) {
    const lines = ['当前规划任务：'];
    const intent = String(dynamic.userIntent ?? '').trim();
    lines.push('- 用户意图：' + (intent || '（未提供，请先与用户确认目标后再动手）'));
    const sop = String(dynamic.userSop ?? '').trim();
    if (sop) {
        lines.push('', '【用户 SOP】（L3 用户可编辑注入点，优先级高于本提示词的默认模式库）：', sop);
    }
    const budget = String(dynamic.orgBudgetText ?? '').trim();
    if (budget) {
        lines.push('', budget);
    }
    return lines.join('\n');
}
//# sourceMappingURL=org-plan.js.map
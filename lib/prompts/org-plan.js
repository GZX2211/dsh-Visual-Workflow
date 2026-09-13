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
// 稳定布局（架构文档 §13.1）：首段硬约束 → 中段 L1 图语义 + 设计方法（长稳定文本）
// → 末段动态状态（用户意图 / L3 用户 SOP 注入点 / 组织预算文本）。
// 构建器为纯函数：不读 Date.now / 随机源，同一 params 两次构建字节相同。
//
// 提示词裁剪原则（用户裁决 2026.09，按「这句是否必要」逐句过）：
//   只保留「模型无法从训练数据推断」与「工具报错无法自我修正」的内容。
//   已删除：一次补丁只用一组 op / 不写坐标 / 检查器 error 修复指引——三者都写在工具
//   schema 里，且违反时由参数层报错（WF_PATCH_MIXED_GROUPS / WF_BAD_ARGS / WF_GRAPH_INVALID
//   附修复建议）精确回指，写进提示词是纯 token 浪费。
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js';
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from './org-sop.js';
import { systemLanguageRule } from './node-task.js';
/**
 * 规划变体关键约束短语（首段与末段双位；测试经本常量引用断言，不绑定具体文案）。
 */
export const ORG_PLAN_HARD_CONSTRAINTS = {
    /** D-11：规划不自动投产（工具无此护栏，只能写进提示词，故必须保留）。 */
    templateOnly: "只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定",
    /** 主用例：新建模板（create 通路）。 */
    createTemplate: "新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id",
    /** 次用例：改既有目标（必须带 targetId 与 expectRevision）。 */
    updateTarget: "改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision",
    /** 先勘察后动手：wf_org_catalog 是第一动作，且必须勘察工作区事实。 */
    surveyFirst: "先勘察后动手：先调用 wf_org_catalog 摸清现有角色模板、组合、预设、模板库与组织预算，再勘察工作区事实（已有文件、技术栈、目录约定），最后才提交补丁",
    /**
     * 工具可被用户关闭（P1 决策：两工具由组合管理统一开关、默认开启）。
     * 为什么必须保留：工具被关闭时模型收到的是 UNKNOWN_TOOL，没有这句它就不知道
     * 「去组合管理开启后重试」，表现为父代理干脆不用工具。
     */
    toolsMayBeClosed: "wf_org_catalog 与 wf_graph_patch 默认开启；任一工具不可用时，提示用户到组合管理开启后重试，不要改用其他方式改图",
};
/** 目标描述（首段身份行 + 中段目标行共用，避免两处措辞漂移）。 */
function describeTarget(facts) {
    const id = String(facts.targetId ?? '').trim();
    const name = String(facts.targetName ?? '').trim() || id || '新工作流模板';
    if (facts.target === 'template') {
        return {
            identity: '你是工作流模板「' + name + '」（id=' + (id || '（未指定）') + '）的组织规划师。',
            goal: '规划目标模板：' + name + '（id=' + (id || '（未指定）') + '）。规划产物先落盘为模板快照，再由用户决定是否投产。',
            grammar: ORG_PLAN_HARD_CONSTRAINTS.updateTarget,
        };
    }
    if (facts.target === 'instance') {
        return {
            identity: '你是工作流实例「' + name + '」（id=' + (id || '（未指定）') + '）的编排规划师。',
            goal: '规划目标实例：' + name + '（id=' + (id || '（未指定）') + '）。对实例的编排改写会即时刷新运行事实源与画布回显。',
            grammar: ORG_PLAN_HARD_CONSTRAINTS.updateTarget,
        };
    }
    return {
        identity: '你是工作流的组织规划师：请按用户意图规划并新建一个工作流模板。',
        goal: '规划目标：新建工作流模板' + (String(facts.targetName ?? '').trim() ? '「' + String(facts.targetName).trim() + '」' : '')
            + '（模板 id 由 wf_graph_patch 的 create 通路生成并返回）。',
        grammar: ORG_PLAN_HARD_CONSTRAINTS.createTemplate,
    };
}
/**
 * 提交前自检（末段动态状态之前；不新增工具调用，只固化「下游知道去哪读」这条契约）。
 * 为什么放在末尾：与「关键约束重申」同位，处于注意力高位，且不污染稳定的前中段。
 */
const PRE_SUBMIT_CHECKLIST = [
    '提交前自检（逐条确认，任一不成立就先补齐再提交）：',
    '- 交付物清单：每份交付物都有对应节点，且节点之间没有重复职责。',
    '- 落盘路径与消费方：每份交付物写明写到哪个文件，以及谁会读它；没有消费方的终端产出不必建 ctx 线。',
    '- 读取通道：每个下游节点都知道去哪里读上游产出（有 ctx 连线，或上游产出已写成文件且路径已在任务里说明）。',
    '- 节点配置：每个 agent 节点都有 systemPrompt 与非空 presetId（工具组合）。',
].join('\n');
/**
 * 构建规划期父代理提示词（纯函数）。
 * @param params facts（目标种类/身份/语言）+ dynamic（用户意图/L3 SOP/预算文本）
 * @returns 完整提示词文本：HEAD 硬约束 → MID（L1 + 设计方法）→ TAIL（重申 + 自检 + 动态状态）
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
        '1. ' + t.grammar + '。',
        '2. ' + c.templateOnly + '。',
        '3. ' + c.surveyFirst + '。',
        '4. ' + c.toolsMayBeClosed + '。',
        ...(langRule ? ['5. ' + langRule] : []),
    ].join('\n');
    const mid = [
        MID_MARKER,
        '',
        t.goal,
        '',
        ORG_SOP_L1_GRAPH_SEMANTICS,
        '',
        ORG_SOP_DESIGN_METHOD,
    ].join('\n');
    const tail = [
        TAIL_MARKER,
        '',
        TAIL_RESTATE_MARKER,
        '- ' + t.grammar + '。',
        '- ' + c.templateOnly + '。',
        ...(langRule ? ['- ' + langRule] : []),
        '',
        PRE_SUBMIT_CHECKLIST,
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
    // TODO(可视化可调项)：L3 用户 SOP 注入点（D-19）——待 UI 落地后由调用方传入。
    const sop = String(dynamic.userSop ?? '').trim();
    if (sop) {
        lines.push('', '【用户 SOP】（用户可编辑注入点，优先级最高）：', sop);
    }
    const budget = String(dynamic.orgBudgetText ?? '').trim();
    if (budget) {
        lines.push('', budget);
    }
    return lines.join('\n');
}
//# sourceMappingURL=org-plan.js.map
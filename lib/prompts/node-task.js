// src/host/prompts/node-task.ts
//
// 节点任务块构建器（T-005 基线之一，提示词准确性改造后重写）。
//
// 上下文：本任务文本由 wf_run_node 启动节点子代理时注入，作为子代理执行单节点
//       任务的「任务文本」。参考旧项目 VisualWorkflow/lib/orchestrator.js 的
//       buildNodeBlocks（L821-871）骨架，但按 §13.1 重构。
//
// 稳定布局（§13.1）：
//   ① 首段 = 该节点真正需要强调的**软约束固化**（AI 有选择权、值得强调的行为规则）
//             ——协作组成员必须经 wf_ask_agent 通信（仅组内节点注入）；
//   ② 中段 = 过程性信息（系统语言规则 + 上游产出上下文（ctx 连线注入）/ 文件路径
//             索引 / 数据库工具说明）
//   ③ 末段 = 软约束重申（W-02 双位）+ 动态态信息（父 agent id，仅注入末尾）
//
// 提示词准确性改造（用户批注 + AI 行为事后剖析）：
//   - **删除 report 工具软禁用条目**：report 不在子代理工具白名单内（AI 无法调用），
//     提示「不得调用 report」属 AI 无法查证/无选择权的内容，写入只会干扰模型；
//   - **删除「当前执行状态」段**（暂停节点 / 运行上下文 / send_message 指令）：暂停门
//     由引擎在 wf_run_node 检测（子代理无需知道）；运行上下文对子代理无可验证语义；
//     send_message 为官方相邻投递注入的冗余条目，本段不再重复；
//   - **新增系统语言规则**：所有回复/注释/思考必须使用配置语言（从 DSH 设置读取）；
//   - **新增父 agent id**：仅告诉父代理会话 id，不再含 send_message 相关条目。
//
// 代码层约束（引擎已强制、AI 无选择权）**不写入提示词**（用户裁决）：
//   - 「仅使用你自己的 System Prompt」：子代理只有一条 System Prompt，无需强调；
//   - 「只调用允许清单内的工具」：工具可见性由引擎管理，AI 只能调用可见工具；
//   - 「重试/ReAct 迭代上限」：引擎护栏，数值对 AI 无执行意义；
//
// 构建器为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同；动态值仅注入末段。
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js';
/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 *
 * 准确性改造：report 工具软禁用条目已删除——report 不在子代理工具白名单内（AI 无法调用），
 * 「不得调用 report」属 AI 无选择权/无法查证的内容（用户批注），写入只会干扰模型。
 */
export const NODE_HARD_CONSTRAINTS = {
    /** 协作组内通信必须经 wf_ask_agent（仅组内成员注入）。 */
    collabAskOnly: '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）',
};
/**
 * 系统语言规则短语（面向模型中文；各提示词构建器共用）。
 * 从 DSH 用户设置读取语言名，注入「所有对话回复、注释、思考过程必须使用该语言」。
 */
export function systemLanguageRule(language) {
    return `所有对话回复、注释、思考过程必须使用${language}`;
}
/**
 * 节点任务块构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段软约束 + 中段过程性信息固定；末段重申固定，
 * 之后仅追加本次动态态信息。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态态信息）。
 * @returns 注入子代理的任务文本（面向模型，中文）。
 */
export function buildNodeTaskBlock(params) {
    const { facts, dynamic } = params;
    // —— 首段：软约束固化（注意力位置第一位；仅保留 AI 有选择权的行为规则）——
    const head = [
        HEAD_MARKER,
        '',
        `你正在执行节点「${facts.nodeLabel}」。`,
        '',
        ...(facts.isGroupMember ? [`1. ${NODE_HARD_CONSTRAINTS.collabAskOnly}，不得用普通文本模拟对话或绕过工具直接发送消息。`] : []),
    ].join('\n');
    // —— 中段：系统语言规则 + 过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）——
    const midParts = [
        MID_MARKER,
        '',
        `请执行工作流节点「${facts.nodeLabel}」`,
    ];
    // 系统语言规则（从 DSH 设置读取；确保回复/注释/思考使用配置语言）
    if (facts.systemLanguage.trim()) {
        midParts.push('', `1. ${systemLanguageRule(facts.systemLanguage)}。`);
    }
    if (facts.upstreamContext.length > 0) {
        midParts.push('', '上游产出（经 ctx 连线注入）：');
        for (const entry of facts.upstreamContext) {
            midParts.push(`- ${entry.source}：${entry.content}`);
        }
    }
    else {
        midParts.push('', '上游产出：（无）');
    }
    if (facts.filePaths.length > 0) {
        midParts.push('', '文件路径索引（自行读取）：');
        for (const filePath of facts.filePaths) {
            midParts.push(`- ${filePath}`);
        }
    }
    if (facts.dbToolHint.trim()) {
        midParts.push('', `数据库工具说明：${facts.dbToolHint.trim()}`);
    }
    const mid = midParts.join('\n');
    // —— 末段：软约束重申（W-02 双位）+ 动态态信息（父 agent id 仅在此注入）——
    const tailLines = [TAIL_MARKER, ''];
    const restate = [];
    if (facts.isGroupMember)
        restate.push(`- ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`);
    if (restate.length > 0)
        tailLines.push(TAIL_RESTATE_MARKER, ...restate);
    const dynamicState = renderDynamicState(dynamic);
    if (dynamicState)
        tailLines.push('', dynamicState);
    const tail = tailLines.join('\n');
    return `${head}\n\n${mid}\n\n${tail}\n`;
}
/**
 * 渲染末段动态态信息（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。
 * 只注入父 agent id（仅告诉 id，不含 send_message 相关条目）。
 * 暂停节点 / 运行上下文不再写入（用户批注：引擎层处理，AI 无可验证语义）。
 */
function renderDynamicState(dynamic) {
    const lines = [];
    const parentAgentId = String(dynamic.parentAgentId ?? '').trim();
    if (parentAgentId) {
        lines.push(`你的父 agent id 为：${parentAgentId}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=node-task.js.map
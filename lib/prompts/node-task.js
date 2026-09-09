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
//             ——系统语言规则 + 协作组成员必须经 wf_ask_agent 通信（仅组内节点注入）；
//   ② 中段 = 过程性信息（上游产出上下文（ctx 连线注入）/ 文件路径索引 / 数据库工具说明）
//   ③ 末段 = 软约束重申（W-02 双位）
//
// 构建器为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同。
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js';
/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
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
    const { facts } = params;
    // —— 首段：软约束固化（注意力位置第一位；仅保留 AI 有选择权的行为规则）——
    const headLines = [
        HEAD_MARKER,
        '',
        `你正在执行节点「${facts.nodeLabel}」。`,
        '',
    ];
    if (facts.systemLanguage.trim()) {
        headLines.push(`1. ${systemLanguageRule(facts.systemLanguage)}。`);
    }
    if (facts.isGroupMember) {
        // 若已有语言规则，编号顺延为 2；否则为 1
        const idx = facts.systemLanguage.trim() ? 2 : 1;
        headLines.push(`${idx}. ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`);
    }
    const head = headLines.join('\n');
    // —— 中段：系统语言规则 + 过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）——
    const midParts = [
        MID_MARKER,
        '',
    ];
    if (facts.upstreamContext.length > 0) {
        midParts.push('', '上游产出：');
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
    // —— 末段：软约束重申（W-02 双位）——
    const tailLines = [TAIL_MARKER, ''];
    const restate = [];
    if (facts.isGroupMember)
        restate.push(`- ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`);
    if (restate.length > 0)
        tailLines.push(TAIL_RESTATE_MARKER, ...restate);
    const tail = tailLines.join('\n');
    return `${head}\n\n${mid}\n\n${tail}\n`;
}
//# sourceMappingURL=node-task.js.map
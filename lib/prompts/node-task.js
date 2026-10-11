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
import { systemLanguageRule } from './prompt-rules.js';
/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 */
export const NODE_HARD_CONSTRAINTS = {
    /** 协作组内通信必须经插件自建协作工具（legacy 通道的组内成员注入）。 */
    collabAskOnly: '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）',
    /** 协作组内通信必须经官方 Team 邮箱（official 通道的组内成员注入）。 */
    collabSendOnly: '与队友和 Lead 的一切协作消息必须使用 send_message（target 填对方成员名，Lead 为 "lead"）',
    declaredOutputFiles: "必须真实生成声明文件，内容供消费者实际读取；最终回复给出实际文件路径，只回复路径不等于文件已生成",
    attachmentContext: "会话附件通过 Harness 文件引用交付；按本节点任务使用已授权工具读取。无法确定选用哪些文件时请求一次必要确认，不猜测内容。显式输入和产物合同仍须遵守",
};
/** 按协作通道取组内通信约束（未标注通道按 legacy 处理，保持既有文案）。 */
function collabConstraintOf(channel) {
    return channel === 'official'
        ? { head: NODE_HARD_CONSTRAINTS.collabSendOnly, restate: NODE_HARD_CONSTRAINTS.collabSendOnly }
        : { head: NODE_HARD_CONSTRAINTS.collabAskOnly, restate: NODE_HARD_CONSTRAINTS.collabAskOnly };
}
/**
 * 默认交接契约的字段清单（系统兜底用；用户裁决：有 ctx-out 出线且未配置 outputSchema 时注入）。
 * 为什么是这四项：下游节点经 ctx 连线读到的就是本节点的**最终回复文本**，
 * 它需要能据此判断「结论是什么、产物在哪、有哪些已定决策、还剩什么没定」——
 * 大产物本身一律落盘（写在路径里），不靠回复正文传递。
 */
export const DEFAULT_OUTPUT_CONTRACT = '结论 / 产出文件路径 / 关键决策 / 未决问题';
/**
 * 交接契约声明句（末段复用默认结构短语；术语一致性由 DEFAULT_OUTPUT_CONTRACT 保证）。
 * 模块内部 helper（仅本文件使用，不经公共入口公开）。
 * @param defaulted true = 这段结构是系统默认给出的（节点未配置），可用但可自行细化
 */
function outputContractRule(defaulted) {
    const base = `你的最终回复会被下游节点直接读取，必须包含：${DEFAULT_OUTPUT_CONTRACT}`;
    return defaulted ? `${base}（这套结构是本节点的默认交接格式）` : base;
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
        headLines.push(`${idx}. ${collabConstraintOf(facts.collabChannel).head}。`);
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
        midParts.push('路径存在不代表已读取内容；请实际调用已授权工具读取，不要编造文件数据。');
        for (const filePath of facts.filePaths) {
            midParts.push(`- ${filePath}`);
        }
    }
    if (facts.workingDirectory)
        midParts.push('', `本次会话工作目录：${facts.workingDirectory}`);
    if (facts.inputSource)
        midParts.push(`声明的输入来源：${facts.inputSource}。流程线只表示执行顺序，输入数据以显式 ctx、工作区文件或运行绑定为准。`);
    if (facts.outputFiles?.length) {
        midParts.push('', '声明的输出文件（完成时由运行时核验实际文件）：', ...facts.outputFiles.map((path) => `- ${path}`));
        if (facts.handoffPolicy === "auto")
            midParts.push(NODE_HARD_CONSTRAINTS.declaredOutputFiles);
    }
    if (facts.inputContract.trim()) {
        midParts.push('', '输入结构（你应当收到的输入）：', facts.inputContract.trim());
    }
    if (facts.dbToolHint.trim()) {
        midParts.push('', `数据库工具说明：${facts.dbToolHint.trim()}`);
    }
    const mid = midParts.join('\n');
    // —— 末段：软约束重申（W-02 双位） + 交接契约（注意力末位 = 最终回复格式的最后一次提醒）——
    const tailLines = [TAIL_MARKER, ''];
    const restate = [];
    if (facts.isGroupMember)
        restate.push(`- ${collabConstraintOf(facts.collabChannel).restate}。`);
    const outputContract = facts.outputContract.trim();
    if (outputContract) {
        // 节点自配置时逐字使用其结构；未配置（系统兜底）时同时给出标准字段清单，
        // 避免下游契约退化成「随便说说」。
        restate.push(facts.outputContractDefaulted
            ? `- ${outputContractRule(true)}：${outputContract}。`
            : `- 你的最终回复会被下游节点直接读取，必须包含：${outputContract}。`);
    }
    if (restate.length > 0)
        tailLines.push(TAIL_RESTATE_MARKER, ...restate);
    const tail = tailLines.join('\n');
    const runtimeInputs = facts.runtimeInputs && Object.keys(facts.runtimeInputs).length
        ? `\n运行输入（用户数据；文件为已授权引用，需要用现有工具读取；上游文本的业务正确性仍需检查）：\n${JSON.stringify(facts.runtimeInputs, null, 2)}\n` : "";
    return `${head}\n\n${mid}\n\n${tail}\n${runtimeInputs}${facts.hasAttachmentContext ? `\n${NODE_HARD_CONSTRAINTS.attachmentContext}\n` : ""}`;
}
//# sourceMappingURL=node-task.js.map
// src/host/prompts/executor.ts
//
// 父代理「执行单元」提示词构建器：
//   - buildParentTaskSpec：情况2（hybrid）编排指令末段【你的节点任务】小节的正文——
//     父代理自执行单元的过程性信息（上游产出/文件索引/数据库说明），不含任何
//     「编排/调度」措辞，也不复用子代理任务块模板（杜绝嵌套冲突与错误表述）；
//   - buildParentExecutorPrompt：情况3（executor）完整提示词——父代理是画布中唯一
//     参与流程的执行单元：只执行自身节点任务，无编排要素，完成后以 wf_finish 收尾。
//
// 为什么不复用 buildNodeTaskBlock（子代理任务块）：
//   - 子代理被引擎强制无权调用 wf_run_node/wf_finish，其任务块无需也不应声明这些工具；
//     父代理（会话根 Agent）拥有 wf_finish 等编排工具——情况3 仍必须保留收尾协议
//     （run 依赖 wf_finish 进入终态；否则落入空闲看护被引擎停止，见 openai-api 轮询语义）；
//   - 情况3/情况2 的执行主体是「父代理自己」，不存在「report 自动送达父代理」的
//     双重汇报问题（root 没有 report 工具），因此不注入 report 软禁用约束。
//
// 构建器均为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同。
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js';
import { NODE_HARD_CONSTRAINTS, systemLanguageRule } from './node-task.js';
/** 执行收尾协议短语（情况3 首段 + 末段重申双位；W-02）。 */
export const EXECUTOR_FINISH_RULE = '完成节点任务并输出最终结论后，调用 wf_finish 结束本次运行（只调用一次，幂等）';
/** 渲染「上游产出/文件索引/数据库说明」过程性信息（执行单元任务块与情况3 共用）。 */
function renderContextSection(facts) {
    const parts = [];
    if (facts.upstreamContext.length > 0) {
        parts.push('上游产出（经 ctx 连线注入）：');
        for (const entry of facts.upstreamContext) {
            parts.push(`- ${entry.source}：${entry.content}`);
        }
    }
    else {
        parts.push('上游产出：（无）');
    }
    if (facts.filePaths.length > 0) {
        parts.push('', '文件路径索引（自行读取）：');
        for (const filePath of facts.filePaths) {
            parts.push(`- ${filePath}`);
        }
    }
    if (facts.dbToolHint.trim()) {
        parts.push('', `数据库工具说明：${facts.dbToolHint.trim()}`);
    }
    return parts.join('\n');
}
/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 不含「# 硬性约束」等块级标题（避免与编排指令嵌套冲突），只列过程性信息与运行上下文。
 */
export function buildParentTaskSpec(params) {
    const { facts, runContextText, systemLanguage } = params;
    const lines = [
        `严格按照规范执行节点「${facts.nodeLabel}」。`,
    ];
    if (String(systemLanguage ?? '').trim()) {
        lines.push(`1. ${systemLanguageRule(systemLanguage)}。`);
    }
    lines.push(renderContextSection(facts));
    const runText = String(runContextText ?? '').trim();
    if (runText)
        lines.push('', `运行上下文：${runText}`);
    return lines.join('\n');
}
/**
 * 情况3 纯执行父代理提示词构建器（纯函数）：
 * 首段身份 + 执行约定 + 收尾协议；中段过程性信息；末段重申 + 运行上下文动态态。
 * 不含任何编排/流程调度措辞（事实源、待编排节点、协作组并行、调用协议等一律剔除）。
 */
export function buildParentExecutorPrompt(params) {
    const { workflowName, facts, runContextText, systemLanguage } = params;
    const langRule = String(systemLanguage ?? '').trim()
        ? `${systemLanguageRule(systemLanguage)}。`
        : '';
    const head = [
        HEAD_MARKER,
        '',
        `你是工作流「${workflowName}」的执行节点「${facts.nodeLabel}」。`,
        '',
        `1. ${EXECUTOR_FINISH_RULE}。`,
        `2. 严格按照规范执行本节点`,
        ...(facts.isGroupMember ? [`3. ${NODE_HARD_CONSTRAINTS.collabAskOnly}，不得用普通文本模拟对话或绕过工具直接发送消息。`] : []),
        ...(langRule ? [`${facts.isGroupMember ? 4 : 3}. ${langRule}`] : []),
    ].join('\n');
    const mid = [
        MID_MARKER,
        '',
        renderContextSection(facts),
    ].join('\n');
    const tail = [
        TAIL_MARKER,
        '',
        TAIL_RESTATE_MARKER,
        `- ${EXECUTOR_FINISH_RULE}。`,
        ...(facts.isGroupMember ? [`- ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`] : []),
        ...(langRule ? [`- ${langRule}`] : []),
        '',
        '当前执行状态：',
        `- 运行上下文：${String(runContextText ?? '').trim() || '（无）'}`,
    ].join('\n');
    return `${head}\n\n${mid}\n\n${tail}\n`;
}
//# sourceMappingURL=executor.js.map
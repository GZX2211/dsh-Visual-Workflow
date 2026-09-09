// src/host/orchestrator/ask-types.ts
//
// wf_ask_agent 三态通信协议（ask/reply/resolve）的纯类型、常量与消息文本构建
// 纯函数：Request/Result/挂起记录/投递缝 + 协作消息、ask 文本、超时通知文本。
// 文本构建函数均为纯函数（不读时钟/随机源），供编排运行时与单测共用。
import { truncateText } from './snapshot.js';
/** 协作消息文本长度上限（防御性截断）。 */
export const ASK_MESSAGE_LIMIT = 20000;
/** 构造协作消息（steer/followup 共用；senderSessionId = 发起者会话 id）。 */
export function coordinatorMessage(id, text, senderSessionId) {
    return {
        id,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'coordinator', form: 'relay', senderSessionId },
    };
}
/** 投递给目标子代理的消息文本（含 askId 与回复指令，业务中文）。 */
export function buildAskText(pending) {
    return [
        `[协作通信] 同工作流节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向你发送协作消息（askId: ${pending.askId}）：`,
        pending.message,
        '',
        `请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "${pending.fromNodeId}", askId: "${pending.askId}", message: "<你的回复文本>" })，回复会解除对方的阻塞等待。`,
    ].join('\n');
}
/** 超时通知父代理的消息文本（父代理据此征询用户并 resolve）。 */
export function buildTimeoutText(pending) {
    const seconds = Math.max(1, Math.round(pending.timeoutMs / 1000));
    return [
        `[协作通信超时] 节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向「${pending.toNodeId}」（会话 ${pending.to}）的协作消息超过 ${seconds} 秒未获回复：`,
        `- askId: ${pending.askId}`,
        `- 消息内容: ${pending.message}`,
        '请用 ask_user_question 向用户征询处理方式（继续等待 / 重发消息 / 终止通信），然后调用 wf_ask_agent({ cmd: "resolve", askId: "${pending.askId}", action: "continue" | "resend" | "abort" })。abort 时发起者会收到超时错误并继续执行。',
    ].join('\n');
}
//# sourceMappingURL=ask-types.js.map
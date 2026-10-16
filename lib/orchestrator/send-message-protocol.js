// src/host/orchestrator/send-message-protocol.ts
//
// wf_send_message 协议（单向持久消息）：类型、常量与消息文本构建纯函数。
// 语义以官方 send_message 为准：投递一条消息即返回，不等待回复、不含 ask/reply 两态。
// 文本构建函数为纯函数（不读时钟/随机源），供编排运行时与单测共用。
import { NOTICE_SEND_MESSAGE, renderTemplate } from '../prompts/index.js';
/** 父代理寻址别名（全图只有一个父代理，故用固定别名而非会话 id）。 */
export const PARENT_TARGET = 'parent';
/** 消息正文长度上限（防御性截断）。 */
export const SEND_MESSAGE_LIMIT = 20000;
/** 构造协作消息（steer/followup 共用；senderSessionId = 发送方会话 id）。 */
export function coordinatorMessage(id, text, senderSessionId) {
    return {
        id,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'coordinator', form: 'relay', senderSessionId },
    };
}
/** 投递消息正文（发送方身份 + 消息体 + 单向语义；正文见 prompts/texts/notice-send-message.ts）。 */
export function buildSendMessageText(from, message) {
    return renderTemplate(NOTICE_SEND_MESSAGE, {
        fromLabel: from.label,
        fromId: from.id,
        message,
    });
}
//# sourceMappingURL=send-message-protocol.js.map
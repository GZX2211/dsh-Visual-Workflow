// src/host/prompts/texts/notice-send-message.ts
//
// 规则文本 · **wf_send_message 消息投递包装**
// 适用：任何代理（父代理或子代理）经 wf_send_message 向本 run 的另一成员投递消息时，
//       目标侧看到的消息正文（发送方身份 + 消息体 + 单向语义）。
// 注入位置：消息投递（coordinatorMessage 的文本体，作为目标代理新一条用户消息）。
// 变量：fromLabel（发送方角色名称）/ fromId（发送方寻址 id）/ message（消息体）
export const NOTICE_SEND_MESSAGE = `[消息] 来自{{fromLabel}}（{{fromId}}）：

{{message}}

这是一条单向消息：发送方不会等待你的回复。`;
//# sourceMappingURL=notice-send-message.js.map
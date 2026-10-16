// src/host/prompts/texts/notice-ask-message.ts
//
// 规则文本 · **wf_ask_agent 协作消息**
// 注入位置：消息投递（ask 投递给目标子代理 / reply 回投给发起者）。
// 变量：ASK_MESSAGE —— fromNodeId / from / askId / message
//       ASK_REPLY  —— toNodeId / to / askId / reply

/** 投递给目标子代理的协作消息（含 askId 与回复指令，要求对方按工具回复）。 */
export const ASK_MESSAGE = `[协作通信] 同工作流节点子代理「{{fromNodeId}}」（会话 {{from}}）向你发送协作消息（askId: {{askId}}）：
{{message}}

请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "{{fromNodeId}}", askId: "{{askId}}", message: "<你的回复文本>" })。`

/** 反向投递给发起者的回复（带 askId，便于发起者把回复关联回自己的提问）。 */
export const ASK_REPLY = `[协作通信回复] 节点子代理「{{toNodeId}}」（会话 {{to}}）回复了你发起且 askId 为 {{askId}} 的协作消息：
{{reply}}`

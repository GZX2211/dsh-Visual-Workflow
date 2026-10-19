// src/host/prompts/texts/task-fallback.ts
//
// 任务文本 · **子代理任务块为空时的兜底首条消息**
// 注入位置：子代理创建时的首条用户消息（正常路径由 buildNodeTaskBlock 组装，此处仅防御性兜底）。
// 变量：nodeLabel
export const TASK_FALLBACK = `你是 Visual Workflow 中的节点子代理。
节点名称：{{nodeLabel}}
具体任务将随后续消息派发；请回复“收到”并待命。`;
//# sourceMappingURL=task-fallback.js.map
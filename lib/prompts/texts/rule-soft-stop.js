// src/host/prompts/texts/rule-soft-stop.ts
//
// 规则文本 · **ReAct 软截停护栏**
// 注入位置：agent/pre-step 替换消息（强制收尾指令）+ tools.guard 拒绝原因。
/** 软截停的强制收尾指令（达到迭代上限时替换本步进入消息）。 */
export const REACT_CAP_MESSAGE = '你已达到本回合的 ReAct 迭代上限。请立即停止调用工具，并基于当前已完成的进展直接给出最终结论。';
/** tools.guard 拒绝原因（触达上限后同步拒绝该子代理一切工具调用）。 */
export const REACT_CAP_DENY_REASON = '已达 ReAct 迭代上限——请立即收尾并给出最终产出。';
//# sourceMappingURL=rule-soft-stop.js.map
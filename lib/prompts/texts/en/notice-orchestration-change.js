// src/host/prompts/texts/en/notice-orchestration-change.ts
//
// 规则文本 · **运行期【编排变更】系统通知**（英文变体）。
// 注入位置：用户消息（运行中画布保存且编排语义变更时注入父代理）。
// 消费方：src/host/orchestrator/runtime-base.ts 的 notifyOrchestrationChange。
/** 通知标题标记（英文）。 */
export const ORCH_CHANGE_MARKER_EN = '[Orchestration changed]';
/** 通知正文：只说「画布变了、去重新召回」。 */
export const ORCH_CHANGE_TEXT_EN = `${ORCH_CHANGE_MARKER_EN} The canvas has been updated (system notification). Recall the current instance skeleton with wf_org_catalog (ids: ["instance"]) before continuing to schedule.`;
//# sourceMappingURL=notice-orchestration-change.js.map
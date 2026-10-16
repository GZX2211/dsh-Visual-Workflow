// src/host/prompts/texts/notice-orchestration-change.ts
//
// 规则文本 · **运行期【编排变更】系统通知**
// 注入位置：用户消息（运行中画布保存且编排语义变更时注入父代理：回合内 steer 插队 / 空闲 followup 唤醒）。
// 消费方：src/host/orchestrator/runtime-base.ts 的 notifyOrchestrationChange。

/** 通知标题标记（父代理与日志据此识别消息性质）。 */
export const ORCH_CHANGE_MARKER = '【编排变更】'

/** 通知正文（唯一一份文案）：只说「画布变了、去重新召回」。 */
export const ORCH_CHANGE_TEXT =
  `${ORCH_CHANGE_MARKER}画布已更新（系统通知），请用 wf_org_catalog（ids: ["instance"]）重新召回当前实例骨架后再继续调度。`

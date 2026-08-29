// src/host/orchestrator/ask-types.ts
//
// wf_ask_agent 三态通信协议（ask/reply/resolve）的纯类型、常量与消息文本构建
// 纯函数：Request/Result/挂起记录/投递缝 + 协作消息、ask 文本、超时通知文本。
// 文本构建函数均为纯函数（不读时钟/随机源），供编排运行时与单测共用。

import type { CoordinatorMessage } from './seams.js'
import { truncateText } from './snapshot.js'

/** wf_ask_agent 三态命令。 */
export type AskAgentCmd = 'ask' | 'reply' | 'resolve'

/** resolve 三动作：continue 重启计时 / resend 重发 / abort 终止。 */
export type ResolveAction = 'continue' | 'resend' | 'abort'

/** wf_ask_agent 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface AskAgentArgs {
  cmd?: unknown
  targetChildId?: unknown
  askId?: unknown
  message?: unknown
  action?: unknown
}

/** wf_ask_agent 返回（cmd 恒为本次调用的命令；ask 挂起结束时携带回复）。 */
export interface AskAgentResult {
  cmd: 'ask' | 'reply' | 'resolve'
  askId?: string
  from?: string
  to?: string
  reply?: string
  action?: ResolveAction
}

/** 协作消息投递缝（真实实现 = 在线 steer / 冷态 followup；单测 fake）。 */
export interface AskAgentDelivery {
  /** 投递协作消息到目标子代理（在线 steer；离线冷恢复 followup，由实现选择）。 */
  deliver(input: { sessionId: string; to: string; message: CoordinatorMessage; signal?: AbortSignal }): Promise<void>
  /** 把超时详情通知父代理（steer 注入，父代理回合内征询用户并 resolve）。 */
  notifyParent(input: { sessionId: string; message: CoordinatorMessage }): void
}

/** 审计事件单条（at 为 ISO 时间；detail 为事件附注）。 */
export interface AskAuditEntry {
  at: string
  event: string
  detail: string
}

/** 挂起的协作通信记录（注册于 RunEntry.asks；A 的阻塞等待由此驱动）。 */
export interface PendingAsk {
  askId: string
  from: string
  to: string
  fromNodeId: string
  toNodeId: string
  message: string
  timeoutMs: number
  expiresAt: number
  state: 'pending' | 'timed-out' | 'resolved' | 'aborted'
  audit: AskAuditEntry[]
  promise: Promise<AskAgentResult>
  resolve: (result: AskAgentResult) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
  delivery: AskAgentDelivery
}

/** 协作消息文本长度上限（防御性截断）。 */
export const ASK_MESSAGE_LIMIT = 20000

/** 构造协作消息（steer/followup 共用；senderSessionId = 发起者会话 id）。 */
export function coordinatorMessage(id: string, text: string, senderSessionId: string): CoordinatorMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'coordinator', form: 'relay', senderSessionId },
  }
}

/** 投递给目标子代理的消息文本（含 askId 与回复指令，业务中文）。 */
export function buildAskText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message'>): string {
  return [
    `[协作通信] 同工作流节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向你发送协作消息（askId: ${pending.askId}）：`,
    pending.message,
    '',
    `请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "${pending.from}", askId: "${pending.askId}", message: "<你的回复文本>" })，回复会解除对方的阻塞等待。`,
  ].join('\n')
}

/** 超时通知父代理的消息文本（父代理据此征询用户并 resolve）。 */
export function buildTimeoutText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message' | 'timeoutMs'>): string {
  const seconds = Math.max(1, Math.round(pending.timeoutMs / 1000))
  return [
    `[协作通信超时] 节点子代理「${pending.fromNodeId}」（会话 ${pending.from}）向「${pending.toNodeId}」（会话 ${pending.to}）的协作消息超过 ${seconds} 秒未获回复：`,
    `- askId: ${pending.askId}`,
    `- 消息内容: ${pending.message}`,
    '请用 ask_user_question 向用户征询处理方式（继续等待 / 重发消息 / 终止通信），然后调用 wf_ask_agent({ cmd: "resolve", askId: "${pending.askId}", action: "continue" | "resend" | "abort" })。abort 时发起者会收到超时错误并继续执行。',
  ].join('\n')
}

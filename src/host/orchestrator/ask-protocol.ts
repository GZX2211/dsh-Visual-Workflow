// src/host/orchestrator/ask-protocol.ts
//
// wf_ask_agent 通信协议（ask/reply 两态）的类型、常量与消息文本构建纯函数：
// Request/Result/待回复登记/投递缝 + 协作消息、ask 文本、回复文本。
// 文本构建函数均为纯函数（不读时钟/随机源），供编排运行时与单测共用。
//
// 协议定位（非阻塞语义）：ask 只做「投递 + 登记待回复」，调用方立即返回，不再挂起；
// reply 反向投递回复到发起者，由发起者的后续回合处理。超时裁决与父代理介入已退役。

import type { CoordinatorMessage } from './seams.js'

/** wf_ask_agent 两态命令（ask 投递并登记待回复 / reply 答复并反向投递）。 */
export type AskAgentCmd = 'ask' | 'reply'

/** wf_ask_agent 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface AskAgentArgs {
  cmd?: unknown
  targetChildId?: unknown
  askId?: unknown
  message?: unknown
}

/** wf_ask_agent 返回（cmd 恒为本次调用的命令；ask 返回受理凭证，回复不在此回传）。 */
export interface AskAgentResult {
  cmd: 'ask' | 'reply'
  askId?: string
  from?: string
  to?: string
}

/** 协作消息投递缝（真实实现 = 在线 steer / 冷态 followup；单测 fake）。 */
export interface AskAgentDelivery {
  /** 投递协作消息到目标子代理（在线 steer；离线冷恢复 followup，由实现选择）。 */
  deliver(input: { sessionId: string; to: string; message: CoordinatorMessage; signal?: AbortSignal }): Promise<void>
}

/**
 * 待回复登记记录（注册于 RunEntry.asks）。
 * 只承担一件事：reply 的归属校验（谁问的、问的谁、问的哪一题）。不含 Promise/timer/状态机：
 * ask 不挂起，故无等待受体，记录到期由 TTL 惰性清理。
 */
export interface PendingAsk {
  askId: string
  from: string
  to: string
  fromNodeId: string
  toNodeId: string
  message: string
  /** 记录保留时长（到期后惰性清理，停止接受该 askId 的 reply）。 */
  ttlMs: number
  expiresAt: number
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
    `请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "${pending.fromNodeId}", askId: "${pending.askId}", message: "<你的回复文本>" })。`,
    '对方不会阻塞等待你的回复：回复将作为新消息投递到对方会话。',
  ].join('\n')
}

/**
 * 反向投递给发起者的回复文本（方向与 ask 相反：发送者为回复方，接收者为发起者）。
 * 带 askId 便于发起者把回复关联回自己发起的提问。
 */
export function buildReplyText(
  pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId'>,
  reply: string,
): string {
  return [
    `[协作通信回复] 节点子代理「${pending.toNodeId}」（会话 ${pending.to}）回复了你发起且 askId 为 ${pending.askId} 的协作消息：`,
    reply,
  ].join('\n')
}

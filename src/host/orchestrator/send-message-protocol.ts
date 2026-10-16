// src/host/orchestrator/send-message-protocol.ts
//
// wf_send_message 协议（单向持久消息）：类型、常量与消息文本构建纯函数。
// 语义以官方 send_message 为准：投递一条消息即返回，不等待回复、不含 ask/reply 两态。
// 文本构建函数为纯函数（不读时钟/随机源），供编排运行时与单测共用。

import type { CoordinatorMessage } from './seams.js'
import { NOTICE_SEND_MESSAGE, renderTemplate } from '../prompts/index.js'

/** 父代理寻址别名（全图只有一个父代理，故用固定别名而非会话 id）。 */
export const PARENT_TARGET = 'parent'

/** 消息正文长度上限（防御性截断）。 */
export const SEND_MESSAGE_LIMIT = 20000

/**
 * 投递状态（模型据此判断对端处境）：
 *   - delivered：目标在线，已插队送达；
 *   - queued：目标在创建/排队中，消息已入队等待其下一个回合；
 *   - resumed：目标不在运行（已结束/空闲），已冷恢复唤醒。
 */
export type SendMessageStatus = 'delivered' | 'queued' | 'resumed'

/** wf_send_message 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface SendMessageArgs {
  target?: unknown
  message?: unknown
}

/** wf_send_message 返回（resolved = 实际投递对象：父代理 'parent' / 子代理会话 id / 成员名）。 */
export interface SendMessageResult {
  target: string
  resolved: string
  status: SendMessageStatus
}

/**
 * 消息投递缝（真实实现 = 宿主能力适配；单测 fake）。
 *
 * 为什么把「状态判定」分别放在两侧：父代理与普通子代理的在线性只有宿主注册表知道
 * （故由实现返回状态）；Team 成员状态是编排层经 NodeRunner.teamMemberStatusOf 读到的
 * 运行时事实，故成员路径只做投递、状态由编排层推导。
 */
export interface SendMessageDelivery {
  /** 投递给父代理（会话 root）：在线插队 → delivered；空闲唤醒 → queued。 */
  deliverToParent(input: {
    sessionId: string
    message: CoordinatorMessage
    signal?: AbortSignal
  }): Promise<SendMessageStatus>
  /** 投递给普通子代理：在线插队 → delivered；不在线冷恢复 → resumed。 */
  deliverToChild(input: {
    sessionId: string
    childId: string
    message: CoordinatorMessage
    signal?: AbortSignal
  }): Promise<SendMessageStatus>
  /** 投递给官方 Team 成员（按官方成员名寻址；投递失败显式上抛）。 */
  deliverToTeammate(input: {
    sessionId: string
    memberName: string
    message: CoordinatorMessage
    signal?: AbortSignal
  }): Promise<void>
}

/** 构造协作消息（steer/followup 共用；senderSessionId = 发送方会话 id）。 */
export function coordinatorMessage(id: string, text: string, senderSessionId: string): CoordinatorMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'coordinator', form: 'relay', senderSessionId },
  }
}

/** 投递消息正文（发送方身份 + 消息体 + 单向语义；正文见 prompts/texts/notice-send-message.ts）。 */
export function buildSendMessageText(from: { label: string; id: string }, message: string): string {
  return renderTemplate(NOTICE_SEND_MESSAGE, {
    fromLabel: from.label,
    fromId: from.id,
    message,
  })
}

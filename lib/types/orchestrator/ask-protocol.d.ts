import type { CoordinatorMessage } from './seams.js';
/** wf_ask_agent 三态命令。 */
export type AskAgentCmd = 'ask' | 'reply' | 'resolve';
/** resolve 三动作：continue 重启计时 / resend 重发 / abort 终止。 */
export type ResolveAction = 'continue' | 'resend' | 'abort';
/** wf_ask_agent 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface AskAgentArgs {
    cmd?: unknown;
    targetChildId?: unknown;
    askId?: unknown;
    message?: unknown;
    action?: unknown;
}
/** wf_ask_agent 返回（cmd 恒为本次调用的命令；ask 挂起结束时携带回复）。 */
export interface AskAgentResult {
    cmd: 'ask' | 'reply' | 'resolve';
    askId?: string;
    from?: string;
    to?: string;
    reply?: string;
    action?: ResolveAction;
}
/** 协作消息投递缝（真实实现 = 在线 steer / 冷态 followup；单测 fake）。 */
export interface AskAgentDelivery {
    /** 投递协作消息到目标子代理（在线 steer；离线冷恢复 followup，由实现选择）。 */
    deliver(input: {
        sessionId: string;
        to: string;
        message: CoordinatorMessage;
        signal?: AbortSignal;
    }): Promise<void>;
    /** 把超时详情通知父代理（steer 注入，父代理回合内征询用户并 resolve）。 */
    notifyParent(input: {
        sessionId: string;
        message: CoordinatorMessage;
    }): void;
}
/** 审计事件单条（at 为 ISO 时间；detail 为事件附注）。 */
export interface AskAuditEntry {
    at: string;
    event: string;
    detail: string;
}
/** 挂起的协作通信记录（注册于 RunEntry.asks；A 的阻塞等待由此驱动）。 */
export interface PendingAsk {
    askId: string;
    from: string;
    to: string;
    fromNodeId: string;
    toNodeId: string;
    message: string;
    timeoutMs: number;
    expiresAt: number;
    state: 'pending' | 'timed-out' | 'resolved' | 'aborted';
    audit: AskAuditEntry[];
    promise: Promise<AskAgentResult>;
    resolve: (result: AskAgentResult) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
    delivery: AskAgentDelivery;
}
/** 协作消息文本长度上限（防御性截断）。 */
export declare const ASK_MESSAGE_LIMIT = 20000;
/** 构造协作消息（steer/followup 共用；senderSessionId = 发起者会话 id）。 */
export declare function coordinatorMessage(id: string, text: string, senderSessionId: string): CoordinatorMessage;
/** 投递给目标子代理的消息文本（含 askId 与回复指令，业务中文）。 */
export declare function buildAskText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message'>): string;
/** 超时通知父代理的消息文本（父代理据此征询用户并 resolve）。 */
export declare function buildTimeoutText(pending: Pick<PendingAsk, 'from' | 'fromNodeId' | 'to' | 'toNodeId' | 'askId' | 'message' | 'timeoutMs'>): string;

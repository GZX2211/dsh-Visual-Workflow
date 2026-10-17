import type { RootAgentLike, RootInjectedMessage } from '../../orchestrator/index.js';
import { type WfToolsHost } from '../infrastructure/caller.js';
/** 宿主能力缝（index.ts 装配；单测 fake）：在 wf 工具宿主之上加三向投递能力。 */
export interface WfSendMessageHost extends WfToolsHost {
    /** 按会话 id 取子代理 agent（注册表查询；未激活返回 null）。 */
    getChildAgent(childId: string): RootAgentLike | null;
    /** 父代理空闲时唤醒投递（官方注入消息契约：必须带 id/source）。 */
    followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void;
    /** 冷态投递：复用子代理派发协作消息（官方 subagents.sendMessage）。 */
    followupChild(parent: RootAgentLike, childId: string, content: unknown[], options: {
        source: unknown;
        signal?: AbortSignal;
    }): Promise<unknown>;
    /** 官方 Team 成员投递（成员名寻址；官方 Team 服务不可用时由注册前置条件排除）。 */
    sendToTeammate(parent: RootAgentLike, memberName: string, content: unknown[], options: {
        signal?: AbortSignal;
    }): Promise<unknown>;
}
/**
 * 注册 wf_send_message（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfSendMessage(ctx: {
    get(name: string): unknown;
}, host: WfSendMessageHost): () => void;

import type { RootAgentLike } from '../orchestrator/runtime.js';
import { type WfToolsHost } from './wf-tools.js';
/** 宿主能力缝（index.ts 装配；单测 fake）：在 wf 工具宿主之上加子代理查询与冷恢复。 */
export interface WfAskAgentHost extends WfToolsHost {
    /** 按会话 id 取子代理 agent（注册表查询；未激活返回 null）。 */
    getChildAgent(childId: string): RootAgentLike | null;
    /** 冷态投递：复用子代理派发协作消息（官方 subagents.followup）。 */
    followupChild(parent: RootAgentLike, childId: string, content: unknown[], options: {
        source: unknown;
        signal?: AbortSignal;
    }): Promise<unknown>;
}
/**
 * 注册 wf_ask_agent（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfAskAgent(ctx: {
    get(name: string): unknown;
}, host: WfAskAgentHost): () => void;

import type { Context } from '@deepseek-ai/cordis';
import type { AgentHost, RootAgentLike, RootInjectedMessage, TurnEndInfo } from '../orchestrator/runtime.js';
import type { AgentsServiceLike, SubagentsServiceLike } from './runner.js';
export declare class CordisAgentHost implements AgentHost {
    private readonly ctx;
    constructor(ctx: Context);
    /** 解析 agents 服务（缺省/不可用时返回 null，调用方给明确错误）。 */
    private agentsService;
    available(): boolean;
    getRootAgent(sessionId: string): RootAgentLike | null;
    /** 按会话 id 取子代理 agent（wf_ask_agent 投递缝用；未激活返回 null）。 */
    getChildAgent(childId: string): RootAgentLike | null;
    followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void;
    latestTurnEnd(sessionId: string, afterMs: number): TurnEndInfo | null;
    /**
     * 最近一条父代理 assistant/message 文本（afterMs 之后；无则 null）。
     * 官方 dsh-agent-loop 每步结束追加 assistant/message 事件（{ turn, step, message }，
     * message.content 为 ContentBlock[]）——取事件流中时间 >= afterMs 的最后一条
     * assistant/message 的 text 块拼接（执行者模式回写父代理节点输出用）。
     */
    latestRootAssistantText(sessionId: string, afterMs: number): string | null;
    childRunning(childId: string): boolean;
}
/** agents 服务惰性解析（节点子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
export declare function agentsServiceLike(ctx: Context): AgentsServiceLike | null;
/** subagents 服务惰性解析（子代理创建/相邻投递/中断/provider 探测使用面）。 */
export declare function subagentsServiceLike(ctx: Context): SubagentsServiceLike | null;

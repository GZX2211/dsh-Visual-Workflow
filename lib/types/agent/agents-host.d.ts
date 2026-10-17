import type { Context } from '@deepseek-ai/cordis';
import type { AgentHost, RootAgentLike, RootInjectedMessage, TurnEndInfo } from '../orchestrator/index.js';
import type { FlowStore } from '../storage/flow-store.js';
import type { AgentsServiceLike, SubagentsServiceLike } from './runner.js';
export declare class CordisAgentHost implements AgentHost {
    private readonly ctx;
    constructor(ctx: Context);
    /** 解析 agents 服务（缺省/不可用时返回 null，调用方给明确错误）。 */
    private agentsService;
    available(): boolean;
    getRootAgent(sessionId: string): RootAgentLike | null;
    /** 按会话 id 取子代理 agent（wf_send_message 投递缝用；未激活返回 null）。 */
    getChildAgent(childId: string): RootAgentLike | null;
    followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void;
    /**
     * 会话根 Agent 在 afterMs 之后的最新 turn/end（无则 null）。
     *
     * dsh-session 的 `TurnEndReasonMap`（merge-extensible）含 7 种 kind：
     * `completed` / `aborted`（带 cancel cause）/ `blocked` / `error`（结构化 LlmFailure）/
     * `max-tokens` / `interrupted`（崩溃孤儿回合事后收口）/ `forked`（fork 种子构造收口）。
     * 本适配的终态翻译口径：
     *   - `error` → 编排已死（模型/工具/官方内部错误）→ 运行 failed；
     *   - `blocked` → pre-step 被拒绝，父代理回合停住且不会自行恢复 → 同样按编排已死
     *     处理（运行 failed）。若不纳入，运行只能等空闲看护（默认 30 分钟）超时收敛；
     *   - `aborted` → 用户中止（对话区停止按钮）→ 保持运行，等下一次调度（见 watchdog）；
     *   - `completed` / `max-tokens` / `interrupted` / `forked` / 未知 kind → null（不判终态）：
     *     completed 是正常回合结束（父代理可能还有后续调度）；max-tokens 只表示本轮输出
     *     被截断、父代理仍可继续；interrupted/forked 只出现在冷读与 fork 种子，运行中
     *     看护不应据此判定。未知 kind 一律保守返回 null（官方可扩展，不得因未知而误判）。
     * 若将来需要把 max-tokens 也纳入终态判定，属编排语义变更：必须同时改
     * TurnEndInfo 契约、看护分支与测试（适配必须取证可追溯）。
     */
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
/**
 * 按会话取/建服务会话的根 Agent（模式二服务进程装配使用）。
 * 父代理节点声明的 provider/model 优先；会话已有 Agent 时直接复用（持久化上下文保留）。
 * 「取/建」的官方 agents 服务守卫与形状收敛归本模块——进程入口只做装配，不承载实现。
 *
 * @param options.cwd 根 Agent 工作目录（`string | undefined` **必填属性**：强制每个调用方
 *   显式给出已解析的值，杜绝「忘了传就静默取进程全局」）。由调用方按服务文档 workspacePath
 *   经 sessions 的 `resolveNewSessionCwd` 解析后传入；未配置工作区时传 `undefined`，此时
 *   **省略** `meta.cwd`，与同进程的会话创建路径（`CordisSessionProvider.createSession`）同口径，
 *   由官方默认工作区决定。本适配函数不得读进程全局 cwd——服务进程由 manager 以
 *   cwd=dataDir 启动，取进程 cwd 会让交付物写进插件数据目录而不是用户工作区。
 */
export declare function createOrGetServiceAgent(ctx: Context, store: FlowStore, serviceId: string, sessionId: string, options: {
    cwd: string | undefined;
}): Promise<{
    agent: unknown;
    provider?: string;
    model?: string;
}>;
/** agents 服务惰性解析（节点子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
export declare function agentsServiceLike(ctx: Context): AgentsServiceLike | null;
/** subagents 服务惰性解析（子代理创建/相邻投递/中断/provider 探测使用面）。 */
export declare function subagentsServiceLike(ctx: Context): SubagentsServiceLike | null;

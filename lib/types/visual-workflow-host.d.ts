import { Context, Service } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import { FlowStore } from './storage/flow-store.js';
import { OrchestratorRuntime, type RootAgentLike } from './orchestrator/runtime.js';
import { NodeAgentRunner } from './agent/runner.js';
import { CordisAgentHost } from './agent/agents-host.js';
import { EmbeddingService } from './embedding/engine.js';
import { ServiceManager } from './service/manager.js';
import { SchedulerEngine } from './scheduler/engine.js';
import { SchedulerTaskStore } from './scheduler/task-store.js';
import { CordisSessionProvider } from './scheduler/session-provider.js';
import { ToolSwitchStore } from './tools/tool-switches.js';
export declare const VisualWorkflowHostServiceName = "visualWorkflowHost";
/**
 * 宿主 service：持有解析后的 config、FlowStore 与编排运行时，挂载事件观察、
 * 看护定时器与清理。内存运行态（运行锁/快照/子代理表）由编排运行时与节点
 * 执行引擎（NodeAgentRunner）接管。
 */
export declare class VisualWorkflowHost extends Service {
    readonly config: Config;
    /** FlowStore 实例（dataDir 落盘数据层）。 */
    readonly store: FlowStore;
    /** 编排运行时（运行锁/快照/状态机/wait 阻塞/暂停门）。 */
    readonly orchestrator: OrchestratorRuntime;
    /** 节点子代理执行引擎（startContinuable 创建/签名复用/白名单解析）。 */
    readonly runner: NodeAgentRunner;
    /** 会话根 Agent 宿主能力（wf_* 工具层归属校验/提问借 root 身份）。 */
    readonly agents: CordisAgentHost;
    /** 模式二服务管理器（fork 子进程生命周期/端口池/自动恢复）。 */
    readonly serviceManager: ServiceManager;
    /** 定时任务引擎（触发/窗口挂起/续跑；新功能本阶段）。 */
    readonly scheduler: SchedulerEngine;
    /** 定时任务存储（scheduler-tasks.json）。 */
    readonly schedulerTaskStore: SchedulerTaskStore;
    /** 全局工具开关存储（tool-switches.json；父代理工具白名单「关闭」侧，全局即时生效）。 */
    readonly toolSwitches: ToolSwitchStore;
    /** 新会话创建缝（「开启新会话」一次性动作：创建实例时新建主会话；API 端点使用）。 */
    readonly sessionProvider: CordisSessionProvider;
    /** 会话工作目录解析（新会话继承创建者 cwd 用；API 端点使用）。 */
    readonly sessionCwdOf: (sessionId: string) => Promise<string | undefined>;
    /** ReAct 软截停护栏（桥供 runner/编排器，贡献注入子代理）。 */
    private readonly reactGuard;
    /** 思考强度模型选择装配。 */
    private readonly modelSelection;
    /** 子代理系统提示词与协作 Prompt 注入装配。 */
    private readonly childPrompt;
    /**
     * 每子代理作用域装配撤销表（agentId → disposer）：由 `agent/session-start` 处理器在
     * 子代理创建窗口内安装四类贡献（角色提示词/工具可见性/模型选择/软截停），
     * `agent/disposed` 或宿主 dispose 时撤销。持 key 的是 agent id（而非 childId）。
     */
    private readonly childScopeDisposers;
    /**
     * 每个视觉工作流子代理的提示词状态（agentId → ChildPromptState）。在首次 `agent/session-start`
     * 时写入；此后即使子代理被重发布/恢复（`agent/session-start` 再次触发、但不在 withPending
     * 作用域内）也能据此状态重新安装四类贡献——避免「第二轮被官方提示词顶替、贡献被卸载」的
     * 二次重置 BUG。
     * 【关键生命周期】`agent/disposed` **不再**删除此状态：可延续子代理（startContinuable）在
     * 回合间会因官方 watchSettlement（空闲+settled）被销毁并触发 `agent/disposed`，第二轮父代理
     * 再派发时经 coldResume 冷恢复（重新发布 → 再次 `agent/session-start`）。若在 dispose 时删除
     * 状态，重发布将找不到该子代理的 ChildPromptState → 四类贡献不再重装 → 第二轮回退官方提示词。
     * 条目为极小字符串、会话内数量有限，仅随宿主 dispose 统一清理即可。
     */
    private readonly childPromptStates;
    /** 本地嵌入引擎（外部端点 > 本地资产 > BM25 降级；惰性加载）。 */
    private readonly embedding;
    /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
    private _disposed;
    /** 跳过磁盘对账（服务进程装配用：运行记录对账属主进程职责）。 */
    private readonly skipReconcile;
    /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
    get disposed(): boolean;
    constructor(ctx: Context, config: Config, options?: {
        skipReconcile?: boolean;
    });
    /** 按会话取根 Agent（wf_* 工具层提问/校验用；转发至 agents 适配）。 */
    getRootAgent(sessionId: string): RootAgentLike | null;
    /**
     * 在子代理创建窗口内安装四类每子代理作用域贡献，返回合并 disposer（host 管理生命周期）。
     * 与官方 installModelSelection(agentCtx) 的「拿到 child 的 ctx 后安装」范式一致：
     *   - wf_* 可见性双保险（wf_run_node/wf_finish deny）；
     *   - ReAct 软截停护栏；
     *   - 模型选择（provider/model/reasoning）；
     *   - 角色提示词段 + 开关过滤。
     * 因在 `agent/session-start`（agents.create 发布、首轮组装之前同步触发）执行，
     * 四类贡献在首轮即可见——修复「系统提示词/工具第二轮才更新」的同源时序 BUG。
     * 单个贡献失败则跳过（其余照装），返回的 disposer 为已成功安装贡献的合并撤销。
     */
    private installChildScope;
    /** 撤销某 child 已安装的作用域装配（幂等；agent/disposed / 重建路径用）。 */
    private dropChildScope;
    /**
     * 监听官方 `agent/session-start`：子代理创建/重发布窗口（startContinuable 内部、first assembly
     * 之前）同步触发。
     *   - 首建：此时 `withPending` 状态仍在作用域内 → `peekPending()` 取到本次创建的 ChildPromptState；
     *   - 重发布/恢复：`agent/session-start` 再次触发但不在 withPending 作用域内 → 从
     *     `childPromptStates`（首建时持久化）取回状态。
     * 据此在其 ctx 上提前（重新）安装四类贡献，使首轮 + 后续每轮系统提示词与工具集都保持就位，
     * 不会「第二轮被官方提示词顶替、贡献被卸载」（二次重置 BUG）。
     */
    private onAgentSessionStart;
    /**
     * 子代理被销毁时回收其作用域装配（重建配置签名变化 / 正常运行结束）。
     * 【关键】**不删除** `childPromptStates`：可延续子代理在回合间会因官方 watchSettlement
     * （空闲+settled）被销毁并触发 `agent/disposed`，第二轮父代理再派发时经 coldResume 冷恢复
     * （重新发布 → 再次 `agent/session-start`）。若此处删除持久化状态，重发布时将无法找到该
     * 子代理的 ChildPromptState，四类贡献（角色提示词段/工具可见性/模型选择/软截停）不会重装
     * → 第二轮回退官方提示词（「系统提示词和工具已更新」二次重置 BUG）。状态仅随宿主 dispose
     * 统一清理。
     */
    private onAgentDisposed;
    /** 按会话 id 取子代理 agent（wf_ask_agent 投递缝用；转发至 agents 适配）。 */
    getChildAgent(childId: string): RootAgentLike | null;
    /** 冷态投递：复用子代理派发协作消息（subagents 服务惰性解析；缺失报明确错误）。 */
    followupChild(parent: RootAgentLike, childId: string, content: unknown[], options: {
        source: unknown;
        signal?: AbortSignal;
    }): Promise<unknown>;
    /** 数据根目录（数据工具索引落盘位置）。 */
    get dataDir(): string;
    /** 服务 apiKey（调试流式代理鉴权用；密钥仅 Host 持有，不下发浏览器）。 */
    get apiKey(): string | null;
    /** 嵌入引擎（数据工具向量检索用）。 */
    get engine(): EmbeddingService;
    /** 启动装配（Service.init 语义：初始化失败让 fiber 失败，不吞错）。 */
    [Service.init](): Promise<void>;
    /** subagent/end 观察：回写 run 节点状态（ok/fail + output）并唤醒 wait 阻塞。 */
    onSubagentEnd(payload: {
        runId?: unknown;
        provider?: unknown;
        id?: unknown;
        local?: unknown;
        stopReason?: unknown;
        lastAssistantMessage?: unknown;
    }): void;
    /** agent/error 观察：匹配父代理会话 → 快速标记失败并释放运行锁（看护兜底）。 */
    onAgentError(payload: {
        agent?: {
            id?: unknown;
        };
        turn?: unknown;
        step?: unknown;
        error?: unknown;
    }): void;
    /**
     * 清理运行时资源（幂等）。
     * fiber 卸载时需尽力中止全部运行（abort controller + 阻塞等待 reject）、清理
     * 子代理表与护栏登记；运行中的子代理由编排运行时统一中止后由官方 seam 收尾；
     * 模式二服务进程的停止逻辑在服务管理阶段接入。
     */
    dispose(): void;
}

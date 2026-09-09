import type { Context } from '@deepseek-ai/cordis';
import type { FlowStore } from '../storage/flow-store.js';
import type { GraphNode, RoleNode } from '../shared/graph-model.js';
import type { NodeRunner, NodeStartInput, OrchestratorLogger } from '../orchestrator/runtime.js';
import { type ReactGuardBridge } from './guards.js';
import type { ModelSelectionSetup } from './model-selection.js';
import type { ChildPromptSetup } from './prompt-setup.js';
/** 子代理复用键：sessionId + flowId + nodeId（跨会话同 id 工作流各自独立）。 */
export declare function childKey(sessionId: string, flowId: string, nodeId: string): string;
/**
 * 影响子代理组成的配置签名（变化即重建；工具为解析后的清单）。
 * 字段依据架构文档 §4.2 L218：rolePrompt/provider/model/工具清单/reasoning
 * （另含 presetId——其决定工具清单，签名内显式保留以抵御同名清单歧义；
 * injectSystemPrompt 决定官方系统提示词开关；injectToolSections 决定工具散文段开关；
 * rolePrompt 为角色 Prompt 的实际注入文本——当 .md 文件路径设置时为其当前内容，文件改动即重建）。
 */
export declare function nodeChildSignature(node: GraphNode, resolvedTools: string[], rolePrompt: string, injectSystemPrompt?: boolean, injectToolSections?: boolean, collabPrompt?: string): string;
/** 从可用 provider 清单中挑选（首选序优先，否则清单第一个；无可选返回 null）。 */
export declare function pickProviderName(available: string[]): string | null;
/**
 * 探测可用延续子代理 provider：0.1.2 SubagentRuntime 移除 rc.2 的 list()，改为按名
 * getProvider(name)（未注册返回 undefined）探测候选顺序；旧宿主回退 list() 清单。
 */
export declare function detectSubagentProvider(service: SubagentsServiceLike): string | null;
/**
 * 解析节点的角色 Prompt 实际注入文本：
 *   - 设置了 promptFilePath（宿主绝对路径）→ 运行时读取该文件（读取失败回退 node.data.systemPrompt）；
 *   - 未设置 → 直接使用 node.data.systemPrompt（内联文本或 .md 内容快照）。
 * 返回的角色文本会纳入子代理签名：文件改动 → 内容变 → 签名变 → 重建子代理 → 自动重载。
 */
export declare function resolveRolePrompt(node: RoleNode): Promise<string>;
/** agents 服务最小结构（注册表；roots 供工具可见集枚举）。 */
export interface AgentsServiceLike {
    get(id: string): unknown;
    roots?(): unknown[];
}
/** 子代理服务最小结构（0.1.2 SubagentRuntime 使用面；零官方类型依赖，运行时守卫）。 */
export interface SubagentsServiceLike {
    /** 延续子代理 provider 名列表（rc.2 旧面；0.1.2 移除 list()，改用 getProvider 按名探测）。 */
    list?(): string[];
    /** 延续子代理创建：首条 prompt 即任务块（rc.1 保留；request 兼容 persona/toolFilter/agentOptions）。 */
    startContinuable(spec: {
        provider: string;
        label: string;
        request: {
            prompt: Array<{
                type: 'text';
                text: string;
            }>;
            parent: unknown;
            persona?: string;
            toolFilter?: {
                allow: string[];
            };
            agentOptions?: {
                provider?: string;
                model?: string;
            };
        };
        signal: AbortSignal;
    }): Promise<{
        childId: string;
        messageId?: unknown;
    }>;
    /** 0.1.2 相邻 Agent 投递（替代 rc.2 followup）：live 父 Agent → direct child 派发下一回合。 */
    sendMessage?(sender: unknown, targetId: string, content: Array<{
        type: 'text';
        text: string;
    }>, options: {
        signal?: AbortSignal;
    }): Promise<unknown>;
    /** 0.1.2 host 协议投递（distinct child turn，durable host source）；无 sendMessage 时回退。 */
    queuePrompt?(parent: unknown, childId: string, content: Array<{
        type: 'text';
        text: string;
    }>, source?: unknown, signal?: AbortSignal): Promise<unknown>;
    /** 尽力中断当前回合（0.1.2 同步签名 interrupt(target, authority)；保留会话）。 */
    interrupt?(childId: string, authority: {
        kind: 'user';
        parentSessionId: string;
    }): unknown;
    /** 0.1.2 provider 按名探测（探测 provider 是否注册；未注册返回 undefined）。 */
    getProvider?(name: string): unknown;
    /** rc.2 旧复用投递（双版本兼容；0.1.2 宿主无此方法）。 */
    followup?(parent: unknown, childId: string, content: unknown[], options: {
        source: unknown;
        signal?: AbortSignal;
    }): Promise<unknown>;
}
/** 工具视图缝（白名单解析依赖；CordisToolsView 为真实实现，单测 fake）。 */
export interface ToolsView {
    /** 全部可见工具名（全局层 ∪ 存活 agent scope ∪ preset standing scope）。 */
    visibleToolNames(sessionId?: string): Promise<string[]>;
    /** 官方 preset 的 standing scope 工具名；服务缺失返回 null（调用方回退）。 */
    presetToolNames(presetId: string): Promise<string[] | null>;
    /**
     * 当前会话父代理（root agent）scope 视图工具名（全局层 ∪ 父代理链注册工具）。
     * 子代理创建时官方 tools.restrict 校验的 restrictableNames 恰为此边界
     * （官方 view() = 全局层 + 祖先 scope 层注册名；不含注入的 run_code、不含
     * own scope），因此 allow 名单只能取该集合子集——未注册/幽灵工具
     * （如 str_replace_editor 仅存在于无关 preset standing scope）由此剔除。
     * 无 agent/服务缺失回退全局层。
     */
    agentToolNames(sessionId?: string): Promise<string[]>;
}
/**
 * 真实工具视图适配：并集 = 全局层 ∪ 每个存活 agent 的 scope 视图 ∪ 每个 agent
 * preset 的 standing scope 视图（旧项目 allToolsSchemas 同构移植）。
 * 历史坑注释（旧项目复盘）：scope key 必须是 agent 对象本身，不是 agent.ctx
 * （Cordis Context）——schemas(scope) 按 scope key 查找，传错必然只能看到全局层。
 */
export declare class CordisToolsView implements ToolsView {
    private readonly ctx;
    constructor(ctx: Context);
    private toolsService;
    private agentsService;
    private agentPresetsService;
    visibleToolNames(sessionId?: string): Promise<string[]>;
    presetToolNames(presetId: string): Promise<string[] | null>;
    agentToolNames(sessionId?: string): Promise<string[]>;
}
/** 白名单解析入参。 */
export interface ResolveToolsInput {
    store: FlowStore;
    toolsView: ToolsView;
    sessionId: string;
    flowId: string;
    /** 已解析为主节点的角色节点（虚拟节点在 T-021 已解析）。 */
    node: RoleNode;
    /**
     * 运行模式（缺省按模式一处理，向后兼容）。模式二的服务文档存储在
     * services/ 目录、须经 getServiceAsFlow 读取——db-in 连线检测必须按
     * 模式分派，否则模式二下 getWorkflow 恒返回 null 导致 wf_db_query 永不注入。
     */
    mode?: 'mode1' | 'mode2';
    /**
     * 被全局关闭的工具名集合（tool-switches 模块的当前快照）。
     * 关闭工具 = 父代理上下文不可见 → 子代理不得携带（双保险第二层，
     * 第一层为 system-prompt/assemble 全局瀑布剔除）。
     */
    disabledTools?: ReadonlySet<string>;
}
/**
 * 运行时解析节点工具白名单（架构文档 §4.2 L219）：
 *   - presetId 空 → []（无工具）；
 *   - combo- 前缀 → 组合勾选 ∩ 可见工具集 + 所选 MCP 服务器前缀工具（缺失组合报错）；
 *   - 官方 preset → standing scope 工具名 ∩ 可见（服务缺失回退全部可见）；
 *   - db-in 连线存在 → 追加 wf_db_query（§4.4.3 规则 5）；
 *   - wf_run_node/wf_finish 无条件剔除（即便被勾选也不进入子代理）。
 * 注意：无强制追加——wf_ask/wf_ask_agent 仅在组合勾选时进入（PRD §4.4.2 规则 7）。
 */
export declare function resolveAgentTools(input: ResolveToolsInput): Promise<string[]>;
/** runner 依赖（官方服务以惰性函数注入，缺省时报明确错误）。 */
export interface NodeAgentRunnerDeps {
    store: FlowStore;
    /** agents 服务惰性解析（调用时求值）。 */
    agents: () => AgentsServiceLike | null;
    /** subagents 服务惰性解析（调用时求值）。 */
    subagents: () => SubagentsServiceLike | null;
    /** 工具视图（白名单解析）。 */
    toolsView: ToolsView;
    /** 软截停护栏桥（guards.ts）。 */
    react: ReactGuardBridge;
    /** 模型选择装配（model-selection.ts）。 */
    modelSelection: ModelSelectionSetup;
    /** 子代理系统提示词注入装配（prompt-setup.ts）。 */
    promptSetup: ChildPromptSetup;
    /** 全局关闭工具集快照（tool-switches 模块；同步读取；缺省空集 = 不做过滤）。 */
    toolSwitches?: () => ReadonlySet<string>;
    logger?: OrchestratorLogger;
}
/**
 * 节点子代理执行引擎：每个角色节点 = 一个可延续子代理
 * （ctx.subagents.startContinuable，带持久 Session）。
 *   - 复用键 sessionId:flowId:nodeId；配置签名变化时重建（旧子代理保留历史）；
 *   - 首条创建即把完整任务块作为 prompt 注入（杜绝创建即空转）；
 *   - 复用经 followup 派发本轮任务，立即返回（不阻塞父代理）。
 */
export declare class NodeAgentRunner implements NodeRunner {
    private readonly deps;
    /** 子代理表：复用键 → { childId, signature }。 */
    private readonly nodeChildren;
    /** 已创建 childId 集合（dispose 清理护栏登记用）。 */
    private readonly childIds;
    /** 软截停消费适配（NodeRunner 契约）。 */
    readonly consumeReactCapped: NonNullable<NodeRunner['consumeReactCapped']>;
    constructor(deps: NodeAgentRunnerDeps);
    /**
     * 异步启动一个节点任务（消息驱动，立即返回）：
     *   - 首次创建：任务块已在首条 prompt 注入，子代理立即开始执行；
     *   - 复用：经 followup 派发本轮任务；
     *   - 完成事件由编排器监听 subagent/end 更新快照，本方法不等待执行结果。
     */
    startNodeTask(input: NodeStartInput): Promise<{
        childId: string;
        created: boolean;
    }>;
    /** 尽力中断子代理当前回合（保留会话；官方 interrupt 语义）。 */
    interruptChild(childId: string, sessionId: string): Promise<void>;
    /** 清理子代理表与护栏登记（宿主 dispose 调用；不中断子代理——由运行时统一中止）。
     *  每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）由 host 层
     *  `agent/session-start` 处理器在创建窗口内安装，其撤销函数归 host 的
     *  `childScopeDisposers` 管理（见 visual-workflow-host.ts），runner 不再持有。 */
    dispose(): void;
    /**
     * 复用子代理的下一回合派发：0.1.2 SubagentRuntime 移除 rc.2 的 followup，改为相邻 Agent
     * 通道。优先 sendMessage（免自定义 source：sender 即 live 父代理，来源由服务派生）；
     * 无则回退 queuePrompt / 旧 followup（双版本兼容）。
     */
    private deliverReuse;
    /**
     * 确保节点子代理存在且配置匹配；返回 { childId, created }。
     * 【关键时序】startContinuable 把 request.prompt 作为第一条 user 消息立即提交，
     * 子代理创建即开始第一轮推理——首次创建必须把完整任务块 blocks 作为 prompt 注入。
     */
    ensureNodeChild(input: NodeStartInput): Promise<{
        childId: string;
        created: boolean;
    }>;
    private requireSubagents;
    private requireParent;
    /**
     * 把节点级模型选择（provider/model/reasoningEffort）写入该 child 的 selection
     * （经 agent.ctx 身份匹配贡献安装的同一 childCtx，无 pending 竞态）。
     * 官方语义：selection 可变，下一步骤生效——首条请求可能仍用创建时的 agentOptions
     * （reasoning 从第二个步骤起稳定生效，与官方 installModelSelection 一致）。
     */
    private attachModelSelection;
    /**
     * 把节点级角色 Prompt、官方系统提示词开关与工具散文段开关写入该 child 的 prompt setup。
     * 角色 Prompt 由 prompt-setup 注册为系统提示词独立段；injectSystemPrompt=false 时
     * 开关过滤瀑布会清空官方段；injectToolSections=false 时移除 tool:* 散文段。
     * Code Mode 协议段（tools:sdk/tools:code-only）与工具 Schema 始终保留，不受两开关影响。
     * 角色文本经 resolveRolePrompt 解析（.md 路径设置时读取文件当前内容），与创建期一致。
     */
    private attachPromptState;
}
/**
 * 子代理工具可见性贡献（经 registerContinuableSetup 注入）：
 * 在 child scope 上 tools.restrict({ deny: ['wf_run_node', 'wf_run_node_wait', 'wf_finish'] })——
 * 与白名单 allow（永不包含）构成双保险（架构文档 §4.2 L219）。restrict 对未注册
 * 工具会抛错（官方 core/tools L1091），故此处尽力而为：失败即跳过，白名单仍兜底。
 */
export declare function childVisibilityContribution(): (childCtx: unknown) => () => void;

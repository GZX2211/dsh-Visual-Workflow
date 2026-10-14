import type { FlowStore } from '../storage/flow-store.js';
import type { RoleNode } from '../shared/graph-model.js';
import type { NodeStartInput, OrchestratorLogger } from '../orchestrator/index.js';
import { type AgentTeamsServiceLike, type TeamMemberViewLike } from '../team/index.js';
import type { ChildPromptSetup } from './prompt-setup.js';
import type { ChildToolFilterSetup } from './child-tool-filter.js';
import type { ModelSelectionSetup } from './model-selection.js';
import type { AgentsServiceLike, SubagentsServiceLike, ToolsView } from './runner.js';
import type { ReactGuardBridge } from './guards.js';
/**
 * 官方成员身份前缀（逐字复刻 `dsh-experimental-tool-agent-team` 的 spawn_teammate 模板）。
 *
 * 为什么必须逐字复刻：官方工具创建成员时会把这段前缀插在任务之前，成员据此知道自己的名字、
 * Lead 名与协作入口；插件直接调服务层不会自动获得，缺了它成员既不知道队友也不知道怎么发消息。
 * 官方该模板变更时，此处必须同步（判据测试锁定文本形状）。
 */
export declare function teammateIdentityPrefix(name: string): string;
/** 成员启动结果（编排器据此登记事件归属与节点状态）。 */
export interface TeamMemberStartResult {
    /** 官方成员会话 id = 子代理 childId。 */
    childId: string;
    /** 官方成员名（官方 send_message 的 target）。 */
    target: string;
    /** true = 复用既有成员（本次仅派发新任务）；false = 本次新建。 */
    created: boolean;
}
/** 成员启动器依赖（纯函数经注入传入，避免与 runner 形成运行时循环依赖）。 */
export interface TeamMemberLauncherDeps {
    store: FlowStore;
    /** agents 服务惰性解析（取会话根 Agent 作为官方团队 Lead）。 */
    agents: () => AgentsServiceLike | null;
    /** subagents 服务惰性解析（provider 探测）。 */
    subagents: () => SubagentsServiceLike | null;
    /** 官方 协作组服务惰性解析；返回 null 即不可用，调用方降级为普通子代理路径。 */
    teams: () => AgentTeamsServiceLike | null;
    toolsView: ToolsView;
    /** 全局关闭工具快照（取值前由宿主保证已跨进程刷新）。 */
    toolSwitches?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>;
    react: ReactGuardBridge;
    modelSelection: ModelSelectionSetup;
    toolFilter: ChildToolFilterSetup;
    promptSetup: ChildPromptSetup;
    /**
     * 官方 协作组会话级成员名额上限（部署层 agent-team.maxMembers 的镜像）。
     * 官方语义是「累计创建过的 teammate 数，含创建失败的」；插件在新建成员前预检，
     * 把运行期类型化失败提前成可行动错误。
     */
    memberLimit: number;
    logger?: OrchestratorLogger;
    /** 成员工具白名单解析（与普通节点路径同源：resolveAgentTools）。 */
    resolveTools: (input: {
        node: RoleNode;
        sessionId: string;
        flowId: string;
        disabledTools?: ReadonlySet<string>;
        mode?: 'mode1' | 'mode2';
    }) => Promise<string[]>;
    /** 角色 Prompt 实际文本解析（resolveRolePrompt）。 */
    resolveRolePrompt: (node: RoleNode) => Promise<string>;
    /** 延续子代理 provider 探测（detectSubagentProvider）。 */
    detectProvider: (service: SubagentsServiceLike) => string | null;
    /** 子代理组成签名（nodeChildSignature）。 */
    signatureOf: (node: RoleNode, resolvedTools: string[], rolePrompt: string, injectSystemPrompt: boolean, injectToolSections: boolean, collabPrompt: string) => string;
}
/**
 * 协作组成员启动器（官方 Agent 协作组路径；官方不可用时由调用方降级为普通子代理）。
 *
 * 无状态持有者之外的唯一内存表是成员组成签名（官方成员在会话内不可重建，签名变化只能告警）。
 */
export declare class TeamMemberLauncher {
    private readonly deps;
    /**
     * 官方成员名 → 上次生效的组成签名。
     * 【释放路径】条目与团队成员一一对应（官方成员本身在会话内不可删除），
     * 名称数量有官方上限，随宿主持有的本对象一起回收。
     */
    private readonly memberSignatures;
    constructor(deps: TeamMemberLauncherDeps);
    /**
     * 官方 协作组路径是否可用（成员启动路径选择与协作块文案的唯一判据）。
     *
     * 条件：官方 协作组服务可用 + **官方 协作组工具面确实下发给成员** + 会话根 Agent 存活
     * + 存在可用的延续子代理 provider。
     *
     * 为什么必须校验工具面：官方 协作组由两个独立包组成——领域服务（agent-team）与工具/策略包
     * （tool-agent-team）。只挂载领域服务时成员会被创建为 teammate，却拿不到九个官方工具与
     * team:policy，此时按 official 通道注入「用 send_message 通信」的文案必然失效。官方工具
     * 注册在每个成员自身 scope，故只需看父代理（同为成员）scope 是否可见该工具。
     */
    available(sessionId: string): boolean;
    /**
     * 启动（或复用）一个成员节点的官方 teammate 并派发本轮任务。
     *
     * @returns 成员启动结果；官方 协作组服务或根 Agent 不可用时返回 null（调用方降级为普通子代理）。
     * @throws 成员名已被失败成员占用、成员仍在创建中、名额耗尽、无可用 provider、官方未返回成员标识等可行动错误。
     */
    start(input: NodeStartInput): Promise<TeamMemberStartResult | null>;
    /** 会话根 Agent（官方团队 Lead）：不存在即无法启动团队。 */
    private rootAgentOf;
    /**
     * 某成员节点在官方 roster 中的当前状态（成员运行态的**唯一权威读源**）。
     * 返回 null：官方 协作组不可用，或该节点尚无对应成员（未创建 / 已降级为普通子代理）。
     */
    memberStatusOf(sessionId: string, nodeId: string): TeamMemberViewLike['status'] | null;
    /**
     * 应用成员级组成：留存（供重发布重装）并登记本轮护栏上限。
     * 创建路径已在创建窗口内生效；复用路径下模型的后续请求与工具可见性由重发布重装补齐。
     */
    private applyMemberComposition;
    /** 记录成员组成签名（首次）。 */
    private rememberSignature;
    /**
     * 成员组成签名变化告警（不重建成员）。
     * 官方成员在创建时确定组成，同会话内无法重建；签名变化只能靠新建会话生效，
     * 因此这里只给出可行动诊断，不静默忽略。
     */
    private reportSignatureChange;
}

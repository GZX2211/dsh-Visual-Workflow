/** 角色 Prompt 注册为的系统提示词段名（order 1，位于官方 harness:identity 之后、工具段之前）。 */
export declare const VISUAL_WORKFLOW_PROMPT_SECTION = "visual-workflow:prompt";
/** 子代理提示词注入状态（runner 在节点启动后写入；bindParent 也使用）。 */
export interface ChildPromptState {
    /** 节点自定义 System Prompt（角色 Prompt；可为空）。 */
    systemPrompt: string;
    /** 官方系统提示词注入开关（默认 true）。 */
    injectSystemPrompt: boolean;
    /** 工具提示词（tool:* 散文段）注入开关（默认 true）。 */
    injectToolSections: boolean;
}
/** 子代理/父代理提示词注入装配（contribution/attach/bindParent 三段式 + 创建期 withPending）。 */
export interface ChildPromptSetup {
    /** 经 registerContinuableSetup 注册的贡献（每个子代理创建时安装监听）。 */
    contribution: (childCtx: unknown) => () => void;
    /**
     * 在 startContinuable 调用前后夹住节点级状态：作用域内注册的贡献可同步取得
     * 本次创建对应的状态，并立即写入 WeakMap，避免首轮组装竞态。
     */
    withPending<T>(state: ChildPromptState, operation: () => Promise<T>): Promise<T>;
    /** 子代理创建完成后由 runner 调用：写入节点级提示词状态（兜底/复用覆盖）。 */
    attach(childCtx: unknown, state: ChildPromptState): void;
    /**
     * 把父代理（会话根 Agent）的提示词状态写入其 ctx（运行时直接调用）。
     * 同一 sessionId 只注册一次（此后仅更新可变状态）；注册后的段/过滤对根 Agent 全程生效，
     * 跨会话不影响。非侵入：仅挂载，不修改官方源码。
     */
    bindParent(ctx: unknown, state: ChildPromptState, sessionId: string): void;
    /**
     * 注册全局 unscoped `system-prompt/assemble` 瀑布（host 层；与工具开关瀑布同构）：
     * 当 `withPending` 的 AsyncLocalStorage 状态仍在作用域内（即子代理首轮组装发生在
     * `startContinuable` 内部时），据此注入角色 Prompt 段并应用开关过滤——修复「子代理
     * 首轮系统提示词未替换成用户自设角色 Prompt」的 BUG。
     *
     * 为什么需要全局瀑布：子代理首轮组装（`agents.create` 后 `followup` 触发）在
     * `startContinuable` 返回**之前**同步发生（官方 dsh-agent-loop 的 preStep → assemble），
     * 而 per-agent 贡献经 `childSetup` 在 `startContinuable` 返回**之后**才安装，晚于首轮，
     * 导致首轮组装时角色 Prompt 段尚未注册。全局瀑布在 host 初始化时即注册（早于任何
     * 子代理创建），且首轮组装执行在 `withPending` 作用域内，故就近读到 pending 状态注入。
     * 后续回合（pending 已退出）由 per-agent 贡献/bindParent 持久生效，本瀑布不再介入
     * （`pending.getStore()` 为空即原样返回），避免双重注入。
     */
    registerGlobalAssemblyHook(ctx: PromptChildContextLike): () => void;
    /**
     * 当前是否处于 `withPending`（视觉工作流子代理创建）作用域内。
     * host 层 `agent/session-start` 处理器据此判断「正在创建的是视觉工作流子代理」，
     * 从而在其创建窗口内提前安装四类每子代理作用域贡献（角色提示词段 / 工具可见性 deny /
     * 模型选择 / 软截停），使首轮系统提示词与工具集均在第一回合就位（修复「工具第二轮才更新」）。
     */
    hasPending(): boolean;
    /** 读取当前 withPending 作用域内的状态（若在作用域内）；`agent/session-start` 首建时据此取状态。 */
    peekPending(): ChildPromptState | undefined;
}
/** 子代理/父代理上下文最小结构（on + systemPrompt.section 用于挂瀑布与注册角色段）。 */
interface PromptChildContextLike {
    on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void;
    systemPrompt?: {
        section?(input: {
            name: string;
            order: number;
            text: unknown;
        }): () => void;
    };
}
/**
 * 创建子代理/父代理提示词注入装配。
 *
 * @returns contribution + attach + withPending + bindParent 四段式接口。
 */
export declare function createChildPromptSetup(): ChildPromptSetup;
export {};

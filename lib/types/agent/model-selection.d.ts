/** 节点模型选择（官方 ModelSelection 同构；reasoningEffort 取值域以适配器公布为准）。 */
export interface ModelSelectionLike {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 可变选择 + 组装期捕获（官方 ModelSelectionRef 同构）。 */
export interface ModelSelectionRefLike {
    current: ModelSelectionLike | undefined;
    assembled: ModelSelectionLike | undefined;
}
/** 注入点最小结构（childCtx 形状；与 guards.ts 的 GuardChildContext 同族）。 */
export interface SelectionChildContext {
    on(name: string, listener: (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown): () => void;
}
/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方 installModelSelection 的零依赖移植）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export declare function installModelSelectionLike(childCtx: SelectionChildContext, selection: ModelSelectionRefLike): () => void;
/** 模型选择装配（index.ts 使用：贡献 + 挂接入口）。 */
export interface ModelSelectionSetup {
    /** 经 registerContinuableSetup 注册的贡献（每 child 安装双瀑布 + 登记 selection）。 */
    contribution: (childCtx: unknown) => () => void;
    /**
     * 子代理创建完成后由 runner 调用：把节点级选择写入该 child 的 selection。
     * childCtx 以对象身份匹配（contribition 执行时的同一 childCtx = Agent.ctx）。
     */
    attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void;
    /**
     * 把父代理（会话根 Agent）的模型选择写入其 ctx（运行时直接调用）。
     * 同一 sessionId 只注册一次（此后仅更新 selection.current）；
     * 服务商/模型/思考强度在会话内可调（官方 ModelSelection 语义），非侵入仅挂载。
     */
    bindParent(ctx: unknown, selection: ModelSelectionLike, sessionId: string): void;
}
/**
 * 创建模型选择装配：返回贡献与 attach 入口。
 * 为什么 attach 在创建后（而非贡献内取配置）：贡献签名固定 (childCtx) => disposer，
 * 无法携带节点参数；WeakMap 身份匹配让 runner 在拿到 childId → agent.ctx 后写值，
 * 无 pending 状态竞态（并发创建安全）。
 */
export declare function createModelSelectionSetup(): ModelSelectionSetup;

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
    /** 贡献（每 child 安装双瀑布 + 登记 selection）；由宿主在子代理创建窗口内对 childCtx 调用。 */
    contribution: (childCtx: unknown) => () => void;
    /**
     * 子代理创建完成后由 runner 调用：把节点级选择写入该 child 的 selection。
     * childCtx 以对象身份匹配（contribution 执行时的同一 childCtx = Agent.ctx）。
     */
    attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void;
    /**
     * 在创建窗口内夹住一段「本次创建应有的模型选择」。
     *
     * 为什么需要：selection 默认在创建完成后才写入，而创建即开始首轮推理——首条请求会落到
     * 创建时的路由（父代理的 provider/model）。对无法经官方创建参数携带路由的子代理
     * （协作组成员由官方 Team 服务建立，不接受 agentOptions），必须在创建窗口内就让
     * selection 就位，否则首个步骤用错模型。非该场景无需使用本方法。
     */
    withPending<T>(selection: ModelSelectionLike | undefined, operation: () => Promise<T>): Promise<T>;
    /**
     * 按 childId 记住该子代理的模型选择。
     *
     * 两处消费：重发布（冷恢复）时重装（restore），以及按身份查询当前模型（modelOf）——
     * 因为「可延续子代理在回合间会被销毁并冷恢复」，创建窗口内写进 ctx 的 selection 会丢失，
     * 冷恢复时官方不接受成员级路由，故选择必须由本模块留存。
     */
    remember(childId: string, selection: ModelSelectionLike): void;
    /**
     * 重发布时按 childId 重装已记住的选择（宿主在 `agent/created` 调用；无记录则不做任何事）。
     */
    restore(childId: string, childCtx: unknown): void;
    /**
     * 把父代理（会话根 Agent）的模型选择写入其 ctx（运行时直接调用）。
     * 同一 sessionId 只注册一次（此后仅更新 selection.current）；
     * 服务商/模型/思考强度在会话内可调（官方 ModelSelection 语义），非侵入仅挂载。
     */
    bindParent(ctx: unknown, selection: ModelSelectionLike, sessionId: string): void;
    /**
     * 按子代理身份查询当前模型选择（无记录返回 null）。
     *
     * 为什么需要查询入口：模型路由只在本装配内成为事实，消费方（如经验评价记录评分者模型）
     * 只能经此读取，各自推断必然与实际路由漂移。「无记录」返回 null 而不是空对象，
     * 让消费方自己决定空值语义（记录空串 = 有事实但值为空）。
     */
    modelOf(childId: string): ModelSelectionLike | null;
    /** 按会话查询父代理当前模型选择（未绑定返回 null）。 */
    parentModelOf(sessionId: string): ModelSelectionLike | null;
}
/**
 * 创建模型选择装配：返回贡献与 attach 入口。
 * 为什么 attach 在创建后（而非贡献内取配置）：贡献签名固定 (childCtx) => disposer，
 * 无法携带节点参数；WeakMap 身份匹配让 runner 在拿到 childId → agent.ctx 后写值，
 * 无 pending 状态竞态（并发创建安全）。
 */
export declare function createModelSelectionSetup(): ModelSelectionSetup;

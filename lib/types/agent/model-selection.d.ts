/** 节点模型选择（官方 ModelSelection 同构；reasoningEffort 取值域以适配器公布为准）。 */
export interface ModelSelectionLike {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 可变选择 + 组装期捕获（官方旧版 ModelSelectionRef 同构；assembled 只被旧核瀑布使用）。 */
export interface ModelSelectionRefLike {
    current: ModelSelectionLike | undefined;
    assembled: ModelSelectionLike | undefined;
}
/** 注入点最小结构（childCtx 形状；与 guards.ts 的 GuardChildContext 同族）。 */
export interface SelectionChildContext {
    on(name: string, listener: (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown): () => void;
}
/**
 * 官方 Agent 模型选择面（0.2.2+ 的 AgentModel；旧核没有该字段）。
 * current() 是步进准备将固化的选择；select() 是官方错误信息要求的唯一改选通道。
 * 全部可选：形状漂移时按旧核瀑布降级，不因未知字段抛错。
 */
export interface SelectionAgentModelLike {
    current?: () => ModelSelectionLike | undefined;
    select?: (selection: ModelSelectionLike) => void;
}
/** Agent 最小形状（ctx 用于身份匹配；model 为 0.2.2+ 的官方选择面）。 */
export interface SelectionAgentLike {
    ctx?: unknown;
    model?: SelectionAgentModelLike;
}
/** 节点配置的模型/强度字段（空白 = 未配置）。 */
export interface NodeModelConfig {
    provider?: unknown;
    model?: unknown;
    reasoning?: unknown;
}
/**
 * 由节点配置与官方当前路由合成一次模型选择（纯函数）。
 *
 * 语义与节点面板「留空 = 默认」一致：
 *   - provider+model 都配置：按节点路由选择；reasoning 留空时省略 effort，即恢复所选
 *     模型的默认强度（agent.model.select 会清除继承的父级 effort）；
 *   - 只配置 reasoning：沿用官方当前路由（父代理继承或创建时 AgentOptions），只改强度；
 *   - 其余（全空 / 路由不完整且无强度）：返回 null，保持官方继承路由不动。
 */
export declare function composeNodeSelection(config: NodeModelConfig, current: ModelSelectionLike | null): ModelSelectionLike | null;
/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方旧版 installModelSelection 的零依赖移植；
 * 仅 0.2.1 及以前使用——0.2.2+ 由 contribution 判定后不安装，改走 agent.model.select）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export declare function installModelSelectionLike(childCtx: SelectionChildContext, selection: ModelSelectionRefLike): () => void;
/** 模型选择装配（index.ts 使用：贡献 + 挂接入口）。 */
export interface ModelSelectionSetup {
    /**
     * 贡献（每 child 安装作用域监听 + 登记 selection）；由宿主在子代理创建窗口内对 childCtx 调用。
     * `agent` 用于判定官方选择面：0.2.2+ 不安装 agent/request 改写（会与步进固化冲突），
     * 旧核仍安装双瀑布。缺省按旧核处理。
     */
    contribution: (childCtx: unknown, agent?: unknown) => () => void;
    /**
     * 子代理创建完成后由 runner/host 调用：把节点级选择写入该 child 的 selection 留存。
     * childCtx 以对象身份匹配（contribution 执行时的同一 childCtx = Agent.ctx）。
     */
    attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void;
    /**
     * 把选择提交给官方 Agent（`agent.model.select()`），必须在下一步步进准备前调用。
     *
     * 显式传入 selection 时同步写入本装配留存（供 modelOf / 冷恢复重装）；缺省用已留存值。
     * 返回是否真正提交：旧核无 model.select 时返回 false，调用方沿用旧版 agent/request 瀑布。
     * 官方 select 抛错时向上传播，由调用方按各自审计口径处理（不得静默篡改选择）。
     */
    applyTo(agent: unknown, selection?: ModelSelectionLike): boolean;
    /** 读官方 Agent 当前选择（步进准备将固化的值）；旧核或形状不符返回 null。 */
    currentOf(agent: unknown): ModelSelectionLike | null;
    /**
     * 在创建窗口内夹住一段「本次创建应有的模型选择」。
     *
     * 为什么需要：对无法经官方创建参数携带路由的子代理（Team 成员由官方 Team 服务建立，
     * 不接受 agentOptions），必须在创建窗口内就让 selection 就位；否则首个步骤用错模型。
     * 新核由宿主在 `agent/created` 内 applyTo 提交官方 AgentModel，旧核由贡献瀑布接管。
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
     * 同一 sessionId 只注册一次（此后仅更新 selection.current）；新核同时经 `agent`
     * 参数提交官方 AgentModel，旧核由旧版瀑布在请求阶段生效。
     */
    bindParent(ctx: unknown, selection: ModelSelectionLike, sessionId: string, agent?: unknown): void;
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

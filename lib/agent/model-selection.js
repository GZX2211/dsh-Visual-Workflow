// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）注入（T-022；V-02 定稿语义）。
//
// 官方取证（需求文档 V-02 + 架构文档 §8 索引 #4、#7）：
//   - 官方 AgentOptions 仅 provider/model/maxTokens（packages/core/agent/src/
//     runtime-types.ts L24-31）——思考强度不在创建选项内；
//   - 官方机制 = ModelSelection + installModelSelection(agentCtx, selection)
//     （packages/core/agent/src/model-selection.ts L10-75）：两条 scoped waterfall
//     （system-prompt/assemble 注入 provider/model 变量；agent/request 改写
//     LlmCallConfig 的 provider/model/reasoningEffort），selection.current 可变，
//     由调用入口持有；
//   - 注入点（0.1.2 适配）：rc.2 的 ctx.subagents.registerContinuableSetup 已从官方移除；
//     改为 runner 在 startContinuable 返回后按 agents.get(childId).ctx 调用本 contribution
//     （与官方 installModelSelection(agentCtx, …)「拿 child 的 ctx 安装」的范式一致）。
//
// 本移植（零官方运行时依赖，W-05）：结构逐条对齐官方 installModelSelection，
// payload/next 全部 unknown 收窄；selection 以 WeakMap 按 childCtx 对象身份登记，
// runner 在 startContinuable 返回后经 agents.get(childId).ctx 找到同一对象并写入
// 节点级 { provider, model, reasoningEffort }——无全局 pending 状态，并发创建
// （协作组并行成员）天然无竞态。子代理复用（签名不变）时 selection 值不变；
// 签名含 provider/model/reasoning，变化即重建，因此 selection 在 child 生命周期
// 内保持字节稳定（KV 前缀友好）。
/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方 installModelSelection 的零依赖移植）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export function installModelSelectionLike(childCtx, selection) {
    // system-prompt/assemble：组装期把 provider/model 注入提示词变量（官方 L40-53）
    const disposeAssembly = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
        const assembly = await next();
        const selected = selection.current;
        selection.assembled = selected;
        if (selected === undefined)
            return assembly;
        const shaped = assembly;
        if (!shaped || typeof shaped !== 'object')
            return assembly;
        return {
            ...shaped,
            variables: {
                ...(shaped.variables ?? {}),
                provider: selected.provider,
                model: selected.model,
            },
        };
    });
    // agent/request：请求路由改写 provider/model，并写入 reasoningEffort
    // （官方 L54-70：无 effort 时清除继承值，恢复所选模型默认行为）
    const disposeRequest = childCtx.on('agent/request', async (rawPayload, next) => {
        const resolved = (await next());
        const selected = selection.assembled;
        if (selected === undefined)
            return resolved;
        const shaped = resolved && typeof resolved === 'object' ? resolved : {};
        const withoutInherited = { ...shaped };
        delete withoutInherited.reasoningEffort;
        return {
            ...withoutInherited,
            provider: selected.provider,
            model: selected.model,
            ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        };
    });
    return () => {
        disposeAssembly();
        disposeRequest();
    };
}
/**
 * 创建模型选择装配：返回贡献与 attach 入口。
 * 为什么 attach 在创建后（而非贡献内取配置）：贡献签名固定 (childCtx) => disposer，
 * 无法携带节点参数；WeakMap 身份匹配让 runner 在拿到 childId → agent.ctx 后写值，
 * 无 pending 状态竞态（并发创建安全）。
 */
export function createModelSelectionSetup() {
    const selections = new WeakMap();
    // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走 selection.current。
    const parentRefs = new Map();
    const parentDisposers = new Map();
    const contribution = (rawChildCtx) => {
        const childCtx = rawChildCtx;
        const selection = { current: undefined, assembled: undefined };
        selections.set(childCtx, selection);
        return installModelSelectionLike(childCtx, selection);
    };
    const attach = (childCtx, selection) => {
        const ref = selections.get(childCtx);
        if (!ref)
            return; // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
        ref.current = { ...selection };
    };
    const bindParent = (ctx, selection, sessionId) => {
        if (!ctx || typeof ctx !== 'object')
            return;
        let ref = parentRefs.get(sessionId);
        if (!ref) {
            ref = { current: undefined, assembled: undefined };
            parentRefs.set(sessionId, ref);
            parentDisposers.set(sessionId, installModelSelectionLike(ctx, ref));
        }
        ref.current = { ...selection };
    };
    return { contribution, attach, bindParent };
}
//# sourceMappingURL=model-selection.js.map
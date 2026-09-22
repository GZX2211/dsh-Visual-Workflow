// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）注入。
//
// 官方取证：
//   - 官方机制 = ModelSelection + installModelSelection(agentCtx, selection)
//     （packages/core/agent/src/model-selection.ts L10-75）：两条 scoped waterfall
//     （system-prompt/assemble 注入 provider/model 变量；agent/request 改写
//     LlmCallConfig 的 provider/model/reasoningEffort），selection.current 可变，
//     由调用入口持有；
//
// 本移植：结构逐条对齐官方 installModelSelection 的双瀑布与可变 selection 语义，
// payload/next 全部 unknown 收窄；selection 以 WeakMap 按 childCtx 对象身份登记，
// runner 在 startContinuable 返回后经 agents.get(childId).ctx 找到同一对象并写入
// 节点级 { provider, model, reasoningEffort }——无全局 pending 状态
//
// 【与官方的已知差异（取证：dsh-agent/lib/types/model-selection.d.ts L23-41）】该版本官方
// installModelSelection 在 provider/model **变化**时还会向下一次被受理的请求追加以
// user 角色写入的持久化告知（durable notice），effort 单变与空决策不写。本平台按
// 「节点子代理的 provider/model 在创建时确定、运行中不切换」使用该能力，故未移植告知线；
// 若将来允许节点级运行中切换模型，必须补齐该行为并同步测试（见同目录 AGENTS.md § 依赖边界）。
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
    // 【释放路径】监听器注册在根 Agent 的 ctx 上，随该 ctx 的 fiber 卸载自动移除；
    // 本表只保留调用入口引用，随宿主实例一起回收（宿主持有本装配对象，不单独释放）。
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
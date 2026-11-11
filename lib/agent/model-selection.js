// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）与模型路由注入。
//
// 官方契约（0.2.2-rc.1 取证，packages/core/agent-loop/src/prepareRequest）：
//   步进准备（agent/pre-step）先从 agent.model.current() 固化本次 selection，随后主循环
//   派发 agent/request 瀑布；两者 provider/model/reasoningEffort 必须完全一致，否则主循环
//   抛 "agent/request proposed … after step preparation fixed …; use agent.model.select()
//   before step preparation"。因此路由与强度只能在步进准备前经 AgentOptions 或
//   agent.model.select() 写入，不能在 agent/request 阶段改写。
//
// 两条通道：
//   - 0.2.2+（Agent 暴露 model.select）：节点选择经 applyTo 提交官方 AgentModel，
//     首步与后续步都由官方步进固化；本装配只留存选择供 modelOf 查询与冷恢复重装；
//   - ≤0.2.1（无 AgentModel）：保留官方旧版 installModelSelection 移植（assemble 注入
//     provider/model 变量 + agent/request 改写路由），该核没有步进一致性强校验。
//
// selection 以 WeakMap 按 childCtx 对象身份登记，runner/host 拿到 agent.ctx 后写值，
// 无全局 pending 状态。
import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * 官方 Agent 模型选择面的运行时守卫。
 * 返回 null 表示旧核（或形状漂移）：调用方退回旧版 agent/request 瀑布。
 */
function officialModelOf(rawAgent) {
    if (rawAgent === null || typeof rawAgent !== 'object')
        return null;
    const model = rawAgent.model;
    if (model === null || typeof model !== 'object')
        return null;
    return model;
}
/** 完整 selection 守卫：provider/model 都非空才可作为官方选择提交。 */
function completeSelectionOf(selection) {
    if (!selection)
        return null;
    const provider = String(selection.provider ?? '').trim();
    const model = String(selection.model ?? '').trim();
    if (!provider || !model)
        return null;
    const reasoning = String(selection.reasoningEffort ?? '').trim();
    return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model };
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
export function composeNodeSelection(config, current) {
    const provider = String(config.provider ?? '').trim();
    const model = String(config.model ?? '').trim();
    const reasoning = String(config.reasoning ?? '').trim();
    if (provider && model) {
        return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model };
    }
    if (!reasoning)
        return null;
    const inherited = completeSelectionOf(current);
    if (!inherited)
        return null;
    return { provider: inherited.provider, model: inherited.model, reasoningEffort: reasoning };
}
/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方旧版 installModelSelection 的零依赖移植；
 * 仅 0.2.1 及以前使用——0.2.2+ 由 contribution 判定后不安装，改走 agent.model.select）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export function installModelSelectionLike(childCtx, selection) {
    // system-prompt/assemble：组装期把 provider/model 注入提示词变量（官方 L40-53）
    const disposeAssembly = childCtx.on('system-prompt/assemble', async (_rawAssembly, _rawContext, next) => {
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
    // （官方旧版 L54-70：无 effort 时清除继承值，恢复所选模型默认行为）
    const disposeRequest = childCtx.on('agent/request', async (_rawPayload, next) => {
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
    /** 创建窗口内的选择（仅在该窗口内可见；按 childId 的留存表见 remembered）。 */
    const pending = new AsyncLocalStorage();
    /**
     * childId → 已记住的模型选择（重发布重装用）。
     * 【释放路径】条目与子代理身份绑定，只增不减；内容为两个短字符串，随宿主持有的本装配
     * 对象一起回收（宿主 dispose 后无引用）。childId 全局唯一，故不按会话再分表。
     */
    const remembered = new Map();
    // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走 selection.current。
    // 【释放路径】监听器注册在根 Agent 的 ctx 上，随该 ctx 的 fiber 卸载自动移除；
    // 本表只保留装配期的状态引用，随宿主实例一起回收（宿主持有本装配对象，不单独释放）。
    const parentRefs = new Map();
    const contribution = (rawChildCtx, rawAgent) => {
        const childCtx = rawChildCtx;
        const pendingSelection = pending.getStore();
        const selection = {
            current: pendingSelection ? { ...pendingSelection } : undefined,
            assembled: undefined,
        };
        selections.set(childCtx, selection);
        // 0.2.2+：官方 AgentModel 在步进准备阶段固化选择；此时再在 agent/request 改写路由
        // 会被主循环断言拒绝（本 Issue 的崩溃点），故只登记留存、不安装请求瀑布。
        const official = officialModelOf(rawAgent);
        if (official !== null && typeof official.select === 'function')
            return () => { };
        return installModelSelectionLike(childCtx, selection);
    };
    const attach = (childCtx, selection) => {
        const ref = selections.get(childCtx);
        if (!ref)
            return; // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
        ref.current = { ...selection };
    };
    const currentOf = (rawAgent) => {
        const official = officialModelOf(rawAgent);
        if (official === null || typeof official.current !== 'function')
            return null;
        try {
            return completeSelectionOf(official.current());
        }
        catch {
            // 官方形状漂移：按「无法读取」处理，调用方退回节点配置/继承路由
            return null;
        }
    };
    const applyTo = (rawAgent, selection) => {
        const rawCtx = rawAgent !== null && typeof rawAgent === 'object' ? rawAgent.ctx : undefined;
        const ref = rawCtx !== null && typeof rawCtx === 'object' ? selections.get(rawCtx) : undefined;
        if (selection !== undefined && ref)
            ref.current = { ...selection };
        const chosen = selection ?? ref?.current;
        const complete = completeSelectionOf(chosen);
        if (!complete)
            return false;
        const official = officialModelOf(rawAgent);
        if (official === null || typeof official.select !== 'function')
            return false;
        official.select(complete);
        return true;
    };
    const withPending = (selection, operation) => pending.run(selection, operation);
    const remember = (childId, selection) => {
        const id = String(childId ?? '');
        if (!id)
            return;
        remembered.set(id, { ...selection });
    };
    const restore = (childId, childCtx) => {
        const selection = remembered.get(String(childId ?? ''));
        if (!selection)
            return;
        if (childCtx === null || typeof childCtx !== 'object')
            return;
        const ref = selections.get(childCtx);
        if (!ref)
            return; // 该 child 未走本贡献：无 selection 可写，静默跳过
        ref.current = { ...selection };
    };
    const bindParent = (ctx, selection, sessionId, rawAgent) => {
        if (!ctx || typeof ctx !== 'object')
            return;
        const official = officialModelOf(rawAgent);
        const hasOfficialSelect = official !== null && typeof official.select === 'function';
        let ref = parentRefs.get(sessionId);
        if (!ref) {
            ref = { current: undefined, assembled: undefined };
            parentRefs.set(sessionId, ref);
            // 新核已由官方 AgentModel 接管路由；继续装旧版请求改写会与步进固化冲突。
            if (!hasOfficialSelect)
                installModelSelectionLike(ctx, ref);
        }
        ref.current = { ...selection };
        if (official !== null && typeof official.select === 'function') {
            // 父代理同样只能经官方通道改选：节点路由完整时以节点为准，仅配置强度时沿用当前路由
            const complete = completeSelectionOf(ref.current) ?? composeNodeSelection(ref.current, currentOf(rawAgent));
            if (complete)
                official.select(complete);
        }
    };
    const parentModelOf = (sessionId) => {
        const id = String(sessionId ?? '');
        if (!id)
            return null;
        const ref = parentRefs.get(id);
        // 返回副本：查询方不得就地改写本装配持有的选择引用
        return ref?.current ? { ...ref.current } : null;
    };
    const modelOf = (childId) => {
        const id = String(childId ?? '');
        if (!id)
            return null;
        const selection = remembered.get(id);
        return selection ? { ...selection } : null;
    };
    return { contribution, attach, applyTo, currentOf, withPending, remember, restore, bindParent, modelOf, parentModelOf };
}
//# sourceMappingURL=model-selection.js.map
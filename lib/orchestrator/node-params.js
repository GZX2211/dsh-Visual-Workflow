// src/host/orchestrator/node-params.ts
//
// 节点级执行参数解析（纯函数）：单次调用的参数覆盖 > 节点配置 > 配置默认。
// 只做取值解析，不做校验之外的语义决策（取值域仍由子代理引擎负责）。
/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export function effectiveRetryLimitOf(node, args, fallback) {
    const fromArgs = Number(args?.retryLimit);
    if (Number.isFinite(fromArgs) && fromArgs >= 0)
        return fromArgs;
    const fromNode = Number(node.data?.retryLimit);
    if (Number.isFinite(fromNode) && fromNode >= 0)
        return fromNode;
    return fallback;
}
/** 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认。 */
export function effectiveReactLimitOf(node, args, fallback) {
    const fromArgs = Number(args?.iterationLimit);
    if (Number.isFinite(fromArgs) && fromArgs >= 1)
        return fromArgs;
    const fromNode = node.data?.reactLimit;
    if (fromNode === null)
        return undefined; // 节点显式不设限（V-01）
    const numeric = Number(fromNode);
    if (Number.isFinite(numeric) && numeric >= 1)
        return numeric;
    return fallback;
}
/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export function effectiveThinkingOf(node, args) {
    const fromArgs = args?.thinking;
    if (typeof fromArgs === 'string' && fromArgs.trim())
        return fromArgs;
    const fromNode = node.data?.reasoning;
    return typeof fromNode === 'string' && fromNode.trim() ? fromNode : undefined;
}
//# sourceMappingURL=node-params.js.map
import type { RunNodeArgs } from './run-entry.js';
/**
 * 节点级参数解析的最小入参形状。
 *
 * 为什么不是 RoleNode：协作组卡片没有这些字段，但组级调用同样需要「参数覆盖 > 组配置
 * （无）> 配置默认」这一口径；用最小形状表达后，角色节点与组卡片共用同一解析函数，
 * 避免为组卡片复制一份取值规则。
 */
export interface NodeParamsInput {
    data?: {
        /** 两类节点共有字段（弱类型检查要求至少一个共同属性；本函数不读它）。 */
        label?: unknown;
        retryLimit?: unknown;
        reactLimit?: unknown;
        reasoning?: unknown;
    } | undefined;
}
/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export declare function effectiveRetryLimitOf(node: NodeParamsInput, args: RunNodeArgs, fallback: number): number;
/**
 * 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认（<1=不设限）。
 */
export declare function effectiveReactLimitOf(node: NodeParamsInput, args: RunNodeArgs, fallback: number): number | undefined;
/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export declare function effectiveThinkingOf(node: NodeParamsInput, args: RunNodeArgs): string | undefined;

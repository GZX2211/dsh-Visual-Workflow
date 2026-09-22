import type { RoleNode } from '../shared/graph-model.js';
import type { RunNodeArgs } from './run-entry.js';
/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export declare function effectiveRetryLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number;
/** 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认。 */
export declare function effectiveReactLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number | undefined;
/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export declare function effectiveThinkingOf(node: RoleNode, args: RunNodeArgs): string | undefined;

import type { FlowDag } from './dag.js';
import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/** a) 协作组一致性：无成员 / 悬空成员 / 无流程线。 */
export declare function ruleGroupMembers(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** b) 虚拟节点引用缺失或指向非角色节点。 */
export declare function ruleProxySource({ flow }: CheckGraphInput): GraphIssue[];
/** c) 数据节点配置完整性（缺少运行必需项 → error）。 */
export declare function ruleDataNodeComplete({ flow }: CheckGraphInput): GraphIssue[];
/** d) 上下文入线来源合法性（角色 / 虚拟节点 / 文件 / 模式二输入节点）。 */
export declare function ruleCtxSource({ flow }: CheckGraphInput): GraphIssue[];
/** e) 数据库出线目标合法性（必须是数据库节点）。 */
export declare function ruleDbTarget({ flow }: CheckGraphInput): GraphIssue[];
/**
 * f) 里程碑闸门（指向父代理的虚拟节点）：
 *   - 任何指向父代理的虚拟节点缺流程入口 → 不会被流程驱动（warning）；
 *   - `data.role='milestone'` 却指向非父代理节点 → 闸门语义无效（warning）；
 *   - 标记为 milestone 的闸门数超过 `meta.milestoneMax` → 超上限（warning）。
 * P3 起闸门以 `data.role` 判别（缺省 executor，不占闸门预算）。
 */
export declare function ruleMilestoneProxy(input: CheckGraphInput, dag: FlowDag): GraphIssue[];

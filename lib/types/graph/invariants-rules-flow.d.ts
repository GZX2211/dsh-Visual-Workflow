import type { FlowDag } from './dag.js';
import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/** a) 恰好 1 个启动/输入节点（缺失/多个都是 error）。 */
export declare function ruleStartRequired({ flow }: CheckGraphInput): GraphIssue[];
/** b) 启动节点的流程出 ≥1 且目标为可执行单元。 */
export declare function ruleStartFlowOut(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** c) 恰好 1 个结束/输出节点。 */
export declare function ruleEndRequired({ flow }: CheckGraphInput): GraphIssue[];
/** d) 结束节点的流程入 ≥1 且来源为可执行单元。 */
export declare function ruleEndFlowIn(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** e) 孤立节点：既无流程线也无上下文/数据库线。 */
export declare function ruleOrphanNode({ flow }: CheckGraphInput): GraphIssue[];
/** f) 条件线相对分支缺失（warning，不阻断）。 */
export declare function ruleConditionPair({ flow }: CheckGraphInput): GraphIssue[];
/** g) 流程子图存在多节点环（自环由 validateFlow 拦截，此处只报 ≥2 节点的环）。 */
export declare function ruleFlowCycle(_input: CheckGraphInput, dag: FlowDag, cycleNodes: Set<string>): GraphIssue[];
/** h) 可达性：有流程入但从启动节点沿流程不可达（孤岛段）。 */
export declare function ruleReachability(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** i) 断头流程：有流程入但无流程出且不是结束节点（warning）。 */
export declare function ruleCannotReachEnd(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** j) 阶段节点方向违规：暂停悬空 / 启动有流程入 / 结束有流程出。 */
export declare function ruleStageDirection({ flow }: CheckGraphInput, dag: FlowDag): GraphIssue[];

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
 * f) 数据流契约（warning，规划期提醒；用户裁决 C6）：把「上下游交接没有通道」变成规划期
 * 可见的提醒。两条互补规则，各自只在**确有可交接的产出 / 确有多个上游可连接**时才报，
 * 因此不会对普通的线性流水线（start → a1 → a2 → end）产生噪声：
 *
 *   - nodeNoConsumer：某可执行节点**声明了产出**（有 ctx-out 出线，或配置了 outputSchema），
 *     但它所有流程下游都没接入该节点的 ctx 出线——上游写了产出却没人读。
 *   - nodeNoUpstream：某可执行节点**有多个可执行前置节点**（存在其他可选的上游信息来源），
 *     却没有任何 ctx/file/db 入线——它多半该连一条而漏了（首节点只有一个前置 start，不报）。
 *
 * 为什么是 warning 而不是 error：单节点流水线、串联中确实不需要上游数据的节点都是合法的，
 * 硬判会误伤；本规则只负责「提醒」，是否补线由规划者/用户判断。
 */
export declare function ruleNodeDataFlowContract({ flow }: CheckGraphInput): GraphIssue[];
/**
 * g) 角色节点配置完整性（warning，规划期提醒；用户裁决 C6 + P2 决策）：
 *   - presetId 为空 → 运行期 `resolveAgentTools` 判定该节点**零工具**（连 read/write 都调不到），
 *     是无效节点；这条只能在规划期提醒，运行期发现就太晚了。
 *   - systemPrompt 为空 → 子代理没有自身角色与任务说明，会以空任务启动。
 * 两者都是语义错误而非形状错误（形状由 wf_graph_patch 的补全兜住）。
 */
export declare function ruleRoleNodeConfigured({ flow }: CheckGraphInput): GraphIssue[];
/**
 * h) 里程碑闸门（指向父代理的虚拟节点）：
 *   - 任何指向父代理的虚拟节点缺流程入口 → 不会被流程驱动（warning）；
 *   - `data.role='milestone'` 却指向非父代理节点 → 闸门语义无效（warning）；
 *   - 标记为 milestone 的闸门数超过 `meta.milestoneMax` → 超上限（warning）。
 * P3 起闸门以 `data.role` 判别（缺省 executor，不占闸门预算）。
 */
export declare function ruleMilestoneProxy(input: CheckGraphInput, dag: FlowDag): GraphIssue[];

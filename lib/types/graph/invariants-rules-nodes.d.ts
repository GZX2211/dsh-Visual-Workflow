import type { FlowDag } from './dag.js';
import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/** a) 协作组一致性：无成员 / 悬空成员 / 无流程线。 */
export declare function ruleGroupMembers(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** b) 虚拟节点引用缺失或指向非角色节点。 */
export declare function ruleProxySource({ flow }: CheckGraphInput): GraphIssue[];
/**
 * c) 数据节点配置完整性：**只校验数据库节点**（缺少运行必需项 → error）。
 *
 * 为什么不再校验 file 节点（用户裁决 2026-10-10）：
 *   1. 唯一生产调用方是 wf_graph_patch（origin='agent'），而写图只产**文本型** file 节点（D-07）——
 *      「受管文件未选文件」这一形态在代理路径上已不可达，规则成为死码；
 *   2. 受管形态只能由画布产生，而画布保存路径只跑结构校验 validateFlow、不经本检查器——
 *      它从未真正保护过用户路径；
 *   3. 文本型文件节点允许空内容（占位 / 待填），空文本不构成运行期失败（ctx 注入空串，节点照常运行）；
 *   4. 该判定是 error 级 = 整批补丁原子失败 + 全量 op 重发；收益为零而误伤成本高。
 *
 * 保留数据库分支的理由相反：既无本地路径又无连接信息时运行期**必然**失败（索引无从构建），
 * 属配置残缺而非「可空字段」，值得在规划期阻断。
 */
export declare function ruleDataNodeComplete({ flow }: CheckGraphInput): GraphIssue[];
/** d) 上下文入线来源合法性（角色 / 虚拟节点 / 文件 / 模式二输入节点）。 */
export declare function ruleCtxSource({ flow }: CheckGraphInput): GraphIssue[];
/**
 * e) 数据库出线目标合法性：**必须是角色节点**（子代理 / 父代理 / 虚拟节点）。
 *
 * 为什么不是「必须是数据库节点」：db 通道的语义是「把数据源转换为检索/查询工具注入角色」
 * （数据库内容绝不注入上下文），配对矩阵 `HANDLE_PAIRING` 也只把 db-out 映到 db-in——
 * 而 db-in 只存在于角色节点上（database 的 inputs 为空，无法自连）。若要求目标为数据库节点，
 * 则 db 线在任何路径下都无法成立，database 节点必然悬空、整类节点不可用。
 */
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

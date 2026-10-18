import type { FlowDag } from './dag.js';
import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/** a) Team 一致性：无成员 / 悬空成员 / 无流程线。 */
export declare function ruleGroupMembers(input: CheckGraphInput, dag: FlowDag): GraphIssue[];
/** b) 虚拟节点引用缺失或指向非角色节点。 */
export declare function ruleProxySource({ flow }: CheckGraphInput): GraphIssue[];
/**
 * c) 数据节点配置完整性：**只校验数据库节点**（缺少运行必需项 → error）。
 *
 * 为什么不再校验任务节点：
 *   1. 任务节点只承载任务描述文本，没有「必填的运行配置」；
 *   2. 文本允许为空（占位 / 待填），空文本不构成运行期失败（ctx 注入空串，节点照常运行）；
 *   3. 该判定若为 error 级会造成整批补丁原子失败，收益为零而误伤成本高。
 *
 * 保留数据库分支的理由相反：既无本地路径又无连接信息时运行期**必然**失败（索引无从构建），
 * 属配置残缺而非「可空字段」，值得在规划期阻断。
 */
export declare function ruleDataNodeComplete({ flow }: CheckGraphInput): GraphIssue[];
/** d) 上下文入线来源合法性（角色 / 虚拟节点 / 任务 / 模式二输入节点）。
 *  技术债（ctx-out 停用）：角色节点的 ctx 出线已不再是注入来源，但连线仍是合法结构
 *  （旧图零迁移），故本规则保持原口径不变。 */
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
 * g) 角色节点配置完整性（warning，规划期提醒；用户裁决 C6 + P2 决策）：
 *   - presetId 为空 → 运行期 `resolveAgentTools` 判定该节点**零工具**（连 read/write 都调不到），
 *     是无效节点；这条只能在规划期提醒，运行期发现就太晚了。
 *   - systemPrompt 为空 → 子代理没有自身角色与任务说明，会以空任务启动。
 * 两者都是语义错误而非形状错误（形状由 wf_graph_patch 的补全兜住）。
 */
export declare function ruleRoleNodeConfigured({ flow }: CheckGraphInput): GraphIssue[];
/**
 * h) 父代理虚拟节点的流程驱动：指向父代理的 proxy 必须有流程入口，否则流程永远不会
 * 驱动它（该节点上的父代理执行单元也就永远不会执行）。
 * 注意本规则只判定「有没有被驱动」，不承担父代理执行单元的完成语义。
 */
export declare function ruleParentProxyFlowIn(input: CheckGraphInput, dag: FlowDag): GraphIssue[];

/**
 * Team 成员上限的**回退值**（宿主未下发 runtimeConfig.teamMemberLimit 时使用）。
 *
 * 为什么由宿主下发而不是画布硬编码：成员在运行期由官方 `spawnTeammate` 创建，名额是**会话级
 * 累计**的（`agent-team.maxMembers`，官方默认 16、bundle 层 8、部署层可再覆盖）——画布放得下
 * 但名额不够时，失败发生在运行期（官方类型化错误），用户无从预防。因此画布上限必须与部署层
 * 同一取值：取宿主下发的 teamMemberLimit，本常量只在取不到时兜底（取官方 bundle 层的 8）。
 */
export declare const TEAM_MEMBER_LIMIT_FALLBACK = 8;
/**
 * 解析宿主下发的 Team 成员上限（缺失 / 形态非法 / 非正整数一律回退回退值）。
 * 与 resolveRunPollMs 同口径：下发值不可信时宁可用保守值，也不把非法值当上限用。
 */
export declare function resolveTeamMemberLimit(value: unknown): number;
/**
 * 合并重复节点（修复历史数据中 Team 节点被重复追加的缺陷）：
 *  - 同 id 的 Team 节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
 *  - 每个 Team 节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
 * 非 Team 节点同 id 直接保留最后出现者。返回合并后的新数组。
 */
export declare function consolidateGroups<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[]): T[];
/**
 * 原子入组：一次变更同时设置「成员节点 data.groupId」与「Team data.memberIds（追加去重）」。
 * 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
 * 先把重复的 Team 节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
 * 供左栏模板拖入与画布内节点拖入两条路径共用。
 */
export declare function joinNodeToGroup<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[], nodeId: string, groupId: string): T[];
/**
 * 移除指定节点的流程连线（角色拖入 Team 后仅保留上下文/数据库线）：
 * 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
 */
export declare function dropNodeFlowLines<T extends {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}>(lines: T[], nodeId: string): T[];

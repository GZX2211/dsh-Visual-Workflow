/**
 * 合并重复节点（修复历史数据中协作组节点被重复追加的缺陷）：
 *  - 同 id 的协作组节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
 *  - 每个协作组节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
 * 非协作组节点同 id 直接保留最后出现者。返回合并后的新数组。
 */
export declare function consolidateGroups<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[]): T[];
/**
 * 原子入组：一次变更同时设置「成员节点 data.groupId」与「协作组 data.memberIds（追加去重）」。
 * 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
 * 先把重复的协作组节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
 * 供左栏模板拖入与画布内节点拖入两条路径共用。
 */
export declare function joinNodeToGroup<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[], nodeId: string, groupId: string): T[];
/**
 * 移除指定节点的流程连线（角色拖入协作组后仅保留上下文/数据库线，§4.2.5.2 规则 4）：
 * 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
 */
export declare function dropNodeFlowLines<T extends {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}>(lines: T[], nodeId: string): T[];

import type { GraphNode, WorkflowDocument } from '../shared/graph-model.js';
/** 已用量（元参数判定的输入；可选维度未提供时不做该维度判定）。 */
export interface OrgUsage {
    /** 可执行节点（agent/parent/group）已用数。 */
    nodeCount: number;
    /** 协作组已用数。 */
    groupCount: number;
    /** 最大组内人数。 */
    maxGroupMembers: number;
    /** 单列最大并行分支数（可选）。 */
    parallelBranchMax?: number;
    /** 父代理闸门已用次数（不含首次编排，D-21）。 */
    milestoneUsed: number;
    /** 本批改图 op 数（可选）。 */
    patchOps?: number;
}
/** 可执行单元计数（agent/parent/group；与检查器、P1 工具、客户端共用同一口径）。 */
export declare function executableUnitCount(nodes: GraphNode[] | null | undefined): number;
/** 协作组卡片计数。 */
export declare function groupCount(nodes: GraphNode[] | null | undefined): number;
/** 单个协作组的最大已配置人数（无组时 0；memberIds 重复 id 只计一次）。 */
export declare function maxGroupMembers(nodes: GraphNode[] | null | undefined): number;
/** 由图文档直接推导已用量（检查器/P1 工具的统一入口）。 */
export declare function orgUsageOf(flow: Pick<WorkflowDocument, 'nodes'> | null | undefined, options?: {
    milestoneUsed?: number;
    parallelBranchMax?: number;
    patchOps?: number;
}): OrgUsage;

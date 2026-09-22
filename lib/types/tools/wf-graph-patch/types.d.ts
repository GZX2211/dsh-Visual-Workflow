import type { GraphIssue } from '../../graph/index.js';
import type { OrgMeta } from '../../shared/types.js';
/** 补丁作用域：template = 工作流模板（规划期改模板）；instance = 工作流/服务实例（运行期改实例）。 */
export type PatchScope = 'template' | 'instance';
/** 操作组名（三分区）。 */
export type PatchGroup = 'graph' | 'meta' | 'mark';
/**
 * 新建模板说明（wf_graph_patch 的 create 参数）。
 * 语义（用户裁决 2026.09）：规划期的主用例是「按意图产出新模板」，因此
 * `scope='template'` + `create` = 新建；不带 create 仍是「必须已存在」的更新语义。
 * 允许出现的组合只有：scope=template 且 op 组为 graph（其余组合一律拒绝）。
 */
export interface NewTemplateSpec {
    /** 模板名称（人类可读，必填）。 */
    name: string;
    /** 模板描述（可选）。 */
    description?: string;
    /** 运行模式（缺省 mode1）。 */
    mode?: 'mode1' | 'mode2';
}
/** A 组：图结构变更。 */
export type GraphPatchOp = {
    op: 'create_node';
    node: Record<string, unknown>;
} | {
    op: 'remove_node';
    nodeId: string;
    cascade?: boolean;
} | {
    op: 'update_node_data';
    nodeId: string;
    data: Record<string, unknown>;
} | {
    op: 'connect';
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    condition?: {
        type: string;
        label?: string;
    };
} | {
    op: 'disconnect';
    lineId?: string;
    key?: {
        source: string;
        target: string;
        sourceHandle: string;
        targetHandle: string;
    };
} | {
    op: 'create_group';
    groupId: string;
    label: string;
    collabPrompt?: string;
    memberIds?: string[];
} | {
    op: 'set_group_members';
    groupId: string;
    memberIds: string[];
};
/** B 组：元参数（一次性提交，不与其他组混用）。 */
export interface MetaPatchOp {
    op: 'set_meta';
    meta: Partial<OrgMeta>;
}
/**
 * C 组：运行状态标记（闸门节点完成/失败）。
 * 语义约束（D-07）：只能标记**当前仍在运行**的 run 所对应的节点；节点不存在即拒绝。
 * P3 会在此之上追加「必须是当前父代理闸门节点 + 闸门预算」判定。
 */
export interface MarkPatchOp {
    op: 'mark_node';
    nodeId: string;
    status: 'ok' | 'fail';
    summary?: string;
}
/** 补丁操作（判别联合）。 */
export type PatchOp = GraphPatchOp | MetaPatchOp | MarkPatchOp;
/** 图结构变更结果。 */
export interface GraphPatchResult {
    doc: {
        id: string;
        sessionId: string;
        mode: string;
        name: string;
        description: string;
        nodes: unknown[];
        lines: unknown[];
        revision: number;
        meta?: OrgMeta;
    };
    createdNodeIds: string[];
    removedNodeIds: string[];
    updatedNodeIds: string[];
    connectedLineIds: string[];
    disconnectedLineIds: string[];
}
/** 元参数变更结果。 */
export interface MetaPatchResult {
    meta: OrgMeta;
    /** 归一化时被丢弃/收敛的提示（面向模型可读）。 */
    notes: string[];
}
/** 运行状态标记结果。 */
export interface MarkPatchResult {
    nodeId: string;
    status: 'ok' | 'fail';
    runId: string;
}
/** op → 组名映射（服务端混组拒绝的唯一依据）。 */
export declare function opGroupOf(op: unknown): PatchGroup | null;
/** 补丁中出现的全部组名（按出现顺序去重）。 */
export declare function groupsOf(ops: unknown[]): PatchGroup[];
/** 未知 op 名（用于错误信息）。 */
export declare function unknownOpsOf(ops: unknown[]): string[];
/** 混组错误的可读分组说明（写进错误文本，帮助模型自我修正）。 */
export declare const GROUP_HINTS: Record<PatchGroup, string>;
/** 检查器 issue → 稳定错误码（error 阻断，warning 放行）。 */
export declare function blockingIssuesOf(issues: GraphIssue[]): GraphIssue[];

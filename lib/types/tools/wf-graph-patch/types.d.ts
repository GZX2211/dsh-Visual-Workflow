import type { WorkflowDocument } from '../../shared/graph-model.js';
/** 补丁作用域：template = 工作流模板（规划期改模板）；instance = 工作流/服务实例（运行期改实例）。 */
export type PatchScope = 'template' | 'instance';
/**
 * 新建模板说明（wf_graph_patch 的 create 参数）。
 * 语义（用户裁决 2026.09）：规划期的主用例是「按意图产出新模板」，因此
 * `scope='template'` + `create` = 新建；不带 create 仍是「必须已存在」的更新语义。
 */
export interface NewTemplateSpec {
    /** 模板名称（人类可读，必填）。 */
    name: string;
    /** 模板描述（可选）。 */
    description?: string;
    /** 运行模式（缺省 mode1）。 */
    mode?: 'mode1' | 'mode2';
}
/** 图结构变更操作。 */
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
    sourceHandle?: string;
    targetHandle?: string;
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
/** 补丁操作（判别联合）。 */
export type PatchOp = GraphPatchOp;
/**
 * 图结构变更结果。
 * doc 用图契约本体：后续校验、预算与落盘全部按 WorkflowDocument 语义进行。
 */
export interface GraphPatchResult {
    doc: WorkflowDocument;
    createdNodeIds: string[];
    removedNodeIds: string[];
    updatedNodeIds: string[];
    connectedLineIds: string[];
    disconnectedLineIds: string[];
    /**
     * 被归一化为「文本型」的文件节点 id（D-07）。
     *
     * 为什么写图只产文本型 file 节点：受管文件（fileKind='file'）必须指向**已存在**的受管副本
     * （检查器 dataNodeIncomplete 强制），而编排要表达的是「未来要产出的交付文件」这一意图——
     * 强制受管会把这类规划直接挡在门外。归一化不静默：工具层据此产出 warning 告知调用方。
     */
    fileNodeTextOnlyIds: string[];
}
/**
 * 单条补丁操作失败项（容错收集模式下的一条记录）。
 * 保留每条的稳定错误码，聚合错误文本据此让模型分辨「改入参形状」还是「改图」。
 */
export interface PatchOpFailure {
    /** 该 op 在本批 ops 中的下标（从 0 起；错误文本按 1 起序号展示）。 */
    index: number;
    /** op 名（未知 op 时为空串）。 */
    op: string;
    /** 稳定错误码。 */
    code: string;
    /** 可行动的错误说明（含正确形状或修复建议）。 */
    message: string;
}
/** 图结构 op 名清单（契约完整性校验与未知 op 判定的唯一来源）。 */
export declare const GRAPH_OP_NAMES: readonly ["create_node", "remove_node", "update_node_data", "connect", "disconnect", "create_group", "set_group_members"];
/** op 是否属于图结构 op（未知 op 由参数层按 WF_BAD_ARGS 拒绝）。 */
export declare function opGroupOf(op: unknown): 'graph' | null;
/** 未知 op 名（用于错误信息）。 */
export declare function unknownOpsOf(ops: unknown[]): string[];
/** 全部允许的 op 名（写进错误文本，帮助模型自我修正）。 */
export declare const ALLOWED_OP_NAMES_TEXT: string;

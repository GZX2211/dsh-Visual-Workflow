import type { GraphNode, Line, WorkflowDocument } from '../shared/graph-model.js';
/** 编排变更摘要（added/removed/changed 任一非空即 changed=true）。 */
export interface FlowChangeSummary {
    /** 是否存在编排语义变更（纯几何改动不算）。 */
    changed: boolean;
    /** 新增节点 id。 */
    addedNodeIds: string[];
    /** 删除节点 id。 */
    removedNodeIds: string[];
    /** 配置变化的节点 id（忽略几何字段）。 */
    changedNodeIds: string[];
    /** 新增连线语义键。 */
    addedLineKeys: string[];
    /** 删除连线语义键。 */
    removedLineKeys: string[];
}
/** 节点非几何配置指纹（忽略顶层 position 与 data 内几何字段；含 id 以区分节点身份）。 */
export declare function nodeConfigKeyOf(node: GraphNode): string;
/**
 * 连线语义键（不含连线 id）：两端节点 + 连接点 + 条件。
 * 删除后重连同一条线（id 变化但语义相同）不应算作编排变更。
 */
export declare function lineKeyOf(line: Line): string;
/**
 * 比较前后两份画布，输出编排语义变更摘要。
 * 比较维度：节点增删 + 节点非几何配置变化 + 连线增删（按语义键）。
 * 不比较：节点坐标、组卡片尺寸、连接点交换、连线 id、文档名称/描述等元信息。
 */
export declare function summarizeFlowChange(prev: WorkflowDocument, next: WorkflowDocument): FlowChangeSummary;

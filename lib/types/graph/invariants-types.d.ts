import type { WorkflowDocument } from '../shared/graph-model.js';
import type { OrgMeta } from '../shared/types.js';
/** 问题级别：error 阻断落盘，warning 仅提示。 */
export type IssueLevel = 'error' | 'warning';
/** 检查器问题记录（面向模型/用户可读；error 必带修复建议）。 */
export interface GraphIssue {
    /** 稳定 code（见 GRAPH_INVARIANT_CODES 注册表）。 */
    code: string;
    /** 级别。 */
    level: IssueLevel;
    /** 中文可读描述（面向模型与用户）。 */
    message: string;
    /** 关联节点 id（可选）。 */
    nodeIds?: string[];
    /** 关联连线 id（可选）。 */
    lineIds?: string[];
    /** 修复建议（模型自我修正的唯一通道；error 级必填，聚合层兜底补齐）。 */
    suggestion?: string;
}
/** 检查器入参。 */
export interface CheckGraphInput {
    /** 待检查的工作流文档（节点 + 连线 + 模式）。 */
    flow: WorkflowDocument;
    /** 生效元参数（模板 ← 实例覆盖后的值）；提供时做规模硬护栏判定。 */
    meta?: OrgMeta;
    /** 变更来源：仅 'agent' 启用元参数硬护栏（D-05：不约束用户手改画布）。 */
    origin: 'agent' | 'user';
    /**
     * 本批改图的操作数（wf_graph_patch 传入；与 meta.patchOpsMax 比对）。
     * 为什么是数字而不是 figure diff：本层只关心「单轮幅度」这一元参数维度，
     * 拓扑再校验已由 checkGraphInvariants 自身完成。
     */
    patchOps?: number;
    /** 父代理闸门已用次数（不含首次编排，D-21）；与 meta.milestoneMax 比对。 */
    milestoneUsed?: number;
}
/** code 注册表条目。 */
export interface IssueCodeInfo {
    /** 稳定 code。 */
    code: string;
    /** 级别（forbiddenShapes 命中时可从 warning 提升为 error）。 */
    level: IssueLevel;
    /** 说明（中文，供文档与测试对照）。 */
    description: string;
}
/**
 * 检查器 code 全集（自主编排方案 §6.2 规则表逐条对应）。
 * 新增规则必须同步登记本表——测试会遍历它，确保每条规则至少一例覆盖。
 */
export declare const GRAPH_INVARIANT_CODES: readonly IssueCodeInfo[];
/** code → 说明的反查表（文档与测试断言用）。 */
export declare function invariantCodeInfo(code: string): IssueCodeInfo | null;

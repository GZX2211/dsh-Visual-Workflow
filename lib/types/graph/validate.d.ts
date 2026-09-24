import type { GraphNode, Line, WorkflowDocument } from '../shared/graph-model.js';
/** 校验问题记录：code 为稳定错误码（UI 国际化与测试断言共用）。 */
export interface FlowIssue {
    code: string;
    message: string;
    /** 关联节点/连线 id（可选）。 */
    id?: string;
}
/** 校验结果：ok 为 true 表示无问题（业务完整性如"启动+结束存在"不在此判定，§4.2.5.1 规则 6 由运行入口检查）。 */
export interface ValidateResult {
    ok: boolean;
    issues: FlowIssue[];
}
/** 单连线检测结果。 */
export interface ConnectionCheck {
    valid: boolean;
    code: string;
    message: string;
}
/**
 * 检测单条连线的连接点合法性（矩阵 + 通道配对 + 端点存在 + 自环）。
 * 纯函数：不改写任何输入。
 */
export declare function connectionProblem(nodes: GraphNode[], line: Line): ConnectionCheck;
/**
 * 全量校验工作流：结构/拓扑/约束合法性。
 * 注意：不含「启动+结束存在」的运行前检查（§4.2.5.1 规则 6 属于运行入口的 Toast 提示，
 * 保存中间态画布应当被允许——与旧项目语义一致）。
 */
export declare function validateFlow(flow: Partial<WorkflowDocument>): ValidateResult;

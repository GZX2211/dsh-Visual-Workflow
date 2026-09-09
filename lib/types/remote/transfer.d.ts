import type { FlowStore } from '../storage/flow-store.js';
/** 导出工作流/服务为自包含 bundle（格式化 JSON 字符串；模式二走 service 字段）。 */
export declare function exportWorkflowBundle(store: FlowStore, sessionId: string, flowId: string): Promise<string>;
/**
 * 导入工作流/服务 bundle（图2 交互改造：**一律导入为工作流模板**，不直接创建实例；
 * 模板全局共享，跨会话可见，由用户在画布中「创建实例」后运行）。
 * 冲突按「名称」判定（重名返回 conflict；rename/overwrite 语义与模板库一致），
 * 嵌入式模板/组合入库逻辑不变（重名复用、id 冲突换新 id）。
 * @param conflictMode rename | overwrite；缺省且重名时返回 { conflict }。
 */
export declare function importWorkflowBundle(store: FlowStore, json: unknown, options?: {
    conflictMode?: 'rename' | 'overwrite';
}): Promise<unknown>;
/** 导出角色模板为单模板 JSON 字符串。 */
export declare function exportAgentTemplate(store: FlowStore, id: string): Promise<string>;
/** 导入角色模板（重名冲突语义同工作流导入）。 */
export declare function importAgentTemplate(store: FlowStore, json: unknown, options?: {
    conflictMode?: 'rename' | 'overwrite';
}): Promise<unknown>;

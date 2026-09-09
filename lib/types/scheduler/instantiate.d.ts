import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js';
/** id 生成器（测试注入固定值；缺省随机 UUID）。 */
export type IdGenerator = () => string;
/**
 * 模板 → 全新实例文档（目标会话无既有实例时）：
 *   - nodes/lines 深拷贝（JSON 深拷贝，与模板完全断引用）；
 *   - 实例名 = 模板名，与给定名称清单重名时追加序号「(2)」「(3)」…（与画布
 *     createInstanceFromCanvas 的命名规则一致；覆盖场景无重名问题）；
 *   - 不落盘（由调用方 flowStore.saveWorkflow 持久化）。
 */
export declare function instantiateFromTemplate(template: WorkflowTemplate, sessionId: string, existingNames: string[], options?: {
    id?: IdGenerator;
    now?: () => number;
}): WorkflowDocument;
/**
 * 模板 → 覆盖既有实例（目标会话已有实例时——「每会话单实例」覆盖语义）：
 * 复用既有实例的 id/sessionId/createdAt（运行历史按 flowId 连续可追溯），
 * 名称/描述/节点/连线 = 模板最新定义；revision 保持既有值（保存层 +1）。
 * 不落盘（由调用方 flowStore.saveWorkflow 持久化）。
 */
export declare function overwriteInstanceFromTemplate(template: WorkflowTemplate, existing: WorkflowDocument, options?: {
    now?: () => number;
}): WorkflowDocument;

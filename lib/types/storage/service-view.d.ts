import type { WorkflowDocument } from '../shared/graph-model.js';
import type { ServiceState } from '../shared/types.js';
/**
 * 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态）。
 * 字段来源逐项对应 ServiceState：图结构与元参数按值转发，运行字段（status/port/
 * apiKeyHash 等）不属于工作流视图，故不透传。
 */
export declare function serviceToWorkflowView(service: ServiceState): WorkflowDocument;

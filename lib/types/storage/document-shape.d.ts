import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/run-types.js';
import type { ServiceState } from '../shared/service-types.js';
import type { Template } from './template-model.js';
/**
 * 文档形状不合法：文件可解析，但不是该资源的文档。
 *
 * 与 CorruptJsonError（JSON 解析失败）是两类原因，不能互相冒充：这里缺的是「这是谁」的
 * 身份字段。带路径是为了让排障直接定位文件，而不是从「不存在」的空结果反推损坏源。
 */
export declare class InvalidDocumentError extends Error {
    /** 目标文件路径。 */
    readonly filePath: string;
    constructor(filePath: string, reason: string);
}
/** 对象且非数组：JSON 文档的最小前提（标量与数组都不是「一份文档」）。 */
export declare function isJsonObject(value: unknown): value is Record<string, unknown>;
/** 工作流实例文档（workflows/<flowId>.json）。 */
export declare function isWorkflowDocument(value: unknown): value is WorkflowDocument;
/** 服务实例文档（services/<serviceId>.json）。 */
export declare function isServiceState(value: unknown): value is ServiceState;
/** 模板文档（roles|groups|data 目录；file 与 database 同目录混存，子类判别归调用方）。 */
export declare function isTemplate(value: unknown): value is Template;
/** 工作流模板文档（flow-templates/<templateId>.json）。 */
export declare function isWorkflowTemplate(value: unknown): value is WorkflowTemplate;
/** run 快照文档（runs/<runId>.json）。 */
export declare function isRunSnapshot(value: unknown): value is RunSnapshot;
/**
 * 工具组合文档（combos.json 单文件）。
 * 为什么这里必须校验容器字段：读取方会直接 spread 这个字段，非数组会被展开成
 * 下标/字符项的垃圾数据（形状漂移在此不是「降级可用」而是「写出错误结果」）。
 */
export declare function isToolComboDocument(value: unknown): value is {
    combos: unknown[];
};
/**
 * userId → sessionId 映射文档（services/<serviceId>.sessions.json）。
 * 逐值校验字符串：读取方会把整表 spread 成返回值，非字符串值会以「看起来像真映射」的
 * 形态流进会话解析并静默走错会话。
 */
export declare function isSessionIdMap(value: unknown): value is Record<string, string>;

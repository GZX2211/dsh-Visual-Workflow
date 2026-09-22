import type { TemplateKind } from './template-model.js';
/** 顶层数据目录（init 时创建；外部工具与测试以此为布局契约）。 */
export declare const DIRS: readonly ["workflows", "services", "roles", "data", "groups", "runs", "orchestrations", "flow-templates"];
/** 嵌套子目录（相对 root 的路径；随顶层目录一并幂等创建）。 */
export declare const NESTED_DIRS: readonly ["data/files"];
/**
 * 文件名消毒：id 中非法字符替换为下划线（防路径穿越/坏文件名）。
 * `.` 与 `..` 单独出现时同样替换，避免生成指向目录自身的路径。
 */
export declare function safeFilePart(value: unknown): string;
/** 工作流实例文件路径。 */
export declare function workflowPath(root: string, flowId: string): string;
/** 服务实例文件路径。 */
export declare function servicePath(root: string, serviceId: string): string;
/** 服务会话映射文件路径（services/<id>.sessions.json）。 */
export declare function sessionsPath(root: string, serviceId: string): string;
/** 模板种类 → 目录（data/ 内 file 与 database 同目录，以字段判别）。 */
export declare function templateDir(kind: TemplateKind): string;
/** 模板文件路径。 */
export declare function templatePath(root: string, kind: TemplateKind, id: string): string;
/** 工作流模板文件路径（flow-templates/，全局共享）。 */
export declare function flowTemplatePath(root: string, templateId: string): string;
/** run 快照文件路径。 */
export declare function runsPath(root: string, runId: string): string;
/** 运行时流程定义文件路径（orchestrations/）。 */
export declare function orchestrationPath(root: string, runId: string): string;
/** 工具组合文件路径（combos.json 单文件）。 */
export declare function combosPath(root: string): string;

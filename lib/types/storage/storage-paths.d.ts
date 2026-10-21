import type { TemplateKind } from './template-model.js';
/** 顶层数据目录（init 时创建；外部工具与测试以此为布局契约）。 */
export declare const DIRS: readonly ["workflows", "services", "roles", "data", "groups", "runs", "flow-templates"];
/**
 * 文件名消毒：id 中非法字符替换为下划线（防路径穿越/坏文件名）。
 * `.` 与 `..` 单独出现时同样替换，避免生成指向目录自身的路径。
 *
 * 已知限制（有意保留，不要顺手「修复」；改动前须先取得契约裁决）：
 *   1. 映射非单射：`a/b`、`a b`、`a_b` 同落 `a_b.json`。改成无冲突编码会改变既有 id 的
 *      落盘路径，磁盘上已存在的文件随之读不回来——「既有数据可读性」优先于文件名唯一。
 *   2. 不排除 Windows 保留设备名（CON / PRN / AUX / NUL / COM1-9 / LPT1-9，含带扩展名形态）。
 *      任何排除方式（转义或拒绝）都是一次路径变更，会让磁盘上以这类名字存在的文件或
 *      记录读不回来；是否接受该代价属产品/契约裁决，不得在实现里静默选择。
 */
export declare function safeFilePart(value: unknown): string;
/** 工作流实例文件路径。 */
export declare function workflowPath(root: string, flowId: string): string;
/** 服务实例文件路径。 */
export declare function servicePath(root: string, serviceId: string): string;
/** 服务会话映射文件路径（services/<id>.sessions.json）。 */
export declare function sessionsPath(root: string, serviceId: string): string;
/** 模板种类 → 目录（data/ 内 task 与 database 同目录，以字段判别）。 */
export declare function templateDir(kind: TemplateKind): string;
/** 模板文件路径。 */
export declare function templatePath(root: string, kind: TemplateKind, id: string): string;
/** 工作流模板文件路径（flow-templates/，全局共享）。 */
export declare function flowTemplatePath(root: string, templateId: string): string;
/** run 快照文件路径。 */
export declare function runsPath(root: string, runId: string): string;
/** 工具组合文件路径（combos.json 单文件）。 */
export declare function combosPath(root: string): string;
/**
 * 内置模板播种标记文件路径（builtin-seeds.json 单文件）。
 *
 * 为什么不放在 flow-templates/ 下：标记必须在模板文件被用户删除后仍然存在，否则
 * 「删除后不再播种」的语义无法成立；同时避免被模板列表读取入口当成模板文档。
 */
export declare function builtinSeedsPath(root: string): string;

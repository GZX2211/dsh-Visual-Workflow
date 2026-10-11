import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js';
export type TemplateKind = 'role' | 'file' | 'database';
export type TemplateMap = Map<string, RoleTemplate | FileTemplate | DatabaseTemplate>;
/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/file/database；传入 GroupTemplate 时按 None 处理（协作组模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export declare function templateToNodeData(kind: 'role' | 'file' | 'database', template: RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate | null | undefined): Record<string, unknown> | null;

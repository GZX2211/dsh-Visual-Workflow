import type { RoleTemplate, TaskTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js';
/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/task/database；传入 GroupTemplate 时按 None 处理（Team 模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export declare function templateToNodeData(kind: 'role' | 'task' | 'database', template: RoleTemplate | TaskTemplate | DatabaseTemplate | GroupTemplate | null | undefined): Record<string, unknown> | null;

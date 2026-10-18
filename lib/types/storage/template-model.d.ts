import type { DatabaseTemplate, GroupTemplate, RoleTemplate, TaskTemplate } from '../shared/types.js';
/** 模板种类：角色 / 任务 / 数据库 / Team（§4.2.3/§4.2.4/§4.2.5.2；左侧栏各 Tab）。 */
export type TemplateKind = 'role' | 'task' | 'database' | 'group';
/** 全部模板的判别联合（按目录区分；data/ 内 task/database 以字段判别；groups/ 为 Team）。 */
export type Template = RoleTemplate | TaskTemplate | DatabaseTemplate | GroupTemplate;
/** 判断数据模板对象是数据库模板（以 dbType 字段判别；data/ 目录内 task 与 database 混存）。 */
export declare function isDatabaseTemplate(t: Template): t is DatabaseTemplate;

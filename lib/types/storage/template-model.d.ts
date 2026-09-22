import type { DatabaseTemplate, FileTemplate, GroupTemplate, RoleTemplate } from '../shared/types.js';
/** 模板种类：角色 / 文件 / 数据库 / 协作组（§4.2.3/§4.2.4/§4.2.5.2；左侧栏各 Tab）。 */
export type TemplateKind = 'role' | 'file' | 'database' | 'group';
/** 全部模板的判别联合（按目录区分；data/ 内 file/database 以字段判别；groups/ 为协作组）。 */
export type Template = RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate;
/** 判断数据模板对象是数据库模板（以 dbType 字段判别；data/ 目录内 file 与 database 混存）。 */
export declare function isDatabaseTemplate(t: Template): t is DatabaseTemplate;

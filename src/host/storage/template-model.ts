// src/host/storage/template-model.ts
//
// 模板种类判别模型（纯类型与纯判别函数：零 IO、无副作用）。
//
// 为什么独立成文件：模板种类是持久化层与 GUI 端点（listTemplates/putTemplate/…）共享的
// 公共契约（调用方以 `TemplateKind` 指定目录族），其变化原因（新增模板种类）
// 与资源 CRUD、锁语义、文档净化的变化原因无关。
//
// 数据模板同目录混存（data/）：file 与 database 以字段判别，因此判别函数必须与
// 类型联合保持同源，不得在读取路径写内联判别。

import type { DatabaseTemplate, FileTemplate, GroupTemplate, RoleTemplate } from '../shared/types.js'

/** 模板种类：角色 / 文件 / 数据库 / 协作组（§4.2.3/§4.2.4/§4.2.5.2；左侧栏各 Tab）。 */
export type TemplateKind = 'role' | 'file' | 'database' | 'group'

/** 全部模板的判别联合（按目录区分；data/ 内 file/database 以字段判别；groups/ 为协作组）。 */
export type Template = RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate

/** 判断数据模板对象是数据库模板（以 dbType 字段判别；data/ 目录内 file 与 database 混存）。 */
export function isDatabaseTemplate(t: Template): t is DatabaseTemplate {
  return typeof (t as DatabaseTemplate).dbType === 'string'
}

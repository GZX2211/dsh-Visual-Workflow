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
/** 判断数据模板对象是数据库模板（以 dbType 字段判别；data/ 目录内 file 与 database 混存）。 */
export function isDatabaseTemplate(t) {
    return typeof t.dbType === 'string';
}
//# sourceMappingURL=template-model.js.map
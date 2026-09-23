// src/host/tools/index.ts
//
// tools 模块公共入口：只导出模块外真实消费的稳定契约——工具注册入口、
// 数据库索引能力、工具开关存储与过滤器。
//
// 边界规则（与 src/host/tools/AGENTS.md 一致）：
// - 模块外（宿主组合根、api、其它模块）只经本文件导入，不得引用模块内部文件；
// - 内部实现（apply / policy / types / text-render / define-tool / caller / 各 tool.ts）
//   不在此导出；
// - 模块内文件不得反向导入本文件（避免 barrel 循环）。

export { registerWfRunNode } from './wf-run-node/tool.js'
export { registerWfRunNodeWait } from './wf-run-node-wait/tool.js'
export { registerWfFinish } from './wf-finish/tool.js'
export { registerWfAsk } from './wf-ask/tool.js'
export { registerWfAskAgent } from './wf-ask-agent/tool.js'
export { registerWfOrgCatalog, type OrgCatalogHost } from './wf-org-catalog/tool.js'
export { registerWfGraphPatch, type GraphPatchHost } from './wf-graph-patch/tool.js'
export { registerWfDbQuery } from './wf-db-query/tool.js'
export { buildIndexForDatabase, ensureDatabaseIndexes, indexPathOf } from './wf-db-query/service.js'
export { createDatabaseDriver, testDatabaseConnection } from './wf-db-query/driver.js'
export { registerToolSwitchFilter, ToolSwitchStore } from './infrastructure/tool-switches.js'

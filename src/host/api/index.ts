// src/host/api/index.ts
//
// API 边界公共入口：只导出 Host 装配与测试所需的稳定契约。
// 内部实现（端点组、传输工具、错误映射表）不属于公共 API——它们可随治理调整，
// 故不经本入口全量 re-export（避免形成「全量 barrel」与伪公共契约）。

export { registerRoutes, VisualWorkflowApi } from './routes.js'
export { registerDownloadRoute } from './file-download.js'
export type { ApiHost } from './boundary.js'

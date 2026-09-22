// Host + Client 共享契约：模板与导入导出 bundle（纯类型，零运行时依赖）。
//
// 职责：定义可复用资源模板（角色/文件/数据库/协作组/工具组合/工作流模板）与
// 导入导出 v2 bundle 的形状。模板与节点深拷贝解耦：拖入画布即深拷贝内联，
// 模板修改不影响已生成节点（需求文档 §4.2.1）。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。
export {};
//# sourceMappingURL=template-types.js.map
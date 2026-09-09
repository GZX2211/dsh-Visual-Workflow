// Host + Client 共享契约（纯类型，零运行时 import）。
//
// 本文件定义运行快照（RunSnapshot）、服务状态（ServiceState）、模板（Role/File/
// Database/Group）、工具组合（ToolCombo）、导入导出 v2 bundle（BundleV2）、
// userId→sessionId 映射（UserIdMap）与断点回填用的节点输出记录（NodeOutputRecord）。
//
// 约束（架构文档 §2.3 / SKILL.md §6.3）：
//   - **零运行时 import**：client 半区经 type-only import 零风险引用本层结构，不得
//     引入任何运行时值（避免 double tsconfig 的 Context augmentation 相互污染）。
//     跨文件的类型复用（如 ServiceState.nodes: GraphNode[]）使用 `import type`
//     （纯类型引用，编译期被完全擦除，不产生任何运行时依赖）。
//   - 结构逐字对齐架构文档 AD-001 §6.1~§6.4。
//   - 每个字段以中文 JSDoc 说明业务语义，并引用需求条款号（PRD §4.x.y）。
export {};
//# sourceMappingURL=types.js.map
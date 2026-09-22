// Host + Client 共享契约：run 运行快照（纯类型，零运行时依赖）。
//
// 职责：定义一次 run 的持久化状态形状（runs/<runId>.json）与节点执行记录及其
// 断点回填视图。字段语义与依据见各字段 JSDoc（架构文档 §4.3 状态机 / §6.1，
// 需求文档 §4.7 断点续跑）。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。
export {};
//# sourceMappingURL=run-types.js.map
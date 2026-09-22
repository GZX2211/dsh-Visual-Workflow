// Host + Client 共享契约：定时任务（纯类型，零运行时依赖）。
//
// 职责：定义定时任务的持久化实体与内存派生运行态的**形状**。
// 语义来源：独立功能需求（prompt/定时任务开发.md），不改写既有需求/架构文档；
// 字段语义与依据见各字段 JSDoc。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。
export {};
//# sourceMappingURL=scheduler-types.js.map
// Host + Client 共享契约：模式二服务实例与多租户会话映射（纯类型，零运行时依赖）。
//
// 职责：定义服务文档形状（services/<serviceId>.json）与 userId→sessionId 映射记录
// 的形状。字段语义与依据见各字段 JSDoc（架构文档 §6.2，需求文档 §4.1.3 规则 7）。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。
export {};
//# sourceMappingURL=service-types.js.map
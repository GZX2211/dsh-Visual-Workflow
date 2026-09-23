// src/host/agent/index.ts
//
// agent 模块公共入口：只导出模块外真实消费的稳定契约——节点执行引擎、作用域装配
// 贡献、护栏工厂、父代理会话宿主适配。
//
// 边界规则（与 src/host/agent/AGENTS.md 一致）：
// - 模块外（宿主组合根、service-runner、orchestrator）只经本文件导入，不得引用模块内部文件；
// - 内部实现（复用键与签名推导、具体装配步骤、内部守卫结构）不在此导出；
// - 模块内文件不得反向导入本文件（避免 barrel 循环）。
export { CordisToolsView, NodeAgentRunner, childVisibilityContribution, resolveRolePrompt, } from './runner.js';
export { createReactGuard } from './guards.js';
export { createModelSelectionSetup } from './model-selection.js';
export { createChildPromptSetup } from './prompt-setup.js';
export { CordisAgentHost, agentsServiceLike, createOrGetServiceAgent, subagentsServiceLike } from './agents-host.js';
//# sourceMappingURL=index.js.map
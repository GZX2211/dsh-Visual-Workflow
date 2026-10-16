// src/host/prompts/index.ts
//
// 提示词的**唯一公共入口**（barrel）：模块外一律从本入口导入。
//
// 维护方式（2026.10 统一化改造）：
//   - 所有提示词正文集中在 texts/：一个注入场景 = 一个文件 = 一段完整正文；
//     改文本即改行为，不再需要跨文件脑内组装；
//   - 本目录的 *.ts 只做「事实 → 模板变量 → 渲染一次」，不再存放正文片段与拼装逻辑；
//   - 正文与常量不做测试断言（测试只覆盖渲染机制与装配结构）。
//
// 三情况组装（父代理提示词按画布形态整体选择模板）：
//   - 情况1 纯编排：buildOrchestratorPrompt；
//   - 情况2 编排+自执行：buildHybridPrompt（末段任务块来自 buildParentTaskSpec）；
//   - 情况3 纯执行：buildParentExecutorPrompt；
//   画布形态判定 parentPromptVariantOf 在 orchestrator/directive.ts。
// 渲染器（模板机制；tests 覆盖其行为）。
export { renderTemplate, flag } from './render.js';
// 父代理提示词（情况1/2/3）与情况2 末段任务块。
export { buildOrchestratorPrompt, buildHybridPrompt, buildParentExecutorPrompt, buildParentTaskSpec, } from './parents.js';
// 子代理任务块（含输入/输出契约）与降级通道协作块。
export { buildNodeTaskBlock, buildCollabBlock, } from './child.js';
// 规划期父代理提示词（/arrange）。
export { buildOrgPlanPrompt, } from './planner.js';
// 规则文本与规则段（工具调用注入）：图语义 / 设计方法 / 编排变更通知。
export { ORG_SOP_L1_GRAPH_SEMANTICS, ORG_SOP_DESIGN_METHOD, ORCH_CHANGE_MARKER, ORCH_CHANGE_TEXT, } from './rules.js';
// 规则文本：写图契约（wf_org_catalog 按需返回 + wf_graph_patch 参数层错误消息引用）。
export { OP_FIELD_SHAPES, GRAPH_OP_FIELD_TEXT, ROLE_NODE_DATA_CONTRACT, PATCH_SUBMISSION_RULES, ERROR_CODE_SEMANTICS, PATCH_CONTRACT_TEXT, PATCH_OPS_MAX, } from './texts/rule-patch-contract.js';
// 规则文本：ReAct 软截停护栏指令 / wf_ask_agent 协作消息 / 数据库工具说明。
export { REACT_CAP_MESSAGE, REACT_CAP_DENY_REASON } from './texts/rule-soft-stop.js';
export { ASK_MESSAGE, ASK_REPLY } from './texts/notice-ask-message.js';
export { RULE_DB_TOOL } from './texts/rule-db-tool.js';
// 任务文本：子代理任务块为空时的兜底首条消息。
export { TASK_FALLBACK } from './texts/task-fallback.js';
//# sourceMappingURL=index.js.map
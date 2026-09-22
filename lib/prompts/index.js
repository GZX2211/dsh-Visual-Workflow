// src/host/prompts/index.ts
//
// 提示词模板基线（T-005）的**唯一公共入口**（barrel）。
//
// 边界契约（同目录 AGENTS.md 固化）：
//   - 模块外（orchestrator / commands / api / service / scheduler 及测试）一律从本入口
//     导入，不得直接引用模块内部文件；
//   - 模块内部文件之间仍用相对路径导入（本文件不包含任何实现，也不承担组装逻辑）；
//   - 本入口只公开「外部真实消费的契约」：构建器 + 段落锚点 + 约束常量 + 入参类型；
//     模块内部的措辞与渲染 helper（共享语言规则、契约声明句、段落渲染）不对外公开。
//
// 三情况组装（用户评审定稿）：父代理提示词按画布形态整体替换组装——
//   - 情况1 纯编排：buildOrchestratorPrompt；
//   - 情况2 编排+自执行：buildHybridPrompt（父代理执行单元任务块来自 buildParentTaskSpec）；
//   - 情况3 纯执行：buildParentExecutorPrompt；
//   画布形态判定 parentPromptVariantOf 在 orchestrator/directive.ts（三情况分类纯函数）。
//
// 提示词文案规范、语言政策、写作规范与 §13.1 检查单落点见同目录 README.md（文案基线）。
// 段落标记常量（「前缀稳定 + 关键约束双位 + 动态值仅末尾」契约的可测试锚点）。
export { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER, } from './markers.js';
// 编排父代理提示词构建器（情况1/2）与三情况变体类型。
export { buildOrchestratorPrompt, buildHybridPrompt, ORCH_HARD_CONSTRAINTS, } from './orchestration.js';
// 父代理执行单元（情况3 完整提示词 + 情况2 末段任务块正文）。
export { buildParentExecutorPrompt, buildParentTaskSpec, EXECUTOR_FINISH_RULE, } from './executor.js';
// 节点任务块构建器（子代理任务文本）：含交接契约（outputContract）与输入结构（inputContract）。
export { buildNodeTaskBlock, NODE_HARD_CONSTRAINTS, DEFAULT_OUTPUT_CONTRACT, } from './node-task.js';
// 协作成员清单块构建器（追加到组成员首条用户消息）。
export { buildCollabBlock } from './collab.js';
// 运行期「编排变更」通知文案（画布保存改变编排语义时注入父代理）。
export { buildOrchestrationChangeText, ORCH_CHANGE_MARKER, } from './orchestration-change.js';
// 「本次组织预算」末段文本构建器（动态值，仅末段注入；由 runtime-launch 接入）。
export { buildOrgBudgetText } from './org-budget.js';
// 规划 SOP 文本（L1 图语义 / 设计方法；长稳定文本段）。
export { ORG_SOP_L1_GRAPH_SEMANTICS, ORG_SOP_DESIGN_METHOD } from './org-sop.js';
// 规划期父代理提示词变体：首段硬约束 → 中段 L1+设计方法 → 末段动态（用户意图 / L3 SOP / 预算）。
export { buildOrgPlanPrompt, ORG_PLAN_HARD_CONSTRAINTS, } from './org-plan.js';
//# sourceMappingURL=index.js.map
// src/host/orchestrator/index.ts
//
// 编排模块**唯一公共入口**（barrel）：
//   - 模块外（host / agent / tools / api / service / scheduler）与全部测试一律
//     从本入口导入，不得直接引用模块内部文件（见同目录 AGENTS.md §4）；
//   - 内部文件之间仍使用相对路径导入；本文件不包含任何实现。
// 运行时主类
export { OrchestratorRuntime } from './runtime.js';
// 依赖缝、常量与身份类型
export { GLOBAL_RUN_CALL_LIMIT, SUBAGENT_END_RETRY_DELAY_MS, SUBAGENT_END_RETRY_MAX, consoleLogger, } from './seams.js';
// 错误内核
export { WfError, messageOf } from './errors.js';
// 运行条目与对外契约
export { createWaiter, } from './run-entry.js';
// wf_ask_agent 两态通信协议（类型/常量/文本纯函数）
export { ASK_MESSAGE_LIMIT, buildAskText, buildReplyText, coordinatorMessage, } from './ask-protocol.js';
// 图推导与节点上下文事实（纯函数）
export { buildNodeContextFacts, collabBlockOf, collabGroupList, collabPromptOf, dbToolHintOf, labelOf, missingStageLabels, orchestrationNodeList, pauseNodeIdsOf, validateFlowForRun, } from './graph-facts.js';
// 节点任务块与交接契约（纯函数）
export { buildNodeBlocks, inputContractOf, outputContractOf } from './task-blocks.js';
// 父代理提示词变体与编排指令组装（纯函数）
export { buildParentRunPrompt, directiveParams, parentExecutorOf, parentPromptVariantOf } from './directive.js';
// 节点级执行参数解析（纯函数）
export { effectiveReactLimitOf, effectiveRetryLimitOf, effectiveThinkingOf } from './node-params.js';
// 运行快照纯函数
export { OUTPUT_SUMMARY_LIMIT, cloneSnapshot, createRunSnapshot, lastAssistantText, setNodeStatus, statusText, terminalizeNodes, truncateText, } from './snapshot.js';
// 断点续跑纯函数与查找
export { RESUMABLE_STATUSES, buildResumedSnapshot, findResumableRun, } from './resume.js';
// 编排语义变更判定（纯函数）
export { lineKeyOf, nodeConfigKeyOf, summarizeFlowChange } from './flow-diff.js';
// 运行看护与宿主重启对账
export { WATCHDOG_INTERVAL_MS, reconcileStaleRuns, scheduleIdleWatchdog, sweepWatchdogOnce } from './watchdog.js';
// 协作组 Team 经验召回查询（组任务上下文摘要纯函数；注入缝 teamExperienceContext 由宿主装配）
export { buildTeamExperienceQuery, TEAM_EXPERIENCE_CAUTION_FIELD, TEAM_EXPERIENCE_FIELD_LIMIT, TEAM_EXPERIENCE_MEMBER_LIMIT, TEAM_EXPERIENCE_MEMBERS_FIELD, TEAM_EXPERIENCE_QUERY_DIGEST_MARKER, TEAM_EXPERIENCE_QUERY_MARKER, TEAM_EXPERIENCE_QUERY_NONE, } from './team-experience.js';
//# sourceMappingURL=index.js.map
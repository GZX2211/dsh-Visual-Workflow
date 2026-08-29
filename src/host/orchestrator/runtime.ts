// src/host/orchestrator/runtime.ts
//
// 编排运行时入口（历史单一文件拆分后的收口文件）：
//   - 最终类 OrchestratorRuntime 汇聚继承链（RuntimeBase ← RuntimeLaunch ←
//     RuntimeExecute ← RuntimeComm ← RuntimeObserve ← RuntimeLifecycle），
//     全部方法体逐字移动、零逻辑修改（可见性放宽见各继承层文件头注释）；
//   - 入口 re-export 拆分前的全部公共 API，外部引用路径不变
//     （工具层 wf-* / agent / remote / 看护 / 单测均从本入口导入）。

import { RuntimeLifecycle } from './runtime-lifecycle.js'

/** 编排运行时：模式一「父代理编排」执行引擎的全部内存状态与状态机（拆分后最终类）。 */
export class OrchestratorRuntime extends RuntimeLifecycle {}

// re-export：原入口公共 API（拆分后外部引用路径不变）
// ---------------------------------------------------------------------------

export {
  GLOBAL_RUN_CALL_LIMIT,
  WfError,
  type AgentHost,
  type CallerInfo,
  type CoordinatorMessage,
  type FlowLockInfo,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type OrchestratorLogger,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from './seams.js'
export {
  ASK_MESSAGE_LIMIT,
  buildAskText,
  buildTimeoutText,
  coordinatorMessage,
  type AskAgentArgs,
  type AskAgentCmd,
  type AskAgentDelivery,
  type AskAgentResult,
  type AskAuditEntry,
  type PendingAsk,
  type ResolveAction,
} from './ask-types.js'
export {
  type FinishArgs,
  type FinishResult,
  type OrchestratorDeps,
  type RunEntry,
  type RunNodeArgs,
  type RunNodeResult,
  type StartRunOptions,
  type StartRunResult,
  type SubagentEndInfo,
  type TerminateOptions,
} from './run-types.js'
export {
  collabGroupList,
  collabPromptOf,
  labelOf,
  orchestrationNodeList,
  pauseNodeIdsOf,
} from './helpers.js'

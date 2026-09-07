// src/host/prompts/index.ts
//
// 提示词模板基线（T-005）统一出口。
//
// 为什么集中在这里（§13.1 稳定段落化）：编排指令（情况1/2）、父代理执行单元（情况3）、
// 节点任务块、协作 Prompt 都遵循同一套「前缀稳定 + 关键约束双位 + 动态值仅注入末尾段」
// 的约定。段落标记（section marker）定义在 markers.ts（独立模块，避免循环 import），
// 本文件统一 re-export 标记常量与构建器，供测试与运行时组装任务
// （T-021/T-023/T-024/T-025/T-032 等）从单一入口引用。
//
// 三情况组装（用户评审定稿）：父代理提示词按画布形态整体替换组装——
//   - 情况1 纯编排：buildOrchestratorPrompt（orchestration.ts）；
//   - 情况2 编排+自执行：buildHybridPrompt（orchestration.ts，父代理执行单元任务块
//     来自 buildParentTaskSpec，executor.ts）；
//   - 情况3 纯执行：buildParentExecutorPrompt（executor.ts）；
//   画布形态判定 parentPromptVariantOf 在 orchestrator/helpers.ts（三情况分类纯函数）。

// 段落标记常量（锚点见 markers.ts 内注释）。
export {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
} from './markers.js'

// 编排父代理提示词构建器（情况1/2）与三情况变体类型。
export {
  buildOrchestratorPrompt,
  buildHybridPrompt,
  ORCH_HARD_CONSTRAINTS,
  type OrchestrationDirectiveParams,
  type ParentPromptVariant,
} from './orchestration.js'

// 父代理执行单元（情况3 完整提示词 + 情况2 末段任务块正文）。
export {
  buildParentExecutorPrompt,
  buildParentTaskSpec,
  EXECUTOR_FINISH_RULE,
  type ExecutorContextFacts,
  type ParentExecutorPromptParams,
  type ParentTaskSpecParams,
} from './executor.js'

// 节点任务块构建器（子代理任务文本）。
export { buildNodeTaskBlock, NODE_HARD_CONSTRAINTS, type NodeTaskBlockParams } from './node-task.js'

// 协作 Prompt 构建器（追加到组成员首条用户消息）。
export { buildCollabBlock, type CollabBlockParams } from './collab.js'
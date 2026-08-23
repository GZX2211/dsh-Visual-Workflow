// src/host/prompts/index.ts
//
// 提示词模板基线（T-005）统一出口。
//
// 为什么集中在这里（§13.1 稳定段落化）：三个构建器（编排指令 / 节点任务块 /
// 协作 Prompt）都遵循同一套「前缀稳定 + 关键约束双位 + 动态值仅注入末尾段」的
// 约定。段落标记（section marker）定义在 markers.ts（独立模块，避免循环 import），
// 本文件统一 re-export 标记常量与构建器，供测试与后续组装任务
// （T-021/T-023/T-024/T-025/T-032 等）从单一入口引用。

// 段落标记常量（锚点见 markers.ts 内注释）。
export {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  COLLAB_PREFIX,
} from './markers.js'

// 三个提示词模板构建器（纯函数，无副作用、不读时钟/随机源）。
export { buildOrchestrationDirective, type OrchestrationDirectiveParams } from './orchestration.js'
export { buildNodeTaskBlock, type NodeTaskBlockParams } from './node-task.js'
export { buildCollabPrompt } from './collab.js'

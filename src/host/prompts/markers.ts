// src/host/prompts/markers.ts
//
// 提示词模板的共享段落标记常量（T-005 基线锚点，独立模块避免循环 import）。
//
// 为什么独立成文件：三个构建器（orchestration/node-task/collab）都引用这些标记，
// 而 index.ts 又需要 re-export 构建器——若标记常量定义在 index.ts 内，子模块
// import './index.js' 会与 index 的 re-export 形成循环 import。纯常量在 ESM 下
// 虽无 TDZ 风险，但后续组装任务（T-021/T-023 等）扩展 prompts 目录时容易踩坑；
// 下沉到独立 markers.ts 后依赖图为单向无环（构建器 → markers，index → 两者）。
//
// 这些标记是「前缀稳定 + 关键约束双位 + 动态值仅注入末尾段」约定的可测试锚点：
// 测试与组装任务据此定位段落边界，而不依赖模板正文的脆弱子串（§13.1 稳定段落化）。

// 首段标记：硬约束段（权限边界 / 调用协议 / 失败语义 / 硬性规则）的起始锚。
// 关键约束「双位」的第一位（注意力位置 §13.1.2：最重要约束置于任务文本开头）。
export const HEAD_MARKER = '# 硬性约束'

// 中段标记：过程性信息段（节点清单 / 上游产出 / 文件路径索引 / 数据库工具说明）的起始锚。
// 关键约束「双位」之间的中部，只放过程性信息，不放硬约束（lost-in-the-middle 处置）。
export const MID_MARKER = '## 流程上下文'

// 尾段标记：动态段（断点继续 / 暂停 / 运行参数 / 本次状态等不稳定内容）的起始锚。
// 承诺：构建器输出中，从首个「TAIL_MARKER 行」开始直到末尾为动态段，
//       其之前（含首段硬约束 + 中段过程性信息）为同一 run 内字节稳定的前缀。
export const TAIL_MARKER = '# 动态状态'

// 尾段重申标识：末段对首段关键约束的重申小节标题。
// 保证测试可断言「关键约束短语同时出现在首段与末段」的明确位置。
export const TAIL_RESTATE_MARKER = '## 重申约束'

// 协作 Prompt 段落前缀（§13.1.4）：协作块以 `collab:` 起段，追加到子代理
// persona/任务文本末尾，对既有前缀零失效；与 `task:` 任务段分隔以便后续稳定引用。
export const COLLAB_PREFIX = 'collab:'

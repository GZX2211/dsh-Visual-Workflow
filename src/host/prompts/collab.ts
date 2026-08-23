// src/host/prompts/collab.ts
//
// 协作 Prompt 构建器（T-005 基线之一）。
//
// 上下文：协作组节点的「协作 Prompt」追加注入到组内所有成员的 System Prompt 末尾。
//       组内成员并行启动，组内经 wf_ask_agent 阻塞通信，超时由父代理裁决。
//
// 为什么以 `collab:` 起段且追加到末尾（§13.1.4）：追加到既有 persona/任务文本末尾，
// 对既有前缀零失效（不重排、不插入前中段，KV 缓存友好）；`collab:` 前缀与 `task:`
// 任务段分隔，供后续组装任务与测试稳定引用（COLLAB_PREFIX 在 prompts/markers.ts 统一定义）。
//
// 纯函数：输入 text 不变则输出字节不变。

import { COLLAB_PREFIX } from './markers.js'

/**
 * 协作 Prompt 构建器（纯函数）。
 *
 * 以 `collab:` 前缀起段，说明组内成员并行启动、经 wf_ask_agent 阻塞通信、超时由父代理裁决。
 * 段落追加到子代理 persona/任务文本末尾，对既有前缀零失效。
 *
 * @param text - 协作组用户自定义的协作说明文本（可为空，模板提供默认说明）。
 * @returns 追加到成员 System Prompt 末尾的协作段落（面向模型，英文；以 collab: 开头）。
 */
export function buildCollabPrompt(text: string): string {
  const custom = String(text ?? '').trim()
  const body = [
    'You are a member of a collaboration group.',
    'Group members start in parallel and communicate by blocking wf_ask_agent calls;',
    'a communication timeout is arbitrated by the parent agent.',
  ]
  if (custom) {
    body.push('Group instructions:', custom)
  }
  // 以 `collab:` 前缀起段（与 `task:` 任务段分隔的稳定锚点，见 index.ts）。
  return `${COLLAB_PREFIX} ${body.join(' ')}`
}

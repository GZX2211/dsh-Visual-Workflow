// src/host/orchestrator/task-blocks.ts
//
// 节点任务块与节点契约（纯函数）：首条用户消息的组装、输入/输出契约解析。
// 事实来源统一走 graph-facts.buildNodeContextFacts（与父代理执行单元共用同一上下文口径）。

import { buildNodeTaskBlock, type CollabChannel } from '../prompts/index.js'
import { isGroupMember } from '../graph/index.js'
import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot } from '../shared/types.js'
import { buildNodeContextFacts, collabBlockOf, collabPromptOf } from './graph-facts.js'

/**
 * 解析节点任务块的输入契约（data.inputSchema）。
 * 语义：告诉子代理「你应当收到什么输入」，避免它重复索要上游已给出的信息。
 * 纯函数；未配置返回空串（不组装该段）。
 */
export function inputContractOf(node: RoleNode): string {
  return String(node.data?.inputSchema ?? '').trim()
}

/**
 * 解析节点的**输出契约**（data.outputSchema）。
 *
 * 语义（用户裁决 2026-10）：不再有「有无下游 / 有无 ctx 出线」的注入判据——统一注入、
 * 但可注入为空。空串即该节点不配置契约（任务块不出现契约段）；配置文本逐字生效，
 * 不与默认文本叠加（默认文本在新建节点时已落盘，界面显示与实际注入是同一个值）。
 */
export function outputContractOf(node: RoleNode): string {
  return String(node.data?.outputSchema ?? '').trim()
}

/** 节点任务块组装：角色任务上下文 + 输入/输出契约 + 软约束 + 执行与交付约定。 */
export function buildNodeBlocks(input: {
  flow: WorkflowDocument
  node: RoleNode
  /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
  snapshot: RunSnapshot
  documentTextLimit: number
  /** 系统语言名（从 DSH 用户设置读取；注入「回复/注释/思考必须使用该语言」规则）。 */
  systemLanguage: string
  /**
   * 协作通道（仅组内成员有意义）：official = 官方 Agent 协作组邮箱；legacy = 插件自建协作工具。
   * 缺省 legacy，保持未启用官方团队时的文案与行为。
   */
  collabChannel?: CollabChannel
}): Array<{ type: 'text'; text: string }> {
  const { flow, node } = input
  const data = node.data
  const { upstreamContext, filePaths, dbToolHint } = buildNodeContextFacts({
    flow,
    node,
    snapshot: input.snapshot,
    documentTextLimit: input.documentTextLimit,
  })
  const outputContract = outputContractOf(node)
  // 协作通道缺省 legacy（未启用官方 协作组时保持既有文案与行为）
  const channel: CollabChannel = input.collabChannel ?? 'legacy'

  const text = buildNodeTaskBlock({
    facts: {
      nodeLabel: data.label || node.id,
      upstreamContext,
      filePaths,
      dbToolHint,
      isGroupMember: isGroupMember(flow, node.id),
      collabChannel: channel,
      inputContract: inputContractOf(node),
      outputContract,
      systemLanguage: input.systemLanguage,
    },
  })
  // 协作信息只在**降级通道**追加完整协作块（成员清单 + 通信指引）：成员是官方 teammate 时，
  // 官方为其注入 team:policy 与九个 协作组工具（list_agents / send_message / 任务板），插件再列
  // 一份成员清单与通信指引就是第二份协作契约（用户裁决 2026-10：与官方重复的定义以官方为准）。
  // 但用户填写的组卡片协作说明不是官方已定义的内容，官方通道下仍作为「团队协作说明」注入。
  const custom = collabPromptOf(flow, node.id)
  const collabBlock = channel === 'legacy'
    ? collabBlockOf(flow, node.id, channel)
    : (custom ? `团队协作说明：\n${custom}` : '')
  return [{ type: 'text', text: collabBlock ? `${text}\n\n${collabBlock}` : text }]
}

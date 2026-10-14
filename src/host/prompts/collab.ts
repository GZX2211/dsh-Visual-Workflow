// src/host/prompts/collab.ts
//
// 协作成员清单块构建器（**降级通道**的协作块；用户裁决 2026-10 后收窄）。
//
// 现状：官方 协作组可用时成员是官方 teammate，官方为其注册九个 协作组工具并注入 team:policy，
//       插件不再注入协作块（避免第二份协作契约）；本构建器只服务**降级通道**——官方协作组
//       不可用、成员降级为普通子代理时，用插件自建工具（wf_ask_agent）协作。
//       用户在 协作组卡片上填写的协作说明在两条通道下都会随任务消息注入（官方通道下作为
//       「团队协作说明」），只是官方通道不再列成员清单与通信指引。
//
// 纯函数：输入 members/custom 不变则输出字节不变。

/**
 * 协作成员清单块入参（中文注释每个字段）。
 */
export interface CollabBlockParams {
  /** 成员清单：组内每个角色节点的 id + 人类可读名称（始终注入，即使 custom 为空）。 */
  members: Array<{ id: string; label: string; target?: string }>
  /** 协作组卡片上用户自定义的协作说明文本（可为空；空则不追加说明段）。 */
  custom: string
  /**
   * 协作通道（成员是官方 teammate 还是普通子代理）。
   * 注意 official 分支当前**没有调用方**：官方通道不注入协作块（官方 team:policy 承担协作
   * 规则与寻址），成员清单与通信指引只在降级通道注入。该分支保留为完整模板备用。
   */
  channel?: CollabChannel
}

/** 协作通道类型（官方团队 / 插件自建）。 */
export type CollabChannel = 'official' | 'legacy'

/**
 * 协作成员清单块构建器（纯函数）。
 *
 * 输出为追加到成员首条用户消息的协作块：先列出本组全部成员（名称 + 可寻址标识），
 * 再追加用户自定义协作说明（若有），最后给出本通道的通信工具。始终包含成员清单，
 * 与 custom 是否为空无关。
 *
 * @param params - 成员清单 + 自定义协作说明 + 通道。
 * @returns 追加到成员用户消息的协作块（面向模型，中文）。
 */
export function buildCollabBlock(params: CollabBlockParams): string {
  const channel: CollabChannel = params?.channel === 'official' ? 'official' : 'legacy'
  const lines: string[] = [
    '你是 协作组的成员。本组成员为：',
  ]
  const members = Array.isArray(params?.members) ? params.members : []
  if (members.length === 0) {
    lines.push('- （无其他成员）')
  } else {
    for (const member of members) {
      const id = String(member?.id ?? '')
      const label = String(member?.label ?? '').trim()
      const target = String(member?.target ?? '').trim()
      // 官方通道以成员名寻址（send_message 的 target）；自建通道以节点 id 寻址
      lines.push(channel === 'official' && target
        ? `- ${label || id}（成员名：${target}）`
        : `- ${label || id}（id：${id}）`)
    }
  }
  lines.push(channel === 'official'
    ? '与其他成员通信时，请使用 send_message 工具，target 填对方的成员名；需要 Lead 决策或汇总时 target 填 "lead"。'
    : '与其他成员通信时，请使用 wf_ask_agent 工具，并将 targetChildId 填为对方成员 id。')

  const custom = String(params?.custom ?? '').trim()
  if (custom) {
    lines.push('', '组内说明：', custom)
  }
  return lines.join('\n')
}

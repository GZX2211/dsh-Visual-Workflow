// src/host/prompts/collab.ts
//
// 协作成员清单块构建器（T-005 基线之一，需求变更后重写）。
//
// 背景：此前把「协作 Prompt」作为 `collab:` 段追加到组内成员 System Prompt 末尾。
//       需求变更：协作信息**改为追加到成员的用户消息**（首条任务块），且**无论
//       用户写了什么（即使空白）都默认追加组内所有成员的 ID + 角色名称清单**，
//       用于告知成员「你在和谁协作、能向谁发送协作消息（wf_ask_agent）」。
//
// 为什么以消息块而非系统提示词段注入（§13.1.4 变更）：协作是**成员间的动态关系**，
// 放入系统提示词会与其他插件段落混排；改放入用户消息首块可稳定告知每个成员的协作对象，
// 且与「系统提示词开关」解耦（关闭官方系统提示词时协作信息仍在）。
//
// 纯函数：输入 members/custom 不变则输出字节不变。

/**
 * 协作成员清单块入参（中文注释每个字段）。
 */
export interface CollabBlockParams {
  /** 成员清单：组内每个角色节点的 id + 人类可读名称（始终注入，即使 custom 为空）。 */
  members: Array<{ id: string; label: string }>
  /** 组卡片上用户自定义的协作说明文本（可为空；空则不追加说明段）。 */
  custom: string
}

/**
 * 协作成员清单块构建器（纯函数）。
 *
 * 输出为追加到成员首条用户消息的协作块：先列出本组全部成员（id + 角色名，告知协作对象），
 * 再追加用户自定义协作说明（若有）。始终包含成员清单，与 custom 是否为空无关。
 *
 * @param params - 成员清单 + 自定义协作说明。
 * @returns 追加到成员用户消息的协作块（面向模型，中文；含成员 ID + 角色名清单）。
 */
export function buildCollabBlock(params: CollabBlockParams): string {
  const lines: string[] = [
    '你是协作组的成员。本组成员为：',
  ]
  const members = Array.isArray(params?.members) ? params.members : []
  if (members.length === 0) {
    lines.push('- （无其他成员）')
  } else {
    for (const member of members) {
      const id = String(member?.id ?? '')
      const label = String(member?.label ?? '').trim()
      lines.push(`- ${label || id}（id：${id}）`)
    }
  }
  lines.push('你可以向以上任一成员发送 wf_ask_agent 消息：ask 的 targetChildId 直接使用上列成员的 id（即节点 id）；目标即使当前空闲/未运行也会被唤醒。超时由父代理仲裁。')

  const custom = String(params?.custom ?? '').trim()
  if (custom) {
    lines.push('', '组内说明：', custom)
  }
  return lines.join('\n')
}

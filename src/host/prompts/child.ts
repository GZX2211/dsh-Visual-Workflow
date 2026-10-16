// src/host/prompts/child.ts
//
// 子代理侧提示词构建器：节点任务块（每次运行注入的那一段）+ 降级通道协作块。
// 正文全部在 texts/child-node-task.ts；本文件只把事实翻译成模板变量并渲染一次。

import { flag, renderTemplate } from './render.js'
import { CHILD_COLLAB_BLOCK, CHILD_NODE_TASK } from './texts/child-node-task.js'

/** 协作通道类型（官方团队 / 插件自建）。 */
export type CollabChannel = 'official' | 'legacy'

/** Team 内通信必须经插件自建协作工具的规则句（降级通道组内成员注入）。 */
const COLLAB_ASK_ONLY = '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）'

/** 节点任务块的入参（facts 为同一 run 内字节稳定的静态事实）。 */
export interface NodeTaskBlockParams {
  facts: {
    /** 节点人类可读名称（身份行与中段指代）。 */
    nodeLabel: string
    /** 上游产出上下文（全链路自动注入），可为空。 */
    upstreamContext: Array<{ nodeId: string; source: string; content: string }>
    /** 文件路径索引（data/files/ 受管路径），可为空。 */
    filePaths: string[]
    /** 数据库工具说明（存在 db-in 连线时说明 wf_db_query 三模式），无则空字符串。 */
    dbToolHint: string
    /** Team 成员标记。 */
    isGroupMember: boolean
    /** 协作通道（isGroupMember 时决定注入哪条通信约束）；缺省 legacy。 */
    collabChannel?: CollabChannel
    /** 输入契约（节点配置 data.inputSchema）；为空则不组装该段。 */
    inputContract: string
    /** 输出契约（节点配置 data.outputSchema）；为空则不组装该段。 */
    outputContract: string
    /** 系统语言名（如 '中文' / 'English'）。 */
    systemLanguage: string
  }
}

/** 协作成员清单块入参。 */
export interface CollabBlockParams {
  /** 成员清单：组内每个角色节点的 id + 人类可读名称。 */
  members: Array<{ id: string; label: string; target?: string }>
  /** Team 卡片上用户自定义的协作说明文本（可为空）。 */
  custom: string
  /** 协作通道（official 分支当前无调用方，保留为完整模板备用）。 */
  channel?: CollabChannel
}

/**
 * 组内通信约束（official 通道不注入：协作规则以官方 team:policy 为唯一契约源，
 * 插件再注入一条等价约束会形成第二份协作契约）。
 */
function collabRuleOf(isGroupMember: boolean, channel: CollabChannel | undefined): string {
  if (!isGroupMember) return ''
  return channel === 'official' ? '' : COLLAB_ASK_ONLY
}

/** 节点任务块构建器（纯函数）：注入子代理「本轮该干什么 + 手上有什么」的完整文本。 */
export function buildNodeTaskBlock(params: NodeTaskBlockParams): string {
  const { facts } = params
  const systemLanguage = String(facts.systemLanguage ?? '').trim()
  const collabRule = collabRuleOf(facts.isGroupMember, facts.collabChannel)
  const outputContract = String(facts.outputContract ?? '').trim()
  return renderTemplate(CHILD_NODE_TASK, {
    nodeLabel: facts.nodeLabel,
    systemLanguage,
    collabRule,
    collabIndex: systemLanguage ? '2' : '1',
    upstreamEntries: facts.upstreamContext
      .map((entry) => `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`)
      .join('\n'),
    noUpstream: flag(facts.upstreamContext.length === 0),
    filePathsText: (facts.filePaths ?? []).map((filePath) => `- ${filePath}`).join('\n'),
    inputContract: String(facts.inputContract ?? '').trim(),
    dbToolHint: String(facts.dbToolHint ?? '').trim(),
    outputContract,
  })
}

/** 协作成员清单块构建器（纯函数）：追加到成员首条用户消息末尾。 */
export function buildCollabBlock(params: CollabBlockParams): string {
  const channel: CollabChannel = params?.channel === 'official' ? 'official' : 'legacy'
  const members = Array.isArray(params?.members) ? params.members : []
  const membersText = members.length === 0
    ? '- （无其他成员）'
    : members
      .map((member) => {
        const id = String(member?.id ?? '')
        const label = String(member?.label ?? '').trim()
        const target = String(member?.target ?? '').trim()
        // 官方通道以成员名寻址（send_message 的 target）；自建通道以节点 id 寻址
        return channel === 'official' && target
          ? `- ${label || id}（成员名：${target}）`
          : `- ${label || id}（id：${id}）`
      })
      .join('\n')
  return renderTemplate(CHILD_COLLAB_BLOCK, {
    membersText,
    official: flag(channel === 'official'),
    legacy: flag(channel === 'legacy'),
    custom: String(params?.custom ?? '').trim(),
  })
}

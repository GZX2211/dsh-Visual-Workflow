// src/host/orchestrator/team-experience.ts
//
// 协作组「Team 经验召回查询」组装（纯函数）：
//   协作组启动前，编排器把本组的任务与协作上下文压成一段稳定摘要，交给宿主注入的
//   经验召回缝（teamExperienceContext）去召回历史 Team 经验。
//
// 为什么是纯函数且不含成员任务正文原文：查询要按「同一组、同一成员构成」稳定复用，
// 正文长度不可控且含大段角色提示词；此处只取归一化后的角色名与任务摘要，再对完整
// 输入取稳定摘要值，使「内容变化 → 查询变化、内容不变 → 查询字节相同」可被测试锁定。

/** 查询标题标记（召回侧与测试据此识别入参性质）。 */
export const TEAM_EXPERIENCE_QUERY_MARKER = '【团队经验查询】'

/** 稳定的查询结束标记：其后跟完整输入的稳定摘要值。 */
export const TEAM_EXPERIENCE_QUERY_DIGEST_MARKER = '【查询摘要】'

/** 成员清单段落锚点（成员逐条列出）。 */
export const TEAM_EXPERIENCE_MEMBERS_FIELD = '【成员任务】'

/** 警示段落锚点（召回侧据此识读「经验仅供参考、以本次任务约束为准」）。 */
export const TEAM_EXPERIENCE_CAUTION_FIELD = '【判定参考】'

/** 无成员时的稳定占位（不因空成员产生空段或崩溃）。 */
export const TEAM_EXPERIENCE_QUERY_NONE = '（无成员）'

/** 单条成员文本归一化后的字符上限（截断保持查询长度有界）。 */
export const TEAM_EXPERIENCE_MEMBER_LIMIT = 200

/** 单个字段（组名/协作 Prompt）归一化后的字符上限。 */
export const TEAM_EXPERIENCE_FIELD_LIMIT = 400

/** 一条成员任务事实（按 group.data.memberIds 顺序给出）。 */
export interface TeamExperienceMemberTask {
  /** 成员角色名（节点 label）。 */
  label: string
  /** 成员任务文本（角色 Prompt；召回侧只消费归一化摘要）。 */
  task: string
}

/** Team 经验召回查询入参（全部来自本次运行事实，运行时不读盘）。 */
export interface TeamExperienceQueryInput {
  sessionId: string
  flowId: string
  /** 协作组节点 id。 */
  groupId: string
  /** 协作组节点名。 */
  groupLabel: string
  /** 组级协作 Prompt。 */
  collabPrompt: string
  /** 成员任务（顺序即 group.data.memberIds 顺序）。 */
  members: TeamExperienceMemberTask[]
}

/** 归一化单行文本：折叠全部空白（含换行/制表）并按上限截断。 */
function normalizeText(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  if (limit <= 0) return ''
  return text.length > limit ? text.slice(0, limit) : text
}

/**
 * 稳定摘要值（FNV-1a 32 位）：只用于「同内容同值、异内容异值」，不承担安全用途。
 * 不引入加密依赖：本模块属提示词侧纯计算，与运行时的 id 生成缝无关。
 */
function digestOf(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 组装 Team 经验召回查询（纯函数：同一入参字节相同）。
 * 结构固定且只含归一化文本，动态值（摘要）仅出现在末尾。
 */
export function buildTeamExperienceQuery(input: TeamExperienceQueryInput): string {
  const groupLabel = normalizeText(input.groupLabel, TEAM_EXPERIENCE_FIELD_LIMIT)
  const collabPrompt = normalizeText(input.collabPrompt, TEAM_EXPERIENCE_FIELD_LIMIT)
  const members = (input.members ?? []).map((member) => ({
    label: normalizeText(member.label, TEAM_EXPERIENCE_MEMBER_LIMIT),
    task: normalizeText(member.task, TEAM_EXPERIENCE_MEMBER_LIMIT),
  }))
  const digest = digestOf(JSON.stringify({
    sessionId: String(input.sessionId ?? ''),
    flowId: String(input.flowId ?? ''),
    groupId: String(input.groupId ?? ''),
    groupLabel,
    collabPrompt,
    members,
  }))
  const memberLines = members.length === 0
    ? [`- ${TEAM_EXPERIENCE_QUERY_NONE}`]
    : members.map((member) => `- ${member.label}：${member.task}`)
  return [
    TEAM_EXPERIENCE_QUERY_MARKER,
    `会话：${String(input.sessionId ?? '')}｜工作流：${String(input.flowId ?? '')}｜组：${groupLabel}（${String(input.groupId ?? '')}）`,
    `协作方式：${collabPrompt}`,
    TEAM_EXPERIENCE_MEMBERS_FIELD,
    ...memberLines,
    TEAM_EXPERIENCE_CAUTION_FIELD,
    '本次为同类协作任务的历史经验召回，返回内容仅作判定参考；与本次任务的实际约束冲突时，以本次任务为准。',
    `${TEAM_EXPERIENCE_QUERY_DIGEST_MARKER} ${digest}`,
  ].join('\n')
}

// src/host/team/member-name.ts
//
// Team 成员名派生（纯函数）：把画布节点 id 确定性地映射为官方 teammate 名。
//
// 官方约束（运行时事实，不可放宽）：
//   - 名字必须匹配 /^[a-z0-9]+(?:-[a-z0-9]+)*$/（小写字母数字，单词间单个短横线）；
//   - 长度不超过 64 字符；
//   - 不得为 "lead"（该名保留给 Lead 伪行）。
//   - 名字在同一团队内**永久不可复用**，因此派生必须稳定：同一节点 id 恒得同名。
//
// 派生策略：可安全直用的节点 id（已小写、已符合形状、加前缀后不超长）直接加前缀；
// 其余（含大写、非常规字符、超长、空串）走确定性强散列，保证形状合法且无大小写折叠
// 造成的碰撞——大小写不同的两个 id 不会映射为同一个名字。

/** 名字前缀：与节点 id 区分，且天然避开保留名 "lead"。 */
const NAME_PREFIX = 'm-'

/** 官方名字长度上限。 */
export const TEAM_MEMBER_NAME_MAX_LENGTH = 64

/** 官方名字形状（与官方校验同源语义；本模块只做本地前置校验）。 */
const TEAM_MEMBER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** 保留名（官方 Lead 伪行）。 */
const RESERVED_LEAD_NAME = 'lead'

/** FNV-1a 32 位散列 → base36（确定性、无随机源、无依赖）。 */
function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/**
 * 节点 id → teammate 名（确定性纯函数）。
 *
 * @param nodeId - 画布角色节点 id。
 * @returns 满足官方约束的成员名；同一 nodeId 恒返回同名。
 */
export function teammateNameOf(nodeId: unknown): string {
  const raw = String(nodeId ?? '').trim()
  const direct = raw.length > 0
    && raw === raw.toLowerCase()
    && raw !== RESERVED_LEAD_NAME
    && raw.length + NAME_PREFIX.length <= TEAM_MEMBER_NAME_MAX_LENGTH
    && TEAM_MEMBER_NAME_PATTERN.test(raw)
  return direct ? `${NAME_PREFIX}${raw}` : `${NAME_PREFIX}${stableHash(raw)}`
}

/** 名字是否满足官方约束（本地前置校验；官方仍会二次校验）。 */
export function isTeammateNameValid(name: unknown): boolean {
  const value = String(name ?? '')
  return value.length > 0
    && value.length <= TEAM_MEMBER_NAME_MAX_LENGTH
    && value !== RESERVED_LEAD_NAME
    && TEAM_MEMBER_NAME_PATTERN.test(value)
}

/** 职责简述上限（官方 description 校验）。 */
export const TEAM_MEMBER_DESCRIPTION_MAX_LENGTH = 200

/**
 * 成员职责简述：取角色名，超长按官方上限截断。
 * 为什么用角色名作 description：官方把它作为成员行的可读职责，且不参与名字唯一性。
 */
export function teammateDescriptionOf(label: unknown, nodeId: unknown): string {
  const text = String(label ?? '').trim() || String(nodeId ?? '').trim() || 'teammate'
  return text.length <= TEAM_MEMBER_DESCRIPTION_MAX_LENGTH
    ? text
    : text.slice(0, TEAM_MEMBER_DESCRIPTION_MAX_LENGTH)
}

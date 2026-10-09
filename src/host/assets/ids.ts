// src/host/assets/ids.ts
//
// 资产库 id 生成：全部为纯函数（随机源与计数器经参数注入），
// 便于测试用固定随机源得到确定的 id 与版本行 id。

/** 随机源：返回 [0, 1) 区间浮点数（缺省 Math.random）。 */
export type RandomSource = () => number

/** id 生成依赖（可注入，测试确定化）。 */
export interface IdGeneratorDeps {
  /** 随机源（缺省 Math.random）；返回 [0, 1) 区间浮点数。 */
  random?: RandomSource
  /** 单调序号（缺省自增计数器；跨进程不保证唯一，故与随机源共同参与）。 */
  sequence?: () => number
}

/** 角色资产逻辑 id 前缀（跨版本不变的身份标识）。 */
export const ROLE_ASSET_ID_PREFIX = 'role-'

/** 工作流资产逻辑 id 前缀。 */
export const WORKFLOW_ASSET_ID_PREFIX = 'flow-'

/** 经验 id 前缀。 */
export const EXPERIENCE_ID_PREFIX = 'ex-'

/**
 * 经验使用事实行 id 前缀。
 * 为什么与经验 id 用不同前缀：使用/评价行是同一条经验的多条历史事实，混用前缀会让磁盘上
 * 无法一眼区分「经验本体」与「它的第 N 次使用」，排障时必须回表才能分辨。
 */
export const EXPERIENCE_USAGE_ID_PREFIX = 'xus-'

/** 经验评价事实行 id 前缀。 */
export const EXPERIENCE_EVALUATION_ID_PREFIX = 'xev-'

/** 新建角色资产逻辑 id（`role-` 前缀）。 */
export function newRoleAssetId(deps: IdGeneratorDeps = {}): string {
  return `${ROLE_ASSET_ID_PREFIX}${newToken(deps)}`
}

/** 新建工作流资产逻辑 id（`flow-` 前缀）。 */
export function newWorkflowAssetId(deps: IdGeneratorDeps = {}): string {
  return `${WORKFLOW_ASSET_ID_PREFIX}${newToken(deps)}`
}

/** 新建经验 id（`ex-` 前缀）。 */
export function newExperienceId(deps: IdGeneratorDeps = {}): string {
  return `${EXPERIENCE_ID_PREFIX}${newToken(deps)}`
}

/** 新建经验使用事实行 id（`xus-` 前缀；由资产库在写入事务内发号）。 */
export function newExperienceUsageId(deps: IdGeneratorDeps = {}): string {
  return `${EXPERIENCE_USAGE_ID_PREFIX}${newToken(deps)}`
}

/** 新建经验评价事实行 id（`xev-` 前缀；由资产库在写入事务内发号）。 */
export function newExperienceEvaluationId(deps: IdGeneratorDeps = {}): string {
  return `${EXPERIENCE_EVALUATION_ID_PREFIX}${newToken(deps)}`
}

/**
 * 版本行 id：`<asset_id>@<version_id>`。
 * 工作流版本行按此 id 反向引用角色版本行，因此格式是对外契约的一部分。
 */
export function versionRowId(assetId: string, versionId: number): string {
  return `${assetId}@${versionId}`
}

/** 递增计数器：进程内保证同毫秒多次生成不撞（跨进程由随机段兜底）。 */
let sequenceCounter = 0

/**
 * 短标识：由「进程内序号 + 随机段」组成，不掺入时间戳。
 * 为什么排除时间戳：id 会出现在 UI 与测试断言里，可读且可复现优先；唯一性由
 * 序号与随机段共同保证。注入 `sequence` 时得到 `role-1`、`role-2` 这类完全确定的 id；
 * 随机段用十六进制补零到固定宽度，避免与序号拼接时产生歧义。
 *
 * 随机段宽度为什么是 8 位十六进制（32 位）：序号只在**单次进程**内单调，进程重启后从 1
 * 重新开始，因此跨重启的同一序号位必须靠随机段区分。4 位（16 位随机）在「每次启动都入库」
 * 的长期使用下会出现可观测的撞号概率（撞号表现为 SQLite 主键冲突，用户只会看到入库失败），
 * 32 位随机把它压到可忽略量级。
 */
function newToken(deps: IdGeneratorDeps): string {
  const sequence = deps.sequence ?? (() => (sequenceCounter += 1))
  const random = deps.random ?? Math.random
  const suffix = Math.floor(random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, '0')
  return `${sequence().toString(36)}-${suffix}`
}

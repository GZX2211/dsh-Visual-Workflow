// src/client/lib/experience-stats.ts
//
// 经验长期统计的展示投影（文档 §34 / §14）：把 Host 由评价历史聚合出的统计事实翻译成只读文本。
//
// 为什么单独成层：精度口径（计数取整 / 比率两位小数）与「统计行缺失」的降级语义属于 Client 的
// 展示规则，与 DOM 无关；放在 lib 里可以脱离渲染被确定性验证，组件只负责摆放。
//
// 为什么缺失时整块降级而**不逐项补 0**：0 是「没有负向效果」「没有被使用过」这类真实断言，
// 与「还没有统计」不是同一个事实（共享契约里 stats 可选，读侧按中性语义解释）。
// 同理，任一项不是有限数视为形状漂移：半截统计会让人把未知读成已知。

import type { ExperienceStatsValues } from '../../host/shared/asset-types.js'

/**
 * 属性栏展示的六项统计及其顺序（文档 §34）。
 * 取值键直接来自共享契约，`satisfies` 在编译期保证字段确实存在：契约改名时此处报错，
 * 而不是静默读成 undefined 后把「未知」显示成某个数。
 */
export const EXPERIENCE_STAT_FIELDS = ['trust', 'empiricalValue', 'evidenceStrength', 'stability', 'usedCount', 'harmRate'] as const satisfies readonly (keyof ExperienceStatsValues)[]

export type ExperienceStatField = (typeof EXPERIENCE_STAT_FIELDS)[number]

/** 只读统计行：field 供词典取标签，text 为已格式化的数值文本。 */
export interface ExperienceStatRow {
  field: ExperienceStatField
  text: string
}

/** 使用次数是计数值，按整数展示；其余四项是 [0,1] / [-1,1] 的比率，统一两位小数。 */
function statText(field: ExperienceStatField, value: number): string {
  return field === 'usedCount' ? String(Math.round(value)) : value.toFixed(2)
}

/** 统计行投影：stats 缺失或任一项不是有限数时返回 null（界面显示「暂无统计」）。 */
export function experienceStatRowsOf(stats: unknown): readonly ExperienceStatRow[] | null {
  if (typeof stats !== 'object' || stats === null) return null
  const record = stats as Partial<Record<ExperienceStatField, unknown>>
  const rows: ExperienceStatRow[] = []
  for (const field of EXPERIENCE_STAT_FIELDS) {
    const value = record[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    rows.push({ field, text: statText(field, value) })
  }
  return rows
}

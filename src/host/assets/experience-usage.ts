// src/host/assets/experience-usage.ts
//
// 使用事实（experience_usage）的写入与准入判据：批量记录「经验被显式注入 agent 上下文」，
// 并按主体 + 经验类型回答「这条经验是否被注入过」。
//
// 为什么使用事实与统计计数落在同一笔事务：recalled_count 的事实来源就是本表，拆成两笔事务会
// 出现「使用行已写、计数没涨」的中间态；重建虽能修复，但期间召回排序已经在用错的信任值。
//
// 本文件只写不读改历史（没有 UPDATE / DELETE 路径）：使用事实写入即终态。

import type { ExperienceType, ExperienceUsageInsert, ExperienceUsageRecordInput } from "../shared/asset-types.js"
import { sqlPlaceholders } from "./db.js"
import { experienceNotFound } from "./errors.js"
import { readExistingExperienceIds, type ExperiencePortContext } from "./experiences.js"
import { createNeutralStatsRow, incrementRecalledCount, statsRowExists } from "./experience-stats.js"
import { newExperienceUsageId } from "./ids.js"
import { requireExperienceText, uniqueFilledIds } from "./role-check.js"

/** 记录一批使用事实：逐条插入使用行，并对涉及的经验累加被注入次数。 */
export function recordUsageRows(
  ctx: ExperiencePortContext,
  input: ExperienceUsageRecordInput,
): { recorded: number } {
  if (input.rows.length === 0) return { recorded: 0 }
  const facts = input.rows.map(normalizeUsageRow)
  const existing = readExistingExperienceIds(
    ctx.tx,
    facts.map((fact) => fact.experienceId),
  )
  const missing = uniqueFilledIds(facts.map((fact) => fact.experienceId)).filter((id) => !existing.has(id))
  if (missing.length > 0) throw experienceNotFound(missing.join("、"))

  const batchCounts = new Map<string, number>()
  for (const fact of facts) {
    ctx.tx.run("INSERT INTO experience_usage (id, experience_id, run_id, subject_id, created_at) VALUES (?, ?, ?, ?, ?)", [
      newExperienceUsageId(ctx.ids),
      fact.experienceId,
      fact.runId,
      fact.subjectId,
      ctx.now(),
    ])
    batchCounts.set(fact.experienceId, (batchCounts.get(fact.experienceId) ?? 0) + 1)
  }

  for (const [experienceId, count] of batchCounts) {
    // 已存在的统计行只涨计数（并刷新记账时间）：其余统计数值列由评价路径维护，使用事实不该改写它们
    if (statsRowExists(ctx, experienceId)) incrementRecalledCount(ctx, experienceId, count, ctx.now())
    else createNeutralStatsRow(ctx, experienceId, input.neutralStats, count, ctx.now())
  }
  return { recorded: facts.length }
}

/**
 * 该主体在给定经验类型下「已被显式注入」的经验 id（feedback 准入判据）。
 *
 * 为什么要连经验表：使用事实只记 id，而「是否属于该类型」是经验行上的事实；
 * 类型不匹配的 id 必须被排除，否则跨类型评价会污染另一类主体的长期统计（§29）。
 * 返回顺序与去重口径跟入参一致：调用方按它逐条判定准入，顺序变化会让结果难以复现。
 */
export function readInjectedExperienceIds(
  ctx: ExperiencePortContext,
  input: { subjectId: string; experienceType: ExperienceType; experienceIds: string[] },
): string[] {
  const wanted = uniqueFilledIds(input.experienceIds)
  const subjectId = typeof input.subjectId === "string" ? input.subjectId : ""
  // 空主体没有任何使用事实：主体身份由域层解析得出，空串不指向任何主体
  if (wanted.length === 0 || subjectId === "") return []
  const rows = ctx.tx.all(
    `SELECT DISTINCT u.experience_id AS experience_id
       FROM experience_usage u
       JOIN experiences e ON e.id = u.experience_id
      WHERE u.subject_id = ? AND e.experience_type = ? AND u.experience_id IN (${sqlPlaceholders(wanted)})`,
    [subjectId, input.experienceType, ...wanted],
  )
  const injected = new Set(rows.map((row) => String(row.experience_id ?? "")))
  return wanted.filter((id) => injected.has(id))
}

/**
 * 使用事实归一。
 * `runId` 允许空串（无运行来源是显式事实，与经验 provenance 同口径）；
 * 经验 id 与主体身份必须非空，否则这行事实既无法归属也无法被准入判据使用。
 */
function normalizeUsageRow(row: ExperienceUsageInsert): ExperienceUsageInsert {
  return {
    experienceId: requireExperienceText(row.experienceId, "experience_usage.experience_id"),
    runId: typeof row.runId === "string" ? row.runId : "",
    subjectId: requireExperienceText(row.subjectId, "experience_usage.subject_id"),
  }
}

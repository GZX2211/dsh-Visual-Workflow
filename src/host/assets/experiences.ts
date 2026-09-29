// src/host/assets/experiences.ts
//
// 经验的写读端口：插入（含 insight 去重跳过）、列表与索引查询、详情查询、
// 可编辑字段就地更新、以及「活跃 / 已归档」状态切换。
//
// 去重语义（用户裁决）：同一 task_type 下 insight 全等即视为重复——复盘在相似任务上
// 反复产出的同一句话不构成新知识，重复入库只污染召回结果，故跳过并回传原因。
// 匹配只按 task_type + insight，不看 evidence/task_context：同一句经验在不同上下文
// 中出现仍是同一知识。
//
// 状态语义（用户裁决）：经验**没有版本控制**，只有 is_active 两态；归档 = 退出父代理
// 召回面（索引查询按 is_active 过滤），内容全部保留；置回活跃即重新进入召回面。
// 因此本端口不提供任何版本的增删与回滚入口。

import type { ExperienceDraft, ExperienceEntry, ExperienceIndexEntry, ExperiencePatch } from '../shared/asset-types.js'
import type { AssetTxContext } from './db.js'
import { experienceBadArgs, experienceNotFound } from './errors.js'
import { newExperienceId, type IdGeneratorDeps } from './ids.js'
import { requireAssetId, toInteger, toNullableText } from './role-check.js'

/** 经验列表/索引查询的默认上限保护（避免无上限全表拉取；界面列表与召回索引共用）。 */
export const EXPERIENCE_INDEX_MAX_LIMIT = 1000

/** 端口运行环境：时钟与 id 生成由 AssetStore 注入。 */
export interface ExperiencePortContext {
  tx: AssetTxContext
  now: () => number
  ids: IdGeneratorDeps
}

/** 批量插入结果（skipped 回传原因，便于调用方区分「空字段」与「重复」）。 */
export interface ExperienceInsertResult {
  inserted: ExperienceEntry[]
  skipped: Array<{ insight: string; reason: string }>
}

/** 单条经验行插入（列顺序与 DDL 一致；返回经验 id）。 */
export function insertExperienceRow(ctx: ExperiencePortContext, draft: ExperienceDraft, reviewedAt: number): string {
  const id = newExperienceId(ctx.ids)
  const now = ctx.now()
  ctx.tx.run(
    `INSERT INTO experiences (
       id, source_run_id, reflection_prompt_version, task_type, task_context, insight, evidence,
       review_feedback, reviewed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      draft.sourceRunId ?? null,
      '1',
      draft.taskType,
      draft.taskContext,
      draft.insight,
      draft.evidence ?? null,
      null,
      reviewedAt,
      now,
      now,
    ],
  )
  return id
}

/**
 * 批量插入（算法 I）：逐条判空与判重，跳过的回传原因，入库的读回完整条目。
 * 批内去重同样生效：同一批里出现两条相同 task_type + insight 时只入库第一条。
 */
export function insertExperienceDrafts(
  ctx: ExperiencePortContext,
  drafts: ExperienceDraft[],
  reviewedAt: number,
): ExperienceInsertResult {
  const inserted: ExperienceEntry[] = []
  const skipped: Array<{ insight: string; reason: string }> = []
  const insertedKeys = new Set<string>()
  const insertedIds: string[] = []
  for (const draft of drafts) {
    const insight = typeof draft.insight === 'string' ? draft.insight : ''
    const missing = emptyFieldReason(draft)
    if (missing) {
      skipped.push({ insight, reason: missing })
      continue
    }
    const key = `${draft.taskType}\u0000${draft.insight}`
    if (insertedKeys.has(key) || experienceExists(ctx.tx, draft.taskType, draft.insight)) {
      skipped.push({
        insight,
        reason: `同 task_type 下已存在相同 insight（${draft.taskType}）：重复经验已跳过`,
      })
      continue
    }
    insertedKeys.add(key)
    insertedIds.push(insertExperienceRow(ctx, draft, reviewedAt))
  }
  if (insertedIds.length > 0) inserted.push(...readExperiencesByIds(ctx.tx, insertedIds))
  return { inserted, skipped }
}

/** 已存在同 task_type + insight 的经验（去重判据）。 */
export function experienceExists(ctx: AssetTxContext, taskType: string, insight: string): boolean {
  const row = ctx.get('SELECT 1 AS present FROM experiences WHERE task_type = ? AND insight = ? LIMIT 1', [
    taskType,
    insight,
  ])
  return row !== null
}

/** 上限归一化（无效/非正数 → 0 表示不查；超上限截断）。 */
function boundedLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 0), EXPERIENCE_INDEX_MAX_LIMIT) : 0
}

/**
 * 索引查询（召回面：只取活跃经验；按 created_at 倒序；id 升序兜底保证同毫秒写入的顺序确定）。
 * 归档过滤留在本查询内，而不是交给调用方各自过滤：召回面的定义只允许一处，
 * 两处各判一次必然在「归档经验还算不算可召回」上分叉。
 */
export function listExperienceIndexRows(ctx: AssetTxContext, limit: number): ExperienceIndexEntry[] {
  const bounded = boundedLimit(limit)
  if (bounded === 0) return []
  const rows = ctx.all(
    'SELECT id, task_context FROM experiences WHERE is_active = 1 ORDER BY created_at DESC, id ASC LIMIT ?',
    [bounded],
  )
  return rows.map((row) => ({ id: String(row.id ?? ''), taskContext: String(row.task_context ?? '') }))
}

/**
 * 经验列表（界面数据源：活跃与已归档一并返回，条目自带 active 标记）。
 *
 * 为什么不像资产那样拆成两份列表：资产拆分的理由是「活跃列表即父代理召回面」，
 * 分开返回让召回面在类型上可见；经验的召回面是 listExperienceIndexRows（另一条查询），
 * 界面列表只服务管理操作，拆两份反而要在两处各判一次状态。
 */
export function listExperienceRows(ctx: AssetTxContext, limit: number): ExperienceEntry[] {
  const bounded = boundedLimit(limit)
  if (bounded === 0) return []
  const rows = ctx.all('SELECT * FROM experiences ORDER BY created_at DESC, id ASC LIMIT ?', [bounded])
  return rows.map(experienceRowToEntry)
}

/** 单条经验（无匹配返回 null）。 */
export function readExperienceRow(ctx: AssetTxContext, id: string): ExperienceEntry | null {
  const row = ctx.get('SELECT * FROM experiences WHERE id = ?', [id])
  return row ? experienceRowToEntry(row) : null
}

/**
 * 就地更新可编辑字段（无版本语义：不产生历史行，只刷新 updated_at）。
 *
 * `undefined` = 本次不改，`null` = 清空：两者语义不同，因此不能用 `??` 合并——
 * 否则「清空证据」会被当成「不改证据」而静默失败。
 * 必填字段（task_type / task_context / insight）被清空即拒绝：经验没有版本，
 * 改坏了无从回滚，宁可让用户看到可行动的错误。
 */
export function updateExperienceRow(ctx: ExperiencePortContext, id: string, patch: ExperiencePatch): ExperienceEntry {
  const current = readExperienceRow(ctx.tx, id)
  if (!current) throw experienceNotFound(id)
  const next = {
    taskType: patch.taskType === undefined ? current.taskType : String(patch.taskType),
    taskContext: patch.taskContext === undefined ? current.taskContext : String(patch.taskContext),
    insight: patch.insight === undefined ? current.insight : String(patch.insight),
    evidence: patch.evidence === undefined ? (current.evidence ?? null) : (patch.evidence ?? null),
    reviewFeedback: patch.reviewFeedback === undefined ? (current.reviewFeedback ?? null) : (patch.reviewFeedback ?? null),
  }
  const missing = requiredFieldNames(next)
  if (missing.length > 0) throw experienceBadArgs(`经验必填字段不能为空：${missing.join('/')}（经验没有版本，清空后无法回滚）`)
  ctx.tx.run(
    `UPDATE experiences
        SET task_type = ?, task_context = ?, insight = ?, evidence = ?, review_feedback = ?, updated_at = ?
      WHERE id = ?`,
    [next.taskType, next.taskContext, next.insight, next.evidence, next.reviewFeedback, ctx.now(), id],
  )
  const updated = readExperienceRow(ctx.tx, id)
  if (!updated) throw experienceNotFound(id)
  return updated
}

/**
 * 状态切换（归档 / 恢复）：只改 is_active 与 updated_at，内容字段一律不动。
 * 返回切换后的条目；id 不存在抛「经验不存在」。
 */
export function setExperienceActiveRow(ctx: ExperiencePortContext, id: string, active: boolean): ExperienceEntry {
  const current = readExperienceRow(ctx.tx, id)
  if (!current) throw experienceNotFound(id)
  ctx.tx.run('UPDATE experiences SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, ctx.now(), id])
  const updated = readExperienceRow(ctx.tx, id)
  if (!updated) throw experienceNotFound(id)
  return updated
}

/**
 * 详情查询（保持入参顺序，命中不到的略过）。
 * `activeOnly` = 召回面语义：已归档经验不得被父代理召回（目录按 id 召回时同样过滤），
 * 因此归档 id 表现为「查不到」而不是「返回归档内容」。
 */
export function readExperiencesByIds(
  ctx: AssetTxContext,
  ids: string[],
  options?: { activeOnly?: boolean },
): ExperienceEntry[] {
  // 重复 id 不去重：SQL IN 本身按集合语义取值，再由 map 按入参顺序取回即可
  const wanted = ids.filter((id) => typeof id === 'string' && id !== '')
  if (wanted.length === 0) return []
  const placeholders = wanted.map(() => '?').join(', ')
  const rows = ctx.all(
    `SELECT * FROM experiences WHERE id IN (${placeholders})${options?.activeOnly === true ? ' AND is_active = 1' : ''}`,
    wanted,
  )
  const byId = new Map(rows.map((row) => [String(row.id ?? ''), experienceRowToEntry(row)]))
  return wanted.map((id) => byId.get(id)).filter((entry): entry is ExperienceEntry => entry !== undefined)
}

/**
 * 行 → 经验条目（可空列读成 undefined，与共享契约一致）。
 * is_active 读成显式两态：列缺失或非 0 一律视为活跃（与 DDL 默认值 1 同口径）。
 */
function experienceRowToEntry(row: Record<string, unknown>): ExperienceEntry {
  const sourceRunId = toNullableText(row.source_run_id)
  const evidence = toNullableText(row.evidence)
  const reviewFeedback = toNullableText(row.review_feedback)
  const reviewedAt = row.reviewed_at === null || row.reviewed_at === undefined ? null : toInteger(row.reviewed_at, 0)
  return {
    id: requireAssetId(row.id, 'experiences.id'),
    active: toInteger(row.is_active, 1) !== 0,
    ...(sourceRunId ? { sourceRunId } : {}),
    reflectionPromptVersion: toNullableText(row.reflection_prompt_version) ?? '1',
    taskType: String(row.task_type ?? ''),
    taskContext: String(row.task_context ?? ''),
    insight: String(row.insight ?? ''),
    ...(evidence ? { evidence } : {}),
    ...(reviewFeedback ? { reviewFeedback } : {}),
    ...(reviewedAt === null ? {} : { reviewedAt }),
    createdAt: toInteger(row.created_at, 0),
    updatedAt: toInteger(row.updated_at, 0),
  }
}

/** 空字段判定（trim 后为空即视为未提供）。 */
export function emptyFieldReason(draft: ExperienceDraft): string | null {
  const missing = requiredFieldNames(draft)
  if (missing.length === 0) return null
  return `缺少必填字段 ${missing.join('/')}：经验未入库`
}

/** 必填字段清单（插入与更新共用同一份判定，避免两处口径分叉）。 */
function requiredFieldNames(fields: { taskType: string; taskContext: string; insight: string }): string[] {
  const missing: string[] = []
  if (!isFilled(fields.insight)) missing.push('insight')
  if (!isFilled(fields.taskType)) missing.push('taskType')
  if (!isFilled(fields.taskContext)) missing.push('taskContext')
  return missing
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

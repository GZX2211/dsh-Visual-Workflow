// src/host/assets/experiences.ts
//
// 经验表的写读端口：批量判重写入、界面列表与按 id 召回、活跃向量读盘、状态切换、
// 编辑保存（语义字段 + 检索投影 + 向量一起重算）。
//
// 事务边界（硬约束）：检索文本与向量可能在事务外走远程嵌入端点或首次加载本地模型，
// 因此「算」与「写」分开——调用方在事务外算好随行传入，本文件只在**一笔事务**内
// 读完活跃行、判重、写入，任何一步失败整批回滚（不留半条）。
//
// 判重算法由经验域以闭包注入：阈值与向量来源属经验域，而「读活跃行 → 判定 → 写入」
// 必须原子，两者只能由事务边界缝合，因此本文件不实现任何相似度。
//
// 判重的比较面只含**同主体类型的活跃行**：归档即退出召回面，它与新经验是否重复
// 已不影响召回结果；不同主体类型共享同一句表述也各自成立，不构成重复。

import type {
  ExperienceDuplicateVerdict,
  ExperienceEntry,
  ExperienceInsertCheckedInput,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRetrievalUpdate,
  ExperienceType,
} from "../shared/asset-types.js"
import type { AssetTxContext } from "./db.js"
import { encodeEmbedding } from "./embedding-blob.js"
import { asExperienceType, decodeRowEmbeddings, experienceRowToEntry, toJsonArray } from "./experience-codec.js"
import { experienceBadArgs, experienceNotFound } from "./errors.js"
import type { IdGeneratorDeps } from "./ids.js"
import { requireAssetId, toNullableInteger, toOptionalText } from "./role-check.js"

/**
 * 界面经验列表一次最多返回的条数。
 * 为什么需要上限：列表服务于人工管理，不做无上限全表拉取；召回面另有向量读端口，
 * 两者上限语义不同，不可共用一个常量。
 */
export const EXPERIENCE_LIST_MAX_LIMIT = 1000

/** 端口运行环境：时钟与 id 生成由 AssetStore 注入（测试可确定化）。 */
export interface ExperiencePortContext {
  tx: AssetTxContext
  now: () => number
  ids: IdGeneratorDeps
}

/**
 * 批量判重写入结果。
 * `skipped` 同时回传原因与决策侧检索文本，使调用方能区分「字段缺失」与「重复」；
 * 重复时附带对上的既有行 id，便于界面直接跳转。
 */
export interface ExperienceInsertCheckedResult {
  inserted: ExperienceEntry[]
  skipped: Array<{ reason: string; experienceId?: string; decisionRetrievalText: string }>
}

/**
 * 活跃向量读盘结果（召回输入）。
 * 双通道同时返回：召回要对任务侧与决策侧各取 topK 再合并，两条向量本来就在同一行，
 * 一次读盘即可，拆成两次查询只会多一遍全表扫描。
 */
export interface ExperienceEmbeddingRow {
  id: string
  taskRetrievalText: string
  taskEmbedding: Float64Array
  decisionRetrievalText: string
  decisionEmbedding: Float64Array
}

/** 判重比较的既有行事实（库中活跃行或本批已写入行）。 */
interface ExistingEmbeddingFact {
  id: string
  decisionEmbedding: Float64Array
  decisionRetrievalText: string
}

/** 批量判重写入（调用方需已在本函数所在事务之外算好向量）。 */
export function insertExperienceRowsChecked(
  ctx: ExperiencePortContext,
  input: ExperienceInsertCheckedInput,
): ExperienceInsertCheckedResult {
  const insertedIds: string[] = []
  const skipped: ExperienceInsertCheckedResult["skipped"] = []
  // 每个主体类型的活跃行只读一次：批内多条同类型经验复用同一份判重比较面
  const existingByType = new Map<ExperienceType, ExistingEmbeddingFact[]>()

  for (const row of input.rows) {
    const decisionRetrievalText = String(row.decisionRetrievalText ?? "")
    const missing = missingRowFields(row)
    if (missing.length > 0) {
      skipped.push({ reason: `缺少必填字段 ${missing.join("/")}：经验未入库`, decisionRetrievalText })
      continue
    }

    const experienceType = asExperienceType(row.experienceType)
    // 先编码：非有限数值在这里被拒绝，整批随之回滚（不会留下半条经验）
    const taskBytes = encodeEmbedding(row.taskEmbedding)
    const decisionBytes = encodeEmbedding(row.decisionEmbedding)
    if (decisionBytes) {
      const existing = existingFactsOf(ctx.tx, existingByType, experienceType)
      const duplicated = firstDuplicate(input, experienceType, row.decisionEmbedding, decisionRetrievalText, existing)
      if (duplicated) {
        skipped.push({ ...duplicated, decisionRetrievalText })
        continue
      }
    }

    const id = requireAssetId(row.id, "id")
    insertExperienceRow(ctx, row, id, taskBytes, decisionBytes)
    insertedIds.push(id)
    // 本批已写入的行立即进入比较面：同一批里重复的候选只入库第一条
    if (decisionBytes) {
      existingFactsOf(ctx.tx, existingByType, experienceType).push({
        id,
        decisionEmbedding: row.decisionEmbedding,
        decisionRetrievalText,
      })
    }
  }

  return { inserted: insertedIds.length > 0 ? readExperiencesByIds(ctx.tx, insertedIds) : [], skipped }
}

/** 界面经验列表（活跃与归档一并返回；条目自带 active 标记）。 */
export function listExperienceRows(ctx: AssetTxContext, limit: number): ExperienceEntry[] {
  const bounded = boundedListLimit(limit)
  if (bounded === 0) return []
  const rows = ctx.all("SELECT * FROM experiences ORDER BY created_at DESC, id ASC LIMIT ?", [bounded])
  return rows.map(experienceRowToEntry)
}

/** 单条经验（无匹配返回 null）。 */
export function readExperienceRow(ctx: AssetTxContext, id: string): ExperienceEntry | null {
  const row = ctx.get("SELECT * FROM experiences WHERE id = ?", [id])
  return row ? experienceRowToEntry(row) : null
}

/**
 * 按 id 读经验（保持入参顺序，命中不到的略过）。
 * `activeOnly` = 召回面语义：归档经验不得被召回，因此表现为「查不到」而不是返回内容。
 */
export function readExperiencesByIds(
  ctx: AssetTxContext,
  ids: string[],
  options?: { activeOnly?: boolean },
): ExperienceEntry[] {
  // 重复 id 不去重：SQL IN 本身按集合取值，再按入参顺序回填即可
  const wanted = ids.filter((id) => typeof id === "string" && id !== "")
  if (wanted.length === 0) return []
  const placeholders = wanted.map(() => "?").join(", ")
  const rows = ctx.all(
    `SELECT * FROM experiences WHERE id IN (${placeholders})${options?.activeOnly === true ? " AND is_active = 1" : ""}`,
    wanted,
  )
  const byId = new Map(rows.map((row) => [String(row.id ?? ""), experienceRowToEntry(row)]))
  return wanted.map((id) => byId.get(id)).filter((entry): entry is ExperienceEntry => entry !== undefined)
}

/**
 * 某主体类型的活跃向量（召回输入）。
 * 双通道缺一即跳过该行：召回要两侧都能算分，只有一条向量的行无法参与合并，
 * 与其在半程报错，不如从读盘起就把它排除（损坏数据只让该行失去语义召回能力）。
 */
export function listActiveExperienceEmbeddingRows(
  ctx: AssetTxContext,
  type: ExperienceType,
): ExperienceEmbeddingRow[] {
  const rows = ctx.all(
    `SELECT id, task_retrieval_text, task_embedding, decision_retrieval_text, decision_embedding, embedding_dimension
       FROM experiences
      WHERE experience_type = ? AND is_active = 1
      ORDER BY created_at DESC, id ASC`,
    [type],
  )
  const result: ExperienceEmbeddingRow[] = []
  for (const row of rows) {
    const { taskEmbedding, decisionEmbedding } = decodeRowEmbeddings(row)
    if (!taskEmbedding || !decisionEmbedding) continue
    result.push({
      id: requireAssetId(row.id, "experiences.id"),
      taskRetrievalText: String(row.task_retrieval_text ?? ""),
      taskEmbedding,
      decisionRetrievalText: String(row.decision_retrieval_text ?? ""),
      decisionEmbedding,
    })
  }
  return result
}

/**
 * 状态切换（归档 / 恢复）：只改 is_active 与 updated_at，内容与检索投影一概不动。
 * 经验没有版本，归档是唯一的状态事实，因此这里也是状态写入的唯一入口。
 */
export function setExperienceActiveRow(ctx: ExperiencePortContext, id: string, active: boolean): ExperienceEntry {
  const current = readExperienceRow(ctx.tx, id)
  if (!current) throw experienceNotFound(id)
  ctx.tx.run("UPDATE experiences SET is_active = ?, updated_at = ? WHERE id = ?", [active ? 1 : 0, ctx.now(), id])
  const updated = readExperienceRow(ctx.tx, id)
  if (!updated) throw experienceNotFound(id)
  return updated
}

/**
 * 编辑保存：语义字段补丁 + 事务外算好的检索投影与向量一并写入，只刷新 updated_at。
 *
 * `undefined` = 本次不改，`null` = 清空：两者语义不同，因此不能用 `??` 合并——
 * 否则「清空排除条件」会被当成「不改排除条件」而静默失败。
 * 必填字符串字段被清空即拒绝：经验没有版本，改坏了无从回滚，宁可让用户看到可行动的错误。
 */
export function updateExperienceFieldsRow(
  ctx: ExperiencePortContext,
  id: string,
  patch: ExperiencePatch,
  next: ExperienceRetrievalUpdate,
): ExperienceEntry {
  const current = readExperienceRow(ctx.tx, id)
  if (!current) throw experienceNotFound(id)
  const merged = applyPatch(current, patch)
  const missing = requiredFieldNames(merged)
  if (missing.length > 0) {
    throw experienceBadArgs(`经验必填字段不能为空：${missing.join("/")}（经验没有版本，清空后无法回滚）`)
  }
  // 向量编码可能抛错，必须发生在写入之前：否则整笔事务要靠回滚来撤销半次更新
  const taskEmbedding = encodeEmbedding(next.taskEmbedding)
  const decisionEmbedding = encodeEmbedding(next.decisionEmbedding)
  ctx.tx.run(
    `UPDATE experiences
        SET responsibility = ?, task_type = ?, decision_domain = ?, situation = ?, trigger = ?,
            principle = ?, recommended_action = ?, exclusions = ?, evidence = ?,
            task_retrieval_text = ?, task_embedding = ?, decision_retrieval_text = ?, decision_embedding = ?,
            embedding_model = ?, embedding_dimension = ?, updated_at = ?
      WHERE id = ?`,
    [
      merged.responsibility,
      merged.taskType,
      merged.decisionDomain,
      merged.situation,
      merged.trigger,
      merged.principle,
      merged.recommendedAction,
      toJsonArray(merged.exclusions),
      toJsonArray(merged.evidence),
      String(next.taskRetrievalText ?? ""),
      taskEmbedding,
      String(next.decisionRetrievalText ?? ""),
      decisionEmbedding,
      toOptionalText(next.embeddingModel),
      toNullableInteger(next.embeddingDimension),
      ctx.now(),
      id,
    ],
  )
  const updated = readExperienceRow(ctx.tx, id)
  if (!updated) throw experienceNotFound(id)
  return updated
}

/** 单条经验行插入（列顺序与 DDL 一致）。 */
function insertExperienceRow(
  ctx: ExperiencePortContext,
  row: ExperienceInsertRow,
  id: string,
  taskEmbedding: Buffer | null,
  decisionEmbedding: Buffer | null,
): void {
  const now = ctx.now()
  ctx.tx.run(
    `INSERT INTO experiences (
       id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
       principle, recommended_action, exclusions, evidence,
       task_retrieval_text, task_embedding, decision_retrieval_text, decision_embedding,
       embedding_model, embedding_dimension, source_run_id,
       generation_prompt_id, generation_prompt_version, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      asExperienceType(row.experienceType),
      filledText(row.responsibility),
      filledText(row.taskType),
      filledText(row.decisionDomain),
      filledText(row.situation),
      filledText(row.trigger),
      filledText(row.principle),
      filledText(row.recommendedAction),
      toJsonArray(row.exclusions),
      toJsonArray(row.evidence),
      String(row.taskRetrievalText ?? ""),
      taskEmbedding,
      String(row.decisionRetrievalText ?? ""),
      decisionEmbedding,
      toOptionalText(row.embeddingModel),
      toNullableInteger(row.embeddingDimension),
      filledText(row.sourceRunId),
      filledText(row.generationPromptId),
      filledText(row.generationPromptVersion),
      now,
      now,
    ],
  )
}

/** 取某主体类型的活跃行比较面（首次访问时读盘并缓存，含本批已写入的行）。 */
function existingFactsOf(
  tx: AssetTxContext,
  cache: Map<ExperienceType, ExistingEmbeddingFact[]>,
  type: ExperienceType,
): ExistingEmbeddingFact[] {
  const cached = cache.get(type)
  if (cached) return cached
  const rows = tx.all(
    `SELECT id, decision_retrieval_text, decision_embedding, embedding_dimension
       FROM experiences
      WHERE experience_type = ? AND is_active = 1
      ORDER BY created_at DESC, id ASC`,
    [type],
  )
  const facts: ExistingEmbeddingFact[] = []
  for (const row of rows) {
    // 缺决策侧向量的行无法参与相似度判定，跳过即可（它仍留在库里，只是判重看不见它）
    const { decisionEmbedding } = decodeRowEmbeddings(row)
    if (!decisionEmbedding) continue
    facts.push({
      id: requireAssetId(row.id, "experiences.id"),
      decisionEmbedding,
      decisionRetrievalText: String(row.decision_retrieval_text ?? ""),
    })
  }
  cache.set(type, facts)
  return facts
}

/** 逐条调用注入的判重闭包，命中第一条即带上原因与对上的行 id。 */
function firstDuplicate(
  input: ExperienceInsertCheckedInput,
  experienceType: ExperienceType,
  decisionEmbedding: Float64Array,
  decisionRetrievalText: string,
  existing: ExistingEmbeddingFact[],
): { reason: string; experienceId: string } | null {
  for (const fact of existing) {
    const verdict: ExperienceDuplicateVerdict = input.duplicateOf(
      { experienceType, decisionEmbedding, decisionRetrievalText },
      { id: fact.id, decisionEmbedding: fact.decisionEmbedding, decisionRetrievalText: fact.decisionRetrievalText },
    )
    if (verdict.duplicate) return { reason: verdict.reason, experienceId: fact.id }
  }
  return null
}

/** 上限归一化（无效/非正数 → 0 表示不查；超上限截断而非报错）。 */
function boundedListLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 0), EXPERIENCE_LIST_MAX_LIMIT) : 0
}

/**
 * 必填字段判定（插入与更新共用同一份清单，避免两处口径分叉）。
 *
 * 生成 Prompt 的 id 与版本必须非空：没有它们就说不清这条经验按哪一版策略产出，事后无从审计。
 * `sourceRunId` 不在此清单内——该列 NOT NULL 但允许空串，而空串是「无运行来源」的显式事实：
 * 父代理未承担编排职责时确实没有 run（见经验域的主体解析），为凑必填而伪造 run id 会把
 * 「没有来源」写成「有来源」的假事实，反而破坏可追溯性。
 */
function missingRowFields(row: ExperienceInsertRow): string[] {
  const missing: string[] = []
  if (!isFilled(row.id)) missing.push("id")
  if (!isFilled(row.responsibility)) missing.push("responsibility")
  if (!isFilled(row.taskType)) missing.push("taskType")
  if (!isFilled(row.decisionDomain)) missing.push("decisionDomain")
  if (!isFilled(row.situation)) missing.push("situation")
  if (!isFilled(row.trigger)) missing.push("trigger")
  if (!isFilled(row.principle)) missing.push("principle")
  if (!isFilled(row.recommendedAction)) missing.push("recommendedAction")
  if (!isFilled(row.generationPromptId)) missing.push("generationPromptId")
  if (!isFilled(row.generationPromptVersion)) missing.push("generationPromptVersion")
  return missing
}

/** 补丁合并：`undefined` 保留原值，`null` 清空（数组清成空数组，字符串清成空串后由必填校验拒绝）。 */
function applyPatch(current: ExperienceEntry, patch: ExperiencePatch): ExperienceEntry {
  return {
    ...current,
    responsibility: patch.responsibility === undefined ? current.responsibility : filledText(patch.responsibility),
    taskType: patch.taskType === undefined ? current.taskType : filledText(patch.taskType),
    decisionDomain: patch.decisionDomain === undefined ? current.decisionDomain : filledText(patch.decisionDomain),
    situation: patch.situation === undefined ? current.situation : filledText(patch.situation),
    trigger: patch.trigger === undefined ? current.trigger : filledText(patch.trigger),
    principle: patch.principle === undefined ? current.principle : filledText(patch.principle),
    recommendedAction:
      patch.recommendedAction === undefined ? current.recommendedAction : filledText(patch.recommendedAction),
    exclusions: patch.exclusions === undefined ? current.exclusions : stringArrayOf(patch.exclusions),
    evidence: patch.evidence === undefined ? current.evidence : stringArrayOf(patch.evidence),
  }
}

/** 更新路径的必填字段清单（语义核心七项：清空其中任一都会让经验不再可读）。 */
function requiredFieldNames(fields: {
  responsibility: string
  taskType: string
  decisionDomain: string
  situation: string
  trigger: string
  principle: string
  recommendedAction: string
}): string[] {
  const missing: string[] = []
  if (!isFilled(fields.responsibility)) missing.push("responsibility")
  if (!isFilled(fields.taskType)) missing.push("taskType")
  if (!isFilled(fields.decisionDomain)) missing.push("decisionDomain")
  if (!isFilled(fields.situation)) missing.push("situation")
  if (!isFilled(fields.trigger)) missing.push("trigger")
  if (!isFilled(fields.principle)) missing.push("principle")
  if (!isFilled(fields.recommendedAction)) missing.push("recommendedAction")
  return missing
}

/** 运行时可能是 null 的数组字段归一（契约类型只声明 string[]，边界外的 null 表示清空）。 */
function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

/** 必填文本归一：入库前去掉首尾空白（同一事实不因空白差异读回成两个值）。 */
function filledText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isFilled(value: unknown): boolean {
  return filledText(value) !== ""
}

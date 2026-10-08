// src/host/experience/validation.ts
//
// 经验候选与保存补丁的协议校验（Schema + 运行时护栏）。
//
// 两个设计决定：
//   1) 未知字段一律拒绝并且不静默丢弃：模型按 Prompt 产出的候选一旦夹带旧协议字段，静默丢弃会让
//      模型以为字段已生效并持续产出无效候选；回报字段名才能让模型自我纠正，也避免「字段清单」
//      在工具层与域层各维护一份（模型侧 snake_case 与域内 camelCase 的写法在本文件内归一）。
//   2) 校验是纯函数且不触碰端口：同一份判定同时服务写入前的候选校验与保存补丁合并后的复核，
//      保证「新增时接受的内容」与「编辑后仍接受的内容」完全同规则。

import { WfError } from "../orchestrator/errors.js"
import type { ExperienceInsertDraft, ExperiencePatch, ExperienceType } from "../shared/asset-types.js"
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_VALIDATION } from "../shared/protocol.js"
import { EXPERIENCE_TYPES, FIELD_LIMITS, MAX_CANDIDATES_PER_CALL, isExperienceType, normalizeWhitespace } from "./constants.js"

/** 校验通过的经验语义核心（九个字段，已空白归一化）。 */
export interface ExperienceSemanticFields {
  responsibility: string
  taskType: string
  decisionDomain: string
  situation: string
  trigger: string
  principle: string
  recommendedAction: string
  exclusions: string[]
  evidence: string[]
}

/** 校验并归一化后的保存补丁：`patch` 交给持久化端口写入，`fields` 是合并后的完整语义核心。 */
export interface ValidatedExperiencePatch {
  patch: ExperiencePatch
  fields: ExperienceSemanticFields
}

/** 语义字段名（域内命名；模型侧 snake_case 写法在读取时归一到这里）。 */
type SemanticField = keyof ExperienceSemanticFields

/** 数组字段清单（协议事实：九个语义字段中只有这两个是字符串数组）。 */
const ARRAY_FIELD_NAMES = ["exclusions", "evidence"] as const
type ArrayField = (typeof ARRAY_FIELD_NAMES)[number]
type ScalarField = Exclude<SemanticField, ArrayField>

const ARRAY_FIELD_SET: ReadonlySet<string> = new Set<string>(ARRAY_FIELD_NAMES)

/** 是否为数组字段（缩窄用；字符串集合查表避免把类型判断写成两份）。 */
function isArrayField(field: SemanticField): field is ArrayField {
  return ARRAY_FIELD_SET.has(field)
}

/**
 * 九字段规格表（字段清单的唯一本体）：域内名 → 模型侧名与单字段上限。
 * 键为语义字段联合类型，少一个或多一个键都会编译失败。
 */
const FIELD_SPECS: Record<SemanticField, { alias: string; limit: number }> = {
  responsibility: { alias: "responsibility", limit: FIELD_LIMITS.responsibility },
  taskType: { alias: "task_type", limit: FIELD_LIMITS.taskType },
  decisionDomain: { alias: "decision_domain", limit: FIELD_LIMITS.decisionDomain },
  situation: { alias: "situation", limit: FIELD_LIMITS.situation },
  trigger: { alias: "trigger", limit: FIELD_LIMITS.trigger },
  principle: { alias: "principle", limit: FIELD_LIMITS.principle },
  recommendedAction: { alias: "recommended_action", limit: FIELD_LIMITS.recommendedAction },
  exclusions: { alias: "exclusions", limit: FIELD_LIMITS.arrayElement },
  evidence: { alias: "evidence", limit: FIELD_LIMITS.arrayElement },
}

type CanonicalField = SemanticField | "experienceType"

const EXPERIENCE_TYPE_FIELD_ALIAS = "experience_type"
const SEMANTIC_FIELDS = Object.keys(FIELD_SPECS) as SemanticField[]
const SCALAR_FIELDS: readonly ScalarField[] = SEMANTIC_FIELDS.filter((field): field is ScalarField => !isArrayField(field))
const ARRAY_FIELDS: readonly ArrayField[] = SEMANTIC_FIELDS.filter((field): field is ArrayField => isArrayField(field))
const SEMANTIC_FIELD_TEXT = SEMANTIC_FIELDS.map((field) => FIELD_SPECS[field].alias).join(" / ")
const ALLOWED_FIELD_TEXT = `${SEMANTIC_FIELD_TEXT}（可选写 ${EXPERIENCE_TYPE_FIELD_ALIAS}）`

/** 允许的键 → 域内字段名（同一字段的两种写法都接受，冲突时在读取阶段判歧义）。 */
const KEY_TO_FIELD = buildKeyToField()

function buildKeyToField(): Map<string, CanonicalField> {
  const map = new Map<string, CanonicalField>()
  for (const field of SEMANTIC_FIELDS) {
    map.set(field, field)
    map.set(FIELD_SPECS[field].alias, field)
  }
  map.set("experienceType", "experienceType")
  map.set(EXPERIENCE_TYPE_FIELD_ALIAS, "experienceType")
  return map
}

function invalid(message: string): WfError {
  return new WfError(message, ERR_EXPERIENCE_VALIDATION)
}

function badArgs(message: string): WfError {
  return new WfError(message, ERR_EXPERIENCE_BAD_ARGS)
}

/** 取值形态的可读描述（错误消息里必须让模型看清自己给的是什么）。 */
function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function requireScalarValue(value: unknown, field: ScalarField, where: string): string {
  const spec = FIELD_SPECS[field]
  if (typeof value !== "string") {
    throw invalid(`${where}的「${spec.alias}」必须是字符串（实际为 ${describeValue(value)}）：请改为文本后重新提交。`)
  }
  const text = normalizeWhitespace(value)
  if (!text) {
    throw invalid(`${where}的「${spec.alias}」为空白：必填文本不能为空，请补充实质内容后重新提交。`)
  }
  if (text.length > spec.limit) {
    throw invalid(`${where}的「${spec.alias}」长度 ${text.length} 超过上限 ${spec.limit}：请精简该字段后重新提交。`)
  }
  return text
}

function requireArrayValue(value: unknown, field: ArrayField, where: string): string[] {
  const spec = FIELD_SPECS[field]
  if (!Array.isArray(value)) {
    throw invalid(`${where}的「${spec.alias}」必须是字符串数组（实际为 ${describeValue(value)}）：请改为数组后重新提交。`)
  }
  if (value.length > FIELD_LIMITS.arrayLength) {
    throw invalid(`${where}的「${spec.alias}」有 ${value.length} 个元素，超过单数组上限 ${FIELD_LIMITS.arrayLength}：请合并或删减后重新提交。`)
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw invalid(`${where}的「${spec.alias}」第 ${index + 1} 个元素必须是字符串（实际为 ${describeValue(item)}）：请改为文本后重新提交。`)
    }
    const text = normalizeWhitespace(item)
    if (!text) {
      throw invalid(`${where}的「${spec.alias}」第 ${index + 1} 个元素为空白：请删除该元素或补充内容后重新提交。`)
    }
    if (text.length > spec.limit) {
      throw invalid(`${where}的「${spec.alias}」第 ${index + 1} 个元素长度 ${text.length} 超过上限 ${spec.limit}：请精简后重新提交。`)
    }
    return text
  })
}

/** 读取对象里的字段值，拒绝未知字段与同一字段的两种写法。 */
function readCanonicalValues(source: Record<string, unknown>, where: string, allowType: boolean): Map<CanonicalField, unknown> {
  const values = new Map<CanonicalField, unknown>()
  const seen = new Map<CanonicalField, string>()
  for (const [key, value] of Object.entries(source)) {
    const field = KEY_TO_FIELD.get(key)
    if (field === undefined || (!allowType && field === "experienceType")) {
      const allowed = allowType ? ALLOWED_FIELD_TEXT : SEMANTIC_FIELD_TEXT
      throw invalid(`${where}包含未知字段「${key}」：只允许 ${allowed}；请删除该字段后重新提交。`)
    }
    const previous = seen.get(field)
    if (previous !== undefined) {
      throw invalid(`${where}同时给出「${previous}」与「${key}」两种写法（同一字段）：请只保留一种写法后重新提交。`)
    }
    seen.set(field, key)
    values.set(field, value)
  }
  return values
}

/** 九字段护栏：必填存在、类型正确、空白归一化、单字段与单条总长上限。 */
function normalizeCore(values: Map<CanonicalField, unknown>, where: string): ExperienceSemanticFields {
  const readScalar = (field: ScalarField): string => {
    const value = values.get(field)
    if (value === undefined) throw missingField(field, where)
    return requireScalarValue(value, field, where)
  }
  const readArray = (field: ArrayField): string[] => {
    const value = values.get(field)
    if (value === undefined) throw missingField(field, where)
    return requireArrayValue(value, field, where)
  }
  const core: ExperienceSemanticFields = {
    responsibility: readScalar("responsibility"),
    taskType: readScalar("taskType"),
    decisionDomain: readScalar("decisionDomain"),
    situation: readScalar("situation"),
    trigger: readScalar("trigger"),
    principle: readScalar("principle"),
    recommendedAction: readScalar("recommendedAction"),
    exclusions: readArray("exclusions"),
    evidence: readArray("evidence"),
  }
  const total = SCALAR_FIELDS.reduce((sum, field) => sum + core[field].length, 0)
    + ARRAY_FIELDS.reduce((sum, field) => sum + core[field].reduce((count, item) => count + item.length, 0), 0)
  if (total > FIELD_LIMITS.total) {
    throw invalid(`${where}九个语义字段文本总长 ${total} 超过上限 ${FIELD_LIMITS.total}：请精简各字段后重新提交。`)
  }
  return core
}

function missingField(field: SemanticField, where: string): WfError {
  return invalid(`${where}缺少必填字段「${FIELD_SPECS[field].alias}」：请按 Prompt 补齐 ${SEMANTIC_FIELD_TEXT} 后重新提交。`)
}

/** 候选自带的类型声明必须与本次提交类型一致（类型由调用参数决定，模型不得伪造）。 */
function assertDeclaredType(values: Map<CanonicalField, unknown>, expectedType: ExperienceType, where: string): void {
  const declared = values.get("experienceType")
  if (declared === undefined) return
  if (!isExperienceType(declared)) {
    throw invalid(`${where}的 experience_type 取值非法（实际为 ${describeValue(declared)}）：只能是 ${EXPERIENCE_TYPES.join(" / ")}。`)
  }
  if (declared !== expectedType) {
    throw invalid(`${where}的 experience_type 为 ${declared}，与本次提交类型 ${expectedType} 不一致：类型由调用参数决定，请删除该字段或改为 ${expectedType}。`)
  }
}

/** 读取候选列表（接受数组本体或 { experiences: [...] } 包装）。 */
function readCandidateList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return assertCandidateCount(payload)
  if (typeof payload !== "object" || payload === null) {
    throw badArgs(`提交载荷必须是候选数组或 { experiences: [...] } 对象（实际为 ${describeValue(payload)}）：请按 wf_experience_learn 的入参协议重新提交。`)
  }
  const record = payload as Record<string, unknown>
  if (!Array.isArray(record.experiences)) {
    throw badArgs("载荷对象缺少 experiences 数组：请提交 { experiences: [...] } 或直接提交候选数组。")
  }
  for (const key of Object.keys(record)) {
    if (key !== "experiences") {
      throw invalid(`载荷顶层包含未知字段「${key}」：顶层只允许 experiences 字段，请删除该字段后重新提交。`)
    }
  }
  return assertCandidateCount(record.experiences)
}

function assertCandidateCount(candidates: unknown[]): unknown[] {
  if (candidates.length === 0) {
    throw badArgs("候选列表为空：若要获取当前主体的经验生成 Prompt，请调用 wf_experience_learn 并传空数组；若要入库，请至少提供 1 条候选。")
  }
  if (candidates.length > MAX_CANDIDATES_PER_CALL) {
    throw invalid(`单次最多提交 ${MAX_CANDIDATES_PER_CALL} 条候选（实际 ${candidates.length} 条）：请分批提交，每批不超过 ${MAX_CANDIDATES_PER_CALL} 条。`)
  }
  return candidates
}

/**
 * 校验并归一化模型提交的候选。
 *
 * 批内「九个语义字段完全相同」判为调用错误：这是模型在同一次提交里自我复制，属可修正的
 * 调用问题；相近但不相同的经验由 0.8 语义判重跳过（那是内容判断，不是调用判断）。
 */
export function validateExperienceCandidates(payload: unknown, expectedType: ExperienceType): ExperienceInsertDraft[] {
  const candidates = readCandidateList(payload)
  const drafts: ExperienceInsertDraft[] = []
  const seen = new Map<string, number>()
  candidates.forEach((candidate, index) => {
    const where = `第 ${index + 1} 条候选`
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw invalid(`${where}必须是对象（实际为 ${describeValue(candidate)}）：每个候选只能包含 ${ALLOWED_FIELD_TEXT}。`)
    }
    const values = readCanonicalValues(candidate as Record<string, unknown>, where, true)
    assertDeclaredType(values, expectedType, where)
    const core = normalizeCore(values, where)
    // 判重键按固定字段顺序生成，因此同一语义核心必然得到同一字符串
    const fingerprint = JSON.stringify(core)
    const previous = seen.get(fingerprint)
    if (previous !== undefined) {
      throw invalid(`${where}与第 ${previous + 1} 条候选的九个语义字段完全相同：请删除其中一条，或修改 principle / decision_domain 后重新提交。`)
    }
    seen.set(fingerprint, index)
    drafts.push({ experienceType: expectedType, ...core })
  })
  return drafts
}

/**
 * 校验保存补丁并给出合并后的完整语义核心。
 * `undefined` = 本次不改；`null` 只允许用于数组字段（清空）；必填文本被清空即拒绝
 * ——经验没有版本，改坏无从回滚。
 */
export function validateExperiencePatch(current: ExperienceSemanticFields, patch: unknown): ValidatedExperiencePatch {
  const where = "保存补丁"
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw badArgs(`${where}必须是对象（实际为 ${describeValue(patch)}）：请按可编辑字段提交补丁。`)
  }
  const values = readCanonicalValues(patch as Record<string, unknown>, where, false)
  const normalizedPatch: ExperiencePatch = {}
  const overrides = new Map<SemanticField, unknown>()
  for (const field of SEMANTIC_FIELDS) {
    if (!values.has(field)) continue
    const value = values.get(field)
    if (value === undefined) continue
    const alias = FIELD_SPECS[field].alias
    if (isArrayField(field)) {
      if (value === null) {
        normalizedPatch[field] = null
        overrides.set(field, [])
        continue
      }
      const list = requireArrayValue(value, field, where)
      normalizedPatch[field] = list
      overrides.set(field, list)
      continue
    }
    if (value === null) {
      throw invalid(`${where}的「${alias}」被置空：必填文本不能通过补丁清空（经验没有版本，改坏无从回滚），请给出新文本。`)
    }
    const text = requireScalarValue(value, field, where)
    normalizedPatch[field] = text
    overrides.set(field, text)
  }
  // 合并后再跑一遍九字段护栏：单字段合法不等于合并结果合法（总长上限按合并后的整条经验计）
  const merged = new Map<CanonicalField, unknown>()
  for (const field of SEMANTIC_FIELDS) merged.set(field, overrides.has(field) ? overrides.get(field) : current[field])
  return { patch: normalizedPatch, fields: normalizeCore(merged, where) }
}

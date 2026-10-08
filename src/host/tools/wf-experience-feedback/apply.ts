// src/host/tools/wf-experience-feedback/apply.ts
//
// 模型侧评价项 → 经验域入参的 deterministic 映射与校验，以及域层结果 → 模型可见投影。
//
// 为什么锚点校验必须在工具层做：经验域 `feedback` 的入参类型已按锚点联合收窄，模型传来的
// unknown 若不在此处被拒绝，就只能靠类型断言混进域层——那样非法评分会在更远处以更难诊断的
// 方式表现。判据本体（锚点表与合法值清单）仍复用经验域的纯函数与常量，工具层不复制一张表。
//
// 为什么整批拒绝而不是逐条跳过：skip 语义归域层（「这条经验没被使用过」），而参数形状错误
// 是调用姿势错误——同一批里既有合法项又有非法项时，接受一半会让模型无法判断自己提交了什么。

import {
  DECISION_EFFECT_ANCHORS,
  EVALUATION_EVIDENCE_LIMIT,
  MAX_EVALUATIONS_PER_CALL,
  SCORE_ANCHORS,
  isDecisionEffectAnchor,
  isScoreAnchor,
} from '../../experience/index.js'
import type {
  ExperienceFeedbackInput,
  ExperienceFeedbackResult,
} from '../../experience/index.js'
import type {
  ExperienceDecisionEffectAnchor,
  ExperienceEvaluationEntry,
  ExperienceScoreAnchor,
} from '../../shared/asset-types.js'
import { WfError } from '../../orchestrator/index.js'
import { ERR_EXPERIENCE_BAD_ARGS } from '../../shared/protocol.js'
import type { FeedbackAcceptedEntry, FeedbackResult, FeedbackSkippedEntry } from './types.js'

/** 评价项的全部合法字段名（闭集：未知字段一律拒绝，不得静默丢弃）。 */
const EVALUATION_FIELDS = [
  'experience_id',
  'fit',
  'decision_effect',
  'information_gain',
  'causal_confidence',
  'evidence',
] as const

/** 参数错误的统一构造：错误码是跨模块契约，消息必须能指名失败字段与合法取值。 */
function badArgs(message: string): WfError {
  return new WfError(message, ERR_EXPERIENCE_BAD_ARGS)
}

/** 取值描述（用于错误消息回显模型实际传了什么；undefined 与 null 必须可区分）。 */
function describeValue(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value) ?? String(value)
}

/** 合法锚点清单文本（由经验域常量渲染，锚点表本身不在工具层出现第二份）。 */
function anchorList(anchors: readonly number[]): string {
  return anchors.join(' / ')
}

/** 五级锚点字段（fit / information_gain / causal_confidence）：0～1，不允许连续小数。 */
function scoreOf(record: Record<string, unknown>, field: string, at: string): ExperienceScoreAnchor {
  const value = record[field]
  if (!isScoreAnchor(value)) {
    throw badArgs(
      `${at}.${field} 必须是五级锚点 ${anchorList(SCORE_ANCHORS)} 之一（收到 ${describeValue(value)}）：`
      + '不允许连续小数，请选择最接近的语义锚点后重新提交',
    )
  }
  return value
}

/** 决策效果字段：唯一跨零维度（-1～+1），负值表达「该经验把决策带向错误方向」。 */
function decisionEffectOf(record: Record<string, unknown>, at: string): ExperienceDecisionEffectAnchor {
  const value = record.decision_effect
  if (!isDecisionEffectAnchor(value)) {
    throw badArgs(
      `${at}.decision_effect 必须是决策效果锚点 ${anchorList(DECISION_EFFECT_ANCHORS)} 之一（收到 ${describeValue(value)}）：`
      + '负值表示该经验带来负面影响，0 表示与不使用它相比没有可归因差异',
    )
  }
  return value
}

/** 经验 id：模型侧身份，归一两端空白后必须非空（同一 id 不因空白产生第二种身份）。 */
function experienceIdOf(record: Record<string, unknown>, at: string): string {
  const raw = record.experience_id
  const experienceId = typeof raw === 'string' ? raw.trim() : ''
  if (!experienceId) {
    throw badArgs(
      `${at}.experience_id 必须是非空字符串（收到 ${describeValue(raw)}）：请填本次已经实际使用的经验 id`,
    )
  }
  return experienceId
}

/** 证据说明：可选；给了就必须是字符串且在长度上限内（上限来自经验域的磁盘护栏常量）。 */
function evidenceOf(record: Record<string, unknown>, at: string): string | undefined {
  const value = record.evidence
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw badArgs(`${at}.evidence 必须是字符串（收到 ${describeValue(value)}）：请用文字说明支撑本次评价的事实`)
  }
  if (value.length > EVALUATION_EVIDENCE_LIMIT) {
    throw badArgs(
      `${at}.evidence 超过 ${EVALUATION_EVIDENCE_LIMIT} 字符上限（实际 ${value.length} 字符）：请压缩到关键事实`,
    )
  }
  return value
}

/**
 * 解析并校验模型侧 evaluations（整批 deterministic 校验，任一非法项即拒绝整批）。
 * 通过后返回经验域入参（camelCase）；缺省的 evidence 不进键，由域层按空串解释。
 */
export function parseFeedbackEvaluations(raw: unknown): ExperienceFeedbackInput[] {
  if (!Array.isArray(raw)) {
    throw badArgs('evaluations 必须是评价数组：形如 [{ experience_id, fit, decision_effect, information_gain, causal_confidence, evidence? }]')
  }
  if (raw.length === 0) {
    throw badArgs('evaluations 不能是空数组：本工具用于提交已使用经验的使用结果，本次没有可评价的经验时不要调用')
  }
  if (raw.length > MAX_EVALUATIONS_PER_CALL) {
    throw badArgs(
      `evaluations 一次最多 ${MAX_EVALUATIONS_PER_CALL} 条（收到 ${raw.length} 条）：请拆成多次提交本次实际使用的经验`,
    )
  }
  const seen = new Set<string>()
  return raw.map((item, index) => {
    const at = `evaluations[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badArgs(`${at} 必须是评价对象（收到 ${describeValue(item)}）`)
    }
    const record = item as Record<string, unknown>
    const unknownFields = Object.keys(record).filter((field) => !(EVALUATION_FIELDS as readonly string[]).includes(field))
    if (unknownFields.length > 0) {
      throw badArgs(
        `${at} 含未知字段 ${unknownFields.join(' / ')}：合法字段只有 ${EVALUATION_FIELDS.join(' / ')}`,
      )
    }
    const experienceId = experienceIdOf(record, at)
    // 同一经验在一次调用里只允许一条评价：重复项会让「本次到底评了几次」不可解释，
    // 而跨调用的重复评价是合法历史（每次都是独立使用事件）。
    if (seen.has(experienceId)) {
      throw badArgs(`${at}.experience_id "${experienceId}" 在同一次调用中重复：同一经验一次只提交一条评价`)
    }
    seen.add(experienceId)
    const evidence = evidenceOf(record, at)
    const scores = {
      fitScore: scoreOf(record, 'fit', at),
      decisionEffect: decisionEffectOf(record, at),
      informationGain: scoreOf(record, 'information_gain', at),
      causalConfidence: scoreOf(record, 'causal_confidence', at),
    }
    return { experienceId, ...scores, ...(evidence === undefined ? {} : { evidence }) }
  })
}

/** 已写入评价的模型可见投影（丢掉系统 provenance，只保留模型提交过的评分）。 */
function acceptedOf(entries: readonly ExperienceEvaluationEntry[]): FeedbackAcceptedEntry[] {
  return entries.map((entry) => ({
    experienceId: entry.experienceId,
    fitScore: entry.fitScore,
    decisionEffect: entry.decisionEffect,
    informationGain: entry.informationGain,
    causalConfidence: entry.causalConfidence,
  }))
}

/** 未受理评价的模型可见投影（原因逐字来自域层，工具层不改写、不追加引导）。 */
function skippedOf(skipped: ReadonlyArray<{ experienceId: string; reason: string }>): FeedbackSkippedEntry[] {
  return skipped.map((item) => ({ experienceId: item.experienceId, reason: item.reason }))
}

/** 域层结果 → 模型可见结果（字段一一投影，顺序保持域层给出的顺序）。 */
export function projectFeedbackResult(result: ExperienceFeedbackResult): FeedbackResult {
  return { accepted: acceptedOf(result.accepted), skipped: skippedOf(result.skipped) }
}

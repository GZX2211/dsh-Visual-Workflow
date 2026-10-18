// src/host/experience/feedback.ts
//
// 反馈编排：把「已使用经验的一次评价」写入评价历史并触发统计重算（§8、§24）。
//
// 为什么把准入判定放在域层而不是工具层：评价的唯一前置条件「该经验确实被显式注入过」是一条
// 历史事实，只能由持久化端口回答（工具层看不到使用事实）。工具层负责参数形状与锚点，
// 域层负责「这条评价有没有资格存在」，两侧职责不重叠。
//
// 为什么单条准入失败只跳过该条：一次复盘里模型可能同时提交多条，其中一条填了未使用过的经验
// 不应废掉整批复盘数据；反之若整批接受，评价历史会掺入「没使用也评价」的假事实，
// 而统计一旦被污染就无法靠重建区分哪些是假的。

import type {
  ExperienceEvaluationEntry,
  ExperienceEvaluationInsert,
  ExperienceEvaluationScores,
  ExperienceType,
} from "../shared/asset-types.js"
import { WfError, messageOf } from "../orchestrator/errors.js"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_FEEDBACK_FAILED,
} from "../shared/protocol.js"
import { EVALUATION_EVIDENCE_LIMIT, MAX_EVALUATIONS_PER_CALL } from "./constants.js"
import type { ExperienceCaller, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js"
import { validateEvaluationScores } from "./scoring.js"
import { aggregateExperienceStats } from "./statistics.js"
import { resolveExperienceSubject } from "./subject.js"

/**
 * 准入拒绝的固定语义（文案是产品要求，不是提示词建议）。
 *
 * 用户明确要求只表达「an experience that was not used cannot be rated」，不得引导模型「先用 ids 召回再评价」：
 * 该引导会把「补一次召回再评价」变成合法路径，从而让未真正使用过的经验也能被评价。
 */
export const FEEDBACK_ADMISSION_REJECTED_REASON = "an experience that was not used cannot be rated"

/** 单条待提交评价（四维评分 + 经验 id + 证据说明）。 */
export interface ExperienceFeedbackInput extends ExperienceEvaluationScores {
  experienceId: string
  /** 支撑本次评价的事实说明；缺省按空串落库。 */
  evidence?: string
}

/** 被跳过的评价条目（原样回报给调用方，便于模型知道哪几条没进历史）。 */
export interface ExperienceFeedbackSkip {
  experienceId: string
  reason: string
}

/** 反馈结果：已写入的评价行投影 + 被跳过的条目。 */
export interface ExperienceFeedbackResult {
  accepted: ExperienceEvaluationEntry[]
  skipped: ExperienceFeedbackSkip[]
}

/** 反馈入参（主体身份 + 经验类型 + 评价列表）。 */
export interface ExperienceFeedbackRequest {
  caller: ExperienceCaller
  type: ExperienceType
  evaluations: readonly ExperienceFeedbackInput[]
}

/** 反馈依赖（与服务的端口依赖同源，便于单测直接驱动编排）。 */
export interface ExperienceFeedbackDeps {
  store: ExperienceStorePort
  runtime: ExperienceRuntimePort
  /** 诊断缝：即时归档失败时留下告警；评价已写入，扫描会补偿。 */
  logger?: { warn(message: string): void }
}

/** 入参错误出口：稳定码写进 message 文本（模型看不到 error.code）。 */
function badArgs(message: string): WfError {
  return new WfError(`${ERR_EXPERIENCE_BAD_ARGS}: ${message}`, ERR_EXPERIENCE_BAD_ARGS)
}

/** 写入失败出口：同上，码为反馈失败码。 */
function feedbackFailed(message: string): WfError {
  return new WfError(`${ERR_EXPERIENCE_FEEDBACK_FAILED}: ${message}`, ERR_EXPERIENCE_FEEDBACK_FAILED)
}

/**
 * 提交评价：解析主体 → 校验每条评分 → 准入判定 → 一笔事务写评价并重算统计。
 *
 * 失败隔离：写入失败只把错误归一为 `WF_EXPERIENCE_FEEDBACK_FAILED`（保留原始原因），
 * 经验本体与既有评价历史都不受影响；统计可由 rebuild 全量重放修复（§24 / §35）。
 */
export async function submitExperienceFeedback(
  deps: ExperienceFeedbackDeps,
  request: ExperienceFeedbackRequest,
): Promise<ExperienceFeedbackResult> {
  const evaluations = validateFeedbackShape(request.evaluations)
  const subject = resolveExperienceSubject({ caller: request.caller, type: request.type, runtime: deps.runtime })
  const injected = new Set(await deps.store.listInjectedIds({
    subjectId: subject.subjectId,
    experienceType: request.type,
    experienceIds: evaluations.map((evaluation) => evaluation.experienceId),
  }))

  const accepted: ExperienceFeedbackInput[] = []
  const skipped: ExperienceFeedbackSkip[] = []
  for (const evaluation of evaluations) {
    if (injected.has(evaluation.experienceId)) {
      accepted.push(evaluation)
      continue
    }
    skipped.push({
      experienceId: evaluation.experienceId,
      reason: `${FEEDBACK_ADMISSION_REJECTED_REASON}: experience ${evaluation.experienceId} is not in the set this subject had explicitly injected;`
        + " this entry is skipped while the rest of the batch is processed.",
    })
  }
  if (accepted.length === 0) return { accepted: [], skipped }

  // 评分者模型名一次性读取：写入失败重试时不得因两次读取不同而让同一批评价带上不同 provenance
  const evaluatorModel = deps.runtime.modelForCaller(request.caller)
  const rows: ExperienceEvaluationInsert[] = accepted.map((evaluation) => ({
    experienceId: evaluation.experienceId,
    runId: subject.sourceRunId,
    fitScore: evaluation.fitScore,
    decisionEffect: evaluation.decisionEffect,
    informationGain: evaluation.informationGain,
    causalConfidence: evaluation.causalConfidence,
    evidence: evaluation.evidence ?? "",
    evaluatorSubjectId: subject.subjectId,
    evaluatorModel,
    // 评价者角色身份与使用事实同源：同一子代理实例在召回与评价时角色一致
    roleKey: subject.roleKey,
    roleLabel: subject.roleLabel,
  }))
  try {
    const { inserted } = await deps.store.insertEvaluationsChecked({ rows, aggregate: aggregateExperienceStats })
    await retireHarmfulExperiences(deps, inserted)
    return { accepted: inserted, skipped }
  } catch (error) {
    throw feedbackFailed(
      `the feedback write failed (${messageOf(error)}); no evaluation of this batch was stored and the experiences plus their existing evaluation history are untouched — retry in the final completion stage of the task.`,
    )
  }
}

/**
 * 本次评价出现负向决策效果时立即归档（用户裁决：一次有害影响即退出召回面）。
 *
 * 为什么归档失败不让反馈失败：评价已经原子写入，失败的是「评价之后的治理动作」；
 * 把整次反馈报成失败会让模型重试并重复写入评价历史（不可变事实，重复即污染）。
 * 这里只告警，周期扫描会以同一套判定补偿。
 *
 * 为什么只看本批插入的评价：恢复后的旧负向评价已被恢复动作豁免，历史遗漏由扫描按
 * `reactivatedAt` 过滤后统一补偿；即时路径只负责「刚发生的负向」这一最需要立刻生效的事实。
 */
async function retireHarmfulExperiences(
  deps: ExperienceFeedbackDeps,
  inserted: readonly ExperienceEvaluationEntry[],
): Promise<void> {
  const harmfulIds = [...new Set(
    inserted
      .filter((entry) => entry.decisionEffect < 0)
      .map((entry) => entry.experienceId),
  )]
  for (const experienceId of harmfulIds) {
    try {
      await deps.store.retireForPolicy(experienceId, "harmful")
    } catch (error) {
      deps.logger?.warn(
        `[visual-workflow] 有害经验即时归档失败（experience=${experienceId}）：${messageOf(error)}；下一轮扫描会重试。`,
      )
    }
  }
}

/**
 * 校验评价列表的形状与锚点（域层是唯一校验本体，工具层重复校验只是为了让错误更早出现）。
 *
 * 先整体校验再动存储：任何一条非法都不应留下部分写入。
 */
function validateFeedbackShape(evaluations: readonly ExperienceFeedbackInput[]): ExperienceFeedbackInput[] {
  if (evaluations.length === 0) {
    throw badArgs(
      "feedback needs at least one evaluation (evaluations must not be empty); submit the experiences you actually used in this unit of work and have formed a judgement about.",
    )
  }
  if (evaluations.length > MAX_EVALUATIONS_PER_CALL) {
    throw badArgs(
      `at most ${MAX_EVALUATIONS_PER_CALL} evaluations may be submitted per call (received ${evaluations.length});`
        + " keep only the entries you reached a real conclusion about in this task and retry.",
    )
  }
  for (const evaluation of evaluations) {
    const experienceId = typeof evaluation.experienceId === "string" ? evaluation.experienceId.trim() : ""
    if (!experienceId) {
      throw badArgs(
        "an evaluation is missing a usable experience id (experience_id must be a non-empty string); fill in an id returned by the recall step and retry.",
      )
    }
    const evidence = evaluation.evidence ?? ""
    if (evidence.length > EVALUATION_EVIDENCE_LIMIT) {
      throw badArgs(
        `the evaluation evidence is ${evidence.length} characters, over the limit of ${EVALUATION_EVIDENCE_LIMIT}; shorten it and retry.`,
      )
    }
    const validation = validateEvaluationScores({
      fitScore: evaluation.fitScore,
      decisionEffect: evaluation.decisionEffect,
      informationGain: evaluation.informationGain,
      causalConfidence: evaluation.causalConfidence,
    })
    if (!validation.ok) {
      throw badArgs(`experience ${experienceId}: ${validation.reason}`)
    }
  }
  return [...evaluations]
}

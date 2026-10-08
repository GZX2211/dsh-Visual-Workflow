// src/host/experience/service.ts
//
// Experience 域的组合根：把主体解析、初始化状态、校验、投影、嵌入、判重与持久化端口串成
// 模型可调用的四个动作（初始化取 Prompt / 提交候选 / 召回 / 编辑与归档）。
//
// 事务边界是硬约束：向量必须在**写事务之外**算完（可能走远程 HTTP 或首次加载本地模型），
// 判重与写入由持久化端口在同一笔事务内完成；因此本类的嵌入调用一律发生在调用端口写入之前，
// 且每个候选的两个文本合成一次批量嵌入（不逐条候选发请求）。
//
// 嵌入能力退化（端口处于 bm25 或调用失败）时写入直接拒绝：V1 的去重门槛是语义相似度，
// 没有向量就无法执行该门槛，绕过它写入会把重复经验堆进库里且事后无法分辨。

import { dotProduct } from "../embedding/engine.js"
import { WfError, messageOf } from "../orchestrator/errors.js"
import type {
  ExperienceDuplicateJudge,
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceInsertDraft,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRecallHit,
  ExperienceRetrievalUpdate,
  ExperienceType,
} from "../shared/asset-types.js"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
  ERR_EXPERIENCE_NOT_FOUND,
  ERR_EXPERIENCE_NOT_INITIALIZED,
  ERR_EXPERIENCE_RECALL_FAILED,
} from "../shared/protocol.js"
import { DUPLICATE_SIMILARITY_THRESHOLD } from "./constants.js"
import { ExperienceExecutionState } from "./execution-state.js"
import type { ExperienceCaller, ExperienceEmbeddingPort, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js"
import { buildRecallSummary, buildRetrievalProjection } from "./projection.js"
import { recallActiveHits } from "./retrieval.js"
import { resolveExperienceSubject, type ExperienceSubject } from "./subject.js"
import { renderTeamExperienceContext } from "./team-context.js"
import { validateExperienceCandidates, validateExperiencePatch } from "./validation.js"

/** 服务依赖（宿主在组合根装配；端口形状见 ./ports.js）。 */
export interface ExperienceServiceDeps {
  store: ExperienceStorePort
  runtime: ExperienceRuntimePort
  embedding: ExperienceEmbeddingPort
  /** 时钟缝（初始化状态时间戳；缺省 Date.now）。 */
  now?: () => number
  /** 诊断缝：辅助路径（协作组共享上下文召回）失败时留下可诊断信息，不向调用方抛错。 */
  logger?: { warn(message: string): void }
}

/** 召回结果：候选阶段（摘要）或详情阶段（完整条目）。 */
export type ExperienceRecallResult =
  | { kind: "candidates"; hits: ExperienceRecallHit[]; source: "semantic" | "bm25" }
  | { kind: "details"; entries: ExperienceEntry[] }

/** 提交结果（与持久化端口一致：写入条目 + 被判重拦截的说明）。 */
export interface ExperienceSubmitResult {
  inserted: ExperienceEntry[]
  skipped: Array<{ reason: string; decisionRetrievalText: string }>
}

/** 命中与磁盘条目配对（未被读到的命中直接丢弃：召回面只暴露仍然活跃的经验）。 */
function pairScoredEntries(
  scored: ReadonlyArray<{ id: string; score: number }>,
  entries: readonly ExperienceEntry[],
): Array<{ entry: ExperienceEntry; score: number }> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const pairs: Array<{ entry: ExperienceEntry; score: number }> = []
  for (const hit of scored) {
    const entry = byId.get(hit.id)
    if (entry) pairs.push({ entry, score: hit.score })
  }
  return pairs
}

/**
 * 判重判据（同类型 + 活跃由持久化端口保证，本闭包只看决策向量）。
 * 为什么只用决策侧向量：经验是否重复取决于「学到的是不是同一条决策原则」；任务类型、证据与
 * 来源运行都会因项目不同而变化，拿它们参与比较会让同一经验反复入库。
 */
function createDuplicateJudge(): ExperienceDuplicateJudge {
  return (candidate, existing) => {
    const similarity = dotProduct(candidate.decisionEmbedding, existing.decisionEmbedding)
    if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) return { duplicate: false }
    return {
      duplicate: true,
      reason: `与已有经验 ${existing.id} 的决策向量相似度 ${similarity.toFixed(3)} ≥ ${DUPLICATE_SIMILARITY_THRESHOLD}，判定为近似重复，未新增；`
        + "如需保留差异，请改写 decision_domain / principle / recommended_action 后重新提交。",
    }
  }
}

export class ExperienceService {
  private readonly state: ExperienceExecutionState

  constructor(private readonly deps: ExperienceServiceDeps) {
    this.state = new ExperienceExecutionState({ now: deps.now })
  }

  /** 取当前主体该类型的生效生成 Prompt，并记录初始化态（重复调用幂等）。 */
  async initializePrompt(input: { caller: ExperienceCaller; type: ExperienceType }): Promise<{ prompt: ExperienceGenerationPromptEntry }> {
    const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime })
    const prompt = await this.requireActivePrompt(input.type)
    this.state.markInitialized({
      sessionId: subject.sessionId,
      subjectId: subject.subjectId,
      experienceType: input.type,
      generationPromptId: prompt.id,
      generationPromptVersion: prompt.promptVersion,
    })
    return { prompt }
  }

  /** 提交候选：校验 → 投影 → 事务外批量嵌入 → 判重与写入（同事务，由端口保证）。 */
  async submit(input: { caller: ExperienceCaller; type: ExperienceType; candidates: unknown }): Promise<ExperienceSubmitResult> {
    const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime })
    const initialization = this.state.readInitialized(subject.sessionId, subject.subjectId, input.type)
    if (!initialization) {
      throw new WfError(
        `尚未初始化 ${input.type} 经验生成 Prompt：请先调用 wf_experience_learn 并传空数组（type=${input.type}）取得生成 Prompt，`
          + "再按 Prompt 产出候选并重新提交。",
        ERR_EXPERIENCE_NOT_INITIALIZED,
      )
    }
    const drafts = validateExperienceCandidates(input.candidates, input.type)
    const projections = drafts.map((draft) => buildRetrievalProjection(draft))
    const vectors = await this.embedOutOfTransaction(projections.flatMap((projection) => [projection.taskRetrievalText, projection.decisionRetrievalText]))
    const rows = drafts.map((draft, index) => this.buildInsertRow(draft, projections[index], vectors[index * 2], vectors[index * 2 + 1], subject, initialization))
    return this.deps.store.insertChecked({ rows, duplicateOf: createDuplicateJudge() })
  }

  /** 召回：传 ids 取完整条目（仅活跃）；否则按 query 取候选摘要。 */
  async recall(input: { caller: ExperienceCaller; type: ExperienceType; query?: string; ids?: string[]; topK?: number }): Promise<ExperienceRecallResult> {
    const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime })
    const ids = input.ids
    if (ids !== undefined && ids.length === 0) {
      throw new WfError("ids 不能为空数组：请传第一阶段返回的候选 id，或改用 query 做候选召回。", ERR_EXPERIENCE_BAD_ARGS)
    }
    const query = (input.query ?? "").trim()
    if (ids === undefined && !query) {
      throw new WfError(
        "经验召回需要 query（第一阶段取候选摘要）或 ids（第二阶段取完整内容）：请提供其中之一后重新调用。",
        ERR_EXPERIENCE_BAD_ARGS,
      )
    }
    try {
      if (ids !== undefined) {
        return { kind: "details", entries: await this.deps.store.getRows(ids, { activeOnly: true }) }
      }
      const { pairs, source } = await this.recallScoredEntries({ subject, query, topK: input.topK })
      const hits: ExperienceRecallHit[] = pairs.map((pair) => ({
        id: pair.entry.id,
        score: pair.score,
        summary: buildRecallSummary(pair.entry),
        source,
      }))
      return { kind: "candidates", hits, source }
    } catch (error) {
      if (error instanceof WfError) throw error
      throw new WfError(
        `经验召回失败（${messageOf(error)}）：请稍后重试；若持续失败请检查经验库与嵌入服务是否可用。`,
        ERR_EXPERIENCE_RECALL_FAILED,
      )
    }
  }

  /** 保存可编辑字段：事务外重算投影与向量，事务内落库。 */
  async update(input: { experienceId: string; patch: ExperiencePatch }): Promise<ExperienceEntry> {
    const rows = await this.deps.store.getRows([input.experienceId], { activeOnly: false })
    const current = rows[0]
    if (!current) {
      throw new WfError(`经验不存在或已被清理：${input.experienceId}；请刷新经验列表后重试。`, ERR_EXPERIENCE_NOT_FOUND)
    }
    const validated = validateExperiencePatch(current, input.patch)
    const projection = buildRetrievalProjection(validated.fields)
    const vectors = await this.embedOutOfTransaction([projection.taskRetrievalText, projection.decisionRetrievalText])
    const next: ExperienceRetrievalUpdate = {
      taskRetrievalText: projection.taskRetrievalText,
      decisionRetrievalText: projection.decisionRetrievalText,
      taskEmbedding: vectors[0],
      decisionEmbedding: vectors[1],
      embeddingModel: this.deps.embedding.source,
      embeddingDimension: this.deps.embedding.dimension,
    }
    return this.deps.store.updateFields(input.experienceId, validated.patch, next)
  }

  /** 归档：退出召回面，内容全部保留。 */
  async retire(input: { experienceId: string }): Promise<ExperienceEntry> {
    return this.deps.store.setActive(input.experienceId, false)
  }

  /** 恢复：重新进入召回面。 */
  async restore(input: { experienceId: string }): Promise<ExperienceEntry> {
    return this.deps.store.setActive(input.experienceId, true)
  }

  /** 列表（活跃 + 归档；上限由调用方给出，存储侧负责实际截断）。 */
  async list(input: { limit: number }): Promise<ExperienceEntry[]> {
    if (!Number.isFinite(input.limit) || input.limit < 1) {
      throw new WfError(`列表上限必须是 ≥ 1 的整数（实际为 ${String(input.limit)}）：请传入正整数上限后重试。`, ERR_EXPERIENCE_BAD_ARGS)
    }
    return this.deps.store.listRows(Math.floor(input.limit))
  }

  /** 释放某会话的初始化状态（run 终态 / 插件卸载；幂等，失败不应阻断终态流程）。 */
  clearSession(input: { sessionId: string }): void {
    if (!input.sessionId) return
    this.state.clearBySession(input.sessionId)
  }

  /**
   * 协作组共享上下文：按 type="team" 召回一次并渲染为同一份文本（无命中返回 null）。
   *
   * 完整职责校检仍然执行（父代理此刻已承担 Team Leader 职责，标记由编排器在调用前落位）。
   * 失败不向调用方抛错——这是 best-effort 辅助路径，绝不阻断协作组启动；失败原因经日志缝
   * 留下可诊断信息（会话/工作流/组 + 具体错误）。
   */
  async teamExperienceContext(input: { sessionId: string; flowId: string; groupId: string; query: string }): Promise<string | null> {
    const where = `session=${input.sessionId} flow=${input.flowId} group=${input.groupId}`
    // 该路径不得抛错，因此入参缺失也按「无查询文本」处理，而不是任其成为 TypeError
    const query = (input.query ?? "").trim()
    if (!query) {
      this.deps.logger?.warn(`[visual-workflow] Team 经验共享上下文缺少查询文本（${where}）：已跳过注入。`)
      return null
    }
    try {
      const subject = resolveExperienceSubject({
        caller: { isChild: false, sessionId: input.sessionId },
        type: "team",
        runtime: this.deps.runtime,
      })
      const { pairs } = await this.recallScoredEntries({ subject, query })
      if (pairs.length === 0) return null
      const text = renderTeamExperienceContext(pairs.map((pair) => pair.entry))
      return text.length > 0 ? text : null
    } catch (error) {
      this.deps.logger?.warn(`[visual-workflow] Team 经验共享上下文召回失败（${where}）：${messageOf(error)}`)
      return null
    }
  }

  /** 取生效生成 Prompt；缺失属配置事实，给出可行动错误。 */
  private async requireActivePrompt(type: ExperienceType): Promise<ExperienceGenerationPromptEntry> {
    const prompt = await this.deps.store.getActivePrompt(type)
    if (!prompt) {
      throw new WfError(
        `没有 ${type} 类型的生效经验生成 Prompt：生成策略尚未就绪，请确认资产库已写入三类 Prompt 种子后重试。`,
        ERR_EXPERIENCE_NOT_FOUND,
      )
    }
    return prompt
  }

  /** 事务外批量嵌入：单次调用算完本批全部文本，任何失败都不得留下部分写入。 */
  private async embedOutOfTransaction(texts: string[]): Promise<Float64Array[]> {
    const { embedding } = this.deps
    if (embedding.source === "bm25") throw embeddingUnavailable("语义嵌入能力不可用（当前为 BM25 词法检索）")
    let vectors: Float64Array[]
    try {
      vectors = await embedding.embed(texts)
    } catch (error) {
      throw embeddingUnavailable(`语义嵌入调用失败（${messageOf(error)}）`)
    }
    if (vectors.length !== texts.length) {
      throw embeddingUnavailable(`语义嵌入返回数量不符（期望 ${texts.length}，实际 ${vectors.length}）`)
    }
    for (const vector of vectors) {
      if (vector.length !== embedding.dimension) {
        throw embeddingUnavailable(`语义嵌入维度与端口声明不符（期望 ${embedding.dimension}，实际 ${vector.length}）`)
      }
    }
    return vectors
  }

  /** 组装完整写入行：语义字段来自草稿，检索投影与向量来自事务外计算，provenance 来自运行事实与初始化记录。 */
  private buildInsertRow(
    draft: ExperienceInsertDraft,
    projection: { taskRetrievalText: string; decisionRetrievalText: string },
    taskEmbedding: Float64Array,
    decisionEmbedding: Float64Array,
    subject: ExperienceSubject,
    initialization: { generationPromptId: string; generationPromptVersion: string },
  ): ExperienceInsertRow {
    return {
      id: this.deps.store.nextId(),
      experienceType: subject.experienceType,
      responsibility: draft.responsibility,
      taskType: draft.taskType,
      decisionDomain: draft.decisionDomain,
      situation: draft.situation,
      trigger: draft.trigger,
      principle: draft.principle,
      recommendedAction: draft.recommendedAction,
      exclusions: draft.exclusions,
      evidence: draft.evidence,
      taskRetrievalText: projection.taskRetrievalText,
      taskEmbedding,
      decisionRetrievalText: projection.decisionRetrievalText,
      decisionEmbedding,
      embeddingModel: this.deps.embedding.source,
      embeddingDimension: this.deps.embedding.dimension,
      sourceRunId: subject.sourceRunId,
      generationPromptId: initialization.generationPromptId,
      generationPromptVersion: initialization.generationPromptVersion,
    }
  }

  /** 单次查询嵌入 + 双通道召回 + 按活跃行补齐条目（摘要与共享上下文共用）。 */
  private async recallScoredEntries(input: {
    subject: ExperienceSubject
    query: string
    topK?: number
  }): Promise<{ pairs: Array<{ entry: ExperienceEntry; score: number }>; source: "semantic" | "bm25" }> {
    const rows = await this.deps.store.listActiveEmbeddings(input.subject.experienceType)
    const outcome = await recallActiveHits({ query: input.query, rows, embedding: this.deps.embedding, topK: input.topK })
    if (outcome.scored.length === 0) return { pairs: [], source: outcome.source }
    const entries = await this.deps.store.getRows(outcome.scored.map((hit) => hit.id), { activeOnly: true })
    return { pairs: pairScoredEntries(outcome.scored, entries), source: outcome.source }
  }
}

/** 语义嵌入不可用的统一错误：消息必须说明「本次未写入」，调用方才知道可以稍后重试。 */
function embeddingUnavailable(reason: string): WfError {
  return new WfError(
    `${reason}：经验入库要求语义去重，本次未写入任何内容；请确认嵌入服务可用后重试。`,
    ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
  )
}

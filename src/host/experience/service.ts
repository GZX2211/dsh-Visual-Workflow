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
import { DUPLICATE_SIMILARITY_THRESHOLD, NEUTRAL_STATS, recallIdsLimitProblem } from "./constants.js"
import { ExperienceExecutionState } from "./execution-state.js"
import {
  submitExperienceFeedback,
  type ExperienceFeedbackInput,
  type ExperienceFeedbackResult,
} from "./feedback.js"
import type { ExperienceCaller, ExperienceEmbeddingPort, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js"
import { buildRecallSummary, buildRetrievalProjection } from "./projection.js"
import { rebuildExperienceStats } from "./rebuild.js"
import { normalizeTopK, recallActiveHits, type ExperienceScoredId, type ExperienceScoredRow } from "./retrieval.js"
import { rankRecallCandidates, type RecallRankingCandidate } from "./retrieval-ranking.js"
import { resolveExperienceSubject, type ExperienceSubject } from "./subject.js"
import { validateExperienceCandidates, validateExperiencePatch } from "./validation.js"

/**
 * 模型可见错误的统一出口（docs/model-facing-surface-rules §3）：稳定码必须写进 message 文本，
 * 因为 error.code 不会投影给模型；本域所有错误一律经此构造，避免个别调用点漏掉码或语言。
 */
function fail(code: string, message: string): WfError {
  return new WfError(`${code}: ${message}`, code)
}

/** 服务依赖（宿主在组合根装配；端口形状见 ./ports.js）。 */
export interface ExperienceServiceDeps {
  store: ExperienceStorePort
  runtime: ExperienceRuntimePort
  embedding: ExperienceEmbeddingPort
  /** 时钟缝（初始化状态时间戳；缺省 Date.now）。 */
  now?: () => number
  /** 诊断缝：辅助路径（统计读取、使用事实写入）失败时留下可诊断信息，不向调用方抛错。 */
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
    // 维度不一致 = 不可比（换嵌入模型/端点后，旧行与新候选不在同一向量空间）：不判重、照常入库。
    // 这条守卫不能省：dotProduct 对异维返回 NaN，而 `NaN < 阈值` 恒为 false，会把「算不出分数」
    // 误当成「高度相似」，使换模型后每条新经验都被静默丢弃。口径与 retrieval.ts 的 scoreChannel、
    // retrieval-ranking.ts 的 channelSimilarity 一致（不猜测、不补零、不按短向量截断）。
    if (candidate.decisionEmbedding.length !== existing.decisionEmbedding.length) return { duplicate: false }
    const similarity = dotProduct(candidate.decisionEmbedding, existing.decisionEmbedding)
    if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) return { duplicate: false }
    return {
      duplicate: true,
      reason: `decision-vector similarity ${similarity.toFixed(3)} with existing experience ${existing.id} >= ${DUPLICATE_SIMILARITY_THRESHOLD}: treated as a near duplicate and not added;`
        + " if the difference matters, rewrite decision_domain / principle / recommended_action and submit again.",
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
      throw fail(
        ERR_EXPERIENCE_NOT_INITIALIZED,
        `the ${input.type} generation prompt was not fetched in this run yet; call wf_experience_learn with an empty experiences array (type=${input.type}) to get it, then produce candidates from that prompt and submit again.`,
      )
    }
    const drafts = validateExperienceCandidates(input.candidates, input.type)
    const projections = drafts.map((draft) => buildRetrievalProjection(draft))
    const vectors = await this.embedOutOfTransaction(projections.flatMap((projection) => [projection.taskRetrievalText, projection.decisionRetrievalText]))
    const rows = drafts.map((draft, index) => this.buildInsertRow(draft, projections[index], vectors[index * 2], vectors[index * 2 + 1], subject, initialization))
    return this.deps.store.insertChecked({ rows, duplicateOf: createDuplicateJudge() })
  }

  /**
   * 召回：传 ids 取完整条目（仅活跃），这一步即「显式注入」的使用事实边界；
   * 否则按 query 取候选摘要——候选阶段只读、幂等，不写任何事实。
   */
  async recall(input: { caller: ExperienceCaller; type: ExperienceType; query?: string; ids?: string[]; topK?: number }): Promise<ExperienceRecallResult> {
    // 读取侧与写入侧共用同一解析入口：类型只决定候选池，不要求与此刻职责对应
    const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime })
    const ids = input.ids
    if (ids !== undefined && ids.length === 0) {
      throw fail(ERR_EXPERIENCE_BAD_ARGS, "ids must not be an empty array: pass candidate ids from the first stage, or use query for candidate recall.")
    }
    // 超限必须停在业务边界：ids 会变成 IN (…) 的绑定变量并逐条写入使用事实，无上限时
    // 底层 SQLite 会以「too many SQL variables」失败，模型拿不到可行动的修正提示。
    const idsLimitProblem = ids ? recallIdsLimitProblem(ids.length) : null
    if (idsLimitProblem !== null) {
      throw fail(ERR_EXPERIENCE_BAD_ARGS, idsLimitProblem)
    }
    const query = (input.query ?? "").trim()
    if (ids === undefined && !query) {
      throw fail(
        ERR_EXPERIENCE_BAD_ARGS,
        "recall needs either query (first stage: candidate summaries) or ids (second stage: full entries); provide one of them and call again.",
      )
    }
    try {
      if (ids !== undefined) {
        const entries = await this.deps.store.getRows(ids, { activeOnly: true })
        await this.recordUsage(subject, entries)
        return { kind: "details", entries }
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
      throw fail(
        ERR_EXPERIENCE_RECALL_FAILED,
        `recall failed (${messageOf(error)}); retry shortly, and if it keeps failing check that the experience store and the embedding service are available.`,
      )
    }
  }

  /**
   * 提交已使用经验的一次评价（§8 / §24）。
   *
   * 编排在 `./feedback.js`：准入判定依赖使用事实，而「逐条跳过」与「一笔事务写评价 + 重算统计」
   * 的语义属同一职责，拆在两处会让准入与写入的边界漂移。
   */
  async feedback(input: {
    caller: ExperienceCaller
    type: ExperienceType
    evaluations: readonly ExperienceFeedbackInput[]
  }): Promise<ExperienceFeedbackResult> {
    return submitExperienceFeedback({ store: this.deps.store, runtime: this.deps.runtime }, input)
  }

  /** 保存可编辑字段：事务外重算投影与向量，事务内落库。 */
  async update(input: { experienceId: string; patch: ExperiencePatch }): Promise<ExperienceEntry> {
    const rows = await this.deps.store.getRows([input.experienceId], { activeOnly: false })
    const current = rows[0]
    if (!current) {
      throw fail(ERR_EXPERIENCE_NOT_FOUND, `experience does not exist or has been cleaned up: ${input.experienceId}; refresh the experience list and retry.`)
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
      throw fail(ERR_EXPERIENCE_BAD_ARGS, `the list limit must be an integer >= 1 (received ${String(input.limit)}); pass a positive integer limit and retry.`)
    }
    return this.deps.store.listRows(Math.floor(input.limit))
  }

  /**
   * 全量重放评价历史与使用事实，覆盖写入统计投影（§24 / §25）。
   *
   * 为什么是显式动作而不是启动时自动执行：重建是全表读写，且结果与时机无关；暴露成服务方法
   * 后，宿主启动路径不带长事务，调参与修复也能在受控时刻进行。
   */
  async rebuildStats(): Promise<{ experienceCount: number }> {
    return rebuildExperienceStats({ store: this.deps.store })
  }

  /** 释放全部初始化状态（插件卸载；幂等）。 */
  clearAllSessions(): void {
    this.state.clearAll()
  }

  /** 取生效生成 Prompt；缺失属配置事实，给出可行动错误。 */
  private async requireActivePrompt(type: ExperienceType): Promise<ExperienceGenerationPromptEntry> {
    const prompt = await this.deps.store.getActivePrompt(type)
    if (!prompt) {
      throw fail(
        ERR_EXPERIENCE_NOT_FOUND,
        `there is no active generation prompt for the ${type} experience type: the generation strategy is not ready, so check that the asset store has its two prompt seeds and retry.`,
      )
    }
    return prompt
  }

  /**
   * 事务外批量嵌入：单次调用算完本批全部文本，任何失败都不得留下部分写入。
   *
   * 为什么先 ensureReady 再读端口 source：source 是「能力事实」，但嵌入引擎惰性加载——
   * 就绪之前 source 恒为 bm25（初始值），直接预读会把「尚未加载」误判成「已降级」并永久
   * 拒绝写入；而真正能触发加载的 embed() 那时还没有机会被调用。就绪后 source 才代表真实能力。
   */
  private async embedOutOfTransaction(texts: string[]): Promise<Float64Array[]> {
    const { embedding } = this.deps
    await embedding.ensureReady()
    if (embedding.source === "bm25") {
      // 带上降级原因：只说「降级了」使用者无从定位（可观测性）；原因缺失时保持原文案
      const reason = embedding.degradeReason?.trim()
      throw embeddingUnavailable(
        reason
          ? `semantic embedding is unavailable (falling back to BM25 lexical retrieval; reason: ${reason})`
          : "semantic embedding is unavailable (falling back to BM25 lexical retrieval)",
      )
    }
    let vectors: Float64Array[]
    try {
      vectors = await embedding.embed(texts)
    } catch (error) {
      throw embeddingUnavailable(`the semantic embedding call failed (${messageOf(error)})`)
    }
    if (vectors.length !== texts.length) {
      throw embeddingUnavailable(`the semantic embedding returned ${vectors.length} vectors for ${texts.length} texts`)
    }
    for (const vector of vectors) {
      if (vector.length !== embedding.dimension) {
        throw embeddingUnavailable(`the semantic embedding dimension does not match the port declaration (expected ${embedding.dimension}, got ${vector.length})`)
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

  /** 单次查询嵌入 + 双通道候选池 + 第二段排序 + 按活跃行补齐条目（摘要与共享上下文共用）。 */
  private async recallScoredEntries(input: {
    subject: ExperienceSubject
    query: string
    topK?: number
  }): Promise<{ pairs: Array<{ entry: ExperienceEntry; score: number }>; source: "semantic" | "bm25" }> {
    const rows = await this.deps.store.listActiveEmbeddings(input.subject.experienceType)
    const outcome = await recallActiveHits({ query: input.query, rows, embedding: this.deps.embedding })
    if (outcome.scored.length === 0) return { pairs: [], source: outcome.source }
    const scored = outcome.source === "semantic"
      ? await this.rankSemanticCandidates(outcome.scored, input.topK)
      : outcome.scored.slice(0, normalizeTopK(input.topK))
    const entries = await this.deps.store.getRows(scored.map((hit) => hit.id), { activeOnly: true })
    return { pairs: pairScoredEntries(scored, entries), source: outcome.source }
  }

  /**
   * 语义候选池 → 有界信任重排 → MMR（§17～§19）。
   *
   * 为什么词法回退不走这条链：BM25 得分既不是余弦也没有上下界，「归一化相似度」与「候选间
   * 相似度」在词法侧没有对应语义；对它套信任修正等于凭空虚造一套公式，因此回退路径只按词法
   * 得分排序（§35：嵌入失败不修改经验信任，也不因此重排）。
   */
  private async rankSemanticCandidates(scored: readonly ExperienceScoredRow[], topK?: number): Promise<ExperienceScoredId[]> {
    const qualitySignalById = await this.readQualitySignals(scored.map((hit) => hit.id))
    const candidates: RecallRankingCandidate[] = scored.map((hit) => ({
      id: hit.id,
      cosine: hit.score,
      qualitySignal: qualitySignalById.get(hit.id) ?? NEUTRAL_STATS.qualitySignal,
      taskVector: hit.row.taskEmbedding,
      decisionVector: hit.row.decisionEmbedding,
    }))
    return rankRecallCandidates({ candidates, topK: normalizeTopK(topK) })
  }

  /**
   * 读候选的统计质量信号；缺行按中性 0 解释（不伪造统计行）。
   *
   * 降级链（§35 失败隔离）：统计读取失败 → 全部候选按信任中性（qualitySignal = 0）继续语义召回。
   * 统计只是相关性上的 ±20% 修正，绝不能因为它读不到就让经验整体不可用。
   */
  private async readQualitySignals(ids: readonly string[]): Promise<Map<string, number>> {
    try {
      const rows = await this.deps.store.getStats([...ids])
      return new Map(rows.map((row) => [row.experienceId, row.qualitySignal]))
    } catch (error) {
      this.deps.logger?.warn(`[visual-workflow] 经验统计读取失败，本次召回按信任中性处理：${messageOf(error)}`)
      return new Map()
    }
  }

  /**
   * 记录「经验被显式注入 agent 上下文」这一使用事实（§8 的使用边界）。
   *
   * 降级链（§35 失败隔离）：使用事实写入是 best-effort 辅助路径——它只服务后续统计与反馈准入，
   * 不参与本次返回内容；失败时告警并继续返回经验，绝不使召回失败。
   * 代价是这次注入没有留下使用事实，后续对该经验的反馈会因准入判定失败被跳过（可再次显式召回后补评）。
   */
  private async recordUsage(subject: ExperienceSubject, entries: readonly ExperienceEntry[]): Promise<void> {
    if (entries.length === 0) return
    try {
      await this.deps.store.recordUsage({
        rows: entries.map((entry) => ({
          experienceId: entry.id,
          runId: subject.sourceRunId,
          subjectId: subject.subjectId,
        })),
        neutralStats: NEUTRAL_STATS,
      })
    } catch (error) {
      this.deps.logger?.warn(
        `[visual-workflow] 经验使用事实写入失败（session=${subject.sessionId} subject=${subject.subjectId}）：`
          + `${messageOf(error)}；本次仍返回经验。`,
      )
    }
  }
}

/** 语义嵌入不可用的统一错误：消息必须说明「本次未写入」，调用方才知道可以稍后重试。 */
function embeddingUnavailable(reason: string): WfError {
  return fail(
    ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
    `${reason}; storing an experience requires semantic deduplication, so nothing was written — retry once the embedding service is available.`,
  )
}

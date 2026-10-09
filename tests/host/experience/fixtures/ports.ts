// tests/host/experience/fixtures/ports.ts
//
// Experience 域单测的受控世界：三个端口的 fake、经验条目/Prompt 工厂，以及「与真实资产库同语义」的判重写入。
//
// 为什么 fake store 要真的跑判重循环（而不是只记录调用）：submit 的判重判据由域层以闭包注入，
// 只有让 fake 逐条调用该闭包、并把本批已插入的行也纳入既有侧，才能锁定「同类型 + 活跃 + 0.8」
// 与「批内互相判重」这两条业务规则；否则测试只能断言「调用发生过」，无法验证规则本身。
//
// 为什么向量默认由检索文本派生：单测里 recall 的排序需要「相同文本 → 相同向量、不同文本 → 不同向量」，
// 派生规则必须确定（禁止随机数），这样排序结果可复现。

import { normalizeVector } from "../../../../src/host/embedding/engine.js"
import { NEUTRAL_STATS } from "../../../../src/host/experience/constants.js"
import type {
  ExperienceDuplicateJudge,
  ExperienceEntry,
  ExperienceEvaluationEntry,
  ExperienceEvaluationInsertInput,
  ExperienceGenerationPromptEntry,
  ExperienceInsertCheckedInput,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRetrievalUpdate,
  ExperienceStatsEntry,
  ExperienceStatsRebuildInput,
  ExperienceStatsValues,
  ExperienceType,
  ExperienceUsageEntry,
  ExperienceUsageRecordInput,
} from "../../../../src/host/shared/asset-types.js"
import type {
  ExperienceRetrievalRow,
  ExperienceRuntimePort,
  ExperienceStorePort,
} from "../../../../src/host/experience/ports.js"

/** 受控世界的固定时钟：用例断言时间戳时无需关心真实时间。 */
export const FIXED_NOW = 1_700_000_000_000

/** 三类经验主体（与协议常量同域；fixture 自带便于建表与遍历）。 */
export const FIXTURE_TYPES: readonly ExperienceType[] = ["agent", "team", "orchestrator"]

/** 运行事实 fake 的内部状态（用例直接摆放事实，不经过业务方法）。 */
export interface FakeRuntimeFacts {
  activeRuns: Map<string, { runId: string; flowId: string; sessionId: string }>
  childRuns: Map<string, { runId: string; flowId: string; sessionId: string; nodeId: string }>
  teamRuns: Set<string>
  /** 主体身份 → 模型名（缺省回落 defaultModel；空串表达「无法确定」）。 */
  models: Map<string, string>
  /** 未登记模型名时的回落值。 */
  defaultModel: string
}

/**
 * 嵌入端口 fake：记录每次批量文本，便于断言「单次 batch」与「查询只嵌入一次」。
 * `source` 声明为可变：用例需要在中途把端口推进 bm25 降级态（真实实现同样会变），
 * 而 ExperienceEmbeddingPort 侧只读口径仍然成立。
 */
export interface FakeEmbeddingPort {
  source: "local" | "remote" | "bm25"
  /** 降级原因（用例可摆放，用于断言「拒绝写入时回显原因」）。 */
  degradeReason?: string | null
  readonly dimension: number
  ensureReady(): Promise<void>
  embed(texts: string[]): Promise<Float64Array[]>
  readonly embedCalls: string[][]
}

/** 受控世界：端口 + 可观察事实。 */
export interface FakeExperienceWorld {
  store: ExperienceStorePort
  runtime: ExperienceRuntimePort
  embedding: FakeEmbeddingPort
  calls: string[]
  entries: Map<string, ExperienceEntry>
  decisionVectors: Map<string, Float64Array>
  prompts: Map<ExperienceType, ExperienceGenerationPromptEntry>
  retrievalRows: Map<ExperienceType, ExperienceRetrievalRow[]>
  runtimeFacts: FakeRuntimeFacts
  embedCalls: string[][]
  getRowsCalls: Array<{ ids: string[]; activeOnly: boolean }>
  listActiveEmbeddingsCalls: ExperienceType[]
  lastInsert: ExperienceInsertCheckedInput | null
  lastUpdate: { id: string; patch: ExperiencePatch; next: ExperienceRetrievalUpdate } | null
  /** 使用事实（显式注入）历史行。 */
  usageRows: ExperienceUsageEntry[]
  /** 评价历史行。 */
  evaluationRows: ExperienceEvaluationEntry[]
  /** 统计投影（缺行代表「证据不足」，读侧按中性解释）。 */
  stats: Map<string, ExperienceStatsEntry>
  recordUsageCalls: ExperienceUsageRecordInput[]
  insertEvaluationsCalls: ExperienceEvaluationInsertInput[]
  rebuildStatsCalls: ExperienceStatsRebuildInput[]
  listInjectedIdsCalls: Array<{ subjectId: string; experienceType: ExperienceType; experienceIds: string[] }>
  getStatsCalls: string[][]
  now: number
}

/** 受控世界构造参数。 */
export interface FakeWorldOptions {
  embeddingSource?: "local" | "remote" | "bm25"
  dimension?: number
  embed?: (texts: string[]) => Promise<Float64Array[]>
  /**
   * 就绪钩子：模拟惰性引擎「就绪之后 source/dimension 才代表真实能力」的行为。
   * 缺省为空操作——此时用例摆放的 source 即能力事实，等价于引擎已就绪。
   */
  onEnsureReady?: () => void | Promise<void>
  now?: number
  maxIdSeed?: number
  /** 运行事实端口在未登记主体模型名时的回落值（默认 fixture-model；空串表达「无法确定」）。 */
  defaultModel?: string
}

/** 由文本派生确定向量（相同文本 → 相同向量；维度可配）。 */
export function derivedVector(text: string, dimension: number): Float64Array {
  const values: number[] = []
  for (let index = 0; index < dimension; index += 1) {
    const code = text.length === 0 ? 0 : text.charCodeAt(index % text.length)
    values.push(((code * 31 + index * 17) % 97) + 1)
  }
  return normalizeVector(values)
}

/** 二维单位向量：与 [1, 0] 的内积恰为 similarity（用于 0.8 阈值边界用例）。 */
export function similarityVector(similarity: number): Float64Array {
  return new Float64Array([similarity, Math.sqrt(Math.max(0, 1 - similarity * similarity))])
}

/** 经验条目工厂（磁盘行的对外投影）。 */
export function createEntry(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: "ex-1",
    active: true,
    experienceType: "agent",
    responsibility: "对节点任务的正确性负责",
    taskType: "软件开发",
    decisionDomain: "任务分解",
    situation: "两个节点表面独立但共享未稳定的前置条件",
    trigger: "准备把多个节点并行启动时",
    principle: "共享前置条件未稳定时并行会放大返工",
    recommendedAction: "先建立显式完成闸门再并行",
    exclusions: ["前置条件已稳定时不适用"],
    evidence: ["一次并行执行返工"],
    taskRetrievalText: "responsibility: 对节点任务的正确性负责",
    decisionRetrievalText: "decision_domain: 任务分解",
    embeddingModel: "local",
    embeddingDimension: 2,
    sourceRunId: "run-1",
    generationPromptId: "ep-agent",
    generationPromptVersion: "V1",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

/** 生成 Prompt 工厂。 */
export function createPrompt(type: ExperienceType, overrides: Partial<ExperienceGenerationPromptEntry> = {}): ExperienceGenerationPromptEntry {
  return {
    id: `ep-${type}`,
    experienceType: type,
    name: `${type} 经验生成 Prompt`,
    prompt: `请按 ${type} 协议提炼经验`,
    promptVersion: "V1",
    active: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

/** 模型侧候选载荷工厂（camelCase；用例可覆盖任意键以构造非法载荷）。 */
export function createCandidatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responsibility: "对节点任务的正确性负责",
    taskType: "软件开发",
    decisionDomain: "任务分解",
    situation: "两个节点共享未稳定的前置条件",
    trigger: "准备并行启动多个节点时",
    principle: "前置条件未稳定时并行会放大返工",
    recommendedAction: "先建立显式完成闸门再并行",
    exclusions: ["前置条件已稳定时不适用"],
    evidence: ["一次并行执行返工"],
    ...overrides,
  }
}

/**
 * 构造受控世界。
 * `embed` 可覆盖默认嵌入（阈值边界、召回排序用例需要指定向量）。
 */
export function createExperienceWorld(options: FakeWorldOptions = {}): FakeExperienceWorld {
  const dimension = options.dimension ?? 2
  const embedCalls: string[][] = []
  const calls: string[] = []
  const getRowsCalls: Array<{ ids: string[]; activeOnly: boolean }> = []
  const listActiveEmbeddingsCalls: ExperienceType[] = []
  const entries = new Map<string, ExperienceEntry>()
  const decisionVectors = new Map<string, Float64Array>()
  const prompts = new Map<ExperienceType, ExperienceGenerationPromptEntry>()
  const retrievalRows = new Map<ExperienceType, ExperienceRetrievalRow[]>()
  for (const type of FIXTURE_TYPES) retrievalRows.set(type, [])
  const runtimeFacts: FakeRuntimeFacts = {
    activeRuns: new Map(),
    childRuns: new Map(),
    teamRuns: new Set(),
    models: new Map(),
    defaultModel: options.defaultModel ?? "fixture-model",
  }
  const usageRows: ExperienceUsageEntry[] = []
  const evaluationRows: ExperienceEvaluationEntry[] = []
  const stats = new Map<string, ExperienceStatsEntry>()
  const recordUsageCalls: ExperienceUsageRecordInput[] = []
  const insertEvaluationsCalls: ExperienceEvaluationInsertInput[] = []
  const rebuildStatsCalls: ExperienceStatsRebuildInput[] = []
  const listInjectedIdsCalls: Array<{ subjectId: string; experienceType: ExperienceType; experienceIds: string[] }> = []
  const getStatsCalls: string[][] = []
  let idSeed = options.maxIdSeed ?? 0
  let now = options.now ?? FIXED_NOW

  const embed = options.embed ?? (async (texts: string[]): Promise<Float64Array[]> =>
    texts.map((text) => derivedVector(text, dimension)))

  const store: ExperienceStorePort = {
    nextId(): string {
      idSeed += 1
      return `ex-${idSeed}`
    },
    async getActivePrompt(type: ExperienceType): Promise<ExperienceGenerationPromptEntry | null> {
      calls.push("store.getActivePrompt")
      const prompt = prompts.get(type)
      return prompt && prompt.active ? prompt : null
    },
    async listPrompts(): Promise<ExperienceGenerationPromptEntry[]> {
      calls.push("store.listPrompts")
      return [...prompts.values()]
    },
    async listRows(limit: number): Promise<ExperienceEntry[]> {
      calls.push("store.listRows")
      return [...entries.values()].slice(0, limit)
    },
    async getRows(ids: string[], getOptions?: { activeOnly?: boolean }): Promise<ExperienceEntry[]> {
      calls.push("store.getRows")
      const activeOnly = getOptions?.activeOnly === true
      getRowsCalls.push({ ids: [...ids], activeOnly })
      return ids
        .map((id) => entries.get(id))
        .filter((entry): entry is ExperienceEntry => entry !== undefined && (!activeOnly || entry.active))
    },
    async listActiveEmbeddings(type: ExperienceType): Promise<ExperienceRetrievalRow[]> {
      calls.push("store.listActiveEmbeddings")
      listActiveEmbeddingsCalls.push(type)
      return retrievalRows.get(type) ?? []
    },
    async insertChecked(input: ExperienceInsertCheckedInput): Promise<{
      inserted: ExperienceEntry[]
      skipped: Array<{ reason: string; decisionRetrievalText: string }>
    }> {
      calls.push("store.insertChecked")
      world.lastInsert = input
      const inserted: ExperienceEntry[] = []
      const skipped: Array<{ reason: string; decisionRetrievalText: string }> = []
      for (const row of input.rows) {
        // 既有侧 = 库中同类型活跃行 + 本批已插入行（插一条即入表，故批内互相判重自然生效）
        const existing = [...entries.values()].filter((entry) => entry.experienceType === row.experienceType && entry.active)
        const verdict = existing
          .map((entry) => input.duplicateOf(
            { experienceType: row.experienceType, decisionEmbedding: row.decisionEmbedding, decisionRetrievalText: row.decisionRetrievalText },
            { id: entry.id, decisionEmbedding: decisionVectors.get(entry.id) ?? new Float64Array(dimension), decisionRetrievalText: entry.decisionRetrievalText },
          ))
          .find((candidate) => candidate.duplicate)
        if (verdict && verdict.duplicate) {
          skipped.push({ reason: verdict.reason, decisionRetrievalText: row.decisionRetrievalText })
          continue
        }
        const entry = entryFromRow(row, now)
        entries.set(entry.id, entry)
        decisionVectors.set(entry.id, row.decisionEmbedding)
        inserted.push(entry)
      }
      return { inserted, skipped }
    },
    async updateFields(id: string, patch: ExperiencePatch, next: ExperienceRetrievalUpdate): Promise<ExperienceEntry> {
      calls.push("store.updateFields")
      world.lastUpdate = { id, patch, next }
      const current = entries.get(id)
      if (!current) throw new Error(`fixture store 缺少经验行：${id}`)
      const updated: ExperienceEntry = {
        ...current,
        ...(patch.responsibility === undefined ? {} : { responsibility: patch.responsibility }),
        ...(patch.taskType === undefined ? {} : { taskType: patch.taskType }),
        ...(patch.decisionDomain === undefined ? {} : { decisionDomain: patch.decisionDomain }),
        ...(patch.situation === undefined ? {} : { situation: patch.situation }),
        ...(patch.trigger === undefined ? {} : { trigger: patch.trigger }),
        ...(patch.principle === undefined ? {} : { principle: patch.principle }),
        ...(patch.recommendedAction === undefined ? {} : { recommendedAction: patch.recommendedAction }),
        ...(patch.exclusions === undefined ? {} : { exclusions: patch.exclusions ?? [] }),
        ...(patch.evidence === undefined ? {} : { evidence: patch.evidence ?? [] }),
        taskRetrievalText: next.taskRetrievalText,
        decisionRetrievalText: next.decisionRetrievalText,
        embeddingModel: next.embeddingModel,
        embeddingDimension: next.embeddingDimension,
        updatedAt: now,
      }
      entries.set(id, updated)
      decisionVectors.set(id, next.decisionEmbedding)
      return updated
    },
    async setActive(id: string, active: boolean): Promise<ExperienceEntry> {
      calls.push("store.setActive")
      const current = entries.get(id)
      if (!current) throw new Error(`fixture store 缺少经验行：${id}`)
      const updated: ExperienceEntry = { ...current, active, updatedAt: now }
      entries.set(id, updated)
      return updated
    },
    async recordUsage(input: ExperienceUsageRecordInput): Promise<{ recorded: number }> {
      calls.push("store.recordUsage")
      recordUsageCalls.push(input)
      const batchCount = new Map<string, number>()
      for (const row of input.rows) {
        usageRows.push({ ...row, id: `usage-${usageRows.length + 1}`, createdAt: now })
        batchCount.set(row.experienceId, (batchCount.get(row.experienceId) ?? 0) + 1)
      }
      // 与真实资产库同语义：首次建行用调用方给的中性投影，已存在则只累加 recalled_count
      for (const [experienceId, count] of batchCount) {
        const current = stats.get(experienceId)
        stats.set(experienceId, current
          ? { ...current, recalledCount: current.recalledCount + count, updatedAt: now }
          : { experienceId, ...input.neutralStats, recalledCount: count, updatedAt: now })
      }
      return { recorded: input.rows.length }
    },
    async listInjectedIds(input: { subjectId: string; experienceType: ExperienceType; experienceIds: string[] }): Promise<string[]> {
      calls.push("store.listInjectedIds")
      listInjectedIdsCalls.push({ ...input, experienceIds: [...input.experienceIds] })
      const seen = new Set<string>()
      const injected: string[] = []
      for (const id of input.experienceIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const entry = entries.get(id)
        if (!entry || entry.experienceType !== input.experienceType) continue
        if (usageRows.some((row) => row.subjectId === input.subjectId && row.experienceId === id)) injected.push(id)
      }
      return injected
    },
    async insertEvaluationsChecked(input: ExperienceEvaluationInsertInput): Promise<{
      inserted: ExperienceEvaluationEntry[]
      stats: ExperienceStatsEntry[]
    }> {
      calls.push("store.insertEvaluationsChecked")
      insertEvaluationsCalls.push(input)
      const inserted = input.rows.map((row) => {
        const entry: ExperienceEvaluationEntry = { ...row, id: `eval-${evaluationRows.length + 1}`, createdAt: now }
        evaluationRows.push(entry)
        return entry
      })
      const affected = [...new Set(inserted.map((entry) => entry.experienceId))]
      const rewritten: ExperienceStatsEntry[] = []
      for (const experienceId of affected) {
        const recalledCount = stats.get(experienceId)?.recalledCount ?? 0
        const values = input.aggregate({
          evaluations: evaluationRows.filter((entry) => entry.experienceId === experienceId),
          recalledCount,
        })
        const row: ExperienceStatsEntry = { experienceId, ...values, updatedAt: now }
        stats.set(experienceId, row)
        rewritten.push(row)
      }
      return { inserted, stats: rewritten }
    },
    async getStats(experienceIds: string[]): Promise<ExperienceStatsEntry[]> {
      calls.push("store.getStats")
      getStatsCalls.push([...experienceIds])
      return experienceIds
        .map((id) => stats.get(id))
        .filter((row): row is ExperienceStatsEntry => row !== undefined)
    },
    async rebuildStats(input: ExperienceStatsRebuildInput): Promise<{ experienceCount: number }> {
      calls.push("store.rebuildStats")
      rebuildStatsCalls.push(input)
      const rebuilt = new Map<string, ExperienceStatsEntry>()
      for (const experienceId of entries.keys()) {
        const values = input.aggregate({
          evaluations: evaluationRows.filter((entry) => entry.experienceId === experienceId),
          recalledCount: usageRows.filter((row) => row.experienceId === experienceId).length,
        })
        rebuilt.set(experienceId, { experienceId, ...values, updatedAt: now })
      }
      stats.clear()
      for (const [experienceId, row] of rebuilt) stats.set(experienceId, row)
      return { experienceCount: rebuilt.size }
    },
  }

  const runtime: ExperienceRuntimePort = {
    activeRunForSession(sessionId: string): { runId: string; flowId: string; sessionId: string } | null {
      calls.push("runtime.activeRunForSession")
      return runtimeFacts.activeRuns.get(sessionId) ?? null
    },
    runForChild(childId: string): { runId: string; flowId: string; sessionId: string; nodeId: string } | null {
      calls.push("runtime.runForChild")
      return runtimeFacts.childRuns.get(childId) ?? null
    },
    hasTeamInCurrentRun(sessionId: string): boolean {
      calls.push("runtime.hasTeamInCurrentRun")
      return runtimeFacts.teamRuns.has(sessionId)
    },
    hasActiveRun(sessionId: string): boolean {
      calls.push("runtime.hasActiveRun")
      return runtimeFacts.activeRuns.has(sessionId)
    },
    modelForCaller(caller): string {
      calls.push("runtime.modelForCaller")
      return runtimeFacts.models.get(caller.childId ?? caller.sessionId) ?? runtimeFacts.defaultModel
    },
  }

  const embedding: FakeEmbeddingPort = {
    source: options.embeddingSource ?? "local",
    degradeReason: null,
    dimension,
    async ensureReady(): Promise<void> {
      calls.push("embedding.ensureReady")
      await options.onEnsureReady?.()
    },
    async embed(texts: string[]): Promise<Float64Array[]> {
      calls.push("embed")
      embedCalls.push([...texts])
      return embed(texts)
    },
    embedCalls,
  }

  const world: FakeExperienceWorld = {
    store,
    runtime,
    embedding,
    calls,
    entries,
    decisionVectors,
    prompts,
    retrievalRows,
    runtimeFacts,
    embedCalls,
    getRowsCalls,
    listActiveEmbeddingsCalls,
    lastInsert: null,
    lastUpdate: null,
    usageRows,
    evaluationRows,
    stats,
    recordUsageCalls,
    insertEvaluationsCalls,
    rebuildStatsCalls,
    listInjectedIdsCalls,
    getStatsCalls,
    now,
  }
  return world
}

/** 由写入行合成磁盘行（时间戳取受控时钟）。 */
function entryFromRow(row: ExperienceInsertRow, now: number): ExperienceEntry {
  return {
    id: row.id,
    active: true,
    experienceType: row.experienceType,
    responsibility: row.responsibility,
    taskType: row.taskType,
    decisionDomain: row.decisionDomain,
    situation: row.situation,
    trigger: row.trigger,
    principle: row.principle,
    recommendedAction: row.recommendedAction,
    exclusions: [...row.exclusions],
    evidence: [...row.evidence],
    taskRetrievalText: row.taskRetrievalText,
    decisionRetrievalText: row.decisionRetrievalText,
    embeddingModel: row.embeddingModel,
    embeddingDimension: row.embeddingDimension,
    sourceRunId: row.sourceRunId,
    generationPromptId: row.generationPromptId,
    generationPromptVersion: row.generationPromptVersion,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 摆放一条既有经验：入表 + 登记向量 + 登记召回行（召回只读活跃行，故归档条目不入召回行）。
 * 为什么三者一起登记：真实资产库里这三者来自同一行的不同列，分开摆放会让用例出现
 * 「查得到判重向量却查不到召回行」这种现实中不存在的中间态。
 */
export function seedEntry(
  world: FakeExperienceWorld,
  overrides: Partial<ExperienceEntry> = {},
  vectors: { decisionVector?: Float64Array; taskVector?: Float64Array } = {},
): ExperienceEntry {
  const entry = createEntry(overrides)
  const decisionEmbedding = vectors.decisionVector ?? derivedVector(entry.decisionRetrievalText, world.embedding.dimension)
  const taskEmbedding = vectors.taskVector ?? derivedVector(entry.taskRetrievalText, world.embedding.dimension)
  world.entries.set(entry.id, entry)
  world.decisionVectors.set(entry.id, decisionEmbedding)
  if (entry.active) {
    const rows = world.retrievalRows.get(entry.experienceType)
    rows?.push({
      id: entry.id,
      taskEmbedding,
      taskRetrievalText: entry.taskRetrievalText,
      decisionEmbedding,
      decisionRetrievalText: entry.decisionRetrievalText,
    })
  }
  return entry
}

/** 摆放生成 Prompt（三类经验各一条 active）。 */
export function seedPrompts(world: FakeExperienceWorld): void {
  for (const type of FIXTURE_TYPES) world.prompts.set(type, createPrompt(type))
}

/** 摆放一条运行事实：会话有活跃 run。 */
export function seedActiveRun(world: FakeExperienceWorld, sessionId: string, runId = "run-1", flowId = "flow-1"): void {
  world.runtimeFacts.activeRuns.set(sessionId, { runId, flowId, sessionId })
}

/** 摆放一条运行事实：子代理可定位到 run。 */
export function seedChildRun(
  world: FakeExperienceWorld,
  childId: string,
  facts: { runId?: string; flowId?: string; sessionId: string; nodeId?: string },
): void {
  world.runtimeFacts.childRuns.set(childId, {
    runId: facts.runId ?? "run-1",
    flowId: facts.flowId ?? "flow-1",
    sessionId: facts.sessionId,
    nodeId: facts.nodeId ?? "node-1",
  })
}

/** 判重判据的类型别名（fixture 侧引用，避免用例重复导入）。 */
export type { ExperienceDuplicateJudge }

/**
 * 摆放一条使用事实（该主体已被显式注入过该经验）。
 * 为什么不经端口方法：feedback 的准入判据读的是历史事实，用例需要直接构造「历史已有注入」，
 * 与本次调用是否发生解耦。
 */
export function seedInjected(
  world: FakeExperienceWorld,
  input: { subjectId: string; experienceId: string; runId?: string },
): ExperienceUsageEntry {
  const row: ExperienceUsageEntry = {
    experienceId: input.experienceId,
    runId: input.runId ?? "run-1",
    subjectId: input.subjectId,
    id: `usage-seed-${world.usageRows.length + 1}`,
    createdAt: world.now,
  }
  world.usageRows.push(row)
  return row
}

/**
 * 摆放一条使用事实的**真实路径**：经端口写入。
 *
 * 为什么与 seedInjected 并存：统计行（含 recalled_count）由端口在写入使用时同步建立，
 * 直接推数组会造出「有使用事实但没有统计行」这一生产中不存在的中间态，
 * 让「增量统计」与「重放统计」出现假差异。
 */
export async function seedUsed(
  world: FakeExperienceWorld,
  input: { subjectId: string; experienceId: string; runId?: string },
): Promise<void> {
  await world.store.recordUsage({
    rows: [{ experienceId: input.experienceId, runId: input.runId ?? "run-1", subjectId: input.subjectId }],
    neutralStats: NEUTRAL_STATS,
  })
}

/** 摆放一条统计投影（缺行代表「证据不足」，用例据此构造有/无统计两种读侧状态）。 */export function seedStats(
  world: FakeExperienceWorld,
  experienceId: string,
  values: Partial<ExperienceStatsValues>,
): ExperienceStatsEntry {
  const row: ExperienceStatsEntry = {
    experienceId,
    effectiveSampleCount: 0,
    recalledCount: 0,
    usedCount: 0,
    fitMean: 0,
    empiricalValue: 0,
    variance: 0,
    stability: 1,
    evidenceStrength: 0,
    harmCount: 0,
    harmRate: 0,
    harmSeverity: 0,
    qualitySignal: 0,
    trust: 0.5,
    updatedAt: world.now,
    ...values,
  }
  world.stats.set(experienceId, row)
  return row
}

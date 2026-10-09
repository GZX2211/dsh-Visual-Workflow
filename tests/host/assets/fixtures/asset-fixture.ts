// tests/host/assets/fixtures/asset-fixture.ts
//
// 资产库测试的共享夹具：临时目录 + 注入固定时钟与固定 id 源的 AssetStore，
// 以及角色模版 / 角色节点 / 连线的构造器。
//
// 为什么不共用 store 实例：测试必须独立（无共享可变状态、无残留文件），
// 每个用例各自持有临时目录，afterEach 时整体删除。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ExperienceDuplicateJudge,
  ExperienceEvaluationInsert,
  ExperienceEvaluationScores,
  ExperienceInsertRow,
  ExperienceStatsAggregate,
  ExperienceUsageInsert,
  NeutralStatsValues,
} from '../../../../src/host/shared/asset-types.js'
import type { GraphNode, Handle, Line, RoleNode } from '../../../../src/host/shared/graph-model.js'
import type { OrgMeta } from '../../../../src/host/shared/org-meta.js'
import type { RoleTemplate } from '../../../../src/host/shared/template-types.js'
import { ASSET_DB_FILE, AssetStore, type AssetStoreDeps } from '../../../../src/host/assets/index.js'

/** 固定起始时间（epoch 毫秒；断言只依赖相对顺序与固定值）。 */
export const FIXED_NOW = 1_700_000_000_000

/** 每次读取表时间前进 1000ms：保证同用例内 updatedAt/createdAt 可比较且确定。 */
export function fakeClock(start = FIXED_NOW): () => number {
  let current = start - 1000
  return () => {
    current += 1000
    return current
  }
}

/**
 * 可手动推进的时钟：把「写入时取当前时刻记账」变成可断言的事实。
 * 为什么需要它：恒定或自动前进的时钟都无法区分「刷新了记账时间」与「恰好取到同一个值」，
 * 而记账时间是否刷新正是 AGENTS「updated_at 每次写入刷新」这条硬规则的唯一可观测面。
 */
export function settableClock(start = FIXED_NOW): { now: () => number; set: (value: number) => void } {
  let current = start
  return {
    now: () => current,
    set: (value: number) => {
      current = value
    },
  }
}

/** 固定 id 源：序号递增，随机源恒为 0，使资产 id 形如 `role-1`。 */
export function fakeIds(): AssetStoreDeps['ids'] {
  let sequence = 0
  return {
    random: () => 0,
    sequence: () => {
      sequence += 1
      return sequence
    },
  }
}

/** 建临时目录与资产库（调用方负责 afterEach 时 close + removeTempRoot）。 */
export async function makeStore(): Promise<{ store: AssetStore; root: string }> {
  return makeStoreWithClock(fakeClock())
}

/** 建临时目录与资产库，使用调用方给定的时钟（需要手动推进时传 settableClock().now）。 */
export async function makeStoreWithClock(now: () => number): Promise<{ store: AssetStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-'))
  const store = new AssetStore(root, { now, ids: fakeIds() })
  await store.init()
  return { store, root }
}

/** 删除临时目录（关闭由调用方负责；此函数只清磁盘）。 */
export async function removeTempRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

/**
 * 绕过 AssetStore 直接打开库文件：用于断言磁盘形状，以及手工制造 Store 写不出的
 * 损坏事实（例如长度非 8 字节倍数的向量 BLOB）。
 */
export async function openRawDb(root: string): Promise<DatabaseSync> {
  const { DatabaseSync } = await import("node:sqlite")
  return new DatabaseSync(join(root, ASSET_DB_FILE))
}

/** 向量构造器：用例只写出关心的数值分量。 */
export function vector(...values: number[]): Float64Array {
  return Float64Array.from(values)
}

/** 直连库文件执行只读查询：用于断言真正落盘的磁盘事实（写侧一律走 store）。 */
export async function rawQuery(
  root: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const raw = await openRawDb(root)
  try {
    return raw
      .prepare(sql)
      .all(...(params as never[]))
      .map((row) => ({ ...(row as Record<string, unknown>) }))
  } finally {
    raw.close()
  }
}

/** 缺省判重：一律不重复（只验证写入路径本身时使用）。 */
export const keepAllJudge: ExperienceDuplicateJudge = () => ({ duplicate: false })

/** 经验写入行构造器（provenance 与向量元信息给出合法默认值，整体可覆盖）。 */
export function experienceRow(id: string, overrides: Partial<ExperienceInsertRow> = {}): ExperienceInsertRow {
  return {
    id,
    experienceType: "agent",
    responsibility: "负责资产库的持久化事实",
    taskType: "软件开发",
    decisionDomain: "共享契约冻结时机",
    situation: "两端并行开发同一份跨模块契约",
    trigger: "两端各自定义同一契约的字段时",
    principle: "共享契约先冻结再并行实现",
    recommendedAction: "先冻结类型与命名，再各自实现两端",
    exclusions: ["一次性脚本"],
    evidence: ["两端字段名漂移导致返工"],
    taskRetrievalText: "资产库持久化 软件开发 并行开发 契约漂移",
    taskEmbedding: vector(0.1, 0.2, 0.3),
    decisionRetrievalText: "共享契约冻结时机 先冻结契约 一次性脚本",
    decisionEmbedding: vector(0.4, 0.5, 0.6),
    embeddingModel: "test-embed",
    embeddingDimension: 3,
    sourceRunId: "run-1",
    generationPromptId: "ep-agent-v1",
    generationPromptVersion: "V1",
    ...overrides,
  }
}

/** 使用事实写入行构造器（行 id 由资产库发号，因此入参不含 id）。 */
export function usageRow(
  experienceId: string,
  overrides: Partial<ExperienceUsageInsert> = {},
): ExperienceUsageInsert {
  return { experienceId, runId: "run-1", subjectId: "session-1", ...overrides }
}

/** 评价写入行构造器（默认锚点便于手算断言，整体可覆盖）。 */
export function evaluationRow(
  experienceId: string,
  overrides: Partial<ExperienceEvaluationInsert> = {},
): ExperienceEvaluationInsert {
  return {
    experienceId,
    runId: "run-1",
    fitScore: 0.75,
    decisionEffect: 0.5,
    informationGain: 0.75,
    causalConfidence: 0.75,
    evidence: "该经验直接影响了并行/串行选择。",
    evaluatorSubjectId: "session-1",
    evaluatorModel: "test-model",
    ...overrides,
  }
}

/**
 * 测试用中性统计口径（数值与经验域 NEUTRAL_STATS 同域，但测试不反向依赖域模块：
 * 资产库只负责「按调用方给的口径建行」，口径属经验域）。
 */
export function neutralStatsFixture(): NeutralStatsValues {
  return {
    effectiveSampleCount: 0,
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
  }
}

/**
 * 测试用最简聚合器：只回答「资产库是否把全部评价历史与 recalledCount 原样交给聚合器、
 * 并把返回值原样落盘」，刻意不复刻生产公式（公式属经验域，见 §26）。
 * 每个字段都能手算：effectiveSampleCount 取条数 × 2，用于区分「有效样本量」与「评价条数」。
 */
export const simpleStatsAggregate: ExperienceStatsAggregate = ({ evaluations, recalledCount }) => {
  const count = evaluations.length
  const mean = (pick: (scores: ExperienceEvaluationScores) => number): number =>
    count === 0 ? 0 : evaluations.reduce((sum, scores) => sum + pick(scores), 0) / count
  // 显式落到 number：锚点联合类型会把 reduce 的累加器收窄成联合，算术结果并不是锚点
  const effects: number[] = evaluations.map((scores) => scores.decisionEffect)
  const harmCount = effects.filter((value) => value < 0).length
  const harmMass = effects.reduce((sum, value) => sum + (value < 0 ? -value : 0), 0)
  const empiricalValue = mean((scores) => scores.decisionEffect)
  const evidenceStrength = count / (count + 1)
  return {
    effectiveSampleCount: count * 2,
    recalledCount,
    usedCount: count,
    fitMean: mean((scores) => scores.fitScore),
    empiricalValue,
    variance: 0,
    stability: count === 0 ? 1 : 0.5,
    evidenceStrength,
    harmCount,
    harmRate: count === 0 ? 0 : harmCount / count,
    harmSeverity: count === 0 ? 0 : harmMass / count,
    qualitySignal: empiricalValue * evidenceStrength,
    trust: 0.5 + 0.45 * empiricalValue,
  }
}

/** 角色模版构造器（默认值可整体覆盖）。 */
export function roleTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  return {
    id: 'tpl-role-1',
    kind: 'agent',
    name: '研究员',
    systemPrompt: '你是研究员。',
    provider: 'deepseek',
    model: 'deepseek-chat',
    retryLimit: 2,
    ...overrides,
  }
}

/**
 * 角色节点构造器。
 * data 允许只覆盖需要变化的字段（未给出的字段用默认值补齐）：用例常只改 systemPrompt
 * 或只加 sourceAssetId，要求每次写全 data 会让用例噪声盖过意图。
 */
export function roleNode(
  overrides: Partial<Omit<RoleNode, 'data'>> & { id: string; data?: Partial<RoleNode['data']> },
): RoleNode {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'agent',
    position: overrides.position ?? { x: 10, y: 20 },
    data: {
      label: '研究员',
      systemPrompt: '你是研究员。',
      provider: 'deepseek',
      model: 'deepseek-chat',
      retryLimit: 2,
      ...overrides.data,
    },
  }
}

/** 阶段节点（非角色节点的重建等价性判据）。 */
export function stageNode(id: string): GraphNode {
  return { id, kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }
}

/** 连线构造器（默认流程出→流程入）。 */
export function flowLine(id: string, source: string, target: string, sourceHandle: Handle = 'flow-out', targetHandle: Handle = 'flow-in'): Line {
  return { id, source, target, sourceHandle, targetHandle }
}

/** 元参数（工作流资产的 meta 往返断言用）。 */
export function orgMeta(): OrgMeta {
  return { nodeMax: 12 }
}

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
    // 新库播种的提示词版本行 id（`<assetId>@<versionId>`）；外键要求它真实存在
    generationPromptId: "ep-agent@1",
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

// ---------------------------------------------------------------------------
// team 主体类型退役迁移的遗留库夹具
//
// 为什么按合法旧形状整体构造、而不复用 src 的 DDL 常量做字符串替换：迁移判据读的是
// sqlite_master 的原文，若夹具由当前源码 DDL 派生，「遗留库能否被识别」会随源码改动
// 自动变成恒真，迁移判定就再也测不到。这里刻意手写冻结副本。
// ---------------------------------------------------------------------------

/** 退役前的 experience_prompts 形状（experience_type 仍含 'team'）。 */
export const LEGACY_TEAM_PROMPTS_DDL = `
CREATE TABLE experience_prompts (
  id TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','team','orchestrator')),
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

/** 退役前的 experiences 形状（experience_type 仍含 'team'）。 */
export const LEGACY_TEAM_EXPERIENCES_DDL = `
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','team','orchestrator')),
  responsibility TEXT NOT NULL,
  task_type TEXT NOT NULL,
  decision_domain TEXT NOT NULL,
  situation TEXT NOT NULL,
  trigger TEXT NOT NULL,
  principle TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  exclusions TEXT NOT NULL CHECK (json_valid(exclusions)),
  evidence TEXT NOT NULL CHECK (json_valid(evidence)),
  task_retrieval_text TEXT NOT NULL,
  task_embedding BLOB,
  decision_retrieval_text TEXT NOT NULL,
  decision_embedding BLOB,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  source_run_id TEXT NOT NULL,
  generation_prompt_id TEXT NOT NULL REFERENCES experience_prompts(id),
  generation_prompt_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

/** 遗留库的 Prompt 行：agent / orchestrator / team 三类各一活跃，另加一条归档版本。 */
export const LEGACY_TEAM_PROMPT_ROWS = [
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-agent-v1', 'agent', 'Agent Experience Generation Prompt', '遗留 agent 描述', '遗留 agent 正文', 'V1', 1, 1000, 1000)`,
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-orchestrator-v1', 'orchestrator', 'Orchestration Experience Generation Prompt', '遗留编排描述', '遗留编排正文', 'V1', 1, 1000, 1000)`,
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-team-v1', 'team', 'Team Experience Generation Prompt', '遗留 team 描述', '遗留 team 正文', 'V1', 1, 1000, 1000)`,
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-agent-v0', 'agent', '旧版 Agent Prompt', '遗留归档描述', '遗留归档正文', 'V0', 0, 900, 900)`,
]

/** 遗留库的经验行：agent 活跃 / agent 归档 / orchestrator 活跃 / team 活跃。 */
export const LEGACY_TEAM_EXPERIENCE_ROWS = [
  experienceRowSql("ex-agent", "agent", "ep-agent-v1", "ex-agent 决策侧", 1),
  experienceRowSql("ex-agent-archived", "agent", "ep-agent-v1", "已归档的 agent", 0),
  experienceRowSql("ex-orch", "orchestrator", "ep-orchestrator-v1", "ex-orch 决策侧", 1),
  experienceRowSql("ex-team", "team", "ep-team-v1", "ex-team 决策侧", 1),
]

/**
 * 遗留库的「评价闭环」子行：给每条经验各配一行使用 / 评价 / 统计。
 * 为什么每条经验都要配全：迁移必须先清子行再删父行，只给 team 配子行时无法证明
 * 「agent/orchestrator 的子行没被连带删掉」；而 ex-team 统计行的 recalled_count 刻意取 9，
 * 便于断言「team 的统计行确实消失」而不是「恰好被重建成同值」。
 */
export const LEGACY_TEAM_CHILD_ROWS = [
  `INSERT INTO experience_usage (id, experience_id, run_id, subject_id, created_at) VALUES
     ('xus-agent', 'ex-agent', 'run-1', 'session-1', 1000),
     ('xus-agent-archived', 'ex-agent-archived', 'run-1', 'session-1', 1000),
     ('xus-orch', 'ex-orch', 'run-1', 'session-2', 1000),
     ('xus-team', 'ex-team', 'run-1', 'session-3', 1000)`,
  `INSERT INTO experience_evaluation (id, experience_id, run_id, fit_score, decision_effect, information_gain, causal_confidence, evidence, evaluator_subject_id, evaluator_model, created_at) VALUES
     ('xev-agent', 'ex-agent', 'run-1', 0.75, 0.5, 0.75, 0.75, 'agent 证据', 'session-1', 'model-1', 1000),
     ('xev-agent-archived', 'ex-agent-archived', 'run-1', 0.75, 0.5, 0.75, 0.75, 'agent 归档证据', 'session-1', 'model-1', 1000),
     ('xev-orch', 'ex-orch', 'run-1', 0.5, 0.5, 0.5, 0.5, '编排证据', 'session-2', 'model-1', 1000),
     ('xev-team', 'ex-team', 'run-1', 1, 0.5, 1, 1, 'team 证据', 'session-3', 'model-1', 1000)`,
  `INSERT INTO experience_stats (experience_id, effective_sample_count, recalled_count, used_count, fit_mean, empirical_value, variance, stability, evidence_strength, harm_count, harm_rate, harm_severity, quality_signal, trust, updated_at) VALUES
     ('ex-agent', 2, 1, 1, 0.75, 0.5, 0, 0.5, 0.5, 0, 0, 0, 0.25, 0.725, 1000),
     ('ex-agent-archived', 2, 1, 1, 0.75, 0.5, 0, 0.5, 0.5, 0, 0, 0, 0.25, 0.725, 1000),
     ('ex-orch', 2, 1, 1, 0.5, 0.5, 0, 0.5, 0.5, 0, 0, 0, 0.25, 0.725, 1000),
     ('ex-team', 1, 9, 1, 1, 0.5, 0, 0.5, 0.5, 0, 0, 0, 0.25, 0.725, 1000)`,
]

/** 遗留库引用的索引名（与 src DDL 同名：迁移后的重建必须把它们全部恢复）。 */
export const LEGACY_TEAM_INDEX_NAMES = [
  'idx_experience_prompts_active_type',
  'idx_experience_prompts_type',
  'idx_experiences_decision_domain',
  'idx_experiences_generation_prompt',
  'idx_experiences_source_run',
  'idx_experiences_task_type',
  'idx_experiences_type_active',
  'idx_experience_usage_experience',
  'idx_experience_usage_subject',
  'idx_experience_evaluation_created',
  'idx_experience_evaluation_experience',
  'idx_experience_stats_harm',
  'idx_experience_stats_trust',
]

/** 一条经验行的 INSERT 语句（向量落 BLOB 与维度 3 一致，读侧才不会判为不可用）。 */
function experienceRowSql(
  id: string,
  experienceType: string,
  generationPromptId: string,
  decisionRetrievalText: string,
  isActive: number,
): string {
  return `INSERT INTO experiences (
    id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
    principle, recommended_action, exclusions, evidence, task_retrieval_text, task_embedding,
    decision_retrieval_text, decision_embedding, embedding_model, embedding_dimension,
    source_run_id, generation_prompt_id, generation_prompt_version, is_active, created_at, updated_at
  ) VALUES (
    '${id}', '${experienceType}', '职责说明', '软件开发', '决策域', '情境', '触发条件',
    '原则', '建议行动', '["一次性脚本"]', '["证据一"]', '任务侧检索文本', x'0000000000000000',
    '${decisionRetrievalText}', x'0000000000000000', 'legacy-embed', 3,
    'run-1', '${generationPromptId}', 'V1', ${isActive}, 1000, 1000
  )`
}

/**
 * 建一个「team 类型退役前」的完整遗留库（两张表均为含 'team' 的旧 CHECK 形状）。
 *
 * 为什么先建新形状再删表回退、而不是从零手写全部 DDL：其余五张表的形状与本次迁移无关，
 * 复用 initSchema 建好后只回退两张目标表，夹具的体积与漂移面都最小；同时索引保持同名，
 * 能顺带验证迁移后的索引恢复。
 */
export async function makeLegacyTeamRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-legacy-team-'))
  const raw = await openRawDb(root)
  try {
    const { initSchema } = await import('../../../../src/host/assets/schema.js')
    initSchema(raw, () => 1000)
    // 回退期间两表互有外键（experiences → experience_prompts），且要丢掉既有索引
    raw.exec('PRAGMA foreign_keys = OFF')
    try {
      raw.exec("DROP TABLE experience_stats")
      raw.exec("DROP TABLE experience_evaluation")
      raw.exec("DROP TABLE experience_usage")
      raw.exec("DROP TABLE experiences")
      raw.exec("DROP TABLE experience_prompts")
      raw.exec(LEGACY_TEAM_PROMPTS_DDL)
      raw.exec(LEGACY_TEAM_EXPERIENCES_DDL)
      for (const statement of LEGACY_TEAM_PROMPT_ROWS) raw.exec(statement)
      for (const statement of LEGACY_TEAM_EXPERIENCE_ROWS) raw.exec(statement)
      raw.exec(`CREATE TABLE experience_usage (
        id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL REFERENCES experiences(id),
        run_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`)
      raw.exec(`CREATE TABLE experience_evaluation (
        id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL REFERENCES experiences(id),
        run_id TEXT NOT NULL,
        fit_score REAL NOT NULL CHECK(fit_score IN (0,0.25,0.5,0.75,1)),
        decision_effect REAL NOT NULL CHECK(decision_effect IN (-1,-0.5,0,0.5,1)),
        information_gain REAL NOT NULL CHECK(information_gain IN (0,0.25,0.5,0.75,1)),
        causal_confidence REAL NOT NULL CHECK(causal_confidence IN (0,0.25,0.5,0.75,1)),
        evidence TEXT NOT NULL DEFAULT '',
        evaluator_subject_id TEXT NOT NULL,
        evaluator_model TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`)
      raw.exec(`CREATE TABLE experience_stats (
        experience_id TEXT PRIMARY KEY REFERENCES experiences(id),
        effective_sample_count REAL NOT NULL,
        recalled_count INTEGER NOT NULL,
        used_count INTEGER NOT NULL,
        fit_mean REAL NOT NULL,
        empirical_value REAL NOT NULL,
        variance REAL NOT NULL,
        stability REAL NOT NULL,
        evidence_strength REAL NOT NULL,
        harm_count INTEGER NOT NULL,
        harm_rate REAL NOT NULL,
        harm_severity REAL NOT NULL,
        quality_signal REAL NOT NULL,
        trust REAL NOT NULL,
        updated_at INTEGER NOT NULL
      )`)
      for (const statement of LEGACY_TEAM_CHILD_ROWS) raw.exec(statement)
    } finally {
      raw.exec('PRAGMA foreign_keys = ON')
    }
  } finally {
    raw.close()
  }
  return root
}

/**
 * 建一个「混合态」库：experiences 已收窄，experience_prompts 仍是含 'team' 的宽 CHECK，
 * 且库里还留着 team Prompt 行。
 *
 * 为什么必须有这个夹具：真实升级路径上两张表可能先后被收窄（例如旧版本只迁移了一张表、
 * 或人工补过数据），迁移判据若只看一张表就会漏掉另一张的 team 行与宽约束。
 */
export async function makeMixedTeamShapeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-mixed-team-'))
  const raw = await openRawDb(root)
  try {
    const { EXPERIENCES_DDL, initSchema } = await import(
      '../../../../src/host/assets/schema.js'
    )
    initSchema(raw, () => 1000)
    raw.exec('PRAGMA foreign_keys = OFF')
    try {
      raw.exec('DROP TABLE experience_prompts')
      raw.exec(LEGACY_TEAM_PROMPTS_DDL)
      for (const statement of LEGACY_TEAM_PROMPT_ROWS) raw.exec(statement)
      // experiences 换成已收窄的形状：即「只有 prompts 表还是宽 CHECK」的混合态
      raw.exec('DROP TABLE experiences')
      raw.exec(EXPERIENCES_DDL)
      raw.exec(`INSERT INTO experiences (
        id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
        principle, recommended_action, exclusions, evidence, task_retrieval_text, task_embedding,
        decision_retrieval_text, decision_embedding, embedding_model, embedding_dimension,
        source_run_id, generation_prompt_id, generation_prompt_version, is_active, created_at, updated_at
      ) VALUES
        ('ex-agent', 'agent', '职责', '软件开发', '决策域', '情境', '触发', '原则', '行动', '["一次性脚本"]',
         '["证据一"]', '任务侧', x'0000000000000000', 'agent 决策侧', x'0000000000000000', 'legacy-embed', 3,
         'run-1', 'ep-agent-v1', 'V1', 1, 1000, 1000),
        ('ex-orch', 'orchestrator', '职责', '软件开发', '决策域', '情境', '触发', '原则', '行动', '["一次性脚本"]',
         '["证据一"]', '任务侧', x'0000000000000000', 'orchestrator 决策侧', x'0000000000000000', 'legacy-embed', 3,
         'run-1', 'ep-orchestrator-v1', 'V1', 1, 1000, 1000)`)
    } finally {
      raw.exec('PRAGMA foreign_keys = ON')
    }
  } finally {
    raw.close()
  }
  return root
}

/**
 * 建一个「旧表多出一个未知列」的遗留库：用于验证重建前的列集合校验。
 *
 * 为什么需要它：换表重建会按当前列清单搬迁，旧表多出的列会被静默丢弃；
 * 这种库来自未知形状，宁可报可行动错误也不该悄悄删列。
 */
export async function makeUnexpectedColumnTeamRoot(): Promise<string> {
  const root = await makeLegacyTeamRoot()
  const raw = await openRawDb(root)
  try {
    raw.exec('PRAGMA foreign_keys = OFF')
    try {
      raw.exec('ALTER TABLE experiences ADD COLUMN legacy_note TEXT')
    } finally {
      raw.exec('PRAGMA foreign_keys = ON')
    }
  } finally {
    raw.close()
  }
  return root
}

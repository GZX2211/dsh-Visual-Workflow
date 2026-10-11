// tests/host/assets/schema.test.ts
//
// 经验域磁盘形状契约：experience_prompts / experiences 的列与索引、活跃 Prompt 的
// 数据库级唯一性、两个主体类型种子播种的幂等与非破坏性、旧形状 experiences 的删表重建，
// 以及 team 主体类型退役时的存量数据清除与 CHECK 收窄。
//
// 为什么旧形状 DDL 在测试里写死副本：迁移判定读的是 sqlite_master 的原文，
// 若测试直接引用源码 DDL，「旧库能否升级」会随源码改动自动变成恒真。

import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EXPERIENCE_TYPE_VALUES } from "../../../src/host/assets/experience-codec.js"
import { EXPERIENCE_PROMPT_SEEDS, EXPERIENCE_PROMPT_SEED_VERSION } from "../../../src/host/assets/experience-seeds.js"
import { AssetStore } from "../../../src/host/assets/index.js"
import { initSchema } from "../../../src/host/assets/schema.js"
import {
  evaluationRow,
  experienceRow,
  fakeClock,
  fakeIds,
  keepAllJudge,
  LEGACY_TEAM_INDEX_NAMES,
  makeLegacyTeamRoot,
  makeMixedTeamShapeRoot,
  makeStore,
  makeUnexpectedColumnTeamRoot,
  neutralStatsFixture,
  openRawDb,
  rawQuery,
  removeTempRoot,
  simpleStatsAggregate,
  usageRow,
} from "./fixtures/asset-fixture.js"

/** 新 experiences 的列集合（按 DDL 声明顺序）。 */
const EXPERIENCES_COLUMNS = [
  "id",
  "experience_type",
  "responsibility",
  "task_type",
  "decision_domain",
  "situation",
  "trigger",
  "principle",
  "recommended_action",
  "exclusions",
  "evidence",
  "task_retrieval_text",
  "task_embedding",
  "decision_retrieval_text",
  "decision_embedding",
  "embedding_model",
  "embedding_dimension",
  "source_run_id",
  "generation_prompt_id",
  "generation_prompt_version",
  "is_active",
  "created_at",
  "updated_at",
]

const EXPERIENCES_INDEXES = [
  "idx_experiences_decision_domain",
  "idx_experiences_generation_prompt",
  "idx_experiences_source_run",
  "idx_experiences_task_type",
  "idx_experiences_type_active",
]

const EXPERIENCE_PROMPT_COLUMNS = [
  "id",
  "experience_type",
  "name",
  "description",
  "prompt",
  "prompt_version",
  "is_active",
  "created_at",
  "updated_at",
]

const EXPERIENCE_PROMPT_INDEXES = ["idx_experience_prompts_active_type", "idx_experience_prompts_type"]

/** 评价闭环三表的列集合（按 DDL 声明顺序）与索引（升序，便于与 PRAGMA 结果比对）。 */
const EXPERIENCE_USAGE_COLUMNS = ["id", "experience_id", "run_id", "subject_id", "created_at"]
const EXPERIENCE_EVALUATION_COLUMNS = [
  "id",
  "experience_id",
  "run_id",
  "fit_score",
  "decision_effect",
  "information_gain",
  "causal_confidence",
  "evidence",
  "evaluator_subject_id",
  "evaluator_model",
  "created_at",
]
const EXPERIENCE_STATS_COLUMNS = [
  "experience_id",
  "effective_sample_count",
  "recalled_count",
  "used_count",
  "fit_mean",
  "empirical_value",
  "variance",
  "stability",
  "evidence_strength",
  "harm_count",
  "harm_rate",
  "harm_severity",
  "quality_signal",
  "trust",
  "updated_at",
]
const EXPERIENCE_USAGE_INDEXES = ["idx_experience_usage_experience", "idx_experience_usage_subject"]
const EXPERIENCE_EVALUATION_INDEXES = [
  "idx_experience_evaluation_created",
  "idx_experience_evaluation_experience",
]
const EXPERIENCE_STATS_INDEXES = ["idx_experience_stats_harm", "idx_experience_stats_trust"]

/** 不可变历史表：只允许 INSERT 与 SELECT。 */
const IMMUTABLE_EXPERIENCE_TABLES = ["experience_usage", "experience_evaluation"]

/** 退役迁移收窄主体类型时被清理的表（子行三张 + 两张父表）。 */
const EXPERIENCE_TABLES_NARROWED_BY_MIGRATION = [
  "experience_usage",
  "experience_evaluation",
  "experience_stats",
  "experiences",
  "experience_prompts",
]

/**
 * 可在任意位置删除的表：统计投影是可重建派生结果（`experience-stats.ts` 有整表覆盖写，
 * 见模块 AGENTS「统计是缓存，可重建」），不受「只允许迁移清理」这条限制。
 */
const PROJECTION_TABLE_DELETABLE_ANYWHERE = "experience_stats"

/** 除投影表外，迁移才允许删除的表（其它模块出现即为越界删除）。 */
const MIGRATION_ONLY_DELETE_TABLES = EXPERIENCE_TABLES_NARROWED_BY_MIGRATION.filter(
  (table) => table !== PROJECTION_TABLE_DELETABLE_ANYWHERE,
)

/** 唯一允许清理退役数据的地方（`src/host/assets/schema.ts` 内的迁移函数）。 */
const RETIRED_TEAM_MIGRATION_FUNCTION = "retireTeamExperienceType"

/**
 * 清理语句必须带的退役类型限定（源码常量形式：迁移绑定常量而不是内联 'team'）。
 * 门禁只认「按退役类型限定」这一事实，不要求某个写法；另有断言直接锁定常量的取值，
 * 防止常量被改成别的类型而门禁仍然通过。子行删除把限定写在子查询里，也算数。
 */
const RETIRED_TEAM_TYPE_PREDICATE = "experience_type = '${RETIRED_EXPERIENCE_TYPE}'"
const RETIRED_TEAM_TYPE_CONSTANT = "RETIRED_EXPERIENCE_TYPE"
const RETIRED_TEAM_TYPE_VALUE = "'team'"

/** 迁移前的经验表形状（冻结副本：早期版本无 experience_type，用的是 task_context/insight 单体形状）。 */
const LEGACY_EXPERIENCES_DDL = `
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  reflection_prompt_version TEXT NOT NULL DEFAULT '1',
  task_type TEXT NOT NULL,
  task_context TEXT NOT NULL,
  insight TEXT NOT NULL,
  evidence TEXT,
  review_feedback TEXT,
  reviewed_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const LEGACY_EXPERIENCES_INDEXES = [
  "CREATE INDEX idx_experiences_task_type ON experiences(task_type)",
  "CREATE INDEX idx_experiences_source_run_id ON experiences(source_run_id)",
]

const LEGACY_EXPERIENCE_ROW = `INSERT INTO experiences (
    id, source_run_id, reflection_prompt_version, task_type, task_context, insight, evidence,
    review_feedback, reviewed_at, is_active, created_at, updated_at
  ) VALUES ('ex-legacy1', 'run-legacy', '1', '软件开发', '旧的上下文', '旧的经验', '旧证据', NULL, 1000, 1, 1000, 1000)`

/** 建一个旧形状的经验库（只有旧 experiences 表；其余表由 init 补齐）。 */
async function makeLegacyExperienceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-assets-legacy-exp-"))
  const raw = await openRawDb(root)
  try {
    raw.exec(LEGACY_EXPERIENCES_DDL)
    for (const statement of LEGACY_EXPERIENCES_INDEXES) raw.exec(statement)
    raw.exec(LEGACY_EXPERIENCE_ROW)
  } finally {
    raw.close()
  }
  return root
}

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

describe("经验域磁盘形状", () => {
  it("test_初始化_新库_两类表列与索引齐备且外键指向Prompt表", async () => {
    const raw = await openRawDb(root)
    let experienceColumns: string[] = []
    let promptColumns: string[] = []
    let experienceIndexes: string[] = []
    let promptIndexes: string[] = []
    let activeIndexSql = ""
    let foreignKeys: Record<string, unknown>[] = []
    try {
      experienceColumns = (raw.prepare("PRAGMA table_info(experiences)").all() as Record<string, unknown>[]).map(
        (row) => String(row.name),
      )
      promptColumns = (raw.prepare("PRAGMA table_info(experience_prompts)").all() as Record<string, unknown>[]).map(
        (row) => String(row.name),
      )
      experienceIndexes = indexNamesOf(raw, "experiences")
      promptIndexes = indexNamesOf(raw, "experience_prompts")
      activeIndexSql = String(
        (
          raw
            .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_experience_prompts_active_type'")
            .get() as Record<string, unknown>
        ).sql,
      )
      foreignKeys = raw.prepare("PRAGMA foreign_key_list(experiences)").all() as Record<string, unknown>[]
    } finally {
      raw.close()
    }

    expect(experienceColumns).toEqual(EXPERIENCES_COLUMNS)
    expect(promptColumns).toEqual(EXPERIENCE_PROMPT_COLUMNS)
    expect(experienceIndexes).toEqual(EXPERIENCES_INDEXES)
    expect(promptIndexes).toEqual(EXPERIENCE_PROMPT_INDEXES)
    // 活跃唯一性必须由数据库保证：索引 SQL 里必须带 is_active = 1 的部分条件
    expect(activeIndexSql).toMatch(/WHERE\s+is_active\s*=\s*1/i)
    expect(foreignKeys).toHaveLength(1)
    expect(foreignKeys[0]).toMatchObject({ table: "experience_prompts", from: "generation_prompt_id", to: "id" })
  })

  it("test_初始化_同类型第二个活跃Prompt_被部分唯一索引拒绝", async () => {
    const raw = await openRawDb(root)
    try {
      expect(() =>
        raw.exec(`INSERT INTO experience_prompts
          (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
          VALUES ('ep-agent-dup', 'agent', '重复活跃', '', '正文', 'V1', 1, 1, 1)`),
      ).toThrow(/UNIQUE/i)

      // 部分索引只约束活跃行：同类型的多个非活跃版本必须可以共存（Prompt 历史保留）
      raw.exec(`INSERT INTO experience_prompts
        (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
        VALUES ('ep-agent-old', 'agent', '旧版本', '', '旧正文', 'V0', 0, 1, 1)`)
      raw.exec(`INSERT INTO experience_prompts
        (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
        VALUES ('ep-agent-older', 'agent', '更旧版本', '', '更旧正文', 'V00', 0, 1, 1)`)

      const active = raw
        .prepare("SELECT COUNT(*) AS total FROM experience_prompts WHERE experience_type = 'agent' AND is_active = 1")
        .get() as Record<string, unknown>
      expect(active).toMatchObject({ total: 1 })
    } finally {
      raw.close()
    }
  })
  it("test_初始化_主体类型取值域_数据库CHECK与编解码白名单完全一致", async () => {
    const raw = await openRawDb(root)
    let experienceCheck: string[] = []
    let promptCheck: string[] = []
    try {
      experienceCheck = experienceTypeCheckValues(tableDdl(raw, "experiences"))
      promptCheck = experienceTypeCheckValues(tableDdl(raw, "experience_prompts"))
    } finally {
      raw.close()
    }

    // 反空洞：解析不出取值域时必须表现为空集，而不是让两边同为 undefined 而意外相等
    expect(experienceCheck).not.toEqual([])
    expect(experienceCheck).toEqual([...EXPERIENCE_TYPE_VALUES])
    expect(promptCheck).toEqual(experienceCheck)
  })

  it("test_初始化_直接插入已退役主体类型_被数据库CHECK拒绝", async () => {
    const raw = await openRawDb(root)
    try {
      // 绕过 store 与 TS 类型（外部工具、补数据脚本都会走这条路径）：边界必须由数据库把住
      expect(() =>
        raw.exec(`INSERT INTO experience_prompts
          (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
          VALUES ('ep-team-injected', 'team', '退役类型', '', '正文', 'V1', 1, 1, 1)`),
      ).toThrow(/CHECK/i)
      expect(() =>
        raw.exec(`INSERT INTO experiences (
          id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
          principle, recommended_action, exclusions, evidence, task_retrieval_text,
          decision_retrieval_text, source_run_id, generation_prompt_id, generation_prompt_version,
          is_active, created_at, updated_at
        ) VALUES (
          'ex-team-injected', 'team', '职责', '软件开发', '决策域', '情境', '触发',
          '原则', '行动', '[]', '[]', '任务侧', '决策侧', 'run-1', 'ep-agent-v1', 'V1', 1, 1, 1
        )`),
      ).toThrow(/CHECK/i)
    } finally {
      raw.close()
    }
  })
})

describe("评价闭环磁盘形状（使用事实 / 评价事实 / 统计投影）", () => {
  it("test_初始化_新库_评价闭环三表列与索引齐备且外键指向经验表", async () => {
    const raw = await openRawDb(root)
    let usageColumns: string[] = []
    let evaluationColumns: string[] = []
    let statsColumns: string[] = []
    let usageIndexes: string[] = []
    let evaluationIndexes: string[] = []
    let statsIndexes: string[] = []
    let foreignKeys: Record<string, unknown>[] = []
    let triggers: Record<string, unknown>[] = []
    try {
      usageColumns = columnsOf(raw, "experience_usage")
      evaluationColumns = columnsOf(raw, "experience_evaluation")
      statsColumns = columnsOf(raw, "experience_stats")
      usageIndexes = indexNamesOf(raw, "experience_usage")
      evaluationIndexes = indexNamesOf(raw, "experience_evaluation")
      statsIndexes = indexNamesOf(raw, "experience_stats")
      foreignKeys = [
        ...(raw.prepare("PRAGMA foreign_key_list(experience_usage)").all() as Record<string, unknown>[]),
        ...(raw.prepare("PRAGMA foreign_key_list(experience_evaluation)").all() as Record<string, unknown>[]),
        ...(raw.prepare("PRAGMA foreign_key_list(experience_stats)").all() as Record<string, unknown>[]),
      ]
      triggers = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Record<string, unknown>[]
    } finally {
      raw.close()
    }

    expect(usageColumns).toEqual(EXPERIENCE_USAGE_COLUMNS)
    expect(evaluationColumns).toEqual(EXPERIENCE_EVALUATION_COLUMNS)
    expect(statsColumns).toEqual(EXPERIENCE_STATS_COLUMNS)
    expect(usageIndexes).toEqual(EXPERIENCE_USAGE_INDEXES)
    expect(evaluationIndexes).toEqual(EXPERIENCE_EVALUATION_INDEXES)
    expect(statsIndexes).toEqual(EXPERIENCE_STATS_INDEXES)
    expect(foreignKeys).toHaveLength(3)
    expect(foreignKeys.map((key) => [key.table, key.from, key.to])).toEqual([
      ["experiences", "experience_id", "id"],
      ["experiences", "experience_id", "id"],
      ["experiences", "experience_id", "id"],
    ])
    // 触发器会带来第二处写入边界：历史不可变靠「不存在写路径」保证，而不是靠触发器兜底
    expect(triggers).toEqual([])
  })

  it("test_初始化_评价表_非锚点评分被取值约束拒绝", async () => {
    await store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
    const raw = await openRawDb(root)
    const insert = (fit: string, effect: string): void => {
      raw.exec(`INSERT INTO experience_evaluation (
        id, experience_id, run_id, fit_score, decision_effect, information_gain, causal_confidence,
        evidence, evaluator_subject_id, evaluator_model, created_at
      ) VALUES ('xev-raw', 'ex-1', 'run-1', ${fit}, ${effect}, 0.5, 0.5, '', 'session-1', '', 1)`)
    }
    try {
      expect(() => insert("0.3", "0.5")).toThrow(/CHECK/i)
      expect(() => insert("0.5", "0.3")).toThrow(/CHECK/i)
      // 合法锚点可写入：证明拒绝来自取值约束，而不是语句本身有别的毛病
      insert("0.5", "-0.5")
    } finally {
      raw.close()
    }
    expect(await rawQuery(root, "SELECT fit_score, decision_effect FROM experience_evaluation")).toEqual([
      { fit_score: 0.5, decision_effect: -0.5 },
    ])
  })

  it("test_源码_整个Host半区_评价与使用历史只允许退役迁移清理删除且禁止任何UPDATE", async () => {
    const sources = await collectHostSources()
    // 反空洞：门禁必须真的扫到那几张历史表的读写文件，否则新增文件绕过门禁时测试仍会通过
    const scanned = sources.filter((file) =>
      IMMUTABLE_EXPERIENCE_TABLES.some((table) => file.text.includes(table)),
    )
    expect(sources.length).toBeGreaterThan(50)
    expect(scanned.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "assets/schema.ts",
        "assets/experience-usage.ts",
        "assets/experience-evaluations.ts",
        "assets/experience-stats.ts",
      ]),
    )

    // 历史不可变 = 业务侧没有改写路径：任何文件都不许 UPDATE 这两张历史事实表
    for (const file of scanned) {
      for (const table of IMMUTABLE_EXPERIENCE_TABLES) {
        expect(file.text, `${file.path} 不得出现 UPDATE ${table}`).not.toMatch(
          new RegExp(`UPDATE\\s+${table}\\b`, "i"),
        )
      }
    }

    // DELETE 的例外只有一个：退役迁移对存量数据的**一次性物理清理**。
    // 例外刻意收窄到三处事实，缺一条门禁就形同放宽：
    //   ① 收窄表只允许在 assets/schema.ts 被删（其它模块不得删这几张表的任何行）；
    //   ② 每条删除必须带退役类型限定（否则就成了「按其它谓词删历史」）；
    //   ③ 这些删除必须位于退役迁移函数体内。
    // experience_stats 属可重建投影（experience-stats.ts 有整表覆盖写），不参与本门禁。
    const schemaSource = sources.find((file) => file.path === "assets/schema.ts")
    if (!schemaSource) throw new Error("门禁未扫到 assets/schema.ts")
    const migrationRange = functionLineRange(schemaSource.text.split("\n"), RETIRED_TEAM_MIGRATION_FUNCTION)
    const schemaDeletes = deleteStatementsIn(schemaSource.text)
    const narrowedDeletes = schemaDeletes.filter((entry) =>
      EXPERIENCE_TABLES_NARROWED_BY_MIGRATION.includes(entry.target),
    )

    for (const file of sources) {
      if (file.path === "assets/schema.ts") continue
      const foreignDeletes = deleteStatementsIn(file.text).filter((entry) =>
        MIGRATION_ONLY_DELETE_TABLES.includes(entry.target),
      )
      expect(
        foreignDeletes.map((entry) => entry.target),
        `${file.path} 不得删除退役收窄表`,
      ).toEqual([])
      for (const table of IMMUTABLE_EXPERIENCE_TABLES) {
        expect(file.text, `${file.path} 不得出现 DELETE FROM ${table}`).not.toMatch(
          new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i"),
        )
      }
    }

    // 反空洞：schema.ts 里必须真的存在这几条收窄表删除，否则下面的断言会在空集上通过
    expect(narrowedDeletes.map((entry) => entry.target).sort()).toEqual(
      [...EXPERIENCE_TABLES_NARROWED_BY_MIGRATION].sort(),
    )
    // 限定条件必须真的是「退役类型」：常量一旦被改成别的类型，本门禁不能再通过
    expect(schemaSource.text).toMatch(
      new RegExp(`const\\s+${RETIRED_TEAM_TYPE_CONSTANT}\\s*=\\s*${RETIRED_TEAM_TYPE_VALUE}`),
    )
    for (const entry of narrowedDeletes) {
      expect(
        entry.line,
        `${entry.target} 的删除必须位于 ${RETIRED_TEAM_MIGRATION_FUNCTION} 内`,
      ).toBeGreaterThanOrEqual(migrationRange.start)
      expect(entry.line).toBeLessThanOrEqual(migrationRange.end)
    }
    // 限定谓词必须写在同一条删除语句里（子行删除的限定在子查询行，故按整条语句判定）
    const schemaCode = stripComments(schemaSource.text)
    expect(
      deleteBlocksOf(schemaCode, narrowedDeletes).every((sql) => sql.includes(RETIRED_TEAM_TYPE_PREDICATE)),
      `收窄表的删除必须限定 ${RETIRED_TEAM_TYPE_PREDICATE}`,
    ).toBe(true)
  })

  it("test_初始化_已有评价与使用事实_重复初始化不改变任何历史行", async () => {
    await store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
    await store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    const before = {
      usage: await rawQuery(root, "SELECT * FROM experience_usage ORDER BY id"),
      evaluation: await rawQuery(root, "SELECT * FROM experience_evaluation ORDER BY id"),
      stats: await rawQuery(root, "SELECT * FROM experience_stats ORDER BY experience_id"),
    }
    expect(before.usage).toHaveLength(1)
    expect(before.evaluation).toHaveLength(1)
    expect(before.stats).toHaveLength(1)
    store.close()

    const reopened = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    try {
      await reopened.init()
      await reopened.init()

      expect({
        usage: await rawQuery(root, "SELECT * FROM experience_usage ORDER BY id"),
        evaluation: await rawQuery(root, "SELECT * FROM experience_evaluation ORDER BY id"),
        stats: await rawQuery(root, "SELECT * FROM experience_stats ORDER BY experience_id"),
      }).toEqual(before)
    } finally {
      reopened.close()
    }
  })
})

describe("经验生成 Prompt 播种", () => {
  it("test_播种_两类主体各一个活跃Prompt且正文取自V1常量", async () => {
    const prompts = await store.listPrompts()

    expect(prompts.map((prompt) => prompt.experienceType).sort()).toEqual(["agent", "orchestrator"])
    expect(prompts.every((prompt) => prompt.active)).toBe(true)
    expect(prompts.every((prompt) => prompt.promptVersion === EXPERIENCE_PROMPT_SEED_VERSION)).toBe(true)
    for (const seed of EXPERIENCE_PROMPT_SEEDS) {
      const stored = prompts.find((prompt) => prompt.experienceType === seed.experienceType)
      expect(stored).toMatchObject({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        prompt: seed.prompt,
        promptVersion: EXPERIENCE_PROMPT_SEED_VERSION,
        active: true,
      })
      // 正文是版本行之后的正文段，不含版本标记本身
      expect(seed.prompt).not.toContain("**Version:**")
    }

    expect((await store.getActivePrompt("agent"))?.prompt.startsWith("你正在为当前 Agent")).toBe(true)
    expect((await store.getActivePrompt("orchestrator"))?.prompt.startsWith("你正在为当前 Orchestrator")).toBe(true)
    // team 已退役：读侧没有活跃 Prompt，也没有任何种子为它播种
    expect(await store.getActivePrompt("team" as never)).toBeNull()
  })

  it("test_播种_重复初始化_不覆盖用户改动也不重复插入", async () => {
    const raw = await openRawDb(root)
    try {
      raw.exec("UPDATE experience_prompts SET prompt = '用户改写后的正文', updated_at = 99 WHERE experience_type = 'agent'")
    } finally {
      raw.close()
    }

    store.close()
    const reopened = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    try {
      await reopened.init()
      await reopened.init()

      const prompts = await reopened.listPrompts()
      expect(prompts).toHaveLength(EXPERIENCE_PROMPT_SEEDS.length)
      expect(prompts.find((prompt) => prompt.experienceType === "agent")?.prompt).toBe("用户改写后的正文")
    } finally {
      reopened.close()
    }
  })

  it("test_播种_时间戳由注入时钟记账", async () => {
    const fixedRoot = await mkdtemp(join(tmpdir(), "dsh-assets-clock-"))
    const fixed = new AssetStore(fixedRoot, { now: () => 42, ids: fakeIds() })
    try {
      await fixed.init()

      const prompts = await fixed.listPrompts()
      expect(prompts).toHaveLength(EXPERIENCE_PROMPT_SEEDS.length)
      expect(prompts.every((prompt) => prompt.createdAt === 42 && prompt.updatedAt === 42)).toBe(true)
    } finally {
      fixed.close()
      await removeTempRoot(fixedRoot)
    }
  })
})

describe("旧形状 experiences 迁移（用户裁决：旧数据直接删除）", () => {
  it("test_迁移_旧形状经验表_删表重建且旧行与备份表都不存在", async () => {
    const legacyRoot = await makeLegacyExperienceRoot()
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()

      const raw = await openRawDb(legacyRoot)
      let columns: string[] = []
      let indexNames: string[] = []
      let legacyRows: Record<string, unknown> | undefined
      let leftovers: Record<string, unknown>[] = []
      try {
        columns = (raw.prepare("PRAGMA table_info(experiences)").all() as Record<string, unknown>[]).map((row) =>
          String(row.name),
        )
        indexNames = indexNamesOf(raw, "experiences")
        legacyRows = raw.prepare("SELECT COUNT(*) AS total FROM experiences").get() as Record<string, unknown>
        // 用 instr 而不是 LIKE：LIKE 的 `_` 是单字符通配符，会把普通表名也算成「残留备份」
        leftovers = raw
          .prepare(
            `SELECT name FROM sqlite_master
              WHERE instr(name, 'backup') > 0 OR instr(name, 'legacy') > 0 OR instr(name, '__') > 0`,
          )
          .all() as Record<string, unknown>[]
      } finally {
        raw.close()
      }

      expect(columns).toEqual(EXPERIENCES_COLUMNS)
      expect(indexNames).toEqual(EXPERIENCES_INDEXES)
      expect(legacyRows).toMatchObject({ total: 0 })
      expect(leftovers).toEqual([])
      // 新库的 Prompt 表与种子在迁移后同样就绪
      expect(await migrated.listPrompts()).toHaveLength(EXPERIENCE_PROMPT_SEEDS.length)
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })

  it("test_迁移_旧库升级后_经验可写入且外键约束已恢复生效", async () => {
    const legacyRoot = await makeLegacyExperienceRoot()
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()

      const inserted = await migrated.insertChecked({
        rows: [experienceRow("ex-after-migration")],
        duplicateOf: keepAllJudge,
      })
      expect(inserted.inserted.map((entry) => entry.id)).toEqual(["ex-after-migration"])

      // 迁移期间外键被关闭，收尾必须恢复：指向不存在 Prompt 的写入要被数据库拒绝
      await expect(
        migrated.insertChecked({
          rows: [experienceRow("ex-bad-prompt", { generationPromptId: "ep-missing" })],
          duplicateOf: keepAllJudge,
        }),
      ).rejects.toThrow(/FOREIGN KEY/i)
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })

  it("test_迁移_重建中途失败_整笔回滚保留旧表而不留半成品", async () => {
    const legacyRoot = await makeLegacyExperienceRoot()
    const seeded = await openRawDb(legacyRoot)
    try {
      // 索引名与表名在 SQLite 里共享命名空间：这个名字会让重建时的建索引语句失败
      seeded.exec("CREATE TABLE idx_experiences_decision_domain (blocked INTEGER)")
    } finally {
      seeded.close()
    }

    const failing = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await expect(failing.init()).rejects.toThrow(/already a table named idx_experiences_decision_domain/)
    } finally {
      failing.close()
    }

    const after = await openRawDb(legacyRoot)
    let columns: string[] = []
    let rows: Record<string, unknown> | undefined
    try {
      columns = (after.prepare("PRAGMA table_info(experiences)").all() as Record<string, unknown>[]).map((row) =>
        String(row.name),
      )
      rows = after.prepare("SELECT COUNT(*) AS total FROM experiences").get() as Record<string, unknown>
    } finally {
      after.close()
    }

    expect(columns).toContain("insight")
    expect(rows).toMatchObject({ total: 1 })
  })

  it("test_迁移_已是新形状_重复初始化不重建且数据保留", async () => {
    await store.insertChecked({ rows: [experienceRow("ex-keep")], duplicateOf: keepAllJudge })
    store.close()

    const reopened = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    try {
      await reopened.init()
      await reopened.init()

      const raw = await openRawDb(root)
      let rows: Record<string, unknown> | undefined
      try {
        rows = raw.prepare("SELECT COUNT(*) AS total FROM experiences").get() as Record<string, unknown>
      } finally {
        raw.close()
      }
      expect(rows).toMatchObject({ total: 1 })
      expect(await reopened.listPrompts()).toHaveLength(EXPERIENCE_PROMPT_SEEDS.length)
      expect((await reopened.getRows(["ex-keep"])).map((entry) => entry.id)).toEqual(["ex-keep"])
    } finally {
      reopened.close()
    }
  })
})

describe("team 主体类型退役迁移（用户裁决：存量 team 数据物理删除）", () => {
  const TABLES = ["experiences", "experience_prompts", "experience_usage", "experience_evaluation", "experience_stats"]
  const SNAPSHOT_KEYS = [...TABLES].sort()
  const SNAPSHOT_ORDER_BY: Record<string, string> = {
    experiences: "id",
    experience_prompts: "id",
    experience_usage: "id",
    experience_evaluation: "id",
    experience_stats: "experience_id",
  }
  let legacyRoot = ""

  beforeEach(async () => {
    legacyRoot = await makeLegacyTeamRoot()
  })

  afterEach(async () => {
    await removeTempRoot(legacyRoot)
  })

  it("test_退役迁移_team行与全部子行被删除且agent与orchestrator数据完好", async () => {
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()
    } finally {
      migrated.close()
    }

    const snapshot = await tableSnapshot(legacyRoot, SNAPSHOT_ORDER_BY)
    // 保留哪些行是迁移的契约，行序不是：重建后的物理行序属实现细节，断言前先排序
    const idsOf = (rows: Record<string, unknown>[], column: string): string[] =>
      rows.map((row) => String(row[column])).sort()

    // team 行在两张表、三张子表里全部消失，不留孤儿
    expect(idsOf(snapshot.experiences, "id")).toEqual(["ex-agent", "ex-agent-archived", "ex-orch"])
    expect(idsOf(snapshot.experience_usage, "experience_id")).toEqual(["ex-agent", "ex-agent-archived", "ex-orch"])
    expect(idsOf(snapshot.experience_evaluation, "experience_id")).toEqual([
      "ex-agent",
      "ex-agent-archived",
      "ex-orch",
    ])
    expect(idsOf(snapshot.experience_stats, "experience_id")).toEqual(["ex-agent", "ex-agent-archived", "ex-orch"])
    // 反空洞：team 的统计行原本把 recalled_count 写成 9，重建成同值不可能，必须整行消失
    expect(snapshot.experience_stats.some((row) => row.recalled_count === 9)).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain("ex-team")

    // 保留行必须逐字段原样，而不是「只剩 id」：子行与统计的既有口径一并完好
    expect(snapshot.experiences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ex-agent", experience_type: "agent", is_active: 1, created_at: 1000 }),
        expect.objectContaining({ id: "ex-orch", experience_type: "orchestrator", is_active: 1 }),
        expect.objectContaining({ id: "ex-agent-archived", experience_type: "agent", is_active: 0 }),
      ]),
    )
    expect(snapshot.experience_stats.find((row) => row.experience_id === "ex-agent")).toMatchObject({
      recalled_count: 1,
      fit_mean: 0.75,
      trust: 0.725,
    })

    // Prompt 表：team 行被删，agent/orchestrator（含归档版本与用户改写的正文）原样保留
    expect(idsOf(snapshot.experience_prompts, "id")).toEqual(["ep-agent-v0", "ep-agent-v1", "ep-orchestrator-v1"])
    const promptsById = new Map(snapshot.experience_prompts.map((row) => [String(row.id), row]))
    expect(promptsById.get("ep-agent-v1")).toMatchObject({ prompt: "遗留 agent 正文", is_active: 1 })
    expect(promptsById.get("ep-orchestrator-v1")).toMatchObject({ prompt: "遗留编排正文", is_active: 1 })
  })

  it("test_退役迁移_两表原文不再含team且活跃Prompt唯一索引仍生效", async () => {
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()
    } finally {
      migrated.close()
    }

    const raw = await openRawDb(legacyRoot)
    let experiencesDdl = ""
    let promptsDdl = ""
    let promptIndexes: string[] = []
    let experienceIndexes: string[] = []
    let secondActiveRejected = false
    let foreignKeyViolations: Record<string, unknown>[] = []
    try {
      experiencesDdl = tableDdl(raw, "experiences")
      promptsDdl = tableDdl(raw, "experience_prompts")
      promptIndexes = indexNamesOf(raw, "experience_prompts")
      experienceIndexes = indexNamesOf(raw, "experiences")
      foreignKeyViolations = raw.prepare("PRAGMA foreign_key_check").all() as Record<string, unknown>[]
      try {
        raw.exec(`INSERT INTO experience_prompts
          (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
          VALUES ('ep-agent-dup', 'agent', '重复活跃', '', '正文', 'V1', 1, 1, 1)`)
      } catch {
        secondActiveRejected = true
      }
    } finally {
      raw.close()
    }

    // 需要重建的理由：CHECK 是任何写入者都绕不开的边界
    expect(experiencesDdl).not.toContain("team")
    expect(promptsDdl).not.toContain("team")
    // 重建必须把两张表的索引一并恢复（DROP TABLE 会带走原表全部索引）
    expect(experienceIndexes).toEqual(EXPERIENCES_INDEXES)
    expect(promptIndexes).toEqual(EXPERIENCE_PROMPT_INDEXES)
    expect(secondActiveRejected).toBe(true)
    expect(foreignKeyViolations).toEqual([])
  })

  it("test_退役迁移_重复初始化_不再触发迁移且全库逐行一致", async () => {
    const first = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await first.init()
    } finally {
      first.close()
    }
    const before = await tableSnapshot(legacyRoot, SNAPSHOT_ORDER_BY)
    expect(Object.keys(before).sort()).toEqual(SNAPSHOT_KEYS)

    const second = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await second.init()
      await second.init()
      // 收窄后再写入的数据必须活过后续每一次初始化
      await second.insertChecked({ rows: [experienceRow("ex-after-team-retire")], duplicateOf: keepAllJudge })
    } finally {
      second.close()
    }

    const after = await tableSnapshot(legacyRoot, SNAPSHOT_ORDER_BY)
    expect(pickTables(after, SNAPSHOT_KEYS.filter((table) => table !== "experiences"))).toEqual(
      pickTables(before, SNAPSHOT_KEYS.filter((table) => table !== "experiences")),
    )
    expect(after.experiences.map((row) => row.id).sort()).toEqual(
      [...before.experiences.map((row) => row.id), "ex-after-team-retire"].sort(),
    )
    expect(after.experiences.filter((row) => row.id === "ex-agent")).toEqual(
      before.experiences.filter((row) => row.id === "ex-agent"),
    )
  })

  it("test_退役迁移_收窄后直接插入team行_被数据库CHECK拒绝", async () => {
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()
    } finally {
      migrated.close()
    }

    const raw = await openRawDb(legacyRoot)
    let promptRejected = false
    let experienceRejected = false
    try {
      expect(experienceTypeCheckValues(tableDdl(raw, "experiences"))).toEqual([...EXPERIENCE_TYPE_VALUES])
      try {
        raw.exec(`INSERT INTO experience_prompts
          (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
          VALUES ('ep-team-revived', 'team', '退役类型', '', '正文', 'V1', 1, 1, 1)`)
      } catch {
        promptRejected = true
      }
      try {
        raw.exec(`INSERT INTO experiences (
          id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
          principle, recommended_action, exclusions, evidence, task_retrieval_text,
          decision_retrieval_text, source_run_id, generation_prompt_id, generation_prompt_version,
          is_active, created_at, updated_at
        ) VALUES (
          'ex-team-revived', 'team', '职责', '软件开发', '决策域', '情境', '触发',
          '原则', '行动', '[]', '[]', '任务侧', '决策侧', 'run-1', 'ep-agent-v1', 'V1', 1, 1, 1
        )`)
      } catch {
        experienceRejected = true
      }
    } finally {
      raw.close()
    }

    expect(promptRejected).toBe(true)
    expect(experienceRejected).toBe(true)
  })

  it("test_退役迁移_混合态仅prompts表仍宽_也触发迁移且agent与orchestrator完好", async () => {
    const mixedRoot = await makeMixedTeamShapeRoot()
    const migrated = new AssetStore(mixedRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()

      const raw = await openRawDb(mixedRoot)
      let promptsDdl = ""
      let experiencesDdl = ""
      let prompts: Record<string, unknown>[] = []
      let experiences: Record<string, unknown>[] = []
      try {
        promptsDdl = tableDdl(raw, "experience_prompts")
        experiencesDdl = tableDdl(raw, "experiences")
        prompts = raw.prepare("SELECT id, experience_type, prompt FROM experience_prompts ORDER BY id").all() as Record<
          string,
          unknown
        >[]
        experiences = raw
          .prepare("SELECT id, experience_type FROM experiences ORDER BY id")
          .all() as Record<string, unknown>[]
      } finally {
        raw.close()
      }

      // 宽 CHECK 的那张表被收窄，team Prompt 行被删
      expect(promptsDdl).not.toContain("team")
      expect(prompts.map((row) => row.id)).toEqual(["ep-agent-v0", "ep-agent-v1", "ep-orchestrator-v1"])
      // 已收窄的那张表不重建也不动数据
      expect(experiencesDdl).not.toContain("team")
      expect(experiences.map((row) => row.id)).toEqual(["ex-agent", "ex-orch"])
      // 两类主体仍各有活跃 Prompt 可用
      expect((await migrated.getActivePrompt("agent"))?.id).toBe("ep-agent-v1")
      expect((await migrated.getActivePrompt("orchestrator"))?.id).toBe("ep-orchestrator-v1")
    } finally {
      migrated.close()
      await removeTempRoot(mixedRoot)
    }
  })

  it("test_退役迁移_混合态_重复初始化_不再触发迁移且全库一致", async () => {
    const mixedRoot = await makeMixedTeamShapeRoot()
    const first = new AssetStore(mixedRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await first.init()
    } finally {
      first.close()
    }
    const before = await tableSnapshot(mixedRoot, SNAPSHOT_ORDER_BY)

    const second = new AssetStore(mixedRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await second.init()
      await second.init()
    } finally {
      second.close()
    }

    const after = await tableSnapshot(mixedRoot, SNAPSHOT_ORDER_BY)
    expect(after).toEqual(before)
  })

  it("test_退役迁移_旧表多出未知列_拒绝迁移并回滚保留旧表", async () => {
    const unexpectedRoot = await makeUnexpectedColumnTeamRoot()
    const failing = new AssetStore(unexpectedRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      // 换表重建会按当前列清单搬迁，未知列会被静默丢弃：宁可报错也不悄悄删列
      await expect(failing.init()).rejects.toThrow(/legacy_note/)
    } finally {
      failing.close()
    }

    const raw = await openRawDb(unexpectedRoot)
    let columns: string[] = []
    let rows: Record<string, unknown> | undefined
    let ddl = ""
    try {
      columns = columnsOf(raw, "experiences")
      rows = raw.prepare("SELECT COUNT(*) AS total FROM experiences").get() as Record<string, unknown>
      ddl = tableDdl(raw, "experiences")
    } finally {
      raw.close()
    }

    // 失败即回滚：旧表连未知列一起保留，没有任何半成品
    expect(columns).toContain("legacy_note")
    expect(rows).toMatchObject({ total: 4 })
    expect(ddl).toContain("team")
    await removeTempRoot(unexpectedRoot)
  })
})

/**
 * 递归收集 `src/host/` 下全部源码文件（Host 半区相对路径 + 正文）。
 *
 * 为什么按目录遍历而不是固定文件名清单：门禁必须自动覆盖新增文件，
 * 固定清单会让「新文件里引入历史表的 UPDATE/DELETE」静默通过。
 *
 * 为什么扫描根是整个 Host 半区而不是 assets 目录：这两张历史表的写入边界属 assets 模块，
 * 但门禁若只扫 assets，别处（例如经验域直连库）写同一张表仍会绕过；扫描整个半区后，
 * 任何位置的越界写入都会让本门禁变红。
 */
async function collectHostSources(): Promise<Array<{ path: string; text: string }>> {
  const collected: Array<{ path: string; text: string }> = []
  const walk = async (dir: URL, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
        continue
      }
      if (!entry.name.endsWith(".ts")) continue
      collected.push({ path: `${prefix}${entry.name}`, text: await readFile(new URL(entry.name, dir), "utf8") })
    }
  }
  await walk(new URL("../../../src/host/", import.meta.url), "")
  return collected
}

/** 某张表上的列名（按 DDL 声明顺序）。 */
function columnsOf(raw: Awaited<ReturnType<typeof openRawDb>>, table: string): string[] {
  return (raw.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[]).map((row) => String(row.name))
}

/** 某张表上由 schema 创建（非自增）的索引名（升序）。 */
function indexNamesOf(raw: Awaited<ReturnType<typeof openRawDb>>, table: string): string[] {
  return (raw
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex%'")
    .all(table) as Record<string, unknown>[])
    .map((row) => String(row.name))
    .sort()
}

/** 某张表在 sqlite_master 里的建表原文（迁移判据读的就是这段文本）。 */
function tableDdl(raw: Awaited<ReturnType<typeof openRawDb>>, table: string): string {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | Record<string, unknown>
    | undefined
  return String(row?.sql ?? "")
}

/**
 * 从建表原文里解析 experience_type 的 CHECK 取值域。
 *
 * 为什么必须解析而不是整段比对 DDL 文本：整段比对会在任何无关列改动时误报，且把
 * 「取值域一致性」这条判据埋进文案里；这里只抽取真正被约束的取值集合。
 * 解析失败返回空数组（调用方以「非空」断言反空洞，避免两边同为 undefined 而意外相等）。
 */
function experienceTypeCheckValues(ddl: string): string[] {
  const check = /experience_type[\s\S]*?CHECK\s*\(\s*experience_type\s+IN\s*\(([^)]*)\)/i.exec(ddl)
  if (!check) return []
  return [...check[1].matchAll(/'([^']*)'/g)].map((match) => match[1])
}

/** 逐行读回若干张表（列名与行序都固定，用于比对迁移前后的全库事实）。 */
async function tableSnapshot(
  root: string,
  orderBy: Record<string, string>,
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {}
  for (const [table, column] of Object.entries(orderBy)) {
    snapshot[table] = await rawQuery(root, `SELECT * FROM ${table} ORDER BY ${column}`)
  }
  return snapshot
}

/** 只取指定几张表的快照（避免「新增一行」这类无关差异污染逐行比对）。 */
function pickTables(
  snapshot: Record<string, Record<string, unknown>[]>,
  tables: string[],
): Record<string, Record<string, unknown>[]> {
  const picked: Record<string, Record<string, unknown>[]> = {}
  for (const table of tables) picked[table] = snapshot[table]
  return picked
}

/**
 * 源码里的一条 DELETE 语句（被删表名、所在行号、所在行文本）。
 *
 * 为什么不做语句文本抽取：SQL 写在模板字符串里，续行缩进与调用行可能相同，
 * 断句规则会引入与被测事实无关的脆弱依赖。删表名 + 行号 + 该行文本已足以表达
 * 「谁在删、删在哪个函数里、加了什么限定」这三条门禁事实。
 */
interface SourceDelete {
  target: string
  line: number
  text: string
}

/**
 * 抽出源码中的全部 DELETE 语句。
 * 为什么先剥注释：门禁只关心真正的删表语句，注释里出现的「DELETE FROM」不是写路径；
 * 逐字符剥注释（而不是按行过滤）才不会连带删掉 JSDoc 之后的代码行。
 */
function deleteStatementsIn(source: string): SourceDelete[] {
  const code = stripComments(source)
  const lines = code.split("\n")
  const pattern = /\bDELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi
  const statements: SourceDelete[] = []
  let match = pattern.exec(code)
  while (match !== null) {
    const line = code.slice(0, match.index).split("\n").length
    statements.push({ target: match[1], line, text: lines[line - 1].trim() })
    match = pattern.exec(code)
  }
  return statements
}

/** 剥掉 `//` 与块注释（字符串与模板字符串原样保留；行结构保持不变）。 */function stripComments(source: string): string {
  let out = ""
  let quote: string | null = null
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (quote !== null) {
      if (char === "\\") {
        out += char + (next ?? "")
        index += 1
        continue
      }
      if (char === quote) quote = null
      out += char
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      out += char
      continue
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1
      out += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") out += "\n"
        index += 1
      }
      index += 1
      continue
    }
    out += char
  }
  return out
}

/**
 * 具名函数声明的起止行号（1 基，闭区间）。
 *
 * 为什么不用「声明到某个收尾字符串」的切片去比对语句文本：行区间判定与格式无关，
 * 而 SQL 续行的缩进恰好可能与调用行相同，按文本比对会把无关的格式事实变成门禁前提。
 */
function functionLineRange(lines: string[], functionName: string): { start: number; end: number } {
  const start = lines.findIndex((line) => line.includes(`function ${functionName}(`))
  if (start < 0) throw new Error(`未在源码中找到函数 ${functionName}`)
  let end = start
  while (end < lines.length && lines[end] !== "}") end += 1
  if (end >= lines.length) throw new Error(`未能定位函数 ${functionName} 的收尾`)
  return { start: start + 1, end: end + 1 }
}

/**
 * 取每条删除语句的完整 SQL 文本（DELETE 起、模板字符串收尾行止）。
 *
 * 为什么要收尾到模板字符串结束：子行删除把退役类型限定写在子查询行上，
 * 只取 DELETE 所在行会把「按退役类型限定」的合法写法误判成无条件删除。
 */
function deleteBlocksOf(code: string, statements: SourceDelete[]): string[] {
  const lines = code.split("\n")
  return statements.map((entry) => {
    const block = [lines[entry.line - 1]]
    for (let index = entry.line; index < lines.length; index += 1) {
      const line = lines[index]
      block.push(line)
      if (/`\)\s*$/.test(line)) break
    }
    return block.join("\n")
  })
}

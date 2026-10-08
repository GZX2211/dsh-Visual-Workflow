// tests/host/assets/schema.test.ts
//
// 经验域磁盘形状契约：experience_prompts / experiences 的列与索引、活跃 Prompt 的
// 数据库级唯一性、三类种子播种的幂等与非破坏性，以及旧形状 experiences 的删表重建。
//
// 为什么旧形状 DDL 在测试里写死副本：迁移判定读的是 sqlite_master 的原文，
// 若测试直接引用源码 DDL，「旧库能否升级」会随源码改动自动变成恒真。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EXPERIENCE_PROMPT_SEEDS, EXPERIENCE_PROMPT_SEED_VERSION } from "../../../src/host/assets/experience-seeds.js"
import { AssetStore } from "../../../src/host/assets/index.js"
import {
  experienceRow,
  fakeClock,
  fakeIds,
  keepAllJudge,
  makeStore,
  openRawDb,
  removeTempRoot,
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
})

describe("经验生成 Prompt 播种", () => {
  it("test_播种_三类主体各一个活跃Prompt且正文取自V1常量", async () => {
    const prompts = await store.listPrompts()

    expect(prompts.map((prompt) => prompt.experienceType).sort()).toEqual(["agent", "orchestrator", "team"])
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
    expect((await store.getActivePrompt("team"))?.prompt.startsWith("你正在为当前 Agent Team")).toBe(true)
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

/** 某张表上由 schema 创建（非自增）的索引名（升序）。 */
function indexNamesOf(raw: Awaited<ReturnType<typeof openRawDb>>, table: string): string[] {
  return (raw
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex%'")
    .all(table) as Record<string, unknown>[])
    .map((row) => String(row.name))
    .sort()
}

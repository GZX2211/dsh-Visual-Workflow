// tests/host/assets/experience-usage.test.ts
//
// 使用事实（experience_usage）写入路径：批量插入与行 id 发号、按主体与经验类型判定
// 「是否被显式注入」、统计行的首次建立与 recalled_count 累加，以及失败时的整批回滚。
//
// 中性口径由调用方注入，因此本文件只验证「资产库是否按调用方给的口径建行、是否只累加计数」，
// 不验证聚合公式（公式属经验域，见 §26）。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ExperienceInsertRow, NeutralStatsValues } from "../../../src/host/shared/asset-types.js"
import { AssetStore } from "../../../src/host/assets/index.js"
import {
  evaluationRow,
  experienceRow,
  fakeIds,
  keepAllJudge,
  makeStore,
  makeStoreWithClock,
  neutralStatsFixture,
  rawQuery,
  removeTempRoot,
  settableClock,
  simpleStatsAggregate,
  usageRow,
} from "./fixtures/asset-fixture.js"

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

/** 写入一条经验（多数用例的前置动作）。 */
async function insertExperience(id: string, overrides: Partial<ExperienceInsertRow> = {}): Promise<void> {
  const result = await store.insertChecked({ rows: [experienceRow(id, overrides)], duplicateOf: keepAllJudge })
  expect(result.inserted.map((entry) => entry.id)).toEqual([id])
}

describe("记录使用事实", () => {
  it("test_记录使用_首次使用_按中性口径建统计行且recalledCount为本批条数", async () => {
    await insertExperience("ex-1")

    const result = await store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })

    expect(result).toEqual({ recorded: 1 })
    const [stats] = await store.getStats(["ex-1"])
    expect(stats).toMatchObject({
      experienceId: "ex-1",
      effectiveSampleCount: 0,
      recalledCount: 1,
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
    })
  })

  it("test_记录使用_使用行_落盘主体运行与发号id", async () => {
    await insertExperience("ex-1")

    await store.recordUsage({
      rows: [usageRow("ex-1", { runId: "run-9", subjectId: "agent-7" })],
      neutralStats: neutralStatsFixture(),
    })

    const [usage] = await rawQuery(root, "SELECT id, experience_id, run_id, subject_id FROM experience_usage")
    expect(usage).toMatchObject({ experience_id: "ex-1", run_id: "run-9", subject_id: "agent-7" })
    expect(String(usage.id)).toMatch(/^xus-/)
  })

  it("test_记录使用_已有统计行_只累加计数其余统计数值列一概不动", async () => {
    await insertExperience("ex-1")
    await store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })
    // 先经评价路径写入一份非中性投影：这样「其余列不动」才能被观测到
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    const before = (await store.getStats(["ex-1"]))[0]

    const result = await store.recordUsage({
      rows: [usageRow("ex-1"), usageRow("ex-1"), usageRow("ex-1")],
      neutralStats: neutralStatsFixture(),
    })

    expect(result).toEqual({ recorded: 3 })
    const [after] = await store.getStats(["ex-1"])
    const { updatedAt: beforeUpdatedAt, ...beforeValues } = before
    const { updatedAt: afterUpdatedAt, ...afterValues } = after
    expect(afterValues).toEqual({ ...beforeValues, recalledCount: before.recalledCount + 3 })
    // 记账时间属被写入的行事实而不是统计数值：行被更新了就必须刷新（AGENTS「updated_at 每次写入刷新」）
    expect(afterUpdatedAt).toBeGreaterThan(beforeUpdatedAt)
  })

  it("test_记录使用_首次建行_中性口径取自调用方而非资产库内置", async () => {
    await insertExperience("ex-1")
    const neutral: NeutralStatsValues = { ...neutralStatsFixture(), trust: 0.42, stability: 0.9, qualitySignal: -0.3 }

    await store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutral })

    const [stats] = await store.getStats(["ex-1"])
    expect(stats).toMatchObject({ trust: 0.42, stability: 0.9, qualitySignal: -0.3, recalledCount: 1 })
  })

  it("test_记录使用_空行数组_不写使用行也不建统计行", async () => {
    await insertExperience("ex-1")

    const result = await store.recordUsage({ rows: [], neutralStats: neutralStatsFixture() })

    expect(result).toEqual({ recorded: 0 })
    expect(await store.getStats(["ex-1"])).toEqual([])
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_usage")).toMatchObject([{ total: 0 }])
  })

  it("test_记录使用_存在不存在的经验_整批回滚不留使用行与统计行", async () => {
    await insertExperience("ex-1")

    await expect(
      store.recordUsage({
        rows: [usageRow("ex-1"), usageRow("ex-missing")],
        neutralStats: neutralStatsFixture(),
      }),
    ).rejects.toMatchObject({ code: "WF_EXPERIENCE_NOT_FOUND" })

    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_usage")).toMatchObject([{ total: 0 }])
    expect(await store.getStats(["ex-1"])).toEqual([])
  })

  it("test_记录使用_成功后_经验本体字段与更新时间不变", async () => {
    await insertExperience("ex-1")
    const before = (await store.getRows(["ex-1"]))[0]

    await store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })

    const after = (await store.getRows(["ex-1"]))[0]
    expect(after.principle).toBe(before.principle)
    expect(after.exclusions).toEqual(before.exclusions)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it("test_记录使用_已存在统计行_推进时钟后计数累加且记账时间刷新", async () => {
    const clock = settableClock(1_000)
    const fixed = await makeStoreWithClock(clock.now)
    try {
      await fixed.store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
      await fixed.store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })
      expect((await fixed.store.getStats(["ex-1"]))[0]).toMatchObject({ recalledCount: 1, updatedAt: 1_000 })

      clock.set(5_000)
      const second = await fixed.store.recordUsage({
        rows: [usageRow("ex-1"), usageRow("ex-1")],
        neutralStats: neutralStatsFixture(),
      })

      // 统计行确实被更新过：计数累加，且记账时间反映这次写入（AGENTS「updated_at 每次写入刷新」）
      expect(second).toEqual({ recorded: 2 })
      expect((await fixed.store.getStats(["ex-1"]))[0]).toMatchObject({ recalledCount: 3, updatedAt: 5_000 })
    } finally {
      fixed.store.close()
      await removeTempRoot(fixed.root)
    }
  })

  it("test_记录使用_首次建行_记账时间等于建行时刻", async () => {
    const clock = settableClock(7_000)
    const fixed = await makeStoreWithClock(clock.now)
    try {
      await fixed.store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })

      await fixed.store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })

      expect((await fixed.store.getStats(["ex-1"]))[0]).toMatchObject({ recalledCount: 1, updatedAt: 7_000 })
    } finally {
      fixed.store.close()
      await removeTempRoot(fixed.root)
    }
  })

  it("test_记录使用_时间戳_由注入时钟记账", async () => {
    const fixedRoot = await mkdtemp(join(tmpdir(), "dsh-assets-usage-clock-"))
    const fixed = new AssetStore(fixedRoot, { now: () => 42, ids: fakeIds() })
    try {
      await fixed.init()
      await fixed.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })

      await fixed.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })

      const [stats] = await fixed.getStats(["ex-1"])
      const [usage] = await rawQuery(fixedRoot, "SELECT created_at FROM experience_usage")
      expect(stats.updatedAt).toBe(42)
      expect(usage).toMatchObject({ created_at: 42 })
    } finally {
      fixed.close()
      await removeTempRoot(fixedRoot)
    }
  })
})

describe("判定经验是否被显式注入（feedback 准入）", () => {
  it("test_已注入判定_主体与经验类型匹配_按入参顺序去重返回", async () => {
    await insertExperience("ex-agent")
    await insertExperience("ex-team", { experienceType: "team", generationPromptId: "ep-team-v1" })
    await insertExperience("ex-other-subject")
    await store.recordUsage({
      rows: [
        usageRow("ex-agent", { subjectId: "session-1" }),
        usageRow("ex-agent", { subjectId: "session-1" }),
        usageRow("ex-other-subject", { subjectId: "session-2" }),
      ],
      neutralStats: neutralStatsFixture(),
    })

    const injected = await store.listInjectedIds({
      subjectId: "session-1",
      experienceType: "agent",
      experienceIds: ["ex-other-subject", "ex-agent", "ex-agent", "ex-never"],
    })

    expect(injected).toEqual(["ex-agent"])
  })

  it("test_已注入判定_经验类型不匹配_不返回该id", async () => {
    await insertExperience("ex-team", { experienceType: "team", generationPromptId: "ep-team-v1" })
    await store.recordUsage({ rows: [usageRow("ex-team")], neutralStats: neutralStatsFixture() })

    const injected = await store.listInjectedIds({
      subjectId: "session-1",
      experienceType: "agent",
      experienceIds: ["ex-team"],
    })

    expect(injected).toEqual([])
  })

  it("test_已注入判定_仅有其它主体的使用行_不返回该id", async () => {
    await insertExperience("ex-agent")
    await store.recordUsage({ rows: [usageRow("ex-agent", { subjectId: "session-2" })], neutralStats: neutralStatsFixture() })

    const injected = await store.listInjectedIds({
      subjectId: "session-1",
      experienceType: "agent",
      experienceIds: ["ex-agent"],
    })

    expect(injected).toEqual([])
  })

  it("test_已注入判定_无使用行_返回空数组", async () => {
    await insertExperience("ex-agent")

    const injected = await store.listInjectedIds({
      subjectId: "session-1",
      experienceType: "agent",
      experienceIds: ["ex-agent"],
    })

    expect(injected).toEqual([])
  })

  it("test_已注入判定_空候选列表_返回空数组", async () => {
    const injected = await store.listInjectedIds({
      subjectId: "session-1",
      experienceType: "agent",
      experienceIds: [],
    })

    expect(injected).toEqual([])
  })
})

// tests/host/assets/experience-stats.test.ts
//
// 统计投影（experience_stats）的读路径与全量重建：按入参顺序读取（缺行不补默认值）、
// 从评价 + 使用历史重放聚合器并覆盖写、以及重建失败时不留半成品。
//
// 重建的正确定义是「与逐条增量维护得到同一份投影」（§24 / §25），因此这里用同一组历史分别
// 走增量路径与重建路径，逐字段比对两者结果。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  ExperienceInsertRow,
  ExperienceStatsAggregate,
  ExperienceStatsEntry,
} from "../../../src/host/shared/asset-types.js"
import { ASSET_DB_FILE, AssetStore } from "../../../src/host/assets/index.js"
import { DatabaseSync } from "node:sqlite"
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

/** 恒定时钟的库：用于需要比较 updatedAt 的严格相等断言。 */
async function makeFixedClockStore(): Promise<{ store: AssetStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-assets-stats-clock-"))
  const store = new AssetStore(root, { now: () => 42, ids: fakeIds() })
  await store.init()
  return { store, root }
}

/** 忽略记账时间后的统计值（时间由注入时钟决定，与可重建性无关）。 */
function stablePart(entry: ExperienceStatsEntry): Omit<ExperienceStatsEntry, "updatedAt"> {
  const { updatedAt: _updatedAt, ...rest } = entry
  return rest
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

async function insertExperience(id: string, overrides: Partial<ExperienceInsertRow> = {}): Promise<void> {
  const result = await store.insertChecked({ rows: [experienceRow(id, overrides)], duplicateOf: keepAllJudge })
  expect(result.inserted.map((entry) => entry.id)).toEqual([id])
}

describe("读取统计投影", () => {
  it("test_读取统计_按入参顺序返回命中行_缺行不补默认值", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await insertExperience("ex-3")
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    await store.recordUsage({ rows: [usageRow("ex-2")], neutralStats: neutralStatsFixture() })

    const stats = await store.getStats(["ex-2", "ex-missing", "ex-3", "ex-1"])

    expect(stats.map((entry) => entry.experienceId)).toEqual(["ex-2", "ex-1"])
    expect(stats.map((entry) => entry.recalledCount)).toEqual([1, 0])
  })

  it("test_读取统计_重复入参_去重且保持首次出现顺序", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await store.recordUsage({ rows: [usageRow("ex-1"), usageRow("ex-2")], neutralStats: neutralStatsFixture() })

    const stats = await store.getStats(["ex-2", "ex-1", "ex-2"])

    expect(stats.map((entry) => entry.experienceId)).toEqual(["ex-2", "ex-1"])
  })

  it("test_读取统计_空入参_返回空数组", async () => {
    await insertExperience("ex-1")

    expect(await store.getStats([])).toEqual([])
  })
})

describe("全量重建统计投影", () => {
  it("test_重建统计_全部经验含归档_按评价与使用历史重放且无历史经验取中性口径", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await insertExperience("ex-3")
    await store.setActive("ex-3", false)
    await store.recordUsage({
      rows: [usageRow("ex-1"), usageRow("ex-1"), usageRow("ex-1")],
      neutralStats: neutralStatsFixture(),
    })
    await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1"), evaluationRow("ex-1", { decisionEffect: -0.5 })],
      aggregate: simpleStatsAggregate,
    })
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-2")], aggregate: simpleStatsAggregate })

    const result = await store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

    expect(result).toEqual({ experienceCount: 3 })
    const stats = await store.getStats(["ex-1", "ex-2", "ex-3"])
    expect(stats.map((entry) => entry.experienceId)).toEqual(["ex-1", "ex-2", "ex-3"])
    expect(stats[0]).toMatchObject({
      effectiveSampleCount: 4,
      recalledCount: 3,
      usedCount: 2,
      empiricalValue: 0,
      harmCount: 1,
      harmRate: 0.5,
      qualitySignal: 0,
      trust: 0.5,
    })
    expect(stats[1]).toMatchObject({ recalledCount: 0, usedCount: 1, empiricalValue: 0.5, trust: 0.725 })
    expect(stats[2]).toMatchObject({
      effectiveSampleCount: 0,
      recalledCount: 0,
      usedCount: 0,
      stability: 1,
      evidenceStrength: 0,
      qualitySignal: 0,
      trust: 0.5,
    })
  })

  it("test_重建统计_与逐条增量维护_统计值逐字段一致", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await store.recordUsage({ rows: [usageRow("ex-1"), usageRow("ex-1")], neutralStats: neutralStatsFixture() })
    await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1"), evaluationRow("ex-1", { decisionEffect: -1, informationGain: 0 })],
      aggregate: simpleStatsAggregate,
    })
    await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-2", { decisionEffect: 1, fitScore: 0 })],
      aggregate: simpleStatsAggregate,
    })
    const incremental = await store.getStats(["ex-1", "ex-2"])

    await store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

    const rebuilt = await store.getStats(["ex-1", "ex-2"])
    expect(rebuilt.map(stablePart)).toEqual(incremental.map(stablePart))
  })

  it("test_重建统计_推进时钟_覆盖写以重建时刻记账且统计值与增量一致", async () => {
    const clock = settableClock(1_000)
    const created = await makeStoreWithClock(clock.now)
    try {
      await created.store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
      await created.store.recordUsage({ rows: [usageRow("ex-1")], neutralStats: neutralStatsFixture() })
      clock.set(2_000)
      await created.store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1")],
        aggregate: simpleStatsAggregate,
      })
      const incremental = await created.store.getStats(["ex-1"])
      expect(incremental[0].updatedAt).toBe(2_000)

      clock.set(9_000)
      await created.store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

      const rebuilt = await created.store.getStats(["ex-1"])
      // 重建确实覆盖写：记账时间取重建那一刻；统计值仍与逐条增量维护的结果逐字段一致
      expect(rebuilt[0].updatedAt).toBe(9_000)
      expect(rebuilt.map(stablePart)).toEqual(incremental.map(stablePart))
    } finally {
      created.store.close()
      await removeTempRoot(created.root)
    }
  })

  it("test_重建统计_覆盖写_陈旧计数与孤立统计行都不残留", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    // node:sqlite 默认开启外键；显式关掉才能造出「经验已不存在」的陈旧统计行（验证整表覆盖）
    const raw = new DatabaseSync(join(root, ASSET_DB_FILE), { enableForeignKeyConstraints: false })
    try {
      raw.exec("UPDATE experience_stats SET recalled_count = 99, trust = 0.1 WHERE experience_id = 'ex-1'")
      raw.exec(
        `INSERT INTO experience_stats (
           experience_id, effective_sample_count, recalled_count, used_count, fit_mean, empirical_value,
           variance, stability, evidence_strength, harm_count, harm_rate, harm_severity, quality_signal, trust, updated_at
         ) VALUES ('ex-ghost', 5, 5, 5, 0.9, 0.9, 0, 1, 0.9, 0, 0, 0, 0.9, 0.9, 1)`,
      )
    } finally {
      raw.close()
    }

    await store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

    const stats = await store.getStats(["ex-1", "ex-2"])
    expect(stats[0]).toMatchObject({ recalledCount: 0, trust: 0.725 })
    expect(stats[1]).toMatchObject({ recalledCount: 0, trust: 0.5 })
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_stats")).toMatchObject([{ total: 2 }])
  })

  it("test_重建统计_重复调用_投影保持稳定", async () => {
    const fixed = await makeFixedClockStore()
    try {
      await fixed.store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
      await fixed.store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })

      await fixed.store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })
      const first = await fixed.store.getStats(["ex-1"])
      await fixed.store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

      expect(await fixed.store.getStats(["ex-1"])).toEqual(first)
    } finally {
      fixed.store.close()
      await removeTempRoot(fixed.root)
    }
  })

  it("test_重建统计_聚合器抛错_既有统计投影整表保持原状", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-2")], aggregate: simpleStatsAggregate })
    const before = await store.getStats(["ex-1", "ex-2"])
    let calls = 0
    const failing: ExperienceStatsAggregate = (input) => {
      calls += 1
      if (calls === 2) throw new Error("聚合器不可用")
      return simpleStatsAggregate(input)
    }

    await expect(
      store.rebuildStats({ aggregate: failing, neutralStats: neutralStatsFixture() }),
    ).rejects.toThrow("聚合器不可用")

    expect(await store.getStats(["ex-1", "ex-2"])).toEqual(before)
  })

  it("test_重建统计_零经验库_重建为零行且不报错", async () => {
    const result = await store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

    expect(result).toEqual({ experienceCount: 0 })
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_stats")).toMatchObject([{ total: 0 }])
  })

  it("test_重建统计_写入中途失败_既有统计投影整表回滚原状", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-2")], aggregate: simpleStatsAggregate })
    const before = await store.getStats(["ex-1", "ex-2"])
    let calls = 0
    const broken: ExperienceStatsAggregate = (input) => {
      calls += 1
      // 第二行返回无法绑定的值：制造「第一行已写入、第二行失败」的中途失败，验证整表回滚
      return calls === 2
        ? { ...simpleStatsAggregate(input), trust: undefined as unknown as number }
        : simpleStatsAggregate(input)
    }

    await expect(store.rebuildStats({ aggregate: broken, neutralStats: neutralStatsFixture() })).rejects.toThrow()

    expect(await store.getStats(["ex-1", "ex-2"])).toEqual(before)
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_stats")).toMatchObject([{ total: 2 }])
  })
})

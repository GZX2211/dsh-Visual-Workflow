// tests/host/assets/experience-evaluations.test.ts
//
// 评价事实（experience_evaluation）写入路径：批量插入与发号、按经验读全部历史后聚合、
// 统计投影的覆盖写，以及任一步失败时的整批回滚。
//
// 聚合公式由调用方注入（本文件用可手算的最简聚合），因此这里验证的是资产库的事务边界与
// 数据搬运：全部历史 + recalledCount 是否完整交给聚合器、返回值是否原样落盘。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  ExperienceDecisionEffectAnchor,
  ExperienceInsertRow,
  ExperienceScoreAnchor,
  ExperienceStatsAggregate,
  ExperienceStatsAggregateInput,
} from "../../../src/host/shared/asset-types.js"
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

/** 同时记录聚合器入参的聚合器（用例内自建，避免跨用例共享可变状态）。 */
function recordingAggregate(seen: ExperienceStatsAggregateInput[]): ExperienceStatsAggregate {
  return (input) => {
    seen.push({ evaluations: [...input.evaluations], recalledCount: input.recalledCount })
    return simpleStatsAggregate(input)
  }
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

describe("写入评价并同步统计投影", () => {
  it("test_写入评价_首次评价_落评价行并按聚合结果建统计行", async () => {
    await insertExperience("ex-1")

    const result = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1")],
      aggregate: simpleStatsAggregate,
    })

    expect(result.inserted).toHaveLength(1)
    expect(result.inserted[0]).toMatchObject({
      experienceId: "ex-1",
      runId: "run-1",
      fitScore: 0.75,
      decisionEffect: 0.5,
      informationGain: 0.75,
      causalConfidence: 0.75,
      evidence: "该经验直接影响了并行/串行选择。",
      evaluatorSubjectId: "session-1",
      evaluatorModel: "test-model",
    })
    expect(result.inserted[0].id).toMatch(/^xev-/)
    const { updatedAt, ...statsValues } = result.stats[0]
    expect(statsValues).toEqual({
      experienceId: "ex-1",
      effectiveSampleCount: 2,
      recalledCount: 0,
      usedCount: 1,
      fitMean: 0.75,
      empiricalValue: 0.5,
      variance: 0,
      stability: 0.5,
      evidenceStrength: 0.5,
      harmCount: 0,
      harmRate: 0,
      harmSeverity: 0,
      qualitySignal: 0.25,
      trust: 0.725,
    })
    // 统计行是在评价之后重算并记账的，因此记账时间不早于评价时间
    expect(updatedAt).toBeGreaterThanOrEqual(result.inserted[0].createdAt)
    // 统计行确实落盘（读路径与返回投影一致）
    expect(await store.getStats(["ex-1"])).toEqual(result.stats)
  })

  it("test_写入评价_已有使用事实_recalledCount按历史带入聚合与统计行", async () => {
    await insertExperience("ex-1")
    await store.recordUsage({ rows: [usageRow("ex-1"), usageRow("ex-1")], neutralStats: neutralStatsFixture() })
    const seen: ExperienceStatsAggregateInput[] = []

    const result = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1")],
      aggregate: recordingAggregate(seen),
    })

    expect(seen).toHaveLength(1)
    expect(seen[0].recalledCount).toBe(2)
    expect(result.stats[0].recalledCount).toBe(2)
  })

  it("test_写入评价_同经验二次评价_读全部历史含本批且逐次覆盖统计", async () => {
    await insertExperience("ex-1")
    const seen: ExperienceStatsAggregateInput[] = []
    const aggregate = recordingAggregate(seen)

    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate })
    const second = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1", { decisionEffect: -0.5, causalConfidence: 1 })],
      aggregate,
    })

    expect(seen.map((input) => input.evaluations.length)).toEqual([1, 2])
    expect(seen[1].evaluations.map((scores) => scores.decisionEffect)).toEqual([0.5, -0.5])
    expect(second.stats).toHaveLength(1)
    expect(second.stats[0]).toMatchObject({
      recalledCount: 0,
      usedCount: 2,
      empiricalValue: 0,
      harmCount: 1,
      harmRate: 0.5,
      qualitySignal: 0,
      trust: 0.5,
    })
  })

  it("test_写入评价_一次提交多条经验_按经验分别聚合且统计顺序为首次出现顺序", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")

    const result = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-2"), evaluationRow("ex-1"), evaluationRow("ex-2", { decisionEffect: -1 })],
      aggregate: simpleStatsAggregate,
    })

    expect(result.inserted).toHaveLength(3)
    expect(result.stats.map((entry) => entry.experienceId)).toEqual(["ex-2", "ex-1"])
    expect(result.stats.map((entry) => entry.usedCount)).toEqual([2, 1])
    // ex-2 的两次评价为 +0.5 与 -1：均值 -0.25，且负向只有一条
    expect(result.stats[0]).toMatchObject({ empiricalValue: -0.25, harmCount: 1, harmRate: 0.5, trust: 0.3875 })
  })

  it("test_写入评价_评分者模型未知_落空串而不伪造", async () => {
    await insertExperience("ex-1")

    const result = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1", { evidence: "", evaluatorModel: "", runId: "" })],
      aggregate: simpleStatsAggregate,
    })

    expect(result.inserted[0]).toMatchObject({ evidence: "", evaluatorModel: "", runId: "" })
    const [persisted] = await rawQuery(root, "SELECT run_id, evidence, evaluator_model FROM experience_evaluation")
    expect(persisted).toMatchObject({ run_id: "", evidence: "", evaluator_model: "" })
  })

  it("test_写入评价_空行数组_不写评价也不建统计行", async () => {
    await insertExperience("ex-1")

    const result = await store.insertEvaluationsChecked({ rows: [], aggregate: simpleStatsAggregate })

    expect(result).toEqual({ inserted: [], stats: [] })
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_evaluation")).toMatchObject([{ total: 0 }])
    expect(await store.getStats(["ex-1"])).toEqual([])
  })

  it("test_写入评价_推进时钟_统计记账时间随每次重算刷新", async () => {
    const clock = settableClock(1_000)
    const fixed = await makeStoreWithClock(clock.now)
    try {
      await fixed.store.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })
      await fixed.store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
      expect((await fixed.store.getStats(["ex-1"]))[0]).toMatchObject({ usedCount: 1, updatedAt: 1_000 })

      clock.set(3_000)
      const second = await fixed.store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1", { decisionEffect: -1 })],
        aggregate: simpleStatsAggregate,
      })

      // 第二次评价重算了统计行：计数反映两条历史，记账时间反映这次写入
      expect(second.stats[0]).toMatchObject({ usedCount: 2, updatedAt: 3_000 })
      expect((await fixed.store.getStats(["ex-1"]))[0]).toMatchObject({ usedCount: 2, updatedAt: 3_000 })
    } finally {
      fixed.store.close()
      await removeTempRoot(fixed.root)
    }
  })

  it("test_写入评价_时间戳_由注入时钟记账", async () => {
    const fixedRoot = await mkdtemp(join(tmpdir(), "dsh-assets-eval-clock-"))
    const fixed = new AssetStore(fixedRoot, { now: () => 42, ids: fakeIds() })
    try {
      await fixed.init()
      await fixed.insertChecked({ rows: [experienceRow("ex-1")], duplicateOf: keepAllJudge })

      const result = await fixed.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })

      const [persisted] = await rawQuery(fixedRoot, "SELECT created_at FROM experience_evaluation")
      expect(result.inserted[0].createdAt).toBe(42)
      expect(result.stats[0].updatedAt).toBe(42)
      expect(persisted).toMatchObject({ created_at: 42 })
    } finally {
      fixed.close()
      await removeTempRoot(fixedRoot)
    }
  })
})

describe("评价写入的拒绝与回滚", () => {
  it("test_写入评价_非锚点评分_被数据库约束拒绝且零行落库", async () => {
    await insertExperience("ex-1")

    await expect(
      store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1", { fitScore: 0.3 as ExperienceScoreAnchor })],
        aggregate: simpleStatsAggregate,
      }),
    ).rejects.toThrow(/CHECK/i)
    await expect(
      store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1", { decisionEffect: 0.3 as unknown as ExperienceDecisionEffectAnchor })],
        aggregate: simpleStatsAggregate,
      }),
    ).rejects.toThrow(/CHECK/i)

    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_evaluation")).toMatchObject([{ total: 0 }])
    expect(await store.getStats(["ex-1"])).toEqual([])
  })

  it("test_写入评价_经验不存在_抛经验不存在且整批回滚", async () => {
    await insertExperience("ex-1")

    await expect(
      store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1"), evaluationRow("ex-missing")],
        aggregate: simpleStatsAggregate,
      }),
    ).rejects.toMatchObject({ code: "WF_EXPERIENCE_NOT_FOUND" })

    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_evaluation")).toMatchObject([{ total: 0 }])
    expect(await store.getStats(["ex-1"])).toEqual([])
  })

  it("test_写入评价_聚合器抛错_已写入的评价与统计一并回滚", async () => {
    await insertExperience("ex-1")
    await insertExperience("ex-2")
    let calls = 0
    const failing: ExperienceStatsAggregate = (input) => {
      calls += 1
      if (calls === 2) throw new Error("聚合器不可用")
      return simpleStatsAggregate(input)
    }

    await expect(
      store.insertEvaluationsChecked({
        rows: [evaluationRow("ex-1"), evaluationRow("ex-2")],
        aggregate: failing,
      }),
    ).rejects.toThrow("聚合器不可用")

    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_evaluation")).toMatchObject([{ total: 0 }])
    expect(await rawQuery(root, "SELECT COUNT(*) AS total FROM experience_stats")).toMatchObject([{ total: 0 }])
  })
})

describe("评价历史的不可变性", () => {
  it("test_重复提交评价_追加新行而非覆盖既有历史", async () => {
    await insertExperience("ex-1")

    const first = await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    const second = await store.insertEvaluationsChecked({
      rows: [evaluationRow("ex-1", { decisionEffect: -1 })],
      aggregate: simpleStatsAggregate,
    })

    expect(second.inserted[0].id).not.toBe(first.inserted[0].id)
    const rows = await rawQuery(
      root,
      "SELECT id, decision_effect FROM experience_evaluation WHERE experience_id = 'ex-1' ORDER BY created_at ASC, id ASC",
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.decision_effect).sort()).toEqual([-1, 0.5])
  })

  it("test_重建统计_评价历史不被改写", async () => {
    await insertExperience("ex-1")
    await store.insertEvaluationsChecked({ rows: [evaluationRow("ex-1")], aggregate: simpleStatsAggregate })
    const before = await rawQuery(root, "SELECT id, fit_score, decision_effect, evidence FROM experience_evaluation")

    await store.rebuildStats({ aggregate: simpleStatsAggregate, neutralStats: neutralStatsFixture() })

    expect(await rawQuery(root, "SELECT id, fit_score, decision_effect, evidence FROM experience_evaluation")).toEqual(before)
  })
})

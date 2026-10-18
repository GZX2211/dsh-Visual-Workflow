// tests/host/assets/experience-retirement.test.ts
//
// 经验退役在资产库层的磁盘事实：归档原因/时间、恢复时间、自动归档的条件更新、
// 退役判定事实的读盘投影，以及旧库升级时新增列的可重复迁移。
//
// 为什么这些必须落在资产库测试：退役状态是经验行上的唯一状态事实，写入边界属资产库；
// 判定算法在经验域，但「读到的到底是什么」由这里锁定，否则域层公式再正确也会被错误的读盘形状污染。

import { afterEach, describe, expect, it } from "vitest"
import {
  evaluationRow,
  experienceRow,
  keepAllJudge,
  makeStoreWithClock,
  neutralStatsFixture,
  openRawDb,
  rawQuery,
  removeTempRoot,
  settableClock,
  usageRow,
} from "./fixtures/asset-fixture.js"
import { AssetStore } from "../../../src/host/assets/index.js"

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup) await cleanup()
  }
})

/** 建库并把关闭/删目录登记到 afterEach。 */
async function makeWorld(now = settableClock()): Promise<{ store: AssetStore; root: string; clock: ReturnType<typeof settableClock> }> {
  const { store, root } = await makeStoreWithClock(now.now)
  // afterEach 按后进先出执行：先登记删目录、再登记关闭，才能保证「先关库再删文件」
  cleanups.push(() => removeTempRoot(root))
  cleanups.push(() => store.close())
  return { store, root, clock: now }
}

/** 写一条经验并返回其 id。 */
async function insertExperience(store: AssetStore, id = "ex-retire"): Promise<string> {
  const result = await store.insertChecked({ rows: [experienceRow(id)], duplicateOf: keepAllJudge })
  return result.inserted[0].id
}

describe("经验退役状态写入", () => {
  it("test_自动归档_写入有害原因与归档时间_且只对活跃经验生效", async () => {
    const { store, clock } = await makeWorld()
    const id = await insertExperience(store)

    clock.set(1_800_000_000_000)
    expect(await store.retireForPolicy(id, "harmful")).toBe(true)

    const [entry] = await store.getRows([id])
    expect(entry).toMatchObject({
      id,
      active: false,
      retiredReason: "harmful",
      retiredAt: 1_800_000_000_000,
    })
    expect(entry.reactivatedAt).toBeUndefined()

    // 幂等：已归档的经验不会被第二次自动归档改写归档时间或原因
    clock.set(1_800_000_001_000)
    expect(await store.retireForPolicy(id, "long_unused")).toBe(false)
    const [again] = await store.getRows([id])
    expect(again).toMatchObject({ retiredReason: "harmful", retiredAt: 1_800_000_000_000 })
  })

  it("test_自动归档_经验不存在_抛经验不存在", async () => {
    const { store } = await makeWorld()

    await expect(store.retireForPolicy("ex-缺失", "harmful")).rejects.toMatchObject({
      code: "WF_EXPERIENCE_NOT_FOUND",
    })
  })

  it("test_手动归档_写入manual原因_恢复时清空退役字段并记录恢复时间", async () => {
    const { store, clock } = await makeWorld()
    const id = await insertExperience(store)
    const before = (await store.getRows([id]))[0]

    clock.set(1_800_000_000_000)
    const archived = await store.setActive(id, false)
    expect(archived).toMatchObject({
      active: false,
      retiredReason: "manual",
      retiredAt: 1_800_000_000_000,
    })
    expect(archived.updatedAt).toBeGreaterThan(before.updatedAt)

    clock.set(1_800_000_100_000)
    const restored = await store.setActive(id, true)
    expect(restored.active).toBe(true)
    expect(restored.retiredAt).toBeUndefined()
    expect(restored.retiredReason).toBeUndefined()
    expect(restored.reactivatedAt).toBe(1_800_000_100_000)
  })

  it("test_恢复已活跃经验_不刷新恢复时间（幂等，避免凭空重置证据基准）", async () => {
    const { store, clock } = await makeWorld()
    const id = await insertExperience(store)
    await store.setActive(id, false)

    clock.set(1_800_000_100_000)
    const restored = await store.setActive(id, true)
    const reactivatedAt = restored.reactivatedAt

    clock.set(1_800_000_200_000)
    const again = await store.setActive(id, true)
    expect(again.reactivatedAt).toBe(reactivatedAt)
  })
})

describe("退役判定事实读盘", () => {
  it("test_只读活跃经验_并带回使用与评价的角色身份与时间", async () => {
    const { store, clock } = await makeWorld()
    const activeId = await insertExperience(store, "ex-active")
    const archivedId = await insertExperience(store, "ex-archived")

    clock.set(1_800_000_000_000)
    await store.recordUsage({
      rows: [
        usageRow(activeId, { runId: "run-u1", subjectId: "child-1", roleKey: "asset:role-a", roleLabel: "开发" }),
        usageRow(archivedId, { runId: "run-u2", subjectId: "child-2" }),
      ],
      neutralStats: neutralStatsFixture(),
    })
    await store.insertEvaluationsChecked({
      rows: [
        evaluationRow(activeId, {
          runId: "run-e1",
          evaluatorSubjectId: "child-1",
          roleKey: "asset:role-a",
          roleLabel: "开发",
          decisionEffect: 0,
        }),
        evaluationRow(archivedId, { runId: "run-e2", evaluatorSubjectId: "child-2" }),
      ],
      aggregate: ({ evaluations, recalledCount }) => ({
        ...neutralStatsFixture(),
        effectiveSampleCount: evaluations.length,
        recalledCount,
        usedCount: evaluations.length,
      }),
    })
    await store.setActive(archivedId, false)

    const facts = await store.listRetirementFacts()

    expect(facts.map((fact) => fact.experienceId)).toEqual([activeId])
    expect(facts[0].experienceType).toBe("agent")
    expect(facts[0].reactivatedAt).toBe(0)
    expect(facts[0].usage).toEqual([{ runId: "run-u1", createdAt: 1_800_000_000_000 }])
    expect(facts[0].evaluations).toEqual([
      {
        runId: "run-e1",
        roleKey: "asset:role-a",
        roleLabel: "开发",
        createdAt: 1_800_000_000_000,
        scores: {
          fitScore: 0.75,
          decisionEffect: 0,
          informationGain: 0.75,
          causalConfidence: 0.75,
        },
      },
    ])
  })

  it("test_历史事实的角色列为空串时_读盘按空角色返回（不伪造角色）", async () => {
    const { store } = await makeWorld()
    const id = await insertExperience(store)
    await store.recordUsage({ rows: [usageRow(id)], neutralStats: neutralStatsFixture() })
    await store.insertEvaluationsChecked({
      rows: [evaluationRow(id, { decisionEffect: 0 })],
      aggregate: ({ evaluations, recalledCount }) => ({
        ...neutralStatsFixture(),
        recalledCount,
        usedCount: evaluations.length,
      }),
    })

    const [fact] = await store.listRetirementFacts()
    expect(fact.usage).toEqual([{ runId: "run-1", createdAt: expect.any(Number) }])
    expect(fact.evaluations[0]).toMatchObject({ roleKey: "", roleLabel: "" })
    expect(fact.evaluations[0].roleLabel).toBe("")
  })
})

describe("旧库升级：退役与角色列", () => {
  it("test_旧形状库缺少新增列_初始化幂等补齐且历史行保留", async () => {
    const { store, root } = await makeWorld()
    const id = await insertExperience(store)
    await store.recordUsage({ rows: [usageRow(id, { roleKey: "asset:role-a" })], neutralStats: neutralStatsFixture() })
    await store.insertEvaluationsChecked({
      rows: [evaluationRow(id, { roleKey: "asset:role-a", decisionEffect: 0 })],
      aggregate: ({ evaluations, recalledCount }) => ({
        ...neutralStatsFixture(),
        recalledCount,
        usedCount: evaluations.length,
      }),
    })
    store.close()

    // 模拟升级前形状：删掉本次新增的列（SQLite 3.35+ 支持 DROP COLUMN）
    const raw = await openRawDb(root)
    try {
      raw.exec("ALTER TABLE experiences DROP COLUMN retired_at")
      raw.exec("ALTER TABLE experiences DROP COLUMN retired_reason")
      raw.exec("ALTER TABLE experiences DROP COLUMN reactivated_at")
      raw.exec("ALTER TABLE experience_usage DROP COLUMN role_key")
      raw.exec("ALTER TABLE experience_usage DROP COLUMN role_label")
      raw.exec("ALTER TABLE experience_evaluation DROP COLUMN role_key")
      raw.exec("ALTER TABLE experience_evaluation DROP COLUMN role_label")
    } finally {
      raw.close()
    }

    const reopened = new AssetStore(root)
    try {
      await reopened.init()
      await reopened.init()

      const columns = await rawQuery(root, "PRAGMA table_info(experiences)")
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["retired_at", "retired_reason", "reactivated_at"]),
      )
      const usageColumns = await rawQuery(root, "PRAGMA table_info(experience_usage)")
      expect(usageColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["role_key", "role_label"]),
      )
      const evaluationColumns = await rawQuery(root, "PRAGMA table_info(experience_evaluation)")
      expect(evaluationColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["role_key", "role_label"]),
      )

      const facts = await reopened.listRetirementFacts()
      expect(facts).toHaveLength(1)
      expect(facts[0].experienceId).toBe(id)
      // 升级前写入的角色值在新增列默认值下变为空串：历史没有角色身份是显式事实
      expect(facts[0].usage[0]).toMatchObject({ runId: "run-1", createdAt: expect.any(Number) })
      expect(facts[0].evaluations[0]).toMatchObject({ roleKey: "", roleLabel: "" })
    } finally {
      reopened.close()
    }
  })
})

// tests/host/experience/rebuild.test.ts
//
// 统计全量重放门（§24 / §25）。
//
// 为什么必须验证「重放 == 增量」：重建是参数变更与数据修复的唯一手段，而它能否被信任，
// 取决于它与增量路径是否产出同一份统计。若两者分歧，用户会看到「重建之后数值变了」，
// 却无法判断哪一份才是对的；因此这条一致性断言比「重建能跑通」更重要。

import { describe, expect, it } from "vitest"
import { NEUTRAL_STATS } from "../../../src/host/experience/constants.js"
import { submitExperienceFeedback } from "../../../src/host/experience/feedback.js"
import { rebuildExperienceStats } from "../../../src/host/experience/rebuild.js"
import type { ExperienceCaller } from "../../../src/host/experience/ports.js"
import { createExperienceWorld, seedEntry, seedStats, seedUsed, type FakeExperienceWorld } from "./fixtures/ports.js"

const CALLER: ExperienceCaller = { isChild: false, sessionId: "session-1" }

/** 摆好「一条活跃经验已被注入 + 一条归档经验从未被使用」的受控世界。 */
async function seedRebuildWorld(): Promise<FakeExperienceWorld> {
  const world = createExperienceWorld()
  seedEntry(world, { id: "ex-1", experienceType: "agent" })
  seedEntry(world, { id: "ex-archived", experienceType: "agent", active: false })
  await seedUsed(world, { subjectId: "session-1", experienceId: "ex-1" })
  return world
}

/** 通过反馈入口写入两条历史评价（复用真实增量路径，避免用例自己拼评价行）。 */
async function evaluateTwice(world: FakeExperienceWorld): Promise<void> {
  await submitExperienceFeedback(
    { store: world.store, runtime: world.runtime },
    {
      caller: CALLER,
      type: "agent",
      evaluations: [
        { experienceId: "ex-1", fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 },
        { experienceId: "ex-1", fitScore: 1, decisionEffect: -0.5, informationGain: 1, causalConfidence: 1 },
      ],
    },
  )
}

describe("rebuildExperienceStats", () => {
  it("test_无评价历史_按中性投影建行并保留注入次数", async () => {
    const world = await seedRebuildWorld()

    const result = await rebuildExperienceStats({ store: world.store })

    expect(result.experienceCount).toBe(2)
    expect(world.stats.get("ex-1")).toEqual({
      experienceId: "ex-1",
      ...NEUTRAL_STATS,
      recalledCount: 1,
      updatedAt: world.now,
    })
  })

  it("test_归档经验_同样重建而不是被跳过", async () => {
    const world = await seedRebuildWorld()

    await rebuildExperienceStats({ store: world.store })

    expect(world.stats.get("ex-archived")).toMatchObject({ trust: 0.5, evidenceStrength: 0, recalledCount: 0 })
  })

  it("test_重放口径_取域层聚合器与中性投影本体", async () => {
    const world = await seedRebuildWorld()

    await rebuildExperienceStats({ store: world.store })

    expect(world.rebuildStatsCalls).toHaveLength(1)
    expect(world.rebuildStatsCalls[0].neutralStats).toEqual(NEUTRAL_STATS)
  })

  it("test_有评价历史_重放结果与增量路径逐字段一致", async () => {
    const world = await seedRebuildWorld()
    await evaluateTwice(world)
    const incremental = { ...world.stats.get("ex-1") }

    seedStats(world, "ex-1", { trust: 0.95, usedCount: 99 })
    await rebuildExperienceStats({ store: world.store })

    expect(world.stats.get("ex-1")).toEqual(incremental)
    expect(world.stats.get("ex-1")?.usedCount).toBe(2)
    expect(world.stats.get("ex-1")?.recalledCount).toBe(1)
    expect(world.stats.get("ex-1")?.trust).toBeGreaterThan(0.5)
    expect(world.stats.get("ex-1")?.harmCount).toBe(1)
  })

  it("test_统计投影被写坏_重放修复为正确值", async () => {
    const world = await seedRebuildWorld()
    seedStats(world, "ex-1", { trust: 0.05, empiricalValue: -1, stability: 0, qualitySignal: -1 })

    await rebuildExperienceStats({ store: world.store })

    expect(world.stats.get("ex-1")).toMatchObject({
      trust: 0.5,
      empiricalValue: 0,
      stability: 1,
      qualitySignal: 0,
      evidenceStrength: 0,
    })
  })

  it("test_连续两次重放_结果逐字段一致", async () => {
    const world = await seedRebuildWorld()
    await evaluateTwice(world)

    await rebuildExperienceStats({ store: world.store })
    const first = new Map(world.stats)
    await rebuildExperienceStats({ store: world.store })

    expect([...world.stats]).toEqual([...first])
  })
})

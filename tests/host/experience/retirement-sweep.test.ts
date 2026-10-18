// tests/host/experience/retirement-sweep.test.ts
//
// 退役扫描编排：读活跃经验事实 → 纯判定 → 条件归档，并保证单条失败不拖垮整轮。
//
// 为什么单独测编排而不只测判定：真正会误伤系统的是「判定正确但执行错误」——
// 例如把已归档经验再写一次、单条写失败后整轮中止、或把并发归档当成失败。

import { describe, expect, it } from "vitest"
import { sweepExperienceRetirements } from "../../../src/host/experience/retirement-sweep.js"
import type { ExperienceAutoRetirementReason, ExperienceRetirementFacts } from "../../../src/host/shared/asset-types.js"

function factsOf(overrides: Partial<ExperienceRetirementFacts> = {}): ExperienceRetirementFacts {
  return {
    experienceId: "ex-1",
    experienceType: "agent",
    reactivatedAt: 0,
    usage: [],
    evaluations: [],
    ...overrides,
  }
}

function harmfulFacts(experienceId = "ex-harmful"): ExperienceRetirementFacts {
  return factsOf({
    experienceId,
    usage: [{ runId: "run-1", createdAt: 100 }],
    evaluations: [{
      runId: "run-1",
      roleKey: "asset:role-a",
      roleLabel: "开发",
      createdAt: 100,
      scores: { fitScore: 1, decisionEffect: -1, informationGain: 0.5, causalConfidence: 1 },
    }],
  })
}

/** 满足角色经验阈值 C 的长期无用事实。 */
function longUnusedFacts(experienceId = "ex-unused"): ExperienceRetirementFacts {
  return factsOf({
    experienceId,
    usage: Array.from({ length: 10 }, (_, index) => ({ runId: `run-u${index % 5}`, createdAt: 100 + index })),
    evaluations: Array.from({ length: 5 }, (_, index) => ({
      runId: `run-e${index}`,
      roleKey: `asset:role-${index % 3}`,
      createdAt: 200 + index,
      scores: { fitScore: 1 as const, decisionEffect: 0 as const, informationGain: 0.5 as const, causalConfidence: 1 as const },
    })),
  })
}

interface RetireCall {
  experienceId: string
  reason: ExperienceAutoRetirementReason
}

function fakeStore(
  facts: ExperienceRetirementFacts[],
  options: { retiredIds?: string[]; failFor?: string } = {},
): {
  listRetirementFacts(): Promise<ExperienceRetirementFacts[]>
  retireForPolicy(id: string, reason: ExperienceAutoRetirementReason): Promise<boolean>
  calls: RetireCall[]
} {
  const calls: RetireCall[] = []
  return {
    calls,
    async listRetirementFacts() {
      return facts
    },
    async retireForPolicy(id, reason) {
      if (options.failFor === id) throw new Error(`write failed: ${id}`)
      calls.push({ experienceId: id, reason })
      return !(options.retiredIds ?? []).includes(id)
    },
  }
}

describe("退役扫描编排", () => {
  it("test_有害经验_以harmful原因归档", async () => {
    const store = fakeStore([harmfulFacts()])

    const result = await sweepExperienceRetirements({ store })

    expect(store.calls).toEqual([{ experienceId: "ex-harmful", reason: "harmful" }])
    expect(result).toEqual({
      scanned: 1,
      retired: [{ experienceId: "ex-harmful", reason: "harmful" }],
    })
  })

  it("test_长期无用经验_以long_unused原因归档", async () => {
    const store = fakeStore([longUnusedFacts()])

    const result = await sweepExperienceRetirements({ store })

    expect(store.calls).toEqual([{ experienceId: "ex-unused", reason: "long_unused" }])
    expect(result.retired).toEqual([{ experienceId: "ex-unused", reason: "long_unused" }])
  })

  it("test_证据不足经验_不调用归档", async () => {
    const store = fakeStore([factsOf()])

    const result = await sweepExperienceRetirements({ store })

    expect(store.calls).toEqual([])
    expect(result).toEqual({ scanned: 1, retired: [] })
  })

  it("test_并发已归档（条件更新返回false）_不计入本轮归档结果", async () => {
    const store = fakeStore([harmfulFacts()], { retiredIds: ["ex-harmful"] })

    const result = await sweepExperienceRetirements({ store })

    expect(store.calls).toHaveLength(1)
    expect(result).toEqual({ scanned: 1, retired: [] })
  })

  it("test_单条写入失败_记录告警并继续处理其余经验", async () => {
    const warnings: string[] = []
    const store = fakeStore([harmfulFacts("ex-fail"), harmfulFacts("ex-ok")], { failFor: "ex-fail" })

    const result = await sweepExperienceRetirements({
      store,
      logger: { warn: (message) => warnings.push(message) },
    })

    expect(result.retired).toEqual([{ experienceId: "ex-ok", reason: "harmful" }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("ex-fail")
  })

  it("test_读取事实失败_向调用方抛出（由宿主记录并等待下一轮重试）", async () => {
    const store = {
      async listRetirementFacts(): Promise<ExperienceRetirementFacts[]> {
        throw new Error("database locked")
      },
      async retireForPolicy(): Promise<boolean> {
        return true
      },
    }

    await expect(sweepExperienceRetirements({ store })).rejects.toThrow("database locked")
  })
})

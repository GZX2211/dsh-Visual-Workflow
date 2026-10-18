// tests/host/experience/retirement-schedule.test.ts
//
// 退役扫描的宿主定时编排：启动延迟、周期执行、失败不终止后续轮次、dispose 后不再执行。
//
// 为什么单独测定时器：经验域的扫描是纯编排，宿主生命周期才是「什么时候跑、失败后还跑不跑、
// 卸载后会不会迟到执行」的责任者；这些行为无法由扫描函数自身证明。

import { afterEach, describe, expect, it, vi } from "vitest"
import { scheduleExperienceRetirementSweep } from "../../../src/host/experience/retirement-schedule.js"

const EMPTY_RESULT = { scanned: 0, retired: [] }

afterEach(() => {
  vi.useRealTimers()
})

describe("经验退役扫描定时编排", () => {
  it("test_启动延迟后首扫_之后按周期执行", async () => {
    vi.useFakeTimers()
    const sweep = vi.fn(async () => EMPTY_RESULT)

    const dispose = scheduleExperienceRetirementSweep({ sweep, initialDelayMs: 1000, intervalMs: 5000 })

    expect(sweep).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(999)
    expect(sweep).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sweep).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(sweep).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sweep).toHaveBeenCalledTimes(2)

    dispose()
    await vi.advanceTimersByTimeAsync(20000)
    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it("test_dispose在首扫前_不会执行任何扫描", async () => {
    vi.useFakeTimers()
    const sweep = vi.fn(async () => EMPTY_RESULT)

    const dispose = scheduleExperienceRetirementSweep({ sweep, initialDelayMs: 1000, intervalMs: 5000 })
    dispose()
    await vi.advanceTimersByTimeAsync(20000)

    expect(sweep).not.toHaveBeenCalled()
  })

  it("test_单轮扫描失败_记录告警且下一轮仍执行", async () => {
    vi.useFakeTimers()
    const warnings: string[] = []
    const sweep = vi.fn()
      .mockRejectedValueOnce(new Error("database locked"))
      .mockResolvedValue(EMPTY_RESULT)

    const dispose = scheduleExperienceRetirementSweep({
      sweep,
      initialDelayMs: 1000,
      intervalMs: 5000,
      logger: { warn: (message) => warnings.push(message) },
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("database locked")

    await vi.advanceTimersByTimeAsync(5000)
    expect(sweep).toHaveBeenCalledTimes(2)
    dispose()
  })

  it("test_本轮有归档_记录可诊断摘要", async () => {
    vi.useFakeTimers()
    const infos: string[] = []
    const sweep = vi.fn(async () => ({
      scanned: 3,
      retired: [{ experienceId: "ex-1", reason: "harmful" as const }],
    }))

    const dispose = scheduleExperienceRetirementSweep({
      sweep,
      initialDelayMs: 1000,
      intervalMs: 5000,
      logger: { warn: () => {}, info: (message) => infos.push(message) },
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain("ex-1")
    dispose()
  })
})

// tests/host/experience/feedback.test.ts
//
// 反馈编排门（§8、§24、§35）。
//
// 为什么重点锁定「准入」与「单条跳过」：反馈是唯一由模型主动写入的历史事实入口，而写入前置
// 条件（该经验确实被显式注入过）无法由模型自证。若准入放宽或整批拒绝，前者会造出「没使用过
// 也评价」的假历史，后者会让一次误填废掉整批复盘数据；两种偏差都会污染长期统计且不可回溯。

import { describe, expect, it } from "vitest"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_FEEDBACK_FAILED,
  ERR_EXPERIENCE_WRONG_TYPE,
} from "../../../src/host/shared/protocol.js"
import { MAX_EVALUATIONS_PER_CALL } from "../../../src/host/experience/constants.js"
import {
  FEEDBACK_ADMISSION_REJECTED_REASON,
  submitExperienceFeedback,
  type ExperienceFeedbackDeps,
  type ExperienceFeedbackInput,
} from "../../../src/host/experience/feedback.js"
import type { ExperienceCaller } from "../../../src/host/experience/ports.js"
import { errorOf } from "./fixtures/assertions.js"
import {
  createExperienceWorld,
  seedActiveRun,
  seedChildRun,
  seedEntry,
  seedInjected,
  seedUsed,
  type FakeExperienceWorld,
} from "./fixtures/ports.js"

const ROOT_CALLER: ExperienceCaller = { isChild: false, sessionId: "session-1" }
const CHILD_CALLER: ExperienceCaller = { isChild: true, sessionId: "session-1", childId: "child-1" }

/** 一条合法评价（默认最高锚点）。 */
function evaluation(overrides: Partial<ExperienceFeedbackInput> = {}): ExperienceFeedbackInput {
  return {
    experienceId: "ex-1",
    fitScore: 1,
    decisionEffect: 1,
    informationGain: 1,
    causalConfidence: 1,
    ...overrides,
  }
}

/** 反馈依赖（端口来自受控世界）。 */
function createDeps(world: FakeExperienceWorld): { deps: ExperienceFeedbackDeps } {
  return { deps: { store: world.store, runtime: world.runtime } }
}

/** 摆好「一条 agent 经验已被父代理显式注入」的受控世界。 */
function seedInjectedWorld(): FakeExperienceWorld {
  const world = createExperienceWorld()
  seedEntry(world, { id: "ex-1", experienceType: "agent" })
  seedInjected(world, { subjectId: "session-1", experienceId: "ex-1" })
  return world
}

describe("submitExperienceFeedback 准入", () => {
  it("test_已被显式注入_写入评价并返回读回投影", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ evidence: "避免了返工" })],
    })

    expect(result.skipped).toEqual([])
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]).toMatchObject({
      id: "eval-1",
      createdAt: world.now,
      experienceId: "ex-1",
      runId: "",
      evidence: "避免了返工",
      evaluatorSubjectId: "session-1",
      evaluatorModel: "fixture-model",
      fitScore: 1,
      decisionEffect: 1,
    })
  })

  it("test_未被显式注入_跳过该条并报告没有使用的经验不能评价", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.accepted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].experienceId).toBe("ex-1")
    expect(result.skipped[0].reason.includes(FEEDBACK_ADMISSION_REJECTED_REASON)).toBe(true)
    expect(result.skipped[0].reason.includes("请先用")).toBe(false)
    expect(result.skipped[0].reason.includes("ids")).toBe(false)
  })

  it("test_经验 id 不存在_按未使用跳过而不是报错", async () => {
    const world = createExperienceWorld()
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ experienceId: "ex-missing" })],
    })

    expect(result.accepted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].experienceId).toBe("ex-missing")
    expect(result.skipped[0].reason.includes(FEEDBACK_ADMISSION_REJECTED_REASON)).toBe(true)
  })

  it("test_同批混合已使用与未使用_只跳过未使用且不整批拒绝", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-used", experienceType: "agent" })
    seedEntry(world, { id: "ex-unused", experienceType: "agent" })
    seedInjected(world, { subjectId: "session-1", experienceId: "ex-used" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ experienceId: "ex-used" }), evaluation({ experienceId: "ex-unused" })],
    })

    expect(result.accepted.map((entry) => entry.experienceId)).toEqual(["ex-used"])
    expect(result.skipped.map((entry) => entry.experienceId)).toEqual(["ex-unused"])
  })

  it("test_全部未使用_不发起写入事务", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.skipped).toHaveLength(1)
    expect(world.calls.includes("store.insertEvaluationsChecked")).toBe(false)
  })

  it("test_其他主体的注入记录_不能作为本主体准入依据", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    seedInjected(world, { subjectId: "child-9", experienceId: "ex-1" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.skipped).toHaveLength(1)
    expect(result.accepted).toEqual([])
  })

  it("test_其他经验类型的注入记录_不能作为本类型准入依据", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-team", experienceType: "team" })
    seedActiveRun(world, "session-1")
    world.runtimeFacts.teamRuns.add("session-1")
    seedInjected(world, { subjectId: "session-1", experienceId: "ex-team" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "orchestrator", evaluations: [evaluation({ experienceId: "ex-team" })] })

    expect(result.skipped).toHaveLength(1)
    expect(result.accepted).toEqual([])
  })

  it("test_同一经验重复评价_每次都作为独立使用事件写入", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation(), evaluation({ fitScore: 0.5 })],
    })

    expect(result.accepted).toHaveLength(2)
    expect(result.accepted.map((entry) => entry.fitScore)).toEqual([1, 0.5])
    expect(world.stats.get("ex-1")?.usedCount).toBe(2)
  })
})

describe("submitExperienceFeedback 参数与职责校验", () => {
  it("test_评价数组为空_拒绝且不读使用事实", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [] }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(world.calls.includes("store.listInjectedIds")).toBe(false)
  })

  it("test_评价条数超上限_拒绝", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)
    const evaluations = Array.from({ length: MAX_EVALUATIONS_PER_CALL + 1 }, () => evaluation())

    const error = await errorOf(() => submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes(String(MAX_EVALUATIONS_PER_CALL))).toBe(true)
  })

  it("test_锚点非法_确定性拒绝且不写任何评价", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ fitScore: 0.73 as never })],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes("0.73")).toBe(true)
    expect(world.calls.includes("store.insertEvaluationsChecked")).toBe(false)
  })

  it("test_评价证据超长_拒绝", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ evidence: "证".repeat(2001) })],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_经验 id 为空串_拒绝", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, {
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [evaluation({ experienceId: "  " })],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_主体职责不符_拒绝且不读使用事实", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "orchestrator", evaluations: [evaluation()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(world.calls.includes("store.listInjectedIds")).toBe(false)
  })
})

describe("submitExperienceFeedback 写入与失败隔离（§24 / §35）", () => {
  it("test_评价写入与统计重算_走同一笔事务入口", async () => {
    // 使用事实走端口写入（生产中 stats 行由使用写入同步建立），否则 recalledCount 会缺一次记账
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    await seedUsed(world, { subjectId: "session-1", experienceId: "ex-1" })
    const { deps } = createDeps(world)

    await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(world.insertEvaluationsCalls).toHaveLength(1)
    expect(world.stats.get("ex-1")).toMatchObject({ usedCount: 1, recalledCount: 1, effectiveSampleCount: 1 })
    expect(world.stats.get("ex-1")?.trust).toBeCloseTo(0.513219098459233, 12)
  })

  it("test_评价写入失败_归一为反馈失败并保留原始原因与恢复动作", async () => {
    const world = seedInjectedWorld()
    world.store.insertEvaluationsChecked = async () => {
      throw new Error("磁盘写入失败")
    }
    const { deps } = createDeps(world)

    const error = await errorOf(() => submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_FEEDBACK_FAILED)
    expect(error.message.includes("磁盘写入失败")).toBe(true)
    expect(error.message.includes("重试")).toBe(true)
  })

  it("test_反馈写入_不修改经验本体字段", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)
    const before = { ...world.entries.get("ex-1") }

    await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(world.entries.get("ex-1")).toEqual(before)
    expect(world.calls.includes("store.updateFields")).toBe(false)
  })

  it("test_子代理提交_评分者身份与来源运行取子代理事实", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { runId: "run-7", sessionId: "session-1" })
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    seedInjected(world, { subjectId: "child-1", experienceId: "ex-1", runId: "run-7" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: CHILD_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.accepted[0]).toMatchObject({ evaluatorSubjectId: "child-1", runId: "run-7", evaluatorModel: "fixture-model" })
  })

  it("test_模型名无法确定_评分为空串而不伪造模型名", async () => {
    const world = createExperienceWorld({ defaultModel: "" })
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    seedInjected(world, { subjectId: "session-1", experienceId: "ex-1" })
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.accepted[0].evaluatorModel).toBe("")
  })

  it("test_评价证据缺省_按空串落库", async () => {
    const world = seedInjectedWorld()
    const { deps } = createDeps(world)

    const result = await submitExperienceFeedback(deps, { caller: ROOT_CALLER, type: "agent", evaluations: [evaluation()] })

    expect(result.accepted[0].evidence).toBe("")
  })
})

// tests/host/experience/subject.test.ts
//
// 主体解析与类型职责校验门（§6/§7.3）。
//
// 为什么职责校验必须独立成门：经验只有「对应主体实际承担的职责」才有意义。若编排父代理
// 能提交 agent 经验、或没有协作组时能提交 team 经验，经验库会被错误主体的经验污染，
// 而召回侧无法分辨。校验失败必须给出「当前实际职责 + 可选类型」，模型才能改对。

import { describe, expect, it } from "vitest"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_WRONG_TYPE,
} from "../../../src/host/shared/protocol.js"
import type { ExperienceCaller } from "../../../src/host/experience/ports.js"
import { allowedExperienceTypes, resolveExperienceReaderSubject, resolveExperienceSubject } from "../../../src/host/experience/subject.js"
import { createExperienceWorld, seedActiveRun, seedChildRun } from "./fixtures/ports.js"
import { errorOf } from "./fixtures/assertions.js"

/** 子代理调用方（childId 为官方子代理会话 agent.id）。 */
function childCaller(childId = "child-1"): ExperienceCaller {
  return { isChild: true, sessionId: "session-1", childId }
}

/** 父代理调用方。 */
function rootCaller(sessionId = "session-1"): ExperienceCaller {
  return { isChild: false, sessionId }
}

describe("resolveExperienceSubject 子代理", () => {
  it("test_子代理可定位运行_解析为 agent 且来源运行取运行事实", () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { runId: "run-9", sessionId: "session-1", nodeId: "node-7" })

    const subject = resolveExperienceSubject({ caller: childCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "agent",
      sourceRunId: "run-9",
      sessionId: "session-1",
      subjectId: "child-1",
      childId: "child-1",
    })
  })

  it("test_子代理填 team_拒绝并说明只能填 agent", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({ caller: childCaller(), type: "team", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("agent")).toBe(true)
  })

  it("test_子代理填 orchestrator_拒绝", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({ caller: childCaller(), type: "orchestrator", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })

  it("test_子代理缺少 childId_返回可行动错误而非落到无来源经验", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({
      caller: { isChild: true, sessionId: "session-1" },
      type: "agent",
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes("childId")).toBe(true)
  })

  it("test_子代理无法定位运行_拒绝且不产生无来源经验", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({ caller: childCaller(), type: "agent", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })
})

describe("resolveExperienceSubject 父代理", () => {
  it("test_有活跃运行且填 orchestrator_解析为编排经验", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-1")

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "orchestrator",
      sourceRunId: "run-1",
      sessionId: "session-1",
      subjectId: "session-1",
    })
  })

  it("test_有活跃运行却填 agent_拒绝并说明当前是编排管理者", async () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1")

    const error = await errorOf(() => resolveExperienceSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("orchestrator")).toBe(true)
  })

  it("test_无活跃运行时填 agent_解析为执行经验且来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "agent", sourceRunId: "", sessionId: "session-1", subjectId: "session-1" })
  })

  it("test_无活跃运行且未改过图_填 orchestrator_拒绝并给出可选类型", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("也没有改过工作流图")).toBe(true)
    expect(error.message.includes("agent")).toBe(true)
  })

  it("test_无活跃运行但曾改过图_填 orchestrator_允许且来源运行为空", () => {
    const world = createExperienceWorld()
    world.runtimeFacts.graphPatchedSessions.add("session-1")

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "orchestrator",
      sourceRunId: "",
      sessionId: "session-1",
      subjectId: "session-1",
    })
  })

  it("test_本运行启动过协作组_允许 team 并取运行作为来源", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-5")
    world.runtimeFacts.teamRuns.add("session-1")

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "team", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "team", sourceRunId: "run-5" })
  })

  it("test_本运行未启动协作组_拒绝 team 并给出可选类型", async () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-5")

    const error = await errorOf(() => resolveExperienceSubject({ caller: rootCaller(), type: "team", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("协作组")).toBe(true)
  })

  it("test_运行已结束但本会话曾启动协作组_拒绝 team 且说明无来源运行", async () => {
    const world = createExperienceWorld()
    world.runtimeFacts.teamRuns.add("session-1")

    const error = await errorOf(() => resolveExperienceSubject({ caller: rootCaller(), type: "team", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })

  it("test_未知类型取值_拒绝并列出合法类型", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({
      caller: rootCaller(),
      type: "reflection" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("team")).toBe(true)
  })
})

describe("allowedExperienceTypes", () => {
  it("test_子代理_只允许 agent", () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    expect(allowedExperienceTypes({ caller: childCaller(), runtime: world.runtime })).toEqual(["agent"])
  })

  it("test_编排管理者_允许 orchestrator 与已启动协作组时的 team", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1")
    world.runtimeFacts.teamRuns.add("session-1")

    expect(allowedExperienceTypes({ caller: rootCaller(), runtime: world.runtime })).toEqual(["orchestrator", "team"])
  })

  it("test_无活跃运行的父代理_允许 agent", () => {
    const world = createExperienceWorld()

    expect(allowedExperienceTypes({ caller: rootCaller(), runtime: world.runtime })).toEqual(["agent"])
  })

  it("test_无活跃运行但曾改过图_允许 orchestrator", () => {
    const world = createExperienceWorld()
    world.runtimeFacts.graphPatchedSessions.add("session-1")

    expect(allowedExperienceTypes({ caller: rootCaller(), runtime: world.runtime })).toEqual(["orchestrator"])
  })

  it("test_无法定位的子代理_无可选类型", () => {
    const world = createExperienceWorld()

    expect(allowedExperienceTypes({ caller: childCaller(), runtime: world.runtime })).toEqual([])
  })
})

describe("resolveExperienceReaderSubject 读取侧（D-09：不施加职责门禁）", () => {
  it("test_改过图的父代理仍可解析 agent 读取主体", () => {
    const world = createExperienceWorld()
    world.runtimeFacts.graphPatchedSessions.add("session-1")

    // 写入侧此刻只允许 orchestrator（改过图即编排职责），但读取侧不应被自身身份挡住
    const subject = resolveExperienceReaderSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "agent",
      sessionId: "session-1",
      subjectId: "session-1",
      sourceRunId: "",
    })
  })

  it("test_无运行实例且未改图_team 读取主体仍可解析", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceReaderSubject({ caller: rootCaller(), type: "team", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "team", sourceRunId: "" })
  })

  it("test_有运行实例_orchestrator 读取主体带上来源运行", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-7")

    const subject = resolveExperienceReaderSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "orchestrator", sourceRunId: "run-7" })
  })

  it("test_子代理读取 agent_来源运行缺失时按无来源运行处理", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceReaderSubject({ caller: childCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "agent", subjectId: "child-1", sourceRunId: "" })
  })

  it("test_子代理读取编排经验_明确拒绝而不是静默回退到 agent 池", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceReaderSubject({
      caller: childCaller(),
      type: "orchestrator",
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("只能召回 agent 经验")).toBe(true)
  })

  it("test_读取侧类型非法_错误文案按召回语义给出", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceReaderSubject({
      caller: rootCaller(),
      type: "junk" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("重新召回")).toBe(true)
  })

  it("test_写入侧类型非法_错误文案仍按提交语义给出", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({
      caller: rootCaller(),
      type: "junk" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("重新提交")).toBe(true)
  })
})

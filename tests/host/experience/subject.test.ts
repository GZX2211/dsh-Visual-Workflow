// tests/host/experience/subject.test.ts
//
// 主体解析与类型边界门（§6 / §7.3）。
//
// 为什么仍然必须独立成门：经验只有对应「主体实际执行的执行内容」才有意义，而子代理恒为
// 执行主体——它提交或召回编排经验只会污染自己的上下文与来源归属。父代理侧的门禁已按用户
// 裁决（2026-10-11）永久取消：父代理自行按此刻执行的内容选择 agent / orchestrator，
// 引擎不得再用「是否正在编排运行中 / 是否改过图」反推它的身份。

import { describe, expect, it } from "vitest"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_WRONG_TYPE,
} from "../../../src/host/shared/protocol.js"
import type { ExperienceCaller } from "../../../src/host/experience/ports.js"
import { resolveExperienceSubject } from "../../../src/host/experience/subject.js"
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

  it("test_子代理提交 orchestrator_被拒且给出可行动类型说明", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({ caller: childCaller(), type: "orchestrator", runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("agent")).toBe(true)
    expect(error.message.includes("child")).toBe(true)
  })

  it("test_子代理提交已退役的 team 取值_按非法类型拒绝", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({ caller: childCaller(), type: "team" as never, runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("orchestrator")).toBe(true)
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

  it("test_子代理不在任何编排运行内_仍可提交 agent 经验且来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: childCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "agent",
      sourceRunId: "",
      sessionId: "session-1",
      subjectId: "child-1",
      childId: "child-1",
    })
  })

  it("test_子代理不在任何编排运行内_仍可召回 agent 经验（同一解析入口）", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: childCaller(), type: "agent", runtime: world.runtime })

    expect(subject.experienceType).toBe("agent")
    expect(subject.sourceRunId).toBe("")
  })
})

describe("resolveExperienceSubject 父代理（护栏永久移除）", () => {
  it("test_无任何运行事实_提交 orchestrator 成功且来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "orchestrator",
      sourceRunId: "",
      sessionId: "session-1",
      subjectId: "session-1",
    })
  })

  it("test_无任何运行事实_提交 agent 成功且来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "agent", sourceRunId: "", sessionId: "session-1", subjectId: "session-1" })
  })

  it("test_有活跃运行_提交 orchestrator 解析为编排经验并带上来源运行", () => {
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

  it("test_有活跃运行_提交 agent 同样成功（类型按此刻执行内容自选）", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-1")

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "agent", sourceRunId: "run-1" })
  })

  it("test_已退役的 team 取值_按非法类型拒绝并列出合法类型", async () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-1")

    const error = await errorOf(() => resolveExperienceSubject({ caller: rootCaller(), type: "team" as never, runtime: world.runtime }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("agent")).toBe(true)
    expect(error.message.includes("orchestrator")).toBe(true)
  })
})

describe("resolveExperienceSubject 读取侧（同一解析入口）", () => {
  it("test_父代理读取 agent 主体_类型只决定候选池不受身份阻挡", () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1", "run-3")

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({
      experienceType: "agent",
      sessionId: "session-1",
      subjectId: "session-1",
      sourceRunId: "run-3",
    })
  })

  it("test_无运行实例_orchestrator 读取主体仍可解析且来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: rootCaller(), type: "orchestrator", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "orchestrator", sourceRunId: "" })
  })

  it("test_子代理读取编排经验_明确拒绝而不是静默回退到 agent 池", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({
      caller: childCaller(),
      type: "orchestrator",
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.includes("agent")).toBe(true)
  })

  it("test_子代理召回传入已退役的 team 取值_同样被拒", async () => {
    const world = createExperienceWorld()
    seedChildRun(world, "child-1", { sessionId: "session-1" })

    const error = await errorOf(() => resolveExperienceSubject({
      caller: childCaller(),
      type: "team" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })

  it("test_读取侧类型非法_错误消息带稳定码并列出合法取值", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({
      caller: rootCaller(),
      type: "junk" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.startsWith(`${ERR_EXPERIENCE_WRONG_TYPE}: `)).toBe(true)
    expect(error.message.includes("orchestrator")).toBe(true)
  })

  it("test_子代理不在任何编排运行内_读取 agent 主体来源运行为空", () => {
    const world = createExperienceWorld()

    const subject = resolveExperienceSubject({ caller: childCaller(), type: "agent", runtime: world.runtime })

    expect(subject).toMatchObject({ experienceType: "agent", subjectId: "child-1", sourceRunId: "" })
  })

  it("test_写入侧类型非法_同样带稳定码拒绝", async () => {
    const world = createExperienceWorld()

    const error = await errorOf(() => resolveExperienceSubject({
      caller: rootCaller(),
      type: "junk" as never,
      runtime: world.runtime,
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(error.message.startsWith(`${ERR_EXPERIENCE_WRONG_TYPE}: `)).toBe(true)
  })
})

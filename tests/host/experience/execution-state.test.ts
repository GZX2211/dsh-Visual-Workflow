// tests/host/experience/execution-state.test.ts
//
// 初始化状态表门。
//
// 为什么它值得单独测：状态表是「必须先取 Prompt 才能提交」这条协议的唯一执行者。
// 它有两个必须同时成立的性质——幂等（同一主体同一类型重复初始化不产生第二条记录，
// 否则状态会随对话轮次无界增长）与可释放（run 终态、插件卸载后不留悬挂记录）。

import { describe, expect, it } from "vitest"
import { ExperienceExecutionState } from "../../../src/host/experience/execution-state.js"

/** 标记入参工厂。 */
function markInput(overrides: Partial<Parameters<ExperienceExecutionState["markInitialized"]>[0]> = {}) {
  return {
    sessionId: "session-1",
    subjectId: "subject-1",
    experienceType: "agent" as const,
    generationPromptId: "ep-agent",
    generationPromptVersion: "V1",
    ...overrides,
  }
}

describe("ExperienceExecutionState 标记与读取", () => {
  it("test_标记后读取_返回完整初始化记录", () => {
    const state = new ExperienceExecutionState({ now: () => 1000 })

    state.markInitialized(markInput())

    expect(state.readInitialized("session-1", "subject-1", "agent")).toEqual({
      sessionId: "session-1",
      subjectId: "subject-1",
      experienceType: "agent",
      generationPromptId: "ep-agent",
      generationPromptVersion: "V1",
      initialized: true,
      initializedAt: 1000,
      refreshedAt: 1000,
    })
  })

  it("test_未标记_读取为空", () => {
    const state = new ExperienceExecutionState()

    expect(state.readInitialized("session-1", "subject-1", "agent")).toBeNull()
  })

  it("test_重复标记_幂等且首次时间保留", () => {
    let now = 1000
    const state = new ExperienceExecutionState({ now: () => now })

    state.markInitialized(markInput())
    now = 2000
    state.markInitialized(markInput({ generationPromptVersion: "V2" }))

    expect(state.recordCount).toBe(1)
    expect(state.sessionCount).toBe(1)
    expect(state.readInitialized("session-1", "subject-1", "agent")).toMatchObject({
      generationPromptVersion: "V2",
      initializedAt: 1000,
      refreshedAt: 2000,
    })
  })

  it("test_不同主体或不同类型_各自独立记录", () => {
    const state = new ExperienceExecutionState()

    state.markInitialized(markInput())
    state.markInitialized(markInput({ subjectId: "subject-2" }))
    state.markInitialized(markInput({ experienceType: "team" }))

    expect(state.recordCount).toBe(3)
    expect(state.readInitialized("session-1", "subject-2", "agent")).not.toBeNull()
    expect(state.readInitialized("session-1", "subject-1", "team")).not.toBeNull()
  })

  it("test_读取结果被外部改动_不影响内部状态", () => {
    const state = new ExperienceExecutionState()
    state.markInitialized(markInput())

    const record = state.readInitialized("session-1", "subject-1", "agent")
    if (record) record.generationPromptVersion = "被外部改写"

    expect(state.readInitialized("session-1", "subject-1", "agent")?.generationPromptVersion).toBe("V1")
  })
})

describe("ExperienceExecutionState 释放与上界", () => {
  it("test_按会话清理_该会话全部记录被释放并返回条数", () => {
    const state = new ExperienceExecutionState()
    state.markInitialized(markInput())
    state.markInitialized(markInput({ subjectId: "subject-2" }))
    state.markInitialized(markInput({ sessionId: "session-2" }))

    const cleared = state.clearBySession("session-1")

    expect(cleared).toBe(2)
    expect(state.readInitialized("session-1", "subject-1", "agent")).toBeNull()
    expect(state.readInitialized("session-2", "subject-1", "agent")).not.toBeNull()
  })

  it("test_清理不存在的会话_幂等无副作用", () => {
    const state = new ExperienceExecutionState()

    expect(state.clearBySession("session-x")).toBe(0)
  })

  it("test_会话数超过上界_逐出最早会话以保持有界", () => {
    const state = new ExperienceExecutionState({ maxSessions: 2 })
    state.markInitialized(markInput({ sessionId: "session-1" }))
    state.markInitialized(markInput({ sessionId: "session-2" }))

    state.markInitialized(markInput({ sessionId: "session-3" }))

    expect(state.sessionCount).toBe(2)
    expect(state.readInitialized("session-1", "subject-1", "agent")).toBeNull()
    expect(state.readInitialized("session-3", "subject-1", "agent")).not.toBeNull()
  })

  it("test_clearAll_释放全部记录", () => {
    const state = new ExperienceExecutionState()
    state.markInitialized(markInput())
    state.markInitialized(markInput({ sessionId: "session-2" }))

    state.clearAll()

    expect(state.recordCount).toBe(0)
    expect(state.sessionCount).toBe(0)
  })
})

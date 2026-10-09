// tests/host/experience/team-context.test.ts
//
// 协作组共享上下文渲染门。
//
// 为什么锁定逐字文本：这段文本以同一份内容注入协作组全部成员的初始任务上下文，成员之间必须
// 看到完全一致的内容；锚点、字段顺序与分隔符一旦漂移，注入侧识别与成员间对照都会失真。

import { describe, expect, it } from "vitest"
import {
  TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST,
  TEAM_EXPERIENCE_CONTEXT_HEADING,
  TEAM_EXPERIENCE_CONTEXT_INTRO,
  TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER,
  renderTeamExperienceContext,
  type TeamExperienceContextEntry,
} from "../../../src/host/experience/team-context.js"

/** 渲染输入工厂。 */
function entry(overrides: Partial<TeamExperienceContextEntry> = {}): TeamExperienceContextEntry {
  return {
    id: "ex-1",
    responsibility: "对协作交付负责",
    taskType: "软件开发协作",
    decisionDomain: "任务分解",
    trigger: "准备并行启动成员时",
    principle: "先对齐接口再并行",
    recommendedAction: "启动前同步接口契约",
    exclusions: ["条件甲", "条件乙"],
    ...overrides,
  }
}

describe("renderTeamExperienceContext", () => {
  it("test_无经验_渲染为空串以便调用方跳过注入", () => {
    expect(renderTeamExperienceContext([])).toBe("")
  })

  it("test_单条经验_按固定锚点与字段顺序渲染", () => {
    const text = renderTeamExperienceContext([entry()])

    expect(text).toBe([
      TEAM_EXPERIENCE_CONTEXT_HEADING,
      TEAM_EXPERIENCE_CONTEXT_INTRO,
      [
        `${TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER}ex-1`,
        "责任：对协作交付负责",
        "任务类型：软件开发协作",
        "决策领域：任务分解",
        "触发信号：准备并行启动成员时",
        "原则：先对齐接口再并行",
        "建议行动：启动前同步接口契约",
        "不适用：条件甲；条件乙",
      ].join("\n"),
    ].join("\n\n"))
  })

  it("test_无排除条件_使用稳定占位", () => {
    const text = renderTeamExperienceContext([entry({ exclusions: [] })])

    expect(text.includes(`不适用：${TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST}`)).toBe(true)
  })

  it("test_多条经验_按传入顺序逐条渲染且含全部 id", () => {
    const text = renderTeamExperienceContext([entry({ id: "ex-1" }), entry({ id: "ex-2" })])

    expect(text.indexOf("ex-1") < text.indexOf("ex-2")).toBe(true)
  })

  it("test_同一输入两次渲染_字节相同", () => {
    const first = renderTeamExperienceContext([entry()])
    const second = renderTeamExperienceContext([entry()])

    expect(second).toBe(first)
  })

  it("test_字段内换行_折叠后不破坏分段结构", () => {
    const text = renderTeamExperienceContext([entry({ principle: "第一行\n第二行" })])

    expect(text.includes("原则：第一行 第二行")).toBe(true)
    expect(text.split("\n\n")[2].split("\n")).toHaveLength(8)
  })
})

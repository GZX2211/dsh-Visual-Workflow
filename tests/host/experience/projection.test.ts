// tests/host/experience/projection.test.ts
//
// 检索投影格式锁定。
//
// 为什么用精确字符串断言而不是快照文件：两个检索文本是 embedding 的输入，格式一旦漂移
// 就会让历史向量与新向量不可比（同一经验重算投影后相似度会失真）。精确断言把「段落锚点、
// 顺序、分隔符、空数组占位」全部锁死，改动必须显式更新本文件。

import { describe, expect, it } from "vitest"
import {
  PROJECTION_EMPTY_VALUE,
  buildDecisionRetrievalText,
  buildRecallSummary,
  buildRetrievalProjection,
  buildTaskRetrievalText,
} from "../../../src/host/experience/projection.js"
import type { ExperienceSemanticFields } from "../../../src/host/experience/validation.js"

/** 投影输入工厂（已归一化的语义核心）。 */
function fields(overrides: Partial<ExperienceSemanticFields> = {}): ExperienceSemanticFields {
  return {
    responsibility: "对节点任务的正确性负责",
    taskType: "软件开发",
    decisionDomain: "任务分解",
    situation: "两个节点共享未稳定的前置条件",
    trigger: "准备并行启动多个节点时",
    principle: "前置条件未稳定时并行会放大返工",
    recommendedAction: "先建立显式完成闸门再并行",
    exclusions: ["前置条件已稳定时不适用"],
    evidence: ["一次并行执行返工"],
    ...overrides,
  }
}

describe("buildTaskRetrievalText", () => {
  it("test_任务侧投影_稳定 label-value 四行", () => {
    const text = buildTaskRetrievalText(fields())

    expect(text).toBe([
      "responsibility: 对节点任务的正确性负责",
      "task_type: 软件开发",
      "situation: 两个节点共享未稳定的前置条件",
      "trigger: 准备并行启动多个节点时",
    ].join("\n"))
  })

  it("test_任务侧投影_字段内换行_折叠为单空格保持单行", () => {
    const text = buildTaskRetrievalText(fields({ situation: "第一行\n第二行  " }))

    expect(text).toBe([
      "responsibility: 对节点任务的正确性负责",
      "task_type: 软件开发",
      "situation: 第一行 第二行",
      "trigger: 准备并行启动多个节点时",
    ].join("\n"))
  })
})

describe("buildDecisionRetrievalText", () => {
  it("test_决策侧投影_四个数组元素用 ASCII 分号连接在同一行", () => {
    const text = buildDecisionRetrievalText(fields({ exclusions: ["条件甲", "条件乙"] }))

    expect(text).toBe([
      "decision_domain: 任务分解",
      "principle: 前置条件未稳定时并行会放大返工",
      "recommended_action: 先建立显式完成闸门再并行",
      "exclusions: 条件甲; 条件乙",
    ].join("\n"))
  })

  it("test_决策侧投影_无排除条件_使用稳定占位", () => {
    const text = buildDecisionRetrievalText(fields({ exclusions: [] }))

    expect(text.endsWith(`exclusions: ${PROJECTION_EMPTY_VALUE}`)).toBe(true)
  })

  it("test_决策侧投影_evidence 不参与_证据变化不改变文本", () => {
    const base = buildDecisionRetrievalText(fields())
    const withEvidence = buildDecisionRetrievalText(fields({ evidence: ["完全不同的证据"] }))

    expect(withEvidence).toBe(base)
  })
})

describe("buildRetrievalProjection", () => {
  it("test_一次投影_同时给出两个检索文本", () => {
    const projection = buildRetrievalProjection(fields())

    expect(projection.taskRetrievalText).toBe(buildTaskRetrievalText(fields()))
    expect(projection.decisionRetrievalText).toBe(buildDecisionRetrievalText(fields()))
  })

  it("test_同一输入两次投影_字节相同", () => {
    const first = buildRetrievalProjection(fields())
    const second = buildRetrievalProjection(fields())

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe("buildRecallSummary", () => {
  it("test_召回摘要_按责任决策领域排除情境四段", () => {
    const summary = buildRecallSummary(fields())

    expect(summary).toBe([
      "responsibility: 对节点任务的正确性负责",
      "decision_domain: 任务分解",
      "exclusions: 前置条件已稳定时不适用",
      "situation: 两个节点共享未稳定的前置条件",
    ].join("\n"))
  })

  it("test_召回摘要_不包含原则与建议行动_保持模型判断用摘要的最小面", () => {
    const summary = buildRecallSummary(fields())

    expect(summary.includes("principle")).toBe(false)
    expect(summary.includes("recommended_action")).toBe(false)
  })
})

describe("投影文本的模型可见语言面", () => {
  /** 全 ASCII 字段值：此时投影文本的非 ASCII 字符只可能来自系统的标签/占位/分隔符。 */
  function asciiFields(overrides: Partial<ExperienceSemanticFields> = {}): ExperienceSemanticFields {
    return fields({
      responsibility: "own the correctness of the node task",
      taskType: "software-development",
      decisionDomain: "task decomposition",
      situation: "two nodes share an unstable precondition",
      trigger: "about to start several nodes in parallel",
      principle: "parallelism amplifies rework while a shared precondition is unstable",
      recommendedAction: "establish an explicit completion gate before parallelizing",
      exclusions: ["precondition already stable"],
      evidence: ["one parallel run was reworked"],
      ...overrides,
    })
  }

  it("test_空列表占位符_为 ASCII 文本", () => {
    expect(PROJECTION_EMPTY_VALUE).toMatch(/^[\x20-\x7e]+$/)
  })

  it("test_全 ASCII 字段_投影文本不含非 ASCII 字符", () => {
    const texts = [
      buildTaskRetrievalText(asciiFields()),
      buildDecisionRetrievalText(asciiFields({ exclusions: [] })),
      buildRecallSummary(asciiFields({ exclusions: ["first condition", "second condition"] })),
    ]

    for (const text of texts) expect(text).toMatch(/^[\x00-\x7f]*$/)
  })
})

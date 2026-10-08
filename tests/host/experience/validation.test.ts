// tests/host/experience/validation.test.ts
//
// 候选入库协议校验门。
//
// 为什么未知字段必须显式拒绝：模型按 Prompt 产出候选时最容易带出旧协议字段（insight /
// task_context 之类）。静默丢弃会让模型以为字段生效、从而持续产出无效候选；拒绝并回报
// 字段名才能让模型自我纠正。批内完全重复同样是「模型一次提交里自己抄自己」，属调用错误，
// 不是相近经验（相近由 0.8 语义判重拦截并静默跳过）。

import { describe, expect, it } from "vitest"
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_VALIDATION } from "../../../src/host/shared/protocol.js"
import { MAX_CANDIDATES_PER_CALL } from "../../../src/host/experience/constants.js"
import { validateExperienceCandidates, validateExperiencePatch } from "../../../src/host/experience/validation.js"
import { createCandidatePayload, createEntry } from "./fixtures/ports.js"
import { errorOf } from "./fixtures/assertions.js"

describe("validateExperienceCandidates 载荷形状", () => {
  it("test_合法候选数组_归一化为草稿并保留九字段", () => {
    const drafts = validateExperienceCandidates([createCandidatePayload()], "agent")

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      experienceType: "agent",
      responsibility: "对节点任务的正确性负责",
      taskType: "软件开发",
      decisionDomain: "任务分解",
      exclusions: ["前置条件已稳定时不适用"],
      evidence: ["一次并行执行返工"],
    })
  })

  it("test_accepts_wrapper_对象形态同样被接受", () => {
    const drafts = validateExperienceCandidates({ experiences: [createCandidatePayload()] }, "agent")

    expect(drafts).toHaveLength(1)
  })

  it("test_载荷既非数组也非对象_WF_EXPERIENCE_BAD_ARGS", async () => {
    const error = await errorOf(() => validateExperienceCandidates("不是载荷", "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes("experiences")).toBe(true)
  })

  it("test_wrapper_对象缺少 experiences 数组_WF_EXPERIENCE_BAD_ARGS", async () => {
    const error = await errorOf(() => validateExperienceCandidates({ candidates: [] }, "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_wrapper_存在未知顶层字段_WF_EXPERIENCE_VALIDATION", async () => {
    const error = await errorOf(() => validateExperienceCandidates({ experiences: [], type: "agent" }, "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("type")).toBe(true)
  })

  it("test_空候选数组_WF_EXPERIENCE_BAD_ARGS_并要求改用初始化调用", async () => {
    const error = await errorOf(() => validateExperienceCandidates([], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes("wf_experience_learn")).toBe(true)
  })

  it("test_候选数超过上限_WF_EXPERIENCE_VALIDATION", async () => {
    const payload = Array.from({ length: MAX_CANDIDATES_PER_CALL + 1 }, (_value, index) =>
      createCandidatePayload({ responsibility: `责任-${index}` }))

    const error = await errorOf(() => validateExperienceCandidates(payload, "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes(String(MAX_CANDIDATES_PER_CALL))).toBe(true)
  })
})

describe("validateExperienceCandidates 字段协议", () => {
  it("test_未知候选字段_拒绝且回报字段名", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ insight: "旧协议字段" })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("insight")).toBe(true)
  })

  it("test_合法字段与未知字段混合_整体拒绝而非静默丢弃未知字段", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload(),
      createCandidatePayload({ review_feedback: "旧协议字段" }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("review_feedback")).toBe(true)
  })

  it("test_必填字段缺失_拒绝并指名缺失字段", async () => {
    const payload = createCandidatePayload()
    delete payload.responsibility

    const error = await errorOf(() => validateExperienceCandidates([payload], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("responsibility")).toBe(true)
  })

  it("test_必填字段为空白_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ principle: "   " })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("principle")).toBe(true)
  })

  it("test_必填字段类型不符_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ situation: 42 })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("situation")).toBe(true)
  })

  it("test_数组字段类型不符_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ exclusions: "条件甲" })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("exclusions")).toBe(true)
  })

  it("test_模型侧 snake_case_被接受并归一为域内 camelCase", () => {
    const drafts = validateExperienceCandidates([{
      responsibility: "对协作交付负责",
      task_type: "软件开发",
      decision_domain: "任务分解",
      situation: "情境",
      trigger: "信号",
      principle: "规律",
      recommended_action: "行动",
      exclusions: [],
      evidence: [],
    }], "team")

    expect(drafts[0]).toMatchObject({ taskType: "软件开发", decisionDomain: "任务分解", recommendedAction: "行动", experienceType: "team" })
  })

  it("test_同一字段两种写法同时出现_判歧义拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload({ task_type: "另一份写法" }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("task_type")).toBe(true)
  })

  it("test_候选内 experience_type 与本次类型不一致_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload({ experience_type: "team" }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("experience_type")).toBe(true)
  })

  it("test_空白归一化_写入草稿的值已被折叠", () => {
    const drafts = validateExperienceCandidates([
      createCandidatePayload({ responsibility: "  对  节点任务负责  ", exclusions: ["  条件甲  ", "条件\t乙"] }),
    ], "agent")

    expect(drafts[0].responsibility).toBe("对 节点任务负责")
    expect(drafts[0].exclusions).toEqual(["条件甲", "条件 乙"])
  })
})

describe("validateExperienceCandidates 运行时护栏", () => {
  it("test_responsibility 长度达上限_通过", () => {
    const drafts = validateExperienceCandidates([createCandidatePayload({ responsibility: "甲".repeat(255) })], "agent")

    expect(drafts[0].responsibility.length).toBe(255)
  })

  it("test_responsibility 超长一个字符_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ responsibility: "甲".repeat(256) })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("255")).toBe(true)
  })

  it("test_task_type 超长_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ taskType: "甲".repeat(129) })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("128")).toBe(true)
  })

  it("test_situation 超长_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({ situation: "甲".repeat(2001) })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("2000")).toBe(true)
  })

  it("test_数组元素数超限_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload({ exclusions: Array.from({ length: 9 }, (_value, index) => `条件${index}`) }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("exclusions")).toBe(true)
  })

  it("test_数组元素超长_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload({ evidence: ["甲".repeat(501)] }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("evidence")).toBe(true)
  })

  it("test_数组存在空白元素_拒绝而非静默丢弃", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload({ exclusions: ["条件甲", "   "] }),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("exclusions")).toBe(true)
  })

  it("test_单条文本总长达 8000_通过", () => {
    const drafts = validateExperienceCandidates([createCandidatePayload({
      responsibility: "甲".repeat(100),
      taskType: "乙".repeat(100),
      decisionDomain: "丙".repeat(100),
      situation: "丁".repeat(1900),
      trigger: "戊".repeat(1900),
      principle: "己".repeat(1900),
      recommendedAction: "庚".repeat(2000),
      exclusions: [],
      evidence: [],
    })], "agent")

    expect(drafts).toHaveLength(1)
  })

  it("test_单条文本总长超过 8000_拒绝", async () => {
    const error = await errorOf(() => validateExperienceCandidates([createCandidatePayload({
      responsibility: "甲".repeat(101),
      taskType: "乙".repeat(100),
      decisionDomain: "丙".repeat(100),
      situation: "丁".repeat(1900),
      trigger: "戊".repeat(1900),
      principle: "己".repeat(1900),
      recommendedAction: "庚".repeat(2000),
      exclusions: [],
      evidence: [],
    })], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("8000")).toBe(true)
  })

  it("test_批内语义核心完全相同_拒绝并指向重复序号", async () => {
    const error = await errorOf(() => validateExperienceCandidates([
      createCandidatePayload(),
      createCandidatePayload(),
    ], "agent"))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("第 2 条")).toBe(true)
    expect(error.message.includes("第 1 条")).toBe(true)
  })

  it("test_批内仅证据不同_视为不同候选通过", () => {
    const drafts = validateExperienceCandidates([
      createCandidatePayload({ evidence: ["证据甲"] }),
      createCandidatePayload({ evidence: ["证据乙"] }),
    ], "agent")

    expect(drafts).toHaveLength(2)
  })
})

describe("validateExperiencePatch", () => {
  it("test_补丁只改一个字段_其余字段沿用现值", () => {
    const current = createEntry({ principle: "旧原则" })

    const validated = validateExperiencePatch(current, { principle: "  新原则  " })

    expect(validated.patch).toEqual({ principle: "新原则" })
    expect(validated.fields.principle).toBe("新原则")
    expect(validated.fields.responsibility).toBe(current.responsibility)
  })

  it("test_数组字段传 null_清空为空数组", () => {
    const validated = validateExperiencePatch(createEntry(), { exclusions: null })

    expect(validated.patch).toEqual({ exclusions: null })
    expect(validated.fields.exclusions).toEqual([])
  })

  it("test_字段缺省_视为本次不改", () => {
    const validated = validateExperiencePatch(createEntry(), {})

    expect(validated.patch).toEqual({})
    expect(validated.fields.evidence).toEqual(["一次并行执行返工"])
  })

  it("test_必填字段被清空_拒绝且说明无从回滚", async () => {
    const error = await errorOf(() => validateExperiencePatch(createEntry(), { responsibility: "  " }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("responsibility")).toBe(true)
  })

  it("test_补丁含未知字段_拒绝", async () => {
    const error = await errorOf(() => validateExperiencePatch(createEntry(), { insight: "旧协议字段" }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("insight")).toBe(true)
  })

  it("test_补丁非对象_返回 WF_EXPERIENCE_BAD_ARGS", async () => {
    const error = await errorOf(() => validateExperiencePatch(createEntry(), "不是补丁"))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_合并后单条总长超限_拒绝", async () => {
    const error = await errorOf(() => validateExperiencePatch(createEntry(), {
      principle: "己".repeat(2000),
      situation: "丁".repeat(2000),
      trigger: "戊".repeat(2000),
      recommendedAction: "庚".repeat(2000),
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("8000")).toBe(true)
  })

  it("test_补丁值类型不符_拒绝", async () => {
    const error = await errorOf(() => validateExperiencePatch(createEntry(), { exclusions: "条件甲" }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("exclusions")).toBe(true)
  })
})

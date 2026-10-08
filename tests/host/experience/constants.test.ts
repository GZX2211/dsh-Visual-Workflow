// tests/host/experience/constants.test.ts
//
// Experience 域上限与归一化规则的取值门。
//
// 为什么单测这些常量：上限是协议的一部分（模型按 Prompt 产出的候选要能被稳定接受），
// 取值漂移会让「Prompt 允许的长度」与「入库校验允许的长度」不一致；空白归一化是所有字段
// 校验与检索投影的共同前置，必须由纯函数锁定。

import { describe, expect, it } from "vitest"
import type { ExperienceType } from "../../../src/host/shared/asset-types.js"
import {
  DEFAULT_RECALL_TOP_K,
  DUPLICATE_SIMILARITY_THRESHOLD,
  EXPERIENCE_TYPES,
  FIELD_LIMITS,
  MAX_CANDIDATES_PER_CALL,
  MAX_INITIALIZED_SESSIONS,
  MAX_RECALL_TOP_K,
  normalizeWhitespace,
} from "../../../src/host/experience/constants.js"

/** 编译期穷尽守卫：联合类型取值必须全在运行期清单内（缺一个即编译失败）。 */
const TYPE_COVERAGE: Record<ExperienceType, true> = { agent: true, team: true, orchestrator: true }

describe("normalizeWhitespace", () => {
  it("test_归一化_首尾空白与连续空白_折叠为单空格", () => {
    const normalized = normalizeWhitespace("  两个节点\t并行\n\n启动  ")

    expect(normalized).toBe("两个节点 并行 启动")
  })

  it("test_归一化_全角空格_同样折叠", () => {
    const normalized = normalizeWhitespace("甲\u3000\u3000乙")

    expect(normalized).toBe("甲 乙")
  })

  it("test_归一化_纯空白_得到空串", () => {
    expect(normalizeWhitespace(" \t\n ")).toBe("")
  })

  it("test_归一化_同一输入两次调用_结果字节相同", () => {
    const input = "  保持  稳定 "

    expect(normalizeWhitespace(input)).toBe(normalizeWhitespace(input))
  })
})

describe("experience 常量", () => {
  it("test_候选与召回上限_取裁决值", () => {
    expect(MAX_CANDIDATES_PER_CALL).toBe(8)
    expect(DEFAULT_RECALL_TOP_K).toBe(10)
    expect(MAX_RECALL_TOP_K).toBe(50)
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBe(0.8)
  })

  it("test_字段上限表_取数据库列宽与运行时护栏", () => {
    expect(FIELD_LIMITS.responsibility).toBe(255)
    expect(FIELD_LIMITS.decisionDomain).toBe(255)
    expect(FIELD_LIMITS.taskType).toBe(128)
    expect(FIELD_LIMITS.situation).toBe(2000)
    expect(FIELD_LIMITS.trigger).toBe(2000)
    expect(FIELD_LIMITS.principle).toBe(2000)
    expect(FIELD_LIMITS.recommendedAction).toBe(2000)
    expect(FIELD_LIMITS.arrayElement).toBe(500)
    expect(FIELD_LIMITS.arrayLength).toBe(8)
    expect(FIELD_LIMITS.total).toBe(8000)
  })

  it("test_经验类型本体_与共享联合类型双向穷尽", () => {
    expect([...EXPERIENCE_TYPES].sort()).toEqual(Object.keys(TYPE_COVERAGE).sort())
  })

  it("test_初始化状态上界_为正整数上界声明", () => {
    expect(MAX_INITIALIZED_SESSIONS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_INITIALIZED_SESSIONS)).toBe(true)
  })
})

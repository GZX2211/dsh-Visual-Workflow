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
  CANDIDATE_POOL_SIZE,
  CAUSAL_WEIGHT_FLOOR,
  CAUSAL_WEIGHT_SPAN,
  DECISION_EFFECT_ANCHORS,
  DEFAULT_RECALL_TOP_K,
  DUPLICATE_SIMILARITY_THRESHOLD,
  EVIDENCE_STRENGTH_SCALE,
  EVALUATION_EVIDENCE_LIMIT,
  EXPERIENCE_TYPES,
  FIELD_BUDGETS,
  FIELD_LIMITS,
  MAX_CANDIDATES_PER_CALL,
  MAX_EVALUATIONS_PER_CALL,
  MAX_INITIALIZED_SESSIONS,
  MAX_RECALL_TOP_K,
  MMR_DIVERSITY_WEIGHT,
  MMR_RELEVANCE_WEIGHT,
  NEUTRAL_STATS,
  PRIOR_STRENGTH,
  SCORE_ANCHORS,
  SEMANTIC_FLOOR,
  TRUST_ADJUSTMENT_BETA,
  TRUST_AMPLITUDE,
  TRUST_CENTER,
  isDecisionEffectAnchor,
  isScoreAnchor,
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
    expect(DEFAULT_RECALL_TOP_K).toBe(15)
    expect(MAX_RECALL_TOP_K).toBe(50)
    expect(CANDIDATE_POOL_SIZE).toBe(30)
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

  it("test_字段预算表_取一句话一条的紧凑引导长度", () => {
    expect(FIELD_BUDGETS.taskType).toBe(10)
    expect(FIELD_BUDGETS.decisionDomain).toBe(20)
    expect(FIELD_BUDGETS.responsibility).toBe(30)
    expect(FIELD_BUDGETS.trigger).toBe(30)
    expect(FIELD_BUDGETS.situation).toBe(30)
    expect(FIELD_BUDGETS.recommendedAction).toBe(60)
    expect(FIELD_BUDGETS.principle).toBe(60)
    expect(FIELD_BUDGETS.arrayElement).toBe(15)
    expect(FIELD_BUDGETS.arrayLength).toBe(4)
    expect(FIELD_BUDGETS.total).toBe(400)
  })

  it("test_字段预算_逐项不超过对应硬上限", () => {
    // 预算是引导值，硬上限才是拒绝边界：任一预算被改到超过上限，就会让「按 Prompt 生成也可能被拒」
    // 重新变成事实，且模型无从从描述里看出矛盾。
    const overCap = (Object.keys(FIELD_LIMITS) as Array<keyof typeof FIELD_BUDGETS>)
      .filter((key) => FIELD_BUDGETS[key] > FIELD_LIMITS[key])

    expect(overCap).toEqual([])
  })

  it("test_字段预算_逐字段之和不超过总预算", () => {
    // 总预算必须容得下「每个字段都写满自己预算」的候选，否则两条引导会互相矛盾
    // （数组各按预算条数计：8 条元素）。
    const scalarTotal = FIELD_BUDGETS.responsibility + FIELD_BUDGETS.taskType + FIELD_BUDGETS.decisionDomain
      + FIELD_BUDGETS.situation + FIELD_BUDGETS.trigger + FIELD_BUDGETS.principle + FIELD_BUDGETS.recommendedAction
    const arrayTotal = 2 * FIELD_BUDGETS.arrayLength * FIELD_BUDGETS.arrayElement

    expect(scalarTotal + arrayTotal).toBeLessThanOrEqual(FIELD_BUDGETS.total)
  })

  it("test_初始化状态上界_为正整数上界声明", () => {
    expect(MAX_INITIALIZED_SESSIONS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_INITIALIZED_SESSIONS)).toBe(true)
  })

  it("test_评分锚点_五级且决策效果跨零", () => {
    expect(SCORE_ANCHORS).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(DECISION_EFFECT_ANCHORS).toEqual([-1, -0.5, 0, 0.5, 1])
    expect(isScoreAnchor(0.73)).toBe(false)
    expect(isDecisionEffectAnchor(-0.5)).toBe(true)
    expect(isDecisionEffectAnchor(0.25)).toBe(false)
    expect(MAX_EVALUATIONS_PER_CALL).toBe(8)
    expect(EVALUATION_EVIDENCE_LIMIT).toBe(2000)
  })

  it("test_评价闭环公式参数_取裁决值", () => {
    expect(PRIOR_STRENGTH).toBe(3)
    expect(EVIDENCE_STRENGTH_SCALE).toBe(8)
    expect(CAUSAL_WEIGHT_FLOOR).toBe(0.25)
    expect(CAUSAL_WEIGHT_SPAN).toBe(0.75)
    expect(TRUST_CENTER).toBe(0.5)
    expect(TRUST_AMPLITUDE).toBe(0.45)
    expect(TRUST_ADJUSTMENT_BETA).toBe(0.2)
    expect(MMR_RELEVANCE_WEIGHT).toBe(0.4)
    expect(MMR_DIVERSITY_WEIGHT).toBe(0.6)
    expect(SEMANTIC_FLOOR).toBeNull()
  })

  it("test_中性统计投影_表达证据不足而非伪造价值", () => {
    expect(NEUTRAL_STATS).toEqual({
      effectiveSampleCount: 0,
      usedCount: 0,
      fitMean: 0,
      empiricalValue: 0,
      variance: 0,
      stability: 1,
      evidenceStrength: 0,
      harmCount: 0,
      harmRate: 0,
      harmSeverity: 0,
      qualitySignal: 0,
      trust: 0.5,
    })
  })
})

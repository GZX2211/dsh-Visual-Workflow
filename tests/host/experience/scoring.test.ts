// tests/host/experience/scoring.test.ts
//
// 评分锚点与单次评价权重门（§6 / §9）。
//
// 为什么把「锚点校验」与「权重公式」放在同一个门里：两者共同定义「一次评价被接受后如何
// 折算成统计事实」。若校验放宽（接受 0.73）而权重公式不变，统计会看起来正常但语义已失真；
// 因此非法值必须被确定性拒绝，合法值必须逐值命中公式。

import { describe, expect, it } from "vitest"
import type { ExperienceEvaluationScores } from "../../../src/host/shared/asset-types.js"
import {
  calculateEffectiveEffect,
  calculateEvaluationWeight,
  validateEvaluationScores,
} from "../../../src/host/experience/scoring.js"

/** 四维评分工厂（默认全部取最高锚点，用例只覆盖关心的一维）。 */
function scores(overrides: Partial<ExperienceEvaluationScores> = {}): ExperienceEvaluationScores {
  return {
    fitScore: 1,
    decisionEffect: 1,
    informationGain: 1,
    causalConfidence: 1,
    ...overrides,
  }
}

describe("calculateEvaluationWeight（§9.1 evaluation_weight = F × (0.25 + 0.75 × C)）", () => {
  it("test_权重_高适用高归因_取最大值", () => {
    expect(calculateEvaluationWeight(scores({ fitScore: 1, causalConfidence: 1 }))).toBe(1)
  })

  it("test_权重_适用性为 0_本次评价不产生统计力", () => {
    expect(calculateEvaluationWeight(scores({ fitScore: 0, causalConfidence: 1 }))).toBe(0)
  })

  it("test_权重_归因置信度为 0_仍保留 25% 最小权重", () => {
    expect(calculateEvaluationWeight(scores({ fitScore: 1, causalConfidence: 0 }))).toBe(0.25)
  })

  it("test_权重_中间锚点_逐值命中公式", () => {
    expect(calculateEvaluationWeight(scores({ fitScore: 0.75, causalConfidence: 0.75 }))).toBeCloseTo(0.609375, 12)
    expect(calculateEvaluationWeight(scores({ fitScore: 0.5, causalConfidence: 0.25 }))).toBeCloseTo(0.21875, 12)
  })
})

describe("calculateEffectiveEffect（§9.2 负向不削弱）", () => {
  it("test_正向效果_按信息增益衰减", () => {
    expect(calculateEffectiveEffect(scores({ decisionEffect: 1, informationGain: 0 }))).toBe(0.5)
    expect(calculateEffectiveEffect(scores({ decisionEffect: 0.5, informationGain: 0.75 }))).toBeCloseTo(0.4375, 12)
  })

  it("test_负向效果_不因信息增益低而减刑", () => {
    expect(calculateEffectiveEffect(scores({ decisionEffect: -1, informationGain: 1 }))).toBe(-1)
    expect(calculateEffectiveEffect(scores({ decisionEffect: -0.5, informationGain: 0 }))).toBe(-0.5)
  })

  it("test_决策效果为 0_有效效果为 0", () => {
    expect(calculateEffectiveEffect(scores({ decisionEffect: 0, informationGain: 1 }))).toBe(0)
  })
})

describe("validateEvaluationScores 锚点确定性校验（§6.1）", () => {
  it("test_四维合法锚点_收窄为评分对象", () => {
    const result = validateEvaluationScores({
      fitScore: 0.75,
      decisionEffect: -0.5,
      informationGain: 0.25,
      causalConfidence: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scores).toEqual({ fitScore: 0.75, decisionEffect: -0.5, informationGain: 0.25, causalConfidence: 1 })
  })

  it("test_连续小数评分_拒绝并给出字段与合法取值", () => {
    const result = validateEvaluationScores({
      fitScore: 0.73,
      decisionEffect: 0,
      informationGain: 0.5,
      causalConfidence: 1,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe("fitScore")
    expect(result.reason.includes("0.73")).toBe(true)
    expect(result.reason.includes("0.25")).toBe(true)
  })

  it("test_决策效果用了 0～1 锚点_拒绝（跨零维度取值域不同）", () => {
    const result = validateEvaluationScores({
      fitScore: 1,
      decisionEffect: 0.25,
      informationGain: 1,
      causalConfidence: 1,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe("decisionEffect")
    expect(result.reason.includes("-1")).toBe(true)
  })

  it("test_非数值或缺失字段_拒绝", () => {
    expect(validateEvaluationScores({ fitScore: "0.75", decisionEffect: 0, informationGain: 1, causalConfidence: 1 }).ok).toBe(false)
    expect(validateEvaluationScores({ fitScore: Number.NaN, decisionEffect: 0, informationGain: 1, causalConfidence: 1 }).ok).toBe(false)
    expect(validateEvaluationScores({ fitScore: 1, decisionEffect: 0, informationGain: 1 }).ok).toBe(false)
  })

  it("test_序列化往返的浮点误差_仍命中锚点", () => {
    const result = validateEvaluationScores({
      fitScore: 0.75 + 1e-12,
      decisionEffect: 0,
      informationGain: 1 - 1e-12,
      causalConfidence: 0,
    })

    expect(result.ok).toBe(true)
  })
})

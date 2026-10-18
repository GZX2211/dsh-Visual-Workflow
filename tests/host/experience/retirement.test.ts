// tests/host/experience/retirement.test.ts
//
// 退役判定纯函数：有害评价一次即归档、角色经验的跨角色长期无用、编排经验的固定次数长期无用，
// 以及恢复后旧证据豁免、同一 run 去重、空角色/空 run 保守处理。
//
// 为什么这些边界必须在纯函数层锁死：退役是「退出召回面」的状态写入，误判会让仍有价值的经验
// 永久消失；把判定收敛成纯函数后，任何阈值与去重口径都能离线复现，不依赖数据库与时钟。

import { describe, expect, it } from "vitest"
import { decideExperienceRetirement } from "../../../src/host/experience/retirement.js"
import type {
  ExperienceRetirementEvaluationFact,
  ExperienceRetirementFacts,
  ExperienceRetirementUsageFact,
} from "../../../src/host/experience/retirement.js"
import type {
  ExperienceDecisionEffectAnchor,
  ExperienceEvaluationScores,
  ExperienceScoreAnchor,
  ExperienceType,
} from "../../../src/host/shared/asset-types.js"

/** 中性评价：decisionEffect = 0（长期无用判定要求「从未产生有效价值」）。 */
const NEUTRAL_SCORES: ExperienceEvaluationScores = {
  fitScore: 1,
  decisionEffect: 0,
  informationGain: 0.5,
  causalConfidence: 1,
}

/** 正向评价：只要出现过一次就不再是「从未产生有效价值」。 */
const POSITIVE_SCORES: ExperienceEvaluationScores = {
  ...NEUTRAL_SCORES,
  decisionEffect: 0.5,
}

/** 负向评价：一次即有害。 */
const HARMFUL_SCORES: ExperienceEvaluationScores = {
  ...NEUTRAL_SCORES,
  decisionEffect: -1,
}

function scoresOf(
  decisionEffect: ExperienceDecisionEffectAnchor,
  fitScore: ExperienceScoreAnchor = 1,
  causalConfidence: ExperienceScoreAnchor = 1,
): ExperienceEvaluationScores {
  return { fitScore, decisionEffect, informationGain: 0.5, causalConfidence }
}

function usage(runId: string, createdAt = 100): ExperienceRetirementUsageFact {
  return { runId, createdAt }
}

function evaluation(
  runId: string,
  roleKey: string,
  scores: ExperienceEvaluationScores = NEUTRAL_SCORES,
  createdAt = 100,
): ExperienceRetirementEvaluationFact {
  return { runId, roleKey, scores, createdAt }
}

function factsOf(
  overrides: Partial<ExperienceRetirementFacts> & { experienceType?: ExperienceType } = {},
): ExperienceRetirementFacts {
  return {
    experienceId: "ex-1",
    experienceType: "agent",
    reactivatedAt: 0,
    usage: [],
    evaluations: [],
    ...overrides,
  }
}

/** 角色经验满足阈值 C 的基线：10 次使用、5 个使用 run、5 个评价 run、3 个角色、有效样本 1×5。 */
function agentLongUnusedFacts(overrides: Partial<ExperienceRetirementFacts> = {}): ExperienceRetirementFacts {
  return factsOf({
    usage: [
      usage("run-u1"),
      usage("run-u1"),
      usage("run-u2"),
      usage("run-u2"),
      usage("run-u3"),
      usage("run-u3"),
      usage("run-u4"),
      usage("run-u4"),
      usage("run-u5"),
      usage("run-u5"),
    ],
    evaluations: [
      evaluation("run-e1", "role-a"),
      evaluation("run-e2", "role-b"),
      evaluation("run-e3", "role-c"),
      evaluation("run-e4", "role-a"),
      evaluation("run-e5", "role-b"),
    ],
    ...overrides,
  })
}

/** 编排经验满足阈值 C 的基线：10 个使用 run、5 个评价 run、有效样本 5。 */
function orchestratorLongUnusedFacts(overrides: Partial<ExperienceRetirementFacts> = {}): ExperienceRetirementFacts {
  return factsOf({
    experienceType: "orchestrator",
    usage: Array.from({ length: 10 }, (_, index) => usage(`run-u${index + 1}`)),
    evaluations: Array.from({ length: 5 }, (_, index) => evaluation(`run-e${index + 1}`, "role-parent")),
    ...overrides,
  })
}

describe("有害经验：一次负向决策效果即归档", () => {
  it("test_任意一次负向评价_立即判定为有害", () => {
    const facts = factsOf({ evaluations: [evaluation("run-e1", "role-a", HARMFUL_SCORES)] })

    expect(decideExperienceRetirement(facts)).toMatchObject({ retire: true, reason: "harmful" })
  })

  it("test_负向评价即使fit与因果置信度为0_仍判定为有害", () => {
    const facts = factsOf({
      evaluations: [evaluation("run-e1", "role-a", scoresOf(-1, 0, 0))],
    })

    expect(decideExperienceRetirement(facts)).toMatchObject({ retire: true, reason: "harmful" })
  })

  it("test_有害优先于长期无用_负向评价存在时不被无价值判定覆盖", () => {
    const facts = agentLongUnusedFacts({
      evaluations: [...agentLongUnusedFacts().evaluations, evaluation("run-e6", "role-d", HARMFUL_SCORES)],
    })

    expect(decideExperienceRetirement(facts)).toMatchObject({ retire: true, reason: "harmful" })
  })

  it("test_恢复前的负向评价不触发有害_恢复后的新负向评价触发有害", () => {
    const facts = factsOf({
      reactivatedAt: 500,
      evaluations: [
        evaluation("run-old", "role-a", HARMFUL_SCORES, 100),
        evaluation("run-new", "role-b", NEUTRAL_SCORES, 900),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })

    const withNewHarm = factsOf({
      reactivatedAt: 500,
      evaluations: [
        evaluation("run-old", "role-a", HARMFUL_SCORES, 100),
        evaluation("run-new", "role-b", HARMFUL_SCORES, 900),
      ],
    })
    expect(decideExperienceRetirement(withNewHarm)).toMatchObject({ retire: true, reason: "harmful" })
  })
})

describe("角色经验：跨角色使用且从未产生价值的长期无用", () => {
  it("test_达到阈值C且覆盖三个角色_归档为长期无用", () => {
    expect(decideExperienceRetirement(agentLongUnusedFacts())).toMatchObject({
      retire: true,
      reason: "long_unused",
    })
  })

  it("test_只覆盖两个角色_不归档", () => {
    const facts = agentLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-a"),
        evaluation("run-e2", "role-b"),
        evaluation("run-e3", "role-a"),
        evaluation("run-e4", "role-b"),
        evaluation("run-e5", "role-a"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_角色身份为空的评价不参与多样性_角色数不足不归档", () => {
    const facts = agentLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-a"),
        evaluation("run-e2", "role-b"),
        evaluation("run-e3", ""),
        evaluation("run-e4", ""),
        evaluation("run-e5", ""),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_出现过一次正向评价_不归档（即使同一run后续评价为零）", () => {
    const facts = agentLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-a", NEUTRAL_SCORES, 100),
        evaluation("run-e1", "role-a", POSITIVE_SCORES, 200),
        evaluation("run-e2", "role-b"),
        evaluation("run-e3", "role-c"),
        evaluation("run-e4", "role-a"),
        evaluation("run-e5", "role-b"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_同一run重复评价只算一次_评价run数不足不归档", () => {
    const facts = agentLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-a"),
        evaluation("run-e1", "role-a"),
        evaluation("run-e2", "role-b"),
        evaluation("run-e3", "role-c"),
        evaluation("run-e4", "role-a"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_评价run去重后有效样本量不足_不归档", () => {
    const lowWeight = scoresOf(0, 0.25, 0)
    const facts = agentLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-a", lowWeight),
        evaluation("run-e2", "role-b", lowWeight),
        evaluation("run-e3", "role-c", lowWeight),
        evaluation("run-e4", "role-a", lowWeight),
        evaluation("run-e5", "role-b", lowWeight),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_使用run不足五个_不归档（即使总召回达到十次）", () => {
    const facts = agentLongUnusedFacts({
      usage: [
        usage("run-u1"),
        usage("run-u1"),
        usage("run-u1"),
        usage("run-u2"),
        usage("run-u2"),
        usage("run-u2"),
        usage("run-u3"),
        usage("run-u3"),
        usage("run-u4"),
        usage("run-u4"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_总召回不足十次_不归档", () => {
    const facts = agentLongUnusedFacts({
      usage: [
        usage("run-u1"),
        usage("run-u2"),
        usage("run-u3"),
        usage("run-u4"),
        usage("run-u5"),
        usage("run-u6"),
        usage("run-u7"),
        usage("run-u8"),
        usage("run-u9"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_恢复前的使用与评价不计入阈值_恢复后证据不足不归档", () => {
    const facts = agentLongUnusedFacts({
      reactivatedAt: 500,
      usage: [
        ...agentLongUnusedFacts().usage.map((item) => ({ ...item, createdAt: 100 })),
        usage("run-new", 900),
      ],
      evaluations: [
        ...agentLongUnusedFacts().evaluations.map((item) => ({ ...item, createdAt: 100 })),
        evaluation("run-new", "role-a", NEUTRAL_SCORES, 900),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })
})

describe("编排经验：不走角色多样性，固定次数长期无用", () => {
  it("test_十个不同编排run且评价充分_归档为长期无用", () => {
    expect(decideExperienceRetirement(orchestratorLongUnusedFacts())).toMatchObject({
      retire: true,
      reason: "long_unused",
    })
  })

  it("test_编排经验不要求角色多样性_单一角色仍可归档", () => {
    const facts = orchestratorLongUnusedFacts()
    expect(new Set(facts.evaluations.map((item) => item.roleKey)).size).toBe(1)
    expect(decideExperienceRetirement(facts)).toMatchObject({ retire: true, reason: "long_unused" })
  })

  it("test_编排run不足十个_不归档", () => {
    const facts = orchestratorLongUnusedFacts({
      usage: Array.from({ length: 9 }, (_, index) => usage(`run-u${index + 1}`)),
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_编排评价run不足五个_不归档", () => {
    const facts = orchestratorLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-parent"),
        evaluation("run-e2", "role-parent"),
        evaluation("run-e3", "role-parent"),
        evaluation("run-e4", "role-parent"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_编排经验出现过正向评价_不归档", () => {
    const facts = orchestratorLongUnusedFacts({
      evaluations: [
        evaluation("run-e1", "role-parent", POSITIVE_SCORES),
        evaluation("run-e2", "role-parent"),
        evaluation("run-e3", "role-parent"),
        evaluation("run-e4", "role-parent"),
        evaluation("run-e5", "role-parent"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })

  it("test_编排经验恢复后旧证据不计入阈值", () => {
    const facts = orchestratorLongUnusedFacts({
      reactivatedAt: 500,
      usage: orchestratorLongUnusedFacts().usage.map((item) => ({ ...item, createdAt: 100 })),
      evaluations: orchestratorLongUnusedFacts().evaluations.map((item) => ({ ...item, createdAt: 100 })),
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })
})

describe("证据不足与边界", () => {
  it("test_没有评价_不归档", () => {
    expect(decideExperienceRetirement(agentLongUnusedFacts({ evaluations: [] }))).toEqual({ retire: false })
  })

  it("test_没有使用_不归档", () => {
    expect(decideExperienceRetirement(agentLongUnusedFacts({ usage: [] }))).toEqual({ retire: false })
  })

  it("test_空run与空角色身份不被当成有效多样性", () => {
    const facts = factsOf({
      usage: Array.from({ length: 10 }, (_, index) => usage(index % 2 === 0 ? "" : `run-u${index}`)),
      evaluations: [
        evaluation("", "role-a"),
        evaluation("", "role-b"),
        evaluation("", "role-c"),
      ],
    })

    expect(decideExperienceRetirement(facts)).toEqual({ retire: false })
  })
})

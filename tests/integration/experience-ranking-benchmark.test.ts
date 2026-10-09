// tests/integration/experience-ranking-benchmark.test.ts
//
// 离线召回算法对比 benchmark（开发方案 §31 / §32）。
//
// 为什么必须有这一层：方案「相似度 × 有界信任修正 + MMR」是**被主张**的结论，不是自明的结论。
// 本文件用固定数据集把五个方案放在同一批场景上跑，并对每个场景写下可判定的语义约束，
// 然后要求：每个 baseline 至少在一个场景上违反约束（否则它与候选方案无从区分，比较就没有信息量），
// 候选 D 只在「高重复度」场景违反，候选 E 全部通过且在重复度场景严格优于 D。
//
// 全部输入写死在文件里：不读时钟、不用随机数、不依赖真实嵌入模型，因此任何一次运行结果都相同。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from "vitest"
import {
  aggregateExperienceStats,
  calculateRecallAdjustment,
  normalizeSimilarity,
  rankRecallCandidates,
  type RecallRankingCandidate,
} from "../../src/host/experience/index.js"
import type { ExperienceEvaluationScores } from "../../src/host/shared/asset-types.js"

/** 两条正交轴向量（同一轴内相似度为 1，跨轴为 0）。 */
const AXIS_A = new Float64Array([1, 0])
const AXIS_B = new Float64Array([0, 1])

/** benchmark 候选：cosine 是 Stage 1 得到的语义相似度，qualitySignal 是统计投影的中性质量信号。 */
interface BenchCandidate extends RecallRankingCandidate {
  id: string
}

/** 构造候选（默认都落在同一轴上，即互相完全重复）。 */
function candidate(
  id: string,
  cosine: number,
  qualitySignal: number,
  axis: Float64Array = AXIS_A,
): BenchCandidate {
  return {
    id,
    cosine,
    qualitySignal,
    taskVector: axis,
    decisionVector: axis,
  }
}

/** 由真实统计聚合器算出的质量信号（case 5 / case 7 用它避免手写近似值）。 */
function qualitySignalOf(evaluations: readonly ExperienceEvaluationScores[]): number {
  return aggregateExperienceStats({ evaluations, recalledCount: evaluations.length }).qualitySignal
}

/** 满分正向评价（w = 1、v = 1）。 */
const PERFECT: ExperienceEvaluationScores = {
  fitScore: 1,
  decisionEffect: 1,
  informationGain: 1,
  causalConfidence: 1,
}

/** 泛化经验：每次都适用、效果中等，但几乎不提供新增决策信息（§5.3 要抑制的形态）。 */
const GENERIC: ExperienceEvaluationScores = {
  fitScore: 1,
  decisionEffect: 0.5,
  informationGain: 0,
  causalConfidence: 1,
}

/** 重复 n 次（同一评分重复出现，用于构造不同有效样本量）。 */
function repeat(scores: ExperienceEvaluationScores, times: number): ExperienceEvaluationScores[] {
  return Array.from({ length: times }, () => scores)
}

/** 单次满分评价后的质量信号（「第一次偶然高分」场景）。 */
const QUALITY_ONCE = qualitySignalOf([PERFECT])
/** 五次满分评价后的质量信号（「已被反复验证」场景）。 */
const QUALITY_SEASONED = qualitySignalOf(repeat(PERFECT, 5))
/** 五次泛化评价后的质量信号。 */
const QUALITY_GENERIC = qualitySignalOf(repeat(GENERIC, 5))

/** 一个固定场景：候选集、返回条数上限，以及「排序结果是否满足该场景语义」的判据。 */
interface BenchCase {
  name: string
  candidates: BenchCandidate[]
  limit: number
  satisfied: (order: readonly string[]) => boolean
}

const CASES: readonly BenchCase[] = [
  {
    name: "Case 1 高相关/新经验：能被发现",
    candidates: [candidate("c1", 0.9, 0), candidate("c2", 0.3, 0)],
    limit: 2,
    satisfied: (order) => order[0] === "c1",
  },
  {
    name: "Case 2 低相关/超高信任：不能击败明显更相关的经验",
    candidates: [candidate("high", 0.95, 0), candidate("lowTrust", 0.2, 0.9)],
    limit: 2,
    satisfied: (order) => order[0] === "high",
  },
  {
    name: "Case 3 高相关/高信任：明显进入前列",
    candidates: [candidate("highTrust", 0.9, 0.6), candidate("mid", 0.6, 0)],
    limit: 2,
    satisfied: (order) => order[0] === "highTrust",
  },
  {
    name: "Case 4 高相关/高信任/高重复度：MMR 抑制重复、保留不同族经验",
    candidates: [
      candidate("dupA", 0.95, 0.5, AXIS_A),
      candidate("dupB", 0.95, 0.5, AXIS_A),
      candidate("other", 0.78, 0, AXIS_B),
    ],
    limit: 2,
    satisfied: (order) => order.includes("other"),
  },
  {
    name: "Case 5 泛化正确但信息增益低：不长期霸榜",
    candidates: [candidate("generic", 0.85, QUALITY_GENERIC), candidate("sharp", 0.8, QUALITY_SEASONED)],
    limit: 2,
    satisfied: (order) => order[0] === "sharp",
  },
  {
    name: "Case 6 有害经验（证据强）：明显降权",
    candidates: [candidate("harm", 0.9, -0.8), candidate("neutral", 0.7, 0)],
    limit: 2,
    satisfied: (order) => order[0] === "neutral",
  },
  {
    name: "Case 7 第一次偶然高分：不得瞬间获得巨大排名优势",
    candidates: [candidate("fresh", 0.8, QUALITY_ONCE), candidate("seasoned", 0.75, QUALITY_SEASONED)],
    limit: 2,
    satisfied: (order) => order[0] === "seasoned",
  },
]

/** 排序方案（输入候选集与条数上限，输出 id 顺序）。 */
type RankPolicy = (candidates: readonly BenchCandidate[], limit: number) => string[]

/** 按给定分数稳定降序排序（同分按 id 升序，使结果可复现）。 */
function rankByScore(candidates: readonly BenchCandidate[], limit: number, scoreOf: (c: BenchCandidate) => number): string[] {
  return [...candidates]
    .sort((left, right) => {
      const delta = scoreOf(right) - scoreOf(left)
      if (delta !== 0) return delta
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    })
    .slice(0, limit)
    .map((item) => item.id)
}

/** Baseline A：只用语义相似度。 */
const policySimilarityOnly: RankPolicy = (candidates, limit) =>
  rankByScore(candidates, limit, (item) => item.cosine)

/** Baseline B：相似度 + **无上限**权重修正（信任可以无限放大相关性）。 */
const policyUnboundedWeight: RankPolicy = (candidates, limit) =>
  rankByScore(candidates, limit, (item) => normalizeSimilarity(item.cosine) * (1 + item.qualitySignal))

/** Baseline C：相似度 + **加法**信任（信任成为第二个召回轴，§15 明确禁止）。 */
const policyAdditiveTrust: RankPolicy = (candidates, limit) =>
  rankByScore(candidates, limit, (item) => normalizeSimilarity(item.cosine) + item.qualitySignal)

/** Candidate D：相似度 × **有界**信任修正（β = 0.20）。 */
const policyBoundedTrust: RankPolicy = (candidates, limit) =>
  rankByScore(candidates, limit, (item) => calculateRecallAdjustment({ cosine: item.cosine, qualitySignal: item.qualitySignal }))

/** Candidate E：候选 D + MMR（多样性项只吃几何相似度，完全不吃信任）。 */
const policyBoundedTrustWithMmr: RankPolicy = (candidates, limit) =>
  rankRecallCandidates({ candidates: [...candidates], topK: limit }).map((hit) => hit.id)

/** 被比较的五个方案（顺序即报告顺序）。 */
const POLICIES: ReadonlyArray<{ key: string; label: string; rank: RankPolicy }> = [
  { key: "A", label: "Baseline A 仅相似度", rank: policySimilarityOnly },
  { key: "B", label: "Baseline B 相似度 + 无上限权重", rank: policyUnboundedWeight },
  { key: "C", label: "Baseline C 相似度 + 加法信任", rank: policyAdditiveTrust },
  { key: "D", label: "Candidate D 相似度 × 有界信任", rank: policyBoundedTrust },
  { key: "E", label: "Candidate E 候选 D + MMR", rank: policyBoundedTrustWithMmr },
]

/** 在某方案下不满足语义约束的场景名（空数组 = 该方案全部通过）。 */
function violatingCasesOf(rank: RankPolicy): string[] {
  return CASES.filter((benchCase) => !benchCase.satisfied(rank(benchCase.candidates, benchCase.limit)))
    .map((benchCase) => benchCase.name)
}

/** 五方案的违规场景表（每次调用都重算，避免用例间共享可变状态）。 */
function violationTable(): Record<string, string[]> {
  return Object.fromEntries(POLICIES.map((policy) => [policy.key, violatingCasesOf(policy.rank)]))
}

describe("召回算法离线对比 benchmark（§31 / §32）", () => {
  it("test_五方案对比_三个baseline各自至少违反一个场景约束_候选D仅在重复度场景违反_候选E全部通过", () => {
    const violations = violationTable()

    // 候选 E（本阶段推荐方案）：全部固定场景通过
    expect(violations.E).toEqual([])
    // 候选 D：只在「高重复度」场景违反——它没有多样性机制
    expect(violations.D).toEqual(["Case 4 高相关/高信任/高重复度：MMR 抑制重复、保留不同族经验"])

    // 三个 baseline 至少各违反一个场景，否则本次比较没有区分力
    expect(violations.A.length).toBeGreaterThan(0)
    expect(violations.B.length).toBeGreaterThan(0)
    expect(violations.C.length).toBeGreaterThan(0)

    // 具体违反点（写死以便回归时能立刻定位是哪个语义被破坏）
    expect(violations.A).toContain("Case 4 高相关/高信任/高重复度：MMR 抑制重复、保留不同族经验")
    expect(violations.A).toContain("Case 5 泛化正确但信息增益低：不长期霸榜")
    expect(violations.A).toContain("Case 6 有害经验（证据强）：明显降权")
    expect(violations.A).toContain("Case 7 第一次偶然高分：不得瞬间获得巨大排名优势")
    // B/C 把信任当成可以碾压相关性的信号：低相关高信任会顶掉明显更相关的经验
    expect(violations.B).toContain("Case 2 低相关/超高信任：不能击败明显更相关的经验")
    expect(violations.C).toContain("Case 2 低相关/超高信任：不能击败明显更相关的经验")
    expect(violations.B).toContain("Case 4 高相关/高信任/高重复度：MMR 抑制重复、保留不同族经验")
    expect(violations.C).toContain("Case 4 高相关/高信任/高重复度：MMR 抑制重复、保留不同族经验")

    // 推荐结论的量化依据：违规数严格递减 A > C = B > D > E
    expect(violations.A.length).toBeGreaterThan(violations.C.length)
    expect(violations.C.length).toBeGreaterThan(violations.D.length)
    expect(violations.E.length).toBeLessThan(violations.D.length)
  })

  it("test_高重复度场景_候选E严格优于候选D（保留不同族经验）", () => {
    const benchCase = CASES[3]
    const withMmr = policyBoundedTrustWithMmr(benchCase.candidates, benchCase.limit)
    const withoutMmr = policyBoundedTrust(benchCase.candidates, benchCase.limit)

    // D 把两个近重复候选全部排在前面，E 用相同相关性但把重复项压下去
    expect(withoutMmr).toEqual(["dupA", "dupB"])
    expect(withMmr).toContain("other")
    expect(withMmr).not.toEqual(withoutMmr)
    // MMR 只改顺序不改「谁更相关」的事实：重复项的相关性修正值仍然最高
    expect(withMmr[0]).toBe("dupA")
  })

  it("test_召回得分语义_score等于有界信任修正后的相关性_MMR不改变得分", () => {
    const benchCase = CASES[3]
    const hits = rankRecallCandidates({ candidates: [...benchCase.candidates], topK: 3 })
    const byId = new Map(hits.map((hit) => [hit.id, hit.score]))

    expect(byId.get("dupA")).toBeCloseTo(calculateRecallAdjustment({ cosine: 0.95, qualitySignal: 0.5 }), 12)
    expect(byId.get("dupB")).toBeCloseTo(calculateRecallAdjustment({ cosine: 0.95, qualitySignal: 0.5 }), 12)
    expect(byId.get("other")).toBeCloseTo(calculateRecallAdjustment({ cosine: 0.78, qualitySignal: 0 }), 12)
    // 信任修正幅度被 β 夹住：任一命中都落在 [sim01, sim01 × 1.2] 区间内
    for (const candidate of benchCase.candidates) {
      const base = normalizeSimilarity(candidate.cosine)
      const score = byId.get(candidate.id) ?? Number.NaN
      expect(score).toBeGreaterThanOrEqual(base - 1e-12)
      expect(score).toBeLessThanOrEqual(base * 1.2 + 1e-12)
    }
  })

  it("test_正负交错评价_稳定性降到最低且信任不高于中性（Case 8）", () => {
    // +1 / -1 交替：价值均值接近 0，但真正的信号是「这条经验的适用行为高度不稳定」
    const alternating: ExperienceEvaluationScores[] = [
      { fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 },
      { fitScore: 1, decisionEffect: -1, informationGain: 1, causalConfidence: 1 },
      { fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 },
      { fitScore: 1, decisionEffect: -1, informationGain: 1, causalConfidence: 1 },
    ]
    const conflicted = aggregateExperienceStats({ evaluations: alternating, recalledCount: 4 })
    const consistent = aggregateExperienceStats({ evaluations: repeat(PERFECT, 4), recalledCount: 4 })

    // 冲突评价把稳定性压到最低，而一致评价保持满稳定性
    expect(conflicted.stability).toBe(0)
    expect(consistent.stability).toBe(1)
    // 信任不得高于中性 0.5：正负相抵时不能表现出「值得信任」
    expect(conflicted.trust).toBeLessThanOrEqual(0.5)
    expect(consistent.trust).toBeGreaterThan(0.5)
    // 两者有效样本量相同，差异只来自「一致性」这一维度
    expect(conflicted.effectiveSampleCount).toBe(consistent.effectiveSampleCount)
  })
})

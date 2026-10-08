// tests/host/experience/retrieval-ranking.test.ts
//
// 有界信任重排与 MMR 门（§15～§20、§30、§32）。
//
// 为什么把「有界性」「低相关高信任不得取胜」「MMR 抑制重复」分别独立成用例：这三条是本阶段
// 最重要的召回约束，任一被破坏都会表现为「经验库越用越偏」——排序看起来仍然正常，
// 只是不再以语义相关性为主导，事后极难从结果反推原因。

import { describe, expect, it } from "vitest"
import { MMR_DIVERSITY_WEIGHT, MMR_RELEVANCE_WEIGHT, TRUST_ADJUSTMENT_BETA } from "../../../src/host/experience/constants.js"
import {
  boundedTrustRerank,
  calculateRecallAdjustment,
  normalizeSimilarity,
  pairSimilarity,
  rankRecallCandidates,
  selectByMmr,
  type RecallRankingCandidate,
} from "../../../src/host/experience/retrieval-ranking.js"

/** 候选工厂：默认两通道同向，使候选间相似度为 1（隔离出「只受 relevance 影响」的排序）。 */
function candidate(
  id: string,
  cosine: number,
  qualitySignal: number,
  vectors: { task?: Float64Array; decision?: Float64Array } = {},
): RecallRankingCandidate {
  return {
    id,
    cosine,
    qualitySignal,
    taskVector: vectors.task ?? new Float64Array([1, 0]),
    decisionVector: vectors.decision ?? new Float64Array([1, 0]),
  }
}

describe("normalizeSimilarity（§17 sim01 = (cosine + 1) / 2）", () => {
  it("test_cosine 取边界_映射到 0 与 1", () => {
    expect(normalizeSimilarity(1)).toBe(1)
    expect(normalizeSimilarity(-1)).toBe(0)
  })

  it("test_cosine 为 0_映射到 0.5", () => {
    expect(normalizeSimilarity(0)).toBe(0.5)
  })

  it("test_浮点舍入略微越界_夹回 [0,1]", () => {
    expect(normalizeSimilarity(1.0000000000000002)).toBe(1)
    expect(normalizeSimilarity(-1.0000000000000002)).toBe(0)
  })
})

describe("calculateRecallAdjustment（§17 adjusted = sim01 × (1 + β × quality_signal)）", () => {
  it("test_高信任_只放大约 20%", () => {
    expect(calculateRecallAdjustment({ cosine: 1, qualitySignal: 1 })).toBeCloseTo(1 + TRUST_ADJUSTMENT_BETA, 12)
  })

  it("test_负信任_只缩小约 20%", () => {
    expect(calculateRecallAdjustment({ cosine: 1, qualitySignal: -1 })).toBeCloseTo(1 - TRUST_ADJUSTMENT_BETA, 12)
  })

  it("test_中性信任_等于归一化相似度", () => {
    expect(calculateRecallAdjustment({ cosine: 0.6, qualitySignal: 0 })).toBeCloseTo(0.8, 12)
  })

  it("test_任意信任取值_修正比例都被夹在 ±20% 内", () => {
    for (const qualitySignal of [-1, -0.5, 0, 0.5, 1]) {
      const ratio = calculateRecallAdjustment({ cosine: 0.2, qualitySignal }) / normalizeSimilarity(0.2)

      expect(ratio).toBeGreaterThanOrEqual(1 - TRUST_ADJUSTMENT_BETA)
      expect(ratio).toBeLessThanOrEqual(1 + TRUST_ADJUSTMENT_BETA)
    }
  })
})

describe("pairSimilarity（候选间相似度取两通道归一化相似度的较大者）", () => {
  it("test_两通道各有一段相似_取较大者", () => {
    const left = candidate("left", 0, 0, { task: new Float64Array([1, 0]), decision: new Float64Array([0, 1]) })
    const right = candidate("right", 0, 0, { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) })

    expect(pairSimilarity(left, right)).toBeCloseTo(1, 12)
  })

  it("test_两通道都反向_相似度为 0", () => {
    const left = candidate("left", 0, 0, { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) })
    const right = candidate("right", 0, 0, { task: new Float64Array([-1, 0]), decision: new Float64Array([-1, 0]) })

    expect(pairSimilarity(left, right)).toBe(0)
  })

  it("test_维度不一致_不猜测直接按 0 处理", () => {
    const left = candidate("left", 0, 0, { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) })
    const right = candidate("right", 0, 0, { task: new Float64Array([1, 0, 0]), decision: new Float64Array([1, 0, 0]) })

    expect(pairSimilarity(left, right)).toBe(0)
  })

  it("test_信任不同_不改变候选间相似度（Trust 与 diversity 分离）", () => {
    const vectors = { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) }
    const trusted = candidate("trusted", 0, 1, vectors)
    const harmful = candidate("harmful", 0, -1, vectors)
    const other = candidate("other", 0, 0, { task: new Float64Array([0.6, 0.8]), decision: new Float64Array([0, 1]) })

    expect(pairSimilarity(trusted, other)).toBe(pairSimilarity(harmful, other))
  })
})

describe("rankRecallCandidates 排序约束（§32 Case 2 / Case 3 / Case 4）", () => {
  it("test_低相关超高信任_不能击败明显更相关的中性经验", () => {
    const candidates = [candidate("low-trust", -0.1, 1), candidate("high-neutral", 0.6, 0)]

    const hits = rankRecallCandidates({ candidates, topK: 2 })

    expect(hits.map((hit) => hit.id)).toEqual(["high-neutral", "low-trust"])
  })

  it("test_高相关高信任_排在高相关中性经验之前", () => {
    const candidates = [candidate("neutral", 0.8, 0), candidate("trusted", 0.8, 1)]

    const hits = rankRecallCandidates({ candidates, topK: 2 })

    expect(hits.map((hit) => hit.id)).toEqual(["trusted", "neutral"])
  })

  it("test_高重复度候选_被 MMR 压到高多样性候选之后", () => {
    // 三者的 adjustedRelevance 递减（1.0 / 0.98 / 0.875），但 a 与 b 互为近似重复
    const candidates = [
      candidate("a", 1, 0, { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) }),
      candidate("b", 1, -0.1, { task: new Float64Array([0.98, Math.sqrt(1 - 0.98 ** 2)]), decision: new Float64Array([0, 1]) }),
      candidate("c", 0.75, 0, { task: new Float64Array([-1, 0]), decision: new Float64Array([-1, 0]) }),
    ]

    const hits = rankRecallCandidates({ candidates, topK: 3 })

    expect(hits.map((hit) => hit.id)).toEqual(["a", "c", "b"])
  })

  it("test_命中得分_为 adjustedRelevance 而不是 MMR 值", () => {
    const candidates = [candidate("a", 0.5, 1), candidate("b", 0.5, -1)]

    const hits = rankRecallCandidates({ candidates, topK: 2 })

    expect(hits[0]).toEqual({ id: "a", score: calculateRecallAdjustment({ cosine: 0.5, qualitySignal: 1 }) })
    expect(hits[1]).toEqual({ id: "b", score: calculateRecallAdjustment({ cosine: 0.5, qualitySignal: -1 }) })
  })

  it("test_同分同信任_按 id 升序稳定排序", () => {
    const candidates = [candidate("ex-b", 0.5, 0), candidate("ex-a", 0.5, 0)]

    const hits = rankRecallCandidates({ candidates, topK: 2 })

    expect(hits.map((hit) => hit.id)).toEqual(["ex-a", "ex-b"])
  })

  it("test_topK 截断_只返回前 topK 条", () => {
    const candidates = [candidate("a", 0.9, 0), candidate("b", 0.8, 0), candidate("c", 0.7, 0), candidate("d", 0.6, 0)]

    const hits = rankRecallCandidates({ candidates, topK: 2 })

    expect(hits.map((hit) => hit.id)).toEqual(["a", "b"])
  })

  it("test_topK 非正_返回空结果", () => {
    expect(rankRecallCandidates({ candidates: [candidate("a", 0.9, 0)], topK: 0 })).toEqual([])
  })

  it("test_无候选_返回空结果", () => {
    expect(rankRecallCandidates({ candidates: [], topK: 15 })).toEqual([])
  })
})

describe("semanticFloor 硬保护（§20，默认关闭）", () => {
  it("test_默认关闭_低相关候选仍参与排序", () => {
    const candidates = [candidate("far", -0.2, 1), candidate("near", 0.6, 0)]

    const hits = rankRecallCandidates({ candidates, topK: 5 })

    expect(hits.map((hit) => hit.id)).toEqual(["near", "far"])
  })

  it("test_显式配置阈值_低于阈值的候选被挡在重排之外", () => {
    const candidates = [candidate("far", -0.2, 1), candidate("near", 0.6, 0)]

    const hits = rankRecallCandidates({ candidates, topK: 5, semanticFloor: 0.5 })

    expect(hits.map((hit) => hit.id)).toEqual(["near"])
  })
})

describe("boundedTrustRerank 与 selectByMmr 的分工", () => {
  it("test_重排阶段_只按 relevance 降序排列", () => {
    const ranked = boundedTrustRerank([candidate("low", 0.1, 0), candidate("high", 0.9, 0)])

    expect(ranked.map((item) => item.candidate.id)).toEqual(["high", "low"])
    expect(ranked[0].adjustedRelevance).toBeCloseTo(normalizeSimilarity(0.9), 12)
  })

  it("test_MMR 阶段_已选候选的信任不改变其余候选的多样性项", () => {
    // a 的信任只影响它自己的 relevance；b / c 与 a 的相似度固定，因此两步选择顺序不随 q_a 变化
    const vectors = { task: new Float64Array([1, 0]), decision: new Float64Array([1, 0]) }
    const shared = () => [
      candidate("b", 0.5, 0, vectors),
      candidate("c", 0.4, 0, { task: new Float64Array([0.6, 0.8]), decision: new Float64Array([1, 0]) }),
    ]
    const trusted = boundedTrustRerank([candidate("a", 1, 1, vectors), ...shared()])
    const harmful = boundedTrustRerank([candidate("a", 1, -1, vectors), ...shared()])

    const orderWithTrust = selectByMmr({ ranked: trusted, limit: 3 }).map((item) => item.candidate.id)
    const orderWithHarm = selectByMmr({ ranked: harmful, limit: 3 }).map((item) => item.candidate.id)

    expect(orderWithTrust).toEqual(["a", "b", "c"])
    expect(orderWithHarm).toEqual(orderWithTrust)
  })

  it("test_MMR 权重_取裁决值 0.40 / 0.60", () => {
    expect(MMR_RELEVANCE_WEIGHT).toBe(0.4)
    expect(MMR_DIVERSITY_WEIGHT).toBe(0.6)
  })

  it("test_MMR 选择条数为 0_返回空结果", () => {
    expect(selectByMmr({ ranked: boundedTrustRerank([candidate("a", 0.9, 0)]), limit: 0 })).toEqual([])
  })
})

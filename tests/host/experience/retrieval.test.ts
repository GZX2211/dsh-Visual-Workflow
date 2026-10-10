// tests/host/experience/retrieval.test.ts
//
// 召回评分门（§8.2 双通道 + §8.3 词法回退）。
//
// 为什么把双通道与回退分开测：双通道是「同一经验可从任务侧或决策侧任一角度被找到」的
// 召回面保证；回退是「语义能力不可用时仍能召回且如实标注来源」的降级保证。两者任一静默
// 失效都会让模型以为「没有历史经验可用」，比报错更难发现。

import { describe, expect, it } from "vitest"
import {
  CANDIDATE_POOL_SIZE,
  DEFAULT_RECALL_TOP_K,
  MAX_RECALL_TOP_K,
} from "../../../src/host/experience/constants.js"
import {
  bm25Scores,
  normalizeTopK,
  rankByBm25,
  rankByEmbedding,
  recallActiveHits,
  tokenizeForLexical,
} from "../../../src/host/experience/retrieval.js"
import type { ExperienceRetrievalRow } from "../../../src/host/experience/ports.js"
import { createExperienceWorld, seedEntry } from "./fixtures/ports.js"

/** 召回行工厂：只带评分需要的四个字段。 */
function row(
  id: string,
  decisionVector: Float64Array,
  options: { taskVector?: Float64Array; taskText?: string; decisionText?: string } = {},
): ExperienceRetrievalRow {
  return {
    id,
    taskEmbedding: options.taskVector ?? decisionVector,
    taskRetrievalText: options.taskText ?? `任务：${id}`,
    decisionEmbedding: decisionVector,
    decisionRetrievalText: options.decisionText ?? `决策：${id}`,
  }
}

describe("normalizeTopK", () => {
  it("test_topK 缺省_取默认值", () => {
    expect(normalizeTopK(undefined)).toBe(DEFAULT_RECALL_TOP_K)
  })

  it("test_topK 超上限_截到上限", () => {
    expect(normalizeTopK(MAX_RECALL_TOP_K + 1)).toBe(MAX_RECALL_TOP_K)
  })

  it("test_topK 非正数或非有限_回落默认值", () => {
    expect(normalizeTopK(0)).toBe(DEFAULT_RECALL_TOP_K)
    expect(normalizeTopK(-3)).toBe(DEFAULT_RECALL_TOP_K)
    expect(normalizeTopK(Number.NaN)).toBe(DEFAULT_RECALL_TOP_K)
  })
})

describe("rankByEmbedding 双通道", () => {
  it("test_仅任务侧命中_该经验仍被召回", () => {
    const rows = [
      row("ex-task", new Float64Array([0, 1]), { taskVector: new Float64Array([1, 0]) }),
      row("ex-far", new Float64Array([0, 1])),
    ]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), 10)

    expect(scored[0].id).toBe("ex-task")
    expect(scored[0].score).toBeCloseTo(1)
  })

  it("test_两通道命中同一经验_去重并取较高分", () => {
    const rows = [
      row("ex-both", new Float64Array([0.6, 0.8]), { taskVector: new Float64Array([1, 0]) }),
    ]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), 10)

    expect(scored.map((hit) => hit.id)).toEqual(["ex-both"])
    expect(scored[0].score).toBeCloseTo(1)
  })

  it("test_两通道各自命中不同经验_并集按最高分排序", () => {
    const rows = [
      row("ex-decision", new Float64Array([1, 0]), { taskVector: new Float64Array([0, 1]) }),
      row("ex-task", new Float64Array([0, 1]), { taskVector: new Float64Array([0.8, 0.6]) }),
    ]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), 10)

    expect(scored.map((hit) => hit.id)).toEqual(["ex-decision", "ex-task"])
    expect(scored[0].score).toBeCloseTo(1)
    expect(scored[1].score).toBeCloseTo(0.8)
  })

  it("test_并集结果_仍按候选池大小截断", () => {
    const rows = [
      row("ex-a", new Float64Array([1, 0])),
      row("ex-b", new Float64Array([0.9, Math.sqrt(1 - 0.9 ** 2)])),
      row("ex-c", new Float64Array([0.5, Math.sqrt(1 - 0.5 ** 2)])),
      row("ex-d", new Float64Array([0, 1])),
    ]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), 2)

    expect(scored.map((hit) => hit.id)).toEqual(["ex-a", "ex-b"])
  })

  it("test_候选池_按固定常量截断且保留最高分", () => {
    // 40 条：每条的决策侧相似度递减，池只保留前 CANDIDATE_POOL_SIZE 名
    const rows = Array.from({ length: CANDIDATE_POOL_SIZE + 10 }, (_, index) => {
      const similarity = 1 - index / 100
      return row(`ex-${String(index).padStart(2, "0")}`, new Float64Array([similarity, Math.sqrt(Math.max(0, 1 - similarity ** 2))]))
    })

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), CANDIDATE_POOL_SIZE)

    expect(scored).toHaveLength(CANDIDATE_POOL_SIZE)
    expect(scored[0].id).toBe("ex-00")
    expect(scored[CANDIDATE_POOL_SIZE - 1].id).toBe(`ex-${String(CANDIDATE_POOL_SIZE - 1).padStart(2, "0")}`)
  })

  it("test_池内命中_携带产生得分的召回行", () => {
    const rows = [row("ex-a", new Float64Array([1, 0]), { taskText: "任务文本", decisionText: "决策文本" })]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), CANDIDATE_POOL_SIZE)

    expect(scored[0].row.decisionRetrievalText).toBe("决策文本")
  })

  it("test_向量维度与查询不符_该行不参与打分", () => {
    const rows = [row("ex-ok", new Float64Array([1, 0])), row("ex-mismatch", new Float64Array([1, 0, 0]))]

    const scored = rankByEmbedding(rows, new Float64Array([1, 0]), CANDIDATE_POOL_SIZE)

    expect(scored.map((hit) => hit.id)).toEqual(["ex-ok"])
  })
})

describe("词法评分（BM25 回退）", () => {
  it("test_分词_中文切二元组英文切词", () => {
    expect(tokenizeForLexical("并行启动 task split")).toEqual(["并行", "行启", "启动", "task", "split"])
  })

  it("test_词法评分_命中查询词的文档得分更高", () => {
    const scores = bm25Scores("并行 前置条件", ["并行 前置条件 未稳定", "完全无关的内容"])

    expect(scores[0]).toBeGreaterThan(scores[1])
  })

  it("test_rankByBm25_按词法得分排序并返回 topK", () => {
    const rows = [
      row("ex-hit", new Float64Array([0, 1]), { taskText: "并行 前置条件 闸门", decisionText: "决策 分解" }),
      row("ex-miss", new Float64Array([1, 0]), { taskText: "数据库 迁移", decisionText: "运维" }),
    ]

    const scored = rankByBm25("并行 前置条件", rows, 10)

    expect(scored[0].id).toBe("ex-hit")
    expect(scored[0].score).toBeGreaterThan(0)
  })

  it("test_rankByBm25_查询与文档全不相干_得分为零", () => {
    const scored = rankByBm25("无关词", [row("ex-miss", new Float64Array([1, 0]), { taskText: "数据库迁移", decisionText: "运维" })], 10)

    expect(scored[0].score).toBe(0)
  })
})

describe("recallActiveHits 通道选择与回退标记", () => {
  it("test_语义可用_单次查询嵌入且标记 semantic", async () => {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    const rows = [row("ex-a", new Float64Array([1, 0]))]

    const outcome = await recallActiveHits({ query: "并行启动", rows, embedding: world.embedding })

    expect(outcome.source).toBe("semantic")
    expect(outcome.scored.map((hit) => hit.id)).toEqual(["ex-a"])
    expect(world.embedCalls).toEqual([["并行启动"]])
  })

  it("test_嵌入端口处于 bm25_不发起嵌入且标记 bm25", async () => {
    const world = createExperienceWorld({ embeddingSource: "bm25" })
    const rows = [row("ex-a", new Float64Array([1, 0]), { taskText: "并行启动 闸门", decisionText: "分解" })]

    const outcome = await recallActiveHits({ query: "并行启动", rows, embedding: world.embedding })

    expect(outcome.source).toBe("bm25")
    expect(world.embedCalls).toEqual([])
    expect(outcome.scored[0].id).toBe("ex-a")
  })

  it("test_惰性引擎就绪前的 source 为 bm25_就绪后走语义通道", async () => {
    const world = createExperienceWorld({
      embeddingSource: "bm25",
      onEnsureReady: () => {
        // 模拟惰性引擎加载完成：就绪之后 source 才代表真实能力
        world.embedding.source = "local"
      },
    })
    const rows = [row("ex-a", new Float64Array([1, 0]), { taskText: "并行启动 闸门", decisionText: "分解" })]

    const outcome = await recallActiveHits({ query: "并行启动", rows, embedding: world.embedding })

    expect(outcome.source).toBe("semantic")
    expect(world.embedCalls).toEqual([["并行启动"]])
  })

  it("test_嵌入调用抛错_回退词法并标记 bm25", async () => {
    const world = createExperienceWorld({
      embed: async () => {
        throw new Error("外部嵌入端点不可用")
      },
    })
    const rows = [row("ex-a", new Float64Array([1, 0]), { taskText: "并行启动 闸门", decisionText: "分解" })]

    const outcome = await recallActiveHits({ query: "并行启动", rows, embedding: world.embedding })

    expect(outcome.source).toBe("bm25")
    expect(outcome.scored[0].id).toBe("ex-a")
  })

  it("test_嵌入未返回查询向量_回退词法并标记 bm25", async () => {
    const world = createExperienceWorld({ embed: async () => [] })
    const rows = [row("ex-a", new Float64Array([1, 0]), { taskText: "并行启动 闸门", decisionText: "分解" })]

    const outcome = await recallActiveHits({ query: "并行启动", rows, embedding: world.embedding })

    expect(outcome.source).toBe("bm25")
    expect(outcome.scored[0].id).toBe("ex-a")
  })

  it("test_无活跃经验行_不发起嵌入且结果为空", async () => {
    const world = createExperienceWorld()

    const outcome = await recallActiveHits({ query: "并行启动", rows: [], embedding: world.embedding })

    expect(outcome.scored).toEqual([])
    expect(world.embedCalls).toEqual([])
  })
})

describe("recallActiveHits 与受控世界", () => {
  it("test_受控世界召回行_按类型隔离", async () => {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    seedEntry(world, { id: "ex-agent", experienceType: "agent" }, { decisionVector: new Float64Array([1, 0]) })

    const outcome = await recallActiveHits({
      query: "并行启动",
      rows: world.retrievalRows.get("agent") ?? [],
      embedding: world.embedding,
    })

    expect(outcome.scored.map((hit) => hit.id)).toEqual(["ex-agent"])
  })
})

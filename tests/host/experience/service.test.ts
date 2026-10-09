// tests/host/experience/service.test.ts
//
// ExperienceService 组合行为门。
//
// 为什么这里必须用「端口调用顺序」而不是只断言最终状态：本服务最硬的约束是事务边界——
// 向量必须在写事务之外算完（可能走远程 HTTP 或首次加载本地模型），判重与写入由资产库
// 在同一事务内完成。顺序错了功能仍然「看起来正常」，只是把长写锁带进了 SQLite，所以
// 顺序本身就是要保护的行为。

import { describe, expect, it } from "vitest"
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
  ERR_EXPERIENCE_NOT_FOUND,
  ERR_EXPERIENCE_NOT_INITIALIZED,
  ERR_EXPERIENCE_RECALL_FAILED,
  ERR_EXPERIENCE_VALIDATION,
  ERR_EXPERIENCE_WRONG_TYPE,
} from "../../../src/host/shared/protocol.js"
import { buildRecallSummary, buildRetrievalProjection } from "../../../src/host/experience/projection.js"
import { CANDIDATE_POOL_SIZE, NEUTRAL_STATS, TRUST_ADJUSTMENT_BETA } from "../../../src/host/experience/constants.js"
import type { ExperienceCaller } from "../../../src/host/experience/ports.js"
import { ExperienceService } from "../../../src/host/experience/service.js"
import { TEAM_EXPERIENCE_CONTEXT_HEADING } from "../../../src/host/experience/team-context.js"
import type { ExperienceSemanticFields } from "../../../src/host/experience/validation.js"
import type { FakeExperienceWorld } from "./fixtures/ports.js"
import {
  createCandidatePayload,
  createExperienceWorld,
  seedActiveRun,
  seedChildRun,
  seedEntry,
  seedPrompts,
  seedStats,
  seedUsed,
  similarityVector,
} from "./fixtures/ports.js"
import { errorOf } from "./fixtures/assertions.js"

const ROOT_CALLER: ExperienceCaller = { isChild: false, sessionId: "session-1" }
const CHILD_CALLER: ExperienceCaller = { isChild: true, sessionId: "session-1", childId: "child-1" }

/** 候选工厂默认值对应的语义核心（写入行投影断言与候选载荷共享同一份事实）。 */
const DEFAULT_CORE: ExperienceSemanticFields = {
  responsibility: "对节点任务的正确性负责",
  taskType: "软件开发",
  decisionDomain: "任务分解",
  situation: "两个节点共享未稳定的前置条件",
  trigger: "准备并行启动多个节点时",
  principle: "前置条件未稳定时并行会放大返工",
  recommendedAction: "先建立显式完成闸门再并行",
  exclusions: ["前置条件已稳定时不适用"],
  evidence: ["一次并行执行返工"],
}

/** 服务 + 告警收集缝（teamExperienceContext 的诊断信息只能经日志缝观察）。 */
function createService(world: FakeExperienceWorld): { service: ExperienceService; warnings: string[] } {
  const warnings: string[] = []
  const service = new ExperienceService({
    store: world.store,
    runtime: world.runtime,
    embedding: world.embedding,
    now: () => world.now,
    logger: { warn: (message: string) => warnings.push(message) },
  })
  return { service, warnings }
}

/** 按「每候选两向量（任务侧在前、决策侧在后）」的顺序返回嵌入结果。 */
function embedPairs(pairs: Array<{ task: Float64Array; decision: Float64Array }>) {
  return async (texts: string[]): Promise<Float64Array[]> => texts.map((_text, index) => {
    const pair = pairs[Math.floor(index / 2)]
    return index % 2 === 0 ? pair.task : pair.decision
  })
}

describe("ExperienceService.initializePrompt", () => {
  it("test_初始化_返回 active Prompt 并记录初始化态供提交使用", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)

    const result = await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    expect(result.prompt).toMatchObject({ id: "ep-agent", experienceType: "agent", promptVersion: "V1" })
  })

  it("test_重复初始化_幂等返回同一 active Prompt", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)

    const first = await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })
    const second = await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    expect(second.prompt.id).toBe(first.prompt.id)
    expect(second.prompt.promptVersion).toBe(first.prompt.promptVersion)
  })

  it("test_该类型没有 active Prompt_返回 WF_EXPERIENCE_NOT_FOUND", async () => {
    const world = createExperienceWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.initializePrompt({ caller: ROOT_CALLER, type: "agent" }))

    expect(error.code).toBe(ERR_EXPERIENCE_NOT_FOUND)
  })

  it("test_职责不符_先拒绝再读 Prompt", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)

    const error = await errorOf(() => service.initializePrompt({ caller: ROOT_CALLER, type: "orchestrator" }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(world.calls.includes("store.getActivePrompt")).toBe(false)
  })
})

describe("ExperienceService.submit 前置校验", () => {
  it("test_未初始化即提交_拒绝并要求先取 Prompt", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_NOT_INITIALIZED)
    expect(error.message.includes("wf_experience_learn")).toBe(true)
    expect(world.calls.includes("embed")).toBe(false)
  })

  it("test_未初始化且候选非法_先报未初始化", async () => {
    const world = createExperienceWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.submit({
      caller: ROOT_CALLER,
      type: "agent",
      candidates: [createCandidatePayload({ insight: "旧协议字段" })],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_NOT_INITIALIZED)
  })

  it("test_候选非法_拒绝且不发起嵌入", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({
      caller: ROOT_CALLER,
      type: "agent",
      candidates: [createCandidatePayload({ insight: "旧协议字段" })],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(world.calls.includes("embed")).toBe(false)
    expect(world.calls.includes("store.insertChecked")).toBe(false)
  })

  it("test_提交时职责已变化_拒绝", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })
    seedActiveRun(world, "session-1")

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })

  it("test_两个子代理的初始化态_互相独立", async () => {
    const world = createExperienceWorld()
    seedPrompts(world)
    seedChildRun(world, "child-1", { sessionId: "session-1" })
    seedChildRun(world, "child-2", { sessionId: "session-1" })
    const { service } = createService(world)
    await service.initializePrompt({ caller: CHILD_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({
      caller: { isChild: true, sessionId: "session-1", childId: "child-2" },
      type: "agent",
      candidates: [createCandidatePayload()],
    }))

    expect(error.code).toBe(ERR_EXPERIENCE_NOT_INITIALIZED)
  })
})

describe("ExperienceService.submit 事务边界与 provenance", () => {
  it("test_嵌入在写入之前完成_且两个文本一次批量嵌入", async () => {
    const world = createExperienceWorld({ embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]) })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    await service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] })

    expect(world.calls.filter((call) => call === "embed" || call === "store.insertChecked")).toEqual(["embed", "store.insertChecked"])
    expect(world.embedCalls).toHaveLength(1)
    expect(world.embedCalls[0]).toHaveLength(2)
  })

  it("test_写入行_补齐来源生成信息与检索投影", async () => {
    const world = createExperienceWorld({ embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]) })
    seedPrompts(world)
    seedChildRun(world, "child-1", { runId: "run-9", sessionId: "session-1" })
    const { service } = createService(world)
    await service.initializePrompt({ caller: CHILD_CALLER, type: "agent" })

    await service.submit({ caller: CHILD_CALLER, type: "agent", candidates: [createCandidatePayload()] })

    const row = world.lastInsert?.rows[0]
    const projection = buildRetrievalProjection(DEFAULT_CORE)
    expect(row).toMatchObject({
      id: "ex-1",
      experienceType: "agent",
      sourceRunId: "run-9",
      generationPromptId: "ep-agent",
      generationPromptVersion: "V1",
      embeddingModel: "local",
      embeddingDimension: 2,
      taskRetrievalText: projection.taskRetrievalText,
      decisionRetrievalText: projection.decisionRetrievalText,
    })
  })

  it("test_嵌入端口退化到 bm25_拒绝写入", async () => {
    const world = createExperienceWorld({ embeddingSource: "bm25" })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
    expect(world.calls.includes("store.insertChecked")).toBe(false)
    expect(world.entries.size).toBe(0)
  })

  it("test_惰性引擎就绪前的 source 为 bm25_就绪后写入成功", async () => {
    const world = createExperienceWorld({
      embeddingSource: "bm25",
      onEnsureReady: () => {
        // 模拟惰性引擎加载完成：就绪之后 source 才代表真实能力
        world.embedding.source = "local"
      },
    })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    await service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] })

    expect(world.entries.size).toBe(1)
    expect(world.lastInsert?.rows[0]?.embeddingModel).toBe("local")
  })

  it("test_嵌入调用抛错_拒绝写入", async () => {
    const world = createExperienceWorld({
      embed: async () => {
        throw new Error("外部嵌入端点不可用")
      },
    })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
    expect(world.calls.includes("store.insertChecked")).toBe(false)
  })

  it("test_嵌入返回数量不符_拒绝写入", async () => {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
    expect(world.calls.includes("store.insertChecked")).toBe(false)
  })

  it("test_嵌入维度与端口声明不符_拒绝写入", async () => {
    const world = createExperienceWorld({ embed: async (texts) => texts.map(() => new Float64Array([1, 0, 0])) })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))

    expect(error.code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
  })
})

describe("ExperienceService.submit 判重", () => {
  /** 提交一条候选并复用既有经验向量，返回判重结果。 */
  async function submitWithExisting(existingSimilarity: number) {
    const world = createExperienceWorld({
      embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]),
    })
    seedPrompts(world)
    seedEntry(world, { id: "ex-existing", experienceType: "agent" }, { decisionVector: similarityVector(existingSimilarity) })
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })
    const result = await service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] })
    return { world, result }
  }

  it("test_决策向量相似度 0.799_通过", async () => {
    const { result } = await submitWithExisting(0.799)

    expect(result.inserted).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
  })

  it("test_决策向量相似度恰好 0.8_拦截", async () => {
    const { result } = await submitWithExisting(0.8)

    expect(result.inserted).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason.includes("ex-existing")).toBe(true)
  })

  it("test_决策向量相似度 0.801_拦截并回报原因与检索文本", async () => {
    const { result } = await submitWithExisting(0.801)

    expect(result.inserted).toHaveLength(0)
    expect(result.skipped[0].reason.includes("0.8")).toBe(true)
    expect(result.skipped[0].decisionRetrievalText.includes("decision_domain")).toBe(true)
  })

  it("test_批内互相判重_第二条被拦截", async () => {
    const world = createExperienceWorld({
      embed: embedPairs([
        { task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) },
        { task: new Float64Array([0, 1]), decision: similarityVector(0.9) },
      ]),
    })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const result = await service.submit({
      caller: ROOT_CALLER,
      type: "agent",
      candidates: [createCandidatePayload({ responsibility: "责任甲" }), createCandidatePayload({ responsibility: "责任乙" })],
    })

    expect(result.inserted.map((entry) => entry.responsibility)).toEqual(["责任甲"])
    expect(result.skipped).toHaveLength(1)
  })

  it("test_证据完全相同但决策向量不同_视为两条经验", async () => {
    const world = createExperienceWorld({
      embed: embedPairs([
        { task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) },
        { task: new Float64Array([0, 1]), decision: similarityVector(0.2) },
      ]),
    })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const result = await service.submit({
      caller: ROOT_CALLER,
      type: "agent",
      candidates: [
        createCandidatePayload({ responsibility: "责任甲", evidence: ["同一份证据"] }),
        createCandidatePayload({ responsibility: "责任乙", evidence: ["同一份证据"] }),
      ],
    })

    expect(result.inserted).toHaveLength(2)
  })

  it("test_不同经验类型不互相判重", async () => {
    const world = createExperienceWorld({
      embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]),
    })
    seedPrompts(world)
    seedEntry(world, { id: "ex-orchestrator", experienceType: "orchestrator" }, { decisionVector: new Float64Array([1, 0]) })
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    const result = await service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] })

    expect(result.inserted).toHaveLength(1)
  })
})

describe("ExperienceService.recall", () => {
  /** 摆好一条 agent 经验与一条 team 经验的受控世界。 */
  function seedRecallWorld() {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    seedEntry(world, {
      id: "ex-agent-1",
      experienceType: "agent",
      responsibility: "对节点任务负责",
      decisionDomain: "任务分解",
    }, { decisionVector: new Float64Array([1, 0]), taskVector: new Float64Array([0, 1]) })
    seedEntry(world, { id: "ex-agent-archived", experienceType: "agent", active: false })
    seedEntry(world, { id: "ex-team-1", experienceType: "team" }, { decisionVector: new Float64Array([1, 0]) })
    return world
  }

  it("test_查询阶段_返回候选摘要与来源并按类型隔离", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.source).toBe("semantic")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-agent-1"])
    expect(result.hits[0].summary).toBe(buildRecallSummary(world.entries.get("ex-agent-1")!))
    expect(result.hits[0].source).toBe("semantic")
    expect(world.listActiveEmbeddingsCalls).toEqual(["agent"])
  })

  it("test_查询阶段_摘要读取只取活跃行", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    expect(world.getRowsCalls).toEqual([{ ids: ["ex-agent-1"], activeOnly: true }])
  })

  it("test_按 id 阶段_返回完整条目且归档查不到", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-agent-1", "ex-agent-archived"] })

    if (result.kind !== "details") throw new Error("期望详情阶段结果")
    expect(result.entries.map((entry) => entry.id)).toEqual(["ex-agent-1"])
  })

  it("test_既无 query 也无 ids_返回 WF_EXPERIENCE_BAD_ARGS", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "agent" }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(error.message.includes("ids")).toBe(true)
  })

  it("test_查询为空字符串_返回 WF_EXPERIENCE_BAD_ARGS", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "agent", query: "   " }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_按 id 阶段传空数组_返回 WF_EXPERIENCE_BAD_ARGS", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "agent", ids: [] }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_语义不可用_候选标记 bm25", async () => {
    const world = seedRecallWorld()
    world.embedding.source = "bm25"
    world.embedding.embed = async (): Promise<Float64Array[]> => {
      throw new Error("bm25 降级态不应发起语义嵌入")
    }
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动 闸门" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.source).toBe("bm25")
    expect(result.hits[0].source).toBe("bm25")
  })

  it("test_无活跃经验_返回空候选且不发起嵌入", async () => {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits).toEqual([])
    expect(world.embedCalls).toEqual([])
  })

  it("test_召回类型职责不符_拒绝", async () => {
    const world = seedRecallWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "team", query: "协作" }))

    expect(error.code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
  })

  it("test_检索通道不可用_返回 WF_EXPERIENCE_RECALL_FAILED", async () => {
    const world = seedRecallWorld()
    world.store.listActiveEmbeddings = async () => {
      throw new Error("经验库读取失败")
    }
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" }))

    expect(error.code).toBe(ERR_EXPERIENCE_RECALL_FAILED)
    expect(error.message.includes("经验库读取失败")).toBe(true)
  })

  it("test_按 id 阶段读取失败_同样返回 WF_EXPERIENCE_RECALL_FAILED", async () => {
    const world = seedRecallWorld()
    world.store.getRows = async () => {
      throw new Error("经验库读取失败")
    }
    const { service } = createService(world)

    const error = await errorOf(() => service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-agent-1"] }))

    expect(error.code).toBe(ERR_EXPERIENCE_RECALL_FAILED)
  })
})

describe("ExperienceService.update", () => {
  it("test_保存_事务外重算投影与向量后再落库", async () => {
    const world = createExperienceWorld({ embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]) })
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const updated = await service.update({ experienceId: "ex-1", patch: { principle: "  新原则  " } })

    expect(updated.principle).toBe("新原则")
    expect(world.calls.filter((call) => call === "embed" || call === "store.updateFields")).toEqual(["embed", "store.updateFields"])
    expect(world.lastUpdate?.patch).toEqual({ principle: "新原则" })
    expect(world.lastUpdate?.next.decisionRetrievalText.includes("principle: 新原则")).toBe(true)
    expect(world.lastUpdate?.next.decisionEmbedding).toEqual(new Float64Array([1, 0]))
  })

  it("test_清空数组字段_投影使用稳定占位", async () => {
    const world = createExperienceWorld({ embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]) })
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const updated = await service.update({ experienceId: "ex-1", patch: { exclusions: null } })

    expect(updated.exclusions).toEqual([])
    expect(world.lastUpdate?.next.decisionRetrievalText.includes("exclusions: （无）")).toBe(true)
  })

  it("test_嵌入不可用_拒绝保存且不落库", async () => {
    const world = createExperienceWorld({ embeddingSource: "bm25" })
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const error = await errorOf(() => service.update({ experienceId: "ex-1", patch: { principle: "新原则" } }))

    expect(error.code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
    expect(world.calls.includes("store.updateFields")).toBe(false)
    expect(world.entries.get("ex-1")?.principle).toBe("共享前置条件未稳定时并行会放大返工")
  })

  it("test_经验不存在_返回 WF_EXPERIENCE_NOT_FOUND", async () => {
    const world = createExperienceWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.update({ experienceId: "ex-missing", patch: { principle: "新原则" } }))

    expect(error.code).toBe(ERR_EXPERIENCE_NOT_FOUND)
    expect(error.message.includes("ex-missing")).toBe(true)
  })

  it("test_必填字段被清空_拒绝", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const error = await errorOf(() => service.update({ experienceId: "ex-1", patch: { responsibility: " " } }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(world.calls.includes("store.updateFields")).toBe(false)
  })

  it("test_补丁含未知字段_拒绝", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const error = await errorOf(() => service.update({ experienceId: "ex-1", patch: { insight: "旧字段" } as never }))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
  })
})

describe("ExperienceService 生命周期与列表", () => {
  it("test_归档_置为非活跃并返回条目", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1" })
    const { service } = createService(world)

    const retired = await service.retire({ experienceId: "ex-1" })

    expect(retired.active).toBe(false)
    expect(world.calls.includes("store.setActive")).toBe(true)
  })

  it("test_恢复_置为活跃并返回条目", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", active: false })
    const { service } = createService(world)

    const restored = await service.restore({ experienceId: "ex-1" })

    expect(restored.active).toBe(true)
  })

  it("test_列表_按上限返回条目", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1" })
    seedEntry(world, { id: "ex-2" })
    seedEntry(world, { id: "ex-3" })
    const { service } = createService(world)

    expect(await service.list({ limit: 2 })).toHaveLength(2)
  })

  it("test_列表上限非法_返回 WF_EXPERIENCE_BAD_ARGS", async () => {
    const world = createExperienceWorld()
    const { service } = createService(world)

    const error = await errorOf(() => service.list({ limit: 0 }))

    expect(error.code).toBe(ERR_EXPERIENCE_BAD_ARGS)
  })

  it("test_终态清理_清理后需重新初始化才能提交", async () => {
    const world = createExperienceWorld({ embed: embedPairs([{ task: new Float64Array([0, 1]), decision: new Float64Array([1, 0]) }]) })
    seedPrompts(world)
    const { service } = createService(world)
    await service.initializePrompt({ caller: ROOT_CALLER, type: "agent" })

    service.clearSession({ sessionId: "session-1" })

    const error = await errorOf(() => service.submit({ caller: ROOT_CALLER, type: "agent", candidates: [createCandidatePayload()] }))
    expect(error.code).toBe(ERR_EXPERIENCE_NOT_INITIALIZED)
  })
})

describe("ExperienceService.teamExperienceContext", () => {
  /** 摆好「运行中 + 已启动协作组 + 一条 team 经验」的受控世界。 */
  function seedTeamWorld() {
    const world = createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
    seedActiveRun(world, "session-1", "run-1")
    world.runtimeFacts.teamRuns.add("session-1")
    seedEntry(world, {
      id: "ex-team-1",
      experienceType: "team",
      responsibility: "对协作交付负责",
      principle: "先对齐接口再并行",
      recommendedAction: "启动前同步接口契约",
    }, { decisionVector: new Float64Array([1, 0]) })
    return world
  }

  const INPUT = { sessionId: "session-1", flowId: "flow-1", groupId: "group-1", query: "协作任务查询" }

  it("test_有 team 经验_渲染稳定共享文本且两次调用字节相同", async () => {
    const world = seedTeamWorld()
    const { service, warnings } = createService(world)

    const text = await service.teamExperienceContext(INPUT)
    const again = await service.teamExperienceContext(INPUT)

    expect(text?.includes(TEAM_EXPERIENCE_CONTEXT_HEADING)).toBe(true)
    expect(text?.includes("ex-team-1")).toBe(true)
    expect(again).toBe(text)
    expect(warnings).toEqual([])
  })

  it("test_无 team 经验_返回 null 且不发起嵌入", async () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1")
    world.runtimeFacts.teamRuns.add("session-1")
    const { service } = createService(world)

    expect(await service.teamExperienceContext(INPUT)).toBeNull()
    expect(world.embedCalls).toEqual([])
  })

  it("test_职责校检不通过_返回 null 并留下可诊断信息", async () => {
    const world = createExperienceWorld()
    seedActiveRun(world, "session-1")
    const { service, warnings } = createService(world)

    expect(await service.teamExperienceContext(INPUT)).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].includes("team")).toBe(true)
    expect(warnings[0].includes("group-1")).toBe(true)
  })

  it("test_经验库读取失败_返回 null 而不抛给调用方", async () => {
    const world = seedTeamWorld()
    world.store.listActiveEmbeddings = async () => {
      throw new Error("资产库不可用")
    }
    const { service, warnings } = createService(world)

    expect(await service.teamExperienceContext(INPUT)).toBeNull()
    expect(warnings[0].includes("资产库不可用")).toBe(true)
  })

  it("test_查询文本为空_返回 null 不做无意义召回", async () => {
    const world = seedTeamWorld()
    const { service } = createService(world)

    expect(await service.teamExperienceContext({ ...INPUT, query: "   " })).toBeNull()
  })
})

describe("ExperienceService.recall ids 阶段的使用事实", () => {
  it("test_显式注入_记录使用事实并同步召回计数", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { service } = createService(world)

    await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-1"] })

    expect(world.usageRows).toHaveLength(1)
    expect(world.usageRows[0]).toMatchObject({ experienceId: "ex-1", runId: "", subjectId: "session-1" })
    expect(world.stats.get("ex-1")).toMatchObject({ ...NEUTRAL_STATS, recalledCount: 1 })
  })

  it("test_同一经验两次显式注入_计为两次独立使用", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { service } = createService(world)

    await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-1"] })
    await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-1"] })

    expect(world.usageRows).toHaveLength(2)
    expect(world.stats.get("ex-1")?.recalledCount).toBe(2)
  })

  it("test_归档经验查不到_不记录使用事实", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-archived", experienceType: "agent", active: false })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-archived"] })

    if (result.kind !== "details") throw new Error("期望详情阶段结果")
    expect(result.entries).toEqual([])
    expect(world.usageRows).toEqual([])
  })

  it("test_使用事实写入失败_仍返回经验并留下可诊断告警", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    world.store.recordUsage = async () => {
      throw new Error("使用事实表写入失败")
    }
    const { service, warnings } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", ids: ["ex-1"] })

    if (result.kind !== "details") throw new Error("期望详情阶段结果")
    expect(result.entries.map((entry) => entry.id)).toEqual(["ex-1"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].includes("使用事实表写入失败")).toBe(true)
    expect(warnings[0].includes("仍返回经验")).toBe(true)
  })
})

describe("ExperienceService.recall 候选阶段的第二段排序", () => {
  /** 受控查询世界：查询向量固定为 [1,0]，嵌入只回这一个向量。 */
  function seedQueryWorld(): FakeExperienceWorld {
    return createExperienceWorld({ embed: async () => [new Float64Array([1, 0])] })
  }

  it("test_候选得分_为语义相关性乘有界信任修正且高信任排前", async () => {
    const world = seedQueryWorld()
    const vectors = { taskVector: new Float64Array([1, 0]), decisionVector: new Float64Array([1, 0]) }
    seedEntry(world, { id: "ex-trusted", experienceType: "agent" }, vectors)
    seedEntry(world, { id: "ex-harmful", experienceType: "agent" }, vectors)
    seedStats(world, "ex-trusted", { qualitySignal: 1 })
    seedStats(world, "ex-harmful", { qualitySignal: -1 })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-trusted", "ex-harmful"])
    expect(result.hits[0].score).toBeCloseTo(1 + TRUST_ADJUSTMENT_BETA, 12)
    expect(result.hits[1].score).toBeCloseTo(1 - TRUST_ADJUSTMENT_BETA, 12)
  })

  it("test_低相关超高信任_不能击败明显更相关的中性经验", async () => {
    const world = seedQueryWorld()
    seedEntry(
      world,
      { id: "ex-low", experienceType: "agent" },
      { taskVector: new Float64Array([-0.1, Math.sqrt(1 - 0.1 ** 2)]), decisionVector: new Float64Array([-0.1, Math.sqrt(1 - 0.1 ** 2)]) },
    )
    seedEntry(
      world,
      { id: "ex-high", experienceType: "agent" },
      { taskVector: new Float64Array([0.6, 0.8]), decisionVector: new Float64Array([0.6, 0.8]) },
    )
    seedStats(world, "ex-low", { qualitySignal: 1 })
    seedStats(world, "ex-high", { qualitySignal: 0 })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-high", "ex-low"])
    expect(result.hits[0].score).toBeCloseTo(0.8, 12)
    expect(result.hits[1].score).toBeCloseTo(0.45 * (1 + TRUST_ADJUSTMENT_BETA), 12)
  })

  it("test_候选池固定为常量_即使 topK 更大也只从池内返回", async () => {
    const world = seedQueryWorld()
    for (let index = 0; index < CANDIDATE_POOL_SIZE + 10; index += 1) {
      seedEntry(world, { id: `ex-${String(index).padStart(2, "0")}`, experienceType: "agent" })
    }
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动", topK: 50 })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits).toHaveLength(CANDIDATE_POOL_SIZE)
  })

  it("test_topK 参数_截断最终返回条数", async () => {
    const world = seedQueryWorld()
    seedEntry(world, { id: "ex-a", experienceType: "agent" }, { taskVector: new Float64Array([1, 0]), decisionVector: new Float64Array([1, 0]) })
    seedEntry(world, { id: "ex-b", experienceType: "agent" }, { taskVector: new Float64Array([0.8, 0.6]), decisionVector: new Float64Array([0.8, 0.6]) })
    seedEntry(world, { id: "ex-c", experienceType: "agent" }, { taskVector: new Float64Array([0.5, 0.5]), decisionVector: new Float64Array([0.5, 0.5]) })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动", topK: 1 })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-a"])
  })

  it("test_候选行存在但条目已不可读_该命中被丢弃", async () => {
    const world = seedQueryWorld()
    // 现实中只有「读检索行与读条目之间行被归档/清理」才会出现这种中间态，命中必须被丢弃
    world.retrievalRows.get("agent")?.push({
      id: "ex-ghost",
      taskEmbedding: new Float64Array([1, 0]),
      taskRetrievalText: "任务：幽灵",
      decisionEmbedding: new Float64Array([1, 0]),
      decisionRetrievalText: "决策：幽灵",
    })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits).toEqual([])
  })

  it("test_统计读取失败_降级为信任中性继续召回并留下告警", async () => {
    const world = seedQueryWorld()
    seedEntry(world, { id: "ex-high", experienceType: "agent" }, { taskVector: new Float64Array([1, 0]), decisionVector: new Float64Array([1, 0]) })
    seedEntry(world, { id: "ex-low", experienceType: "agent" }, { taskVector: new Float64Array([0.6, 0.8]), decisionVector: new Float64Array([0.6, 0.8]) })
    seedStats(world, "ex-low", { qualitySignal: 1 })
    world.store.getStats = async () => {
      throw new Error("统计表不可读")
    }
    const { service, warnings } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-high", "ex-low"])
    expect(result.hits[1].score).toBeCloseTo(0.8, 12)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].includes("统计表不可读")).toBe(true)
  })

  it("test_查询阶段_不写使用事实且两次调用结果相同", async () => {
    const world = seedQueryWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { service } = createService(world)

    const first = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })
    const second = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行启动" })

    expect(world.usageRows).toEqual([])
    expect(world.calls.includes("store.recordUsage")).toBe(false)
    expect(second).toEqual(first)
  })

  it("test_语义回退词法_不读统计因而不套信任修正", async () => {
    const world = createExperienceWorld({ embeddingSource: "bm25" })
    seedEntry(world, { id: "ex-hit", experienceType: "agent", taskRetrievalText: "并行 前置条件 闸门", decisionRetrievalText: "决策 分解" })
    const { service } = createService(world)

    const result = await service.recall({ caller: ROOT_CALLER, type: "agent", query: "并行 前置条件" })

    if (result.kind !== "candidates") throw new Error("期望候选阶段结果")
    expect(result.source).toBe("bm25")
    expect(result.hits.map((hit) => hit.id)).toEqual(["ex-hit"])
    expect(world.calls.includes("store.getStats")).toBe(false)
  })
})

describe("ExperienceService.feedback 与 rebuildStats", () => {
  it("test_反馈委派_已使用经验写入评价且无跳过", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    await seedUsed(world, { subjectId: "session-1", experienceId: "ex-1" })
    const { service } = createService(world)

    const result = await service.feedback({
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [{ experienceId: "ex-1", fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 }],
    })

    expect(result.accepted.map((entry) => entry.experienceId)).toEqual(["ex-1"])
    expect(result.skipped).toEqual([])
    expect(world.stats.get("ex-1")?.usedCount).toBe(1)
  })

  it("test_反馈委派_未使用经验被跳过且文案为没有使用的经验不能评价", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    const { service } = createService(world)

    const result = await service.feedback({
      caller: ROOT_CALLER,
      type: "agent",
      evaluations: [{ experienceId: "ex-1", fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 }],
    })

    expect(result.accepted).toEqual([])
    expect(result.skipped[0].reason.includes("没有使用的经验，不能评价")).toBe(true)
  })

  it("test_重建委派_返回重建经验数并写出统计行", async () => {
    const world = createExperienceWorld()
    seedEntry(world, { id: "ex-1", experienceType: "agent" })
    seedEntry(world, { id: "ex-2", experienceType: "agent" })
    const { service } = createService(world)

    const result = await service.rebuildStats()

    expect(result.experienceCount).toBe(2)
    expect(world.stats.get("ex-1")).toMatchObject({ trust: 0.5, evidenceStrength: 0 })
    expect(world.calls.includes("store.rebuildStats")).toBe(true)
  })
})

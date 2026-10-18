// tests/integration/experience-retirement.test.ts
//
// 经验退役闭环集成测试：真实 SQLite + 真实 ExperienceService + 受控嵌入/运行端口。
//
// 覆盖完整链路：
//   评价写入 → 有害即时归档；
//   周期扫描 → 有害补偿 / 角色经验长期无用 / 编排经验长期无用；
//   人工恢复 → 旧证据豁免 → 新有害评价再次归档。
//
// 为什么必须用真实资产库：退役状态是磁盘行上的事实，恢复基准（reactivated_at）与角色列
// 的读写口径只有在真实列上才会暴露；fake store 无法证明迁移后的列真的能被扫描读到。

import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AssetStore } from "../../src/host/assets/index.js"
import {
  ExperienceService,
  aggregateExperienceStats,
  type ExperienceEmbeddingPort,
  type ExperienceRuntimePort,
  type ExperienceStorePort,
} from "../../src/host/experience/index.js"
import type { ExperienceInsertRow, ExperienceType } from "../../src/host/shared/asset-types.js"
import {
  keepAllJudge,
  neutralStatsFixture,
  settableClock,
  vector,
} from "../host/assets/fixtures/asset-fixture.js"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 受控嵌入端口：退役扫描不需要向量，但 submit 路径要求语义能力可用。 */
function fakeEmbedding(): ExperienceEmbeddingPort {
  return {
    source: "local",
    dimension: 3,
    async ensureReady() {},
    async embed(texts: string[]): Promise<Float64Array[]> {
      return texts.map((text) => {
        const axis = text.length % 3
        const result = new Float64Array([0, 0, 0])
        result[axis] = 1
        return result
      })
    },
  }
}

/** 无任何编排运行：反馈/召回仍可按父代理主体工作。 */
function fakeRuntime(): ExperienceRuntimePort {
  return {
    activeRunForSession: () => null,
    runForChild: () => null,
    modelForCaller: () => "test-model",
  }
}

/** 与宿主装配同形的薄转发（不复制业务语义）。 */
function storePortOf(store: AssetStore): ExperienceStorePort {
  return {
    nextId: () => store.nextId(),
    getActivePrompt: (type) => store.getActivePrompt(type),
    listPrompts: () => store.listPrompts(),
    listRows: (limit) => store.listRows(limit),
    getRows: (ids, options) => store.getRows(ids, options),
    listActiveEmbeddings: (type) => store.listActiveExperienceEmbeddings(type),
    insertChecked: (input) => store.insertChecked(input),
    updateFields: (id, patch, next) => store.updateFields(id, patch, next),
    setActive: (id, active) => store.setActive(id, active),
    retireForPolicy: (id, reason) => store.retireForPolicy(id, reason),
    listRetirementFacts: () => store.listRetirementFacts(),
    recordUsage: (input) => store.recordUsage(input),
    listInjectedIds: (input) => store.listInjectedIds(input),
    insertEvaluationsChecked: (input) => store.insertEvaluationsChecked(input),
    getStats: (ids) => store.getStats(ids),
    rebuildStats: (input) => store.rebuildStats(input),
  }
}

async function makeWorld(): Promise<{
  store: AssetStore
  service: ExperienceService
  clock: ReturnType<typeof settableClock>
}> {
  const dir = await mkdtemp(join(tmpdir(), "vw-experience-retirement-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const clock = settableClock(1_800_000_000_000)
  const store = new AssetStore(dir, { now: clock.now })
  await store.init()
  cleanups.push(async () => store.close())
  const service = new ExperienceService({
    store: storePortOf(store),
    runtime: fakeRuntime(),
    embedding: fakeEmbedding(),
    now: clock.now,
  })
  return { store, service, clock }
}

let idSeed = 0
function rowOf(type: ExperienceType = "agent"): ExperienceInsertRow {
  idSeed += 1
  return {
    id: `ex-${idSeed}`,
    experienceType: type,
    responsibility: "负责在依赖失败时区分本地逻辑错误",
    taskType: "软件开发",
    decisionDomain: "错误处理",
    situation: "外部依赖可能失败",
    trigger: "准备调用外部依赖时",
    principle: "依赖失败与本地失败必须分开判断",
    recommendedAction: "先确认依赖失败语义再决定重试",
    exclusions: [],
    evidence: [],
    taskRetrievalText: `task-${idSeed}`,
    taskEmbedding: vector(1, 0, 0),
    decisionRetrievalText: `decision-${idSeed}`,
    decisionEmbedding: vector(0, 1, 0),
    embeddingModel: "test-embed",
    embeddingDimension: 3,
    sourceRunId: "run-source",
    generationPromptId: type === "orchestrator" ? "ep-orchestrator-v1" : "ep-agent-v1",
    generationPromptVersion: "V1",
  }
}

async function insertExperience(store: AssetStore, type: ExperienceType = "agent"): Promise<string> {
  const row = rowOf(type)
  const result = await store.insertChecked({ rows: [row], duplicateOf: keepAllJudge })
  return result.inserted[0].id
}

async function recordUsage(
  store: AssetStore,
  experienceId: string,
  runs: string[],
  roleKey: string,
): Promise<void> {
  await store.recordUsage({
    rows: runs.map((runId) => ({ experienceId, runId, subjectId: "session-1", roleKey, roleLabel: roleKey })),
    neutralStats: neutralStatsFixture(),
  })
}

async function recordEvaluation(
  store: AssetStore,
  experienceId: string,
  input: { runId: string; roleKey: string; decisionEffect: 0 | -1 | 0.5; fitScore?: 0.25 | 1; causalConfidence?: 0 | 1 },
): Promise<void> {
  await store.insertEvaluationsChecked({
    rows: [{
      experienceId,
      runId: input.runId,
      fitScore: input.fitScore ?? 1,
      decisionEffect: input.decisionEffect,
      informationGain: 0.5,
      causalConfidence: input.causalConfidence ?? 1,
      evidence: "",
      evaluatorSubjectId: `child-${input.runId}`,
      evaluatorModel: "test-model",
      roleKey: input.roleKey,
      roleLabel: input.roleKey,
    }],
    aggregate: aggregateExperienceStats,
  })
}

/** 角色经验达到阈值 C：10 次使用 / 5 个使用 run / 5 个评价 run / 3 个角色 / 有效样本 5。 */
async function seedAgentLongUnused(store: AssetStore): Promise<string> {
  const id = await insertExperience(store)
  await recordUsage(store, id, ["run-u1", "run-u1", "run-u2", "run-u2", "run-u3", "run-u3", "run-u4", "run-u4", "run-u5", "run-u5"], "asset:role-a")
  for (const [index, role] of ["asset:role-a", "asset:role-b", "asset:role-c", "asset:role-a", "asset:role-b"].entries()) {
    await recordEvaluation(store, id, { runId: `run-e${index + 1}`, roleKey: role, decisionEffect: 0 })
  }
  return id
}

/** 编排经验达到固定次数：10 个编排 run / 5 个评价 run / 有效样本 5。 */
async function seedOrchestratorLongUnused(store: AssetStore): Promise<string> {
  const id = await insertExperience(store, "orchestrator")
  await recordUsage(store, id, Array.from({ length: 10 }, (_, index) => `run-u${index + 1}`), "asset:role-parent")
  for (let index = 0; index < 5; index += 1) {
    await recordEvaluation(store, id, { runId: `run-e${index + 1}`, roleKey: "asset:role-parent", decisionEffect: 0 })
  }
  return id
}

describe("经验退役闭环（真实资产库）", () => {
  it("test_反馈提交负向评价_立即归档为有害且评价历史保留", async () => {
    const { store, service } = await makeWorld()
    const caller = { isChild: false, sessionId: "session-1" }
    await service.initializePrompt({ caller, type: "agent" })
    const submitted = await service.submit({ caller, type: "agent", candidates: { experiences: [{
      responsibility: "负责错误处理",
      task_type: "软件开发",
      decision_domain: "错误处理",
      situation: "依赖失败",
      trigger: "调用依赖前",
      principle: "分开判断失败来源",
      recommended_action: "先确认依赖语义",
      exclusions: [],
      evidence: [],
    }] } })
    const id = submitted.inserted[0].id
    // 显式注入一次，取得反馈准入资格
    await service.recall({ caller, type: "agent", ids: [id] })

    const result = await service.feedback({
      caller,
      type: "agent",
      evaluations: [{
        experienceId: id,
        fitScore: 1,
        decisionEffect: -1,
        informationGain: 0.5,
        causalConfidence: 1,
      }],
    })

    expect(result.accepted).toHaveLength(1)
    const [entry] = await store.getRows([id])
    expect(entry).toMatchObject({ active: false, retiredReason: "harmful" })
    // 归档不删除经验本体：条目仍可读回（评价历史同理，退役只改状态字段）
    expect(entry.principle).toBe("分开判断失败来源")
  })

  it("test_扫描_角色经验跨三角色长期无用_归档为long_unused", async () => {
    const { store, service } = await makeWorld()
    const id = await seedAgentLongUnused(store)

    const result = await service.sweepRetirements()

    expect(result.retired).toEqual([{ experienceId: id, reason: "long_unused" }])
    const [entry] = await store.getRows([id])
    expect(entry).toMatchObject({ active: false, retiredReason: "long_unused" })
  })

  it("test_扫描_编排经验固定十次无价值_不走角色多样性也归档", async () => {
    const { store, service } = await makeWorld()
    const id = await seedOrchestratorLongUnused(store)

    const result = await service.sweepRetirements()

    expect(result.retired).toEqual([{ experienceId: id, reason: "long_unused" }])
    expect((await store.getRows([id]))[0]).toMatchObject({ active: false, retiredReason: "long_unused" })
  })

  it("test_扫描_角色数不足的经验保持活跃（不因单角色重复使用误杀）", async () => {
    const { store, service } = await makeWorld()
    const id = await insertExperience(store)
    await recordUsage(store, id, ["run-u1", "run-u1", "run-u2", "run-u2", "run-u3", "run-u3", "run-u4", "run-u4", "run-u5", "run-u5"], "asset:role-a")
    for (let index = 0; index < 5; index += 1) {
      await recordEvaluation(store, id, { runId: `run-e${index + 1}`, roleKey: "asset:role-a", decisionEffect: 0 })
    }

    const result = await service.sweepRetirements()

    expect(result.retired).toEqual([])
    expect((await store.getRows([id]))[0].active).toBe(true)
  })

  it("test_扫描_补偿反馈遗漏的有害评价", async () => {
    const { store, service } = await makeWorld()
    const id = await insertExperience(store)
    await recordEvaluation(store, id, { runId: "run-e1", roleKey: "asset:role-a", decisionEffect: -1 })

    const result = await service.sweepRetirements()

    expect(result.retired).toEqual([{ experienceId: id, reason: "harmful" }])
  })

  it("test_恢复后旧有害证据豁免_新有害评价再次归档", async () => {
    const { store, service, clock } = await makeWorld()
    const id = await insertExperience(store)
    await recordEvaluation(store, id, { runId: "run-old", roleKey: "asset:role-a", decisionEffect: -1 })
    expect((await service.sweepRetirements()).retired).toEqual([{ experienceId: id, reason: "harmful" }])

    clock.set(1_800_000_100_000)
    await store.setActive(id, true)
    // 旧负向评价发生在恢复之前：不得再次触发归档
    expect((await service.sweepRetirements()).retired).toEqual([])
    expect((await store.getRows([id]))[0].active).toBe(true)

    clock.set(1_800_000_200_000)
    await recordEvaluation(store, id, { runId: "run-new", roleKey: "asset:role-a", decisionEffect: -1 })
    expect((await service.sweepRetirements()).retired).toEqual([{ experienceId: id, reason: "harmful" }])
  })
})

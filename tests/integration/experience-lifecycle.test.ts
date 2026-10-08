// tests/integration/experience-lifecycle.test.ts
//
// 经验闭环集成测试：真实 SQLite 资产库 + 真实 ExperienceService + 受控嵌入端口。
//
// 为什么必须有这一层（而不是只靠各自的单测）：入库路径横跨两处独立契约——经验域
// 负责「主体解析 → 检索投影 → 向量 → 判重」，资产库负责「必填校验 → 事务内写入」。
// 两侧各自单测都能通过，但两侧口径一旦冲突（例如一侧允许空的运行来源、另一侧当成必填），
// 只有在真实装配下才会暴露。本文件因此覆盖「父代理未承担编排职责时的 agent 经验入库」
// 这条曾经整链失效的路径。
//
// 嵌入端口用受控 fake：向量值与维度可控，既不加载本地模型，也不让「判重是否命中」
// 取决于真实语义相似度。
//
// 运行环境：node（host 测试默认）。

import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AssetStore } from "../../src/host/assets/index.js"
import {
  ExperienceService,
  type ExperienceEmbeddingPort,
  type ExperienceRuntimePort,
  type ExperienceStorePort,
} from "../../src/host/experience/index.js"
import type { ExperienceInsertRow } from "../../src/host/shared/asset-types.js"
import { ERR_EXPERIENCE_WRONG_TYPE } from "../../src/host/shared/protocol.js"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 受控嵌入端口：按文本给出可预期的单位向量（维度固定 3）。 */
function fakeEmbedding(): ExperienceEmbeddingPort & { calls: number; batches: number } {
  const port = {
    source: "local" as const,
    dimension: 3,
    calls: 0,
    batches: 0,
    async embed(texts: string[]): Promise<Float64Array[]> {
      port.calls += 1
      port.batches += texts.length
      // 同一文本恒得同一向量；不同文本落在不同轴上，使判重结论可预测
      return texts.map((text) => {
        const axis = Math.abs(hashOf(text)) % 3
        const vector = new Float64Array([0, 0, 0])
        vector[axis] = 1
        return vector
      })
    },
  }
  return port
}

/** 稳定小散列（仅用于让不同文本落到不同轴，不承担任何安全语义）。 */
function hashOf(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0
  return hash
}

/** 编排运行事实端口替身：默认「无任何运行」（父代理未承担编排职责）。 */
function fakeRuntime(overrides: Partial<ExperienceRuntimePort> = {}): ExperienceRuntimePort {
  return {
    activeRunForSession: () => null,
    runForChild: () => null,
    hasTeamInCurrentRun: () => false,
    hasActiveRun: () => false,
    ...overrides,
  }
}

/** Store 端口：与宿主装配同形的薄转发（不复制任何业务语义）。 */
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
  }
}

/** 组装一套真实资产库 + 真实经验域（返回清理函数）。 */
async function makeWorld(runtime: ExperienceRuntimePort = fakeRuntime()): Promise<{
  store: AssetStore
  service: ExperienceService
  embedding: ReturnType<typeof fakeEmbedding>
}> {
  const dir = await mkdtemp(join(tmpdir(), "vw-experience-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new AssetStore(dir, { now: () => 1_000 })
  await store.init()
  cleanups.push(async () => store.close())
  const embedding = fakeEmbedding()
  const service = new ExperienceService({
    store: storePortOf(store),
    runtime,
    embedding,
    now: () => 1_000,
  })
  return { store, service, embedding }
}

/** 一条合法候选（模型侧字段名：snake_case）。 */
function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responsibility: "对实际执行任务的正确性负责",
    task_type: "软件开发",
    decision_domain: "错误处理",
    situation: "依赖的修改可能失败",
    trigger: "准备依赖外部改动时",
    principle: "外部依赖失败必须与本地逻辑失败分开判断",
    recommended_action: "先确认依赖的失败语义再决定重试策略",
    exclusions: ["依赖被保证不可失败时"],
    evidence: ["一次依赖失败被误判为逻辑错误"],
    ...overrides,
  }
}

describe("经验闭环（真实资产库 + 真实经验域）", () => {
  it("test_父代理无运行_提交agent经验_以空来源入库而非被拒收", async () => {
    const { store, service } = await makeWorld()

    await service.initializePrompt({ caller: { isChild: false, sessionId: "session-1" }, type: "agent" })
    const result = await service.submit({
      caller: { isChild: false, sessionId: "session-1" },
      type: "agent",
      candidates: { experiences: [candidate()] },
    })

    expect(result.skipped).toEqual([])
    expect(result.inserted).toHaveLength(1)
    // 无运行来源时不得伪造 run id：空串是「没有来源」的显式表达（磁盘列 NOT NULL 允许空串）
    expect(result.inserted[0].sourceRunId).toBe("")
    expect((await store.listRows(10)).map((entry) => entry.active)).toEqual([true])
  })

  it("test_父代理无运行_生成Prompt缺失时_仍按必填拒收并回传字段名", async () => {
    const { store } = await makeWorld()
    const prompt = await store.getActivePrompt("agent")
    if (!prompt) throw new Error("缺少 agent 类型的活跃生成 Prompt")
    const row: ExperienceInsertRow = {
      id: store.nextId(),
      experienceType: "agent",
      responsibility: "职责",
      taskType: "软件开发",
      decisionDomain: "错误处理",
      situation: "情境",
      trigger: "信号",
      principle: "原则",
      recommendedAction: "行动",
      exclusions: [],
      evidence: [],
      taskRetrievalText: "task",
      taskEmbedding: new Float64Array([1, 0, 0]),
      decisionRetrievalText: "decision",
      decisionEmbedding: new Float64Array([0, 1, 0]),
      sourceRunId: "",
      // 故意缺 generationPromptId / generationPromptVersion
      generationPromptVersion: "",
    } as unknown as ExperienceInsertRow

    const result = await store.insertChecked({ rows: [row], duplicateOf: () => ({ duplicate: false }) })

    expect(result.inserted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain("generationPromptId")
    expect(prompt.id).toBeTruthy()
  })

  it("test_父代理承担编排_按运行事实写入orchestrator经验", async () => {
    const runtime = fakeRuntime({
      activeRunForSession: (sessionId) => ({ runId: "run-9", flowId: "flow-1", sessionId }),
      hasActiveRun: () => true,
    })
    const { service } = await makeWorld(runtime)

    await service.initializePrompt({ caller: { isChild: false, sessionId: "session-1" }, type: "orchestrator" })
    const result = await service.submit({
      caller: { isChild: false, sessionId: "session-1" },
      type: "orchestrator",
      candidates: [candidate()],
    })

    expect(result.inserted).toHaveLength(1)
    // 来源由运行事实给出，模型无法伪造
    expect(result.inserted[0].sourceRunId).toBe("run-9")
    expect(result.inserted[0].experienceType).toBe("orchestrator")
  })

  it("test_父代理承担编排_提交agent经验_以职责不符拒绝", async () => {
    const runtime = fakeRuntime({
      activeRunForSession: (sessionId) => ({ runId: "run-9", flowId: "flow-1", sessionId }),
      hasActiveRun: () => true,
    })
    const { service } = await makeWorld(runtime)

    await expect(
      service.initializePrompt({ caller: { isChild: false, sessionId: "session-1" }, type: "agent" }),
    ).rejects.toMatchObject({ code: ERR_EXPERIENCE_WRONG_TYPE })
  })

  it("test_子代理提交agent经验_来源取所属运行", async () => {
    const runtime = fakeRuntime({
      runForChild: (childId) => ({ runId: "run-child", flowId: "flow-1", sessionId: "session-1", nodeId: childId }),
      hasActiveRun: () => true,
    })
    const { service } = await makeWorld(runtime)
    const caller = { isChild: true, sessionId: "session-1", childId: "child-7" }

    await service.initializePrompt({ caller, type: "agent" })
    const result = await service.submit({ caller, type: "agent", candidates: [candidate()] })

    expect(result.inserted).toHaveLength(1)
    expect(result.inserted[0].sourceRunId).toBe("run-child")
  })

  it("test_同类型活跃经验语义重合_第二次提交被0.8阈值拦截", async () => {
    const { service, store } = await makeWorld()
    const caller = { isChild: false, sessionId: "session-1" }
    await service.initializePrompt({ caller, type: "agent" })

    const first = await service.submit({ caller, type: "agent", candidates: [candidate()] })
    expect(first.inserted).toHaveLength(1)

    // 语义字段不同但决策向量相同 → 属同一决策语义，必须被拦截（不新增第二条）
    const second = await service.submit({
      caller,
      type: "agent",
      candidates: [candidate({ responsibility: "另一个责任表述", situation: "另一个情境表述" })],
    })
    expect(second.inserted).toEqual([])
    expect(second.skipped).toHaveLength(1)
    expect(await store.listRows(10)).toHaveLength(1)
  })

  it("test_不同类型主体的经验_召回面互不可见", async () => {
    // 运行事实按会话区分：session-1 是编排管理者，session-2 未承担编排职责
    const runtime = fakeRuntime({
      activeRunForSession: (sessionId) => (sessionId === "session-1" ? { runId: "run-9", flowId: "flow-1", sessionId } : null),
      hasActiveRun: (sessionId) => sessionId === "session-1",
    })
    const { service } = await makeWorld(runtime)
    const caller = { isChild: false, sessionId: "session-1" }

    await service.initializePrompt({ caller, type: "orchestrator" })
    await service.submit({ caller, type: "orchestrator", candidates: [candidate()] })

    const recalled = await service.recall({ caller, type: "orchestrator", query: "错误处理" })
    expect(recalled.kind).toBe("candidates")
    if (recalled.kind !== "candidates") return
    expect(recalled.hits).toHaveLength(1)

    // agent 主体（未承担编排职责）的召回面不含刚写入的编排经验
    const agentCaller = { isChild: false, sessionId: "session-2" }
    const agentRecalled = await service.recall({ caller: agentCaller, type: "agent", query: "错误处理" })
    expect(agentRecalled.kind).toBe("candidates")
    if (agentRecalled.kind !== "candidates") return
    expect(agentRecalled.hits).toEqual([])
  })

  it("test_提交候选_嵌入在写入之前一次批量完成", async () => {
    const { service, embedding } = await makeWorld()
    const caller = { isChild: false, sessionId: "session-1" }
    await service.initializePrompt({ caller, type: "agent" })

    await service.submit({ caller, type: "agent", candidates: [candidate(), candidate({ task_type: "运维" })] })

    // 每条候选两个检索文本 → 两条候选共 4 个文本；单次 batch 调用即可
    expect(embedding.calls).toBe(1)
    expect(embedding.batches).toBe(4)
  })
})

// tests/host/assets/experiences.test.ts
//
// 经验的写读端口：批量判重写入（批内与库内判重、事务原子性、候选行非空校验）、
// 界面列表与按 id 召回、活跃向量读盘（BLOB 还原与损坏向量的降级）、
// 状态切换，以及编辑保存时的必填校验与检索字段重算。
//
// 判重算法由经验域注入，因此测试注入的是「按决策侧检索文本判等」这类最简单的判据：
// 资产库只对事务边界与写入事实负责，相似度阈值不在这里验证。

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  ExperienceDuplicateJudge,
  ExperienceInsertRow,
  ExperienceRetrievalUpdate,
} from "../../../src/host/shared/asset-types.js"
import { decodeEmbedding } from "../../../src/host/assets/embedding-blob.js"
import { asExperienceType, parseJsonArray } from "../../../src/host/assets/experience-codec.js"
import { AssetStore, EXPERIENCE_LIST_MAX_LIMIT } from "../../../src/host/assets/index.js"
import { experienceRow, keepAllJudge, makeStore, openRawDb, removeTempRoot, vector } from "./fixtures/asset-fixture.js"

/** 决策侧检索文本相同即视为重复（验证判重接入点，不验证相似度算法）。 */
const byDecisionText: ExperienceDuplicateJudge = (candidate, existing) =>
  candidate.decisionRetrievalText === existing.decisionRetrievalText
    ? { duplicate: true, reason: `决策侧检索文本与经验 ${existing.id} 重复` }
    : { duplicate: false }

/** 检索投影重算载荷构造器（默认值可整体覆盖）。 */
function retrieval(overrides: Partial<ExperienceRetrievalUpdate> = {}): ExperienceRetrievalUpdate {
  return {
    taskRetrievalText: "重算的任务侧检索文本",
    decisionRetrievalText: "重算的决策侧检索文本",
    taskEmbedding: vector(1, 2, 3),
    decisionEmbedding: vector(4, 5, 6),
    embeddingModel: "recomputed-embed",
    embeddingDimension: 3,
    ...overrides,
  }
}

/** 写入单行并断言成功，返回经验 id（多数用例的前置动作）。 */
async function insertOne(row: ExperienceInsertRow, judge: ExperienceDuplicateJudge = keepAllJudge): Promise<string> {
  const result = await store.insertChecked({ rows: [row], duplicateOf: judge })
  expect(result.skipped).toEqual([])
  expect(result.inserted).toHaveLength(1)
  return result.inserted[0].id
}

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

describe("经验 id 生成", () => {
  it("test_nextId_返回经验前缀且逐次不同", () => {
    const first = store.nextId()
    const second = store.nextId()

    expect(first).toMatch(/^ex-/)
    expect(second).toMatch(/^ex-/)
    expect(second).not.toBe(first)
  })
})

describe("经验批量判重写入", () => {
  it("test_写入_合法行_回读完整语义事实与出处", async () => {
    const row = experienceRow("ex-1")

    const result = await store.insertChecked({ rows: [row], duplicateOf: keepAllJudge })

    expect(result.skipped).toEqual([])
    expect(result.inserted).toHaveLength(1)
    expect(result.inserted[0]).toMatchObject({
      id: "ex-1",
      active: true,
      experienceType: "agent",
      responsibility: row.responsibility,
      taskType: row.taskType,
      decisionDomain: row.decisionDomain,
      situation: row.situation,
      trigger: row.trigger,
      principle: row.principle,
      recommendedAction: row.recommendedAction,
      exclusions: row.exclusions,
      evidence: row.evidence,
      taskRetrievalText: row.taskRetrievalText,
      decisionRetrievalText: row.decisionRetrievalText,
      embeddingModel: "test-embed",
      embeddingDimension: 3,
      sourceRunId: "run-1",
      generationPromptId: "ep-agent-v1",
      generationPromptVersion: "V1",
    })
    expect(result.inserted[0].createdAt).toBe(result.inserted[0].updatedAt)
  })

  it("test_写入_同一批内决策侧重复_仅入库第一条并回传原因", async () => {
    const duplicated = experienceRow("ex-2", { decisionRetrievalText: "同一决策侧检索文本" })

    const result = await store.insertChecked({
      rows: [experienceRow("ex-1", { decisionRetrievalText: "同一决策侧检索文本" }), duplicated],
      duplicateOf: byDecisionText,
    })

    expect(result.inserted.map((entry) => entry.id)).toEqual(["ex-1"])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain("重复")
    expect(result.skipped[0].experienceId).toBe("ex-1")
    expect(result.skipped[0].decisionRetrievalText).toBe("同一决策侧检索文本")
  })

  it("test_写入_与库中活跃行重复_跳过并指向库中行", async () => {
    await insertOne(experienceRow("ex-1", { decisionRetrievalText: "库中已有决策侧" }))

    const result = await store.insertChecked({
      rows: [experienceRow("ex-2", { decisionRetrievalText: "库中已有决策侧" })],
      duplicateOf: byDecisionText,
    })

    expect(result.inserted).toEqual([])
    expect(result.skipped[0].experienceId).toBe("ex-1")
  })

  it("test_写入_已归档行_不参与判重", async () => {
    await insertOne(experienceRow("ex-1", { decisionRetrievalText: "已归档决策侧" }))
    await store.setActive("ex-1", false)

    const result = await store.insertChecked({
      rows: [experienceRow("ex-2", { decisionRetrievalText: "已归档决策侧" })],
      duplicateOf: byDecisionText,
    })

    expect(result.inserted.map((entry) => entry.id)).toEqual(["ex-2"])
  })

  it("test_写入_不同主体类型同样文本_互不判重", async () => {
    const result = await store.insertChecked({
      rows: [
        experienceRow("ex-agent", { decisionRetrievalText: "跨主体相同文本" }),
        experienceRow("ex-team", { experienceType: "team", generationPromptId: "ep-team-v1", decisionRetrievalText: "跨主体相同文本" }),
      ],
      duplicateOf: byDecisionText,
    })

    expect(result.inserted.map((entry) => entry.id)).toEqual(["ex-agent", "ex-team"])
    expect(result.skipped).toEqual([])
  })

  it("test_写入_判重抛错_整批回滚不留半条", async () => {
    const throwingJudge: ExperienceDuplicateJudge = (candidate) => {
      if (candidate.decisionRetrievalText === "触发判重失败") throw new Error("判重服务不可用")
      return { duplicate: false }
    }

    await expect(
      store.insertChecked({
        rows: [experienceRow("ex-1"), experienceRow("ex-2", { decisionRetrievalText: "触发判重失败" })],
        duplicateOf: throwingJudge,
      }),
    ).rejects.toThrow("判重服务不可用")

    expect(await store.listRows(10)).toEqual([])
  })

  it("test_写入_必填语义字段为空_拒绝并列出缺失字段", async () => {
    const result = await store.insertChecked({
      rows: [experienceRow("ex-1", { principle: "   ", decisionDomain: "" })],
      duplicateOf: keepAllJudge,
    })

    expect(result.inserted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain("principle")
    expect(result.skipped[0].reason).toContain("decisionDomain")
    expect(await store.listRows(10)).toEqual([])
  })

  it("test_写入_空sourceRunId_可入库（无运行来源是显式事实）", async () => {
    const result = await store.insertChecked({
      rows: [experienceRow("ex-1", { sourceRunId: "  " })],
      duplicateOf: keepAllJudge,
    })

    expect(result.skipped).toEqual([])
    expect(result.inserted).toHaveLength(1)
    // 空白归一后落空串：读回与写入同值，「没有来源运行」不因空白差异变成两种事实
    expect(result.inserted[0].sourceRunId).toBe("")
    expect((await store.getRows(["ex-1"]))[0].sourceRunId).toBe("")
  })

  it("test_写入_生成Prompt出处为空_拒绝并回传字段名", async () => {
    const result = await store.insertChecked({
      rows: [experienceRow("ex-1", { generationPromptId: "  ", generationPromptVersion: "" })],
      duplicateOf: keepAllJudge,
    })

    expect(result.inserted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain("generationPromptId")
    expect(result.skipped[0].reason).toContain("generationPromptVersion")
    expect(await store.listRows(10)).toEqual([])
  })

  it("test_写入_空向量_落NULL且条目不含向量元信息", async () => {
    const result = await store.insertChecked({
      rows: [experienceRow("ex-1", { taskEmbedding: new Float64Array(0), decisionEmbedding: new Float64Array(0) })],
      duplicateOf: keepAllJudge,
    })

    const entry = result.inserted[0]
    expect(entry.embeddingModel).toBeUndefined()
    expect(entry.embeddingDimension).toBeUndefined()
    expect(await store.listActiveExperienceEmbeddings("agent")).toEqual([])

    const raw = await openRawDb(root)
    let stored: Record<string, unknown> | undefined
    try {
      stored = raw.prepare("SELECT task_embedding, decision_embedding FROM experiences WHERE id = 'ex-1'").get() as
        | Record<string, unknown>
        | undefined
    } finally {
      raw.close()
    }
    expect(stored).toMatchObject({ task_embedding: null, decision_embedding: null })
  })

  it("test_写入_向量含非有限值_拒绝整批", async () => {
    await expect(
      store.insertChecked({
        rows: [experienceRow("ex-1", { taskEmbedding: Float64Array.from([1, Number.NaN, 3]) })],
        duplicateOf: keepAllJudge,
      }),
    ).rejects.toMatchObject({ code: "WF_EXPERIENCE_BAD_ARGS" })
    expect(await store.listRows(10)).toEqual([])
  })
})

describe("活跃向量读盘（召回输入）", () => {
  it("test_读向量_双通道BLOB_还原为数值相同的Float64Array", async () => {
    await insertOne(experienceRow("ex-1"))

    const [item] = await store.listActiveExperienceEmbeddings("agent")

    expect(item.id).toBe("ex-1")
    expect(item.taskRetrievalText).toBe("资产库持久化 软件开发 并行开发 契约漂移")
    expect(Array.from(item.taskEmbedding)).toEqual([0.1, 0.2, 0.3])
    expect(item.decisionRetrievalText).toBe("共享契约冻结时机 先冻结契约 一次性脚本")
    expect(Array.from(item.decisionEmbedding)).toEqual([0.4, 0.5, 0.6])
  })

  it("test_读向量_按主体类型与活跃态过滤", async () => {
    await insertOne(experienceRow("ex-agent"))
    await insertOne(experienceRow("ex-team", { experienceType: "team", generationPromptId: "ep-team-v1" }))
    await insertOne(experienceRow("ex-archived"))
    await store.setActive("ex-archived", false)

    expect((await store.listActiveExperienceEmbeddings("agent")).map((item) => item.id)).toEqual(["ex-agent"])
    expect((await store.listActiveExperienceEmbeddings("team")).map((item) => item.id)).toEqual(["ex-team"])
  })

  it("test_读向量_维度与字节长度不符或长度非8倍数_跳过该行而不抛错", async () => {
    await insertOne(experienceRow("ex-ok"))
    await insertOne(experienceRow("ex-bad-dimension", { embeddingDimension: 4 }))
    await insertOne(experienceRow("ex-bad-bytes"))

    const raw = await openRawDb(root)
    try {
      raw.exec("UPDATE experiences SET decision_embedding = x'01020304050607' WHERE id = 'ex-bad-bytes'")
    } finally {
      raw.close()
    }

    expect((await store.listActiveExperienceEmbeddings("agent")).map((item) => item.id)).toEqual(["ex-ok"])
  })

  it("test_读向量_损坏向量_列表读仍返回该行且不含向量元信息", async () => {
    await insertOne(experienceRow("ex-bad-dimension", { embeddingDimension: 4 }))

    const [entry] = await store.listRows(10)

    expect(entry.decisionRetrievalText).toBe("共享契约冻结时机 先冻结契约 一次性脚本")
    expect(entry.embeddingModel).toBeUndefined()
    expect(entry.embeddingDimension).toBeUndefined()
  })

  it("test_编解码_非8字节倍数或维度不符_判定为无向量并给出原因", () => {
    expect(decodeEmbedding(new Uint8Array(7), null).vector).toBeNull()
    expect(decodeEmbedding(new Uint8Array(7), null).reason).toContain("8")
    expect(decodeEmbedding(new Uint8Array(24), 4).vector).toBeNull()
    expect(decodeEmbedding(new Uint8Array(24), 4).reason).toContain("维度")
    expect(decodeEmbedding(null, 3).vector).toBeNull()
    expect(Array.from(decodeEmbedding(new Uint8Array(new Float64Array([1.5, -2.5]).buffer), 2).vector ?? [])).toEqual([
      1.5, -2.5,
    ])
  })

  it("test_编解码_非二进制列与未知取值_降级读而不抛错", () => {
    expect(decodeEmbedding("不是字节", 3).vector).toBeNull()
    expect(decodeEmbedding(new Uint8Array(0), 3).vector).toBeNull()
    // CHECK 约束让损坏 JSON 与未知主体类型写不进库，这两条降级分支只能直接验证
    expect(parseJsonArray("不是 JSON")).toEqual([])
    expect(asExperienceType("bogus")).toBe("agent")
  })
})

describe("经验列表与按 id 召回", () => {
  it("test_列表_活跃与已归档一并返回且条目自带active标记", async () => {
    await insertOne(experienceRow("ex-first"))
    await insertOne(experienceRow("ex-second"))
    await store.setActive("ex-second", false)

    const rows = await store.listRows(10)

    expect(rows.map((entry) => [entry.id, entry.active])).toEqual([
      ["ex-second", false],
      ["ex-first", true],
    ])
  })

  it("test_列表_limit非正数或非数值_返回空列表且超上限被截断", async () => {
    await insertOne(experienceRow("ex-first"))
    await insertOne(experienceRow("ex-second"))

    expect(await store.listRows(0)).toEqual([])
    expect(await store.listRows(-1)).toEqual([])
    expect(await store.listRows(Number.NaN)).toEqual([])
    expect(await store.listRows(EXPERIENCE_LIST_MAX_LIMIT + 100)).toHaveLength(2)
    expect(await store.listRows(1)).toHaveLength(1)
  })

  it("test_按id召回_保持入参顺序且命中不到的略过", async () => {
    await insertOne(experienceRow("ex-first"))
    await insertOne(experienceRow("ex-second"))

    const rows = await store.getRows(["ex-second", "ex-缺失", "ex-first"])

    expect(rows.map((entry) => entry.id)).toEqual(["ex-second", "ex-first"])
    expect(rows[0].situation).toBe("两端并行开发同一份跨模块契约")
  })

  it("test_按id召回_空入参_返回空列表", async () => {
    expect(await store.getRows([])).toEqual([])
  })

  it("test_按id召回_仅活跃过滤_排除已归档", async () => {
    await insertOne(experienceRow("ex-archived"))
    await store.setActive("ex-archived", false)

    expect(await store.getRows(["ex-archived"], { activeOnly: true })).toEqual([])
    expect((await store.getRows(["ex-archived"])).map((entry) => entry.id)).toEqual(["ex-archived"])
  })
})

describe("经验状态切换", () => {
  it("test_归档_内容与创建时间不变仅刷新更新时间", async () => {
    const id = await insertOne(experienceRow("ex-1"))
    const before = (await store.getRows([id]))[0]

    const archived = await store.setActive(id, false)

    expect(archived.active).toBe(false)
    expect(archived.principle).toBe(before.principle)
    expect(archived.exclusions).toEqual(before.exclusions)
    expect(archived.createdAt).toBe(before.createdAt)
    expect(archived.updatedAt).toBeGreaterThan(before.updatedAt)
  })

  it("test_恢复_重新进入活跃召回面", async () => {
    const id = await insertOne(experienceRow("ex-1"))
    await store.setActive(id, false)

    const restored = await store.setActive(id, true)

    expect(restored.active).toBe(true)
    expect((await store.listActiveExperienceEmbeddings("agent")).map((item) => item.id)).toEqual([id])
  })

  it("test_状态切换_id不存在_抛经验不存在", async () => {
    await expect(store.setActive("ex-缺失", false)).rejects.toMatchObject({ code: "WF_EXPERIENCE_NOT_FOUND" })
  })
})

describe("经验编辑保存（重算检索投影，无版本）", () => {
  it("test_保存_语义字段与检索投影一并更新且createdAt不变", async () => {
    const id = await insertOne(experienceRow("ex-1"))
    const before = (await store.getRows([id]))[0]

    const updated = await store.updateFields(
      id,
      { principle: "改写后的原则", exclusions: ["不适用场景"] },
      retrieval({ decisionRetrievalText: "重算的决策侧检索文本" }),
    )

    expect(updated).toMatchObject({
      principle: "改写后的原则",
      exclusions: ["不适用场景"],
      responsibility: before.responsibility,
      taskRetrievalText: "重算的任务侧检索文本",
      decisionRetrievalText: "重算的决策侧检索文本",
      embeddingModel: "recomputed-embed",
      embeddingDimension: 3,
    })
    expect(updated.createdAt).toBe(before.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(before.updatedAt)
    expect((await store.listActiveExperienceEmbeddings("agent")).map((item) => Array.from(item.taskEmbedding))).toEqual([
      [1, 2, 3],
    ])
  })

  it("test_保存_null清空数组字段_与未提供区分", async () => {
    const id = await insertOne(experienceRow("ex-1"))

    const updated = await store.updateFields(id, { exclusions: null, evidence: null }, retrieval())

    expect(updated.exclusions).toEqual([])
    expect(updated.evidence).toEqual([])
    expect(updated.principle).toBe("共享契约先冻结再并行实现")
  })

  it("test_保存_必填字段被清空_拒绝且库中内容不变", async () => {
    const id = await insertOne(experienceRow("ex-1"))

    await expect(store.updateFields(id, { responsibility: "   " }, retrieval())).rejects.toMatchObject({
      code: "WF_EXPERIENCE_BAD_ARGS",
    })
    // 运行时 null 与空串同义：都表示「清空」，都必须被拒绝
    await expect(
      store.updateFields(id, { taskType: null as unknown as string }, retrieval()),
    ).rejects.toMatchObject({ code: "WF_EXPERIENCE_BAD_ARGS" })

    const [entry] = await store.getRows([id])
    expect(entry.responsibility).toBe("负责资产库的持久化事实")
    expect(entry.taskType).toBe("软件开发")
  })

  it("test_保存_向量含非有限值_拒绝且检索字段不变", async () => {
    const id = await insertOne(experienceRow("ex-1"))

    await expect(
      store.updateFields(id, { principle: "改写" }, retrieval({ decisionEmbedding: Float64Array.from([Number.NaN]) })),
    ).rejects.toMatchObject({ code: "WF_EXPERIENCE_BAD_ARGS" })

    const [entry] = await store.getRows([id])
    expect(entry.principle).toBe("共享契约先冻结再并行实现")
    expect(entry.decisionRetrievalText).toBe("共享契约冻结时机 先冻结契约 一次性脚本")
  })

  it("test_保存_id不存在_抛经验不存在", async () => {
    await expect(store.updateFields("ex-缺失", { principle: "改写" }, retrieval())).rejects.toMatchObject({
      code: "WF_EXPERIENCE_NOT_FOUND",
    })
  })
})

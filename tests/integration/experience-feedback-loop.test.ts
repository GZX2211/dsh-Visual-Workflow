// tests/integration/experience-feedback-loop.test.ts
//
// 经验评价闭环端到端集成测试（开发方案 §24、§30、§35、§36）：
//
//   Capture → Recall（候选摘要） → Usage（ids 显式注入） → Feedback → Evaluation
//           → Statistics → Trust → 下一次 Recall
//
// 为什么必须在真实资产库上跑：闭环的每一环都跨两处独立契约——经验域负责「主体解析 / 排序链 /
// 准入判定」，资产库负责「事务边界 / 统计重算 / 可重建性」。两侧单测都能过，但「候选阶段必须
// 只读」「ids 阶段才产生使用事实」「反馈写评价与重算统计同一笔事务」这三条只在真实装配下才成立。
//
// 嵌入端口用受控 fake（按关键词给出固定单位向量）：本测试要断言的是「信任只在语义相关性上做
// 有界修正」，因此相似度必须是我写死的数，而不能来自真实模型。
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
import type { ExperienceEntry, ExperienceStatsEntry } from "../../src/host/shared/asset-types.js"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 高相关向量（查询与目标重合时 cosine = 1）。 */
const HIGH_VECTOR = new Float64Array([1, 0])
/** 低相关向量（与 HIGH 的内积恰为 0.2，仍是单位向量）。 */
const LOW_VECTOR = new Float64Array([0.2, Math.sqrt(1 - 0.04)])

/** 关键词：带该词的文本一律映射为低相关向量，其余映射为高相关向量。 */
const LOW_KEYWORD = "低相关"
const HIGH_KEYWORD = "高相关"

/** 受控嵌入端口：向量只由关键词决定，使相似度成为测试里写死的常量。 */
function keywordEmbedding(): ExperienceEmbeddingPort & { batches: string[][] } {
  const batches: string[][] = []
  return {
    source: "local",
    dimension: 2,
    batches,
    async embed(texts: string[]): Promise<Float64Array[]> {
      batches.push([...texts])
      return texts.map((text) => (text.includes(LOW_KEYWORD) ? LOW_VECTOR : HIGH_VECTOR))
    },
  }
}

/** 运行事实端口替身：会话没有活跃运行（父代理此刻是执行主体）。 */
function fakeRuntime(overrides: Partial<ExperienceRuntimePort> = {}): ExperienceRuntimePort {
  return {
    activeRunForSession: () => null,
    runForChild: () => null,
    hasTeamInCurrentRun: () => false,
    hasActiveRun: () => false,
    modelForCaller: () => "test-model",
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
    recordUsage: (input) => store.recordUsage(input),
    listInjectedIds: (input) => store.listInjectedIds(input),
    insertEvaluationsChecked: (input) => store.insertEvaluationsChecked(input),
    getStats: (ids) => store.getStats(ids),
    rebuildStats: (input) => store.rebuildStats(input),
  }
}

/** 受控世界：真实资产库 + 真实经验域服务 + 可观察的告警。 */
interface LoopWorld {
  store: AssetStore
  service: ExperienceService
  warnings: string[]
}

/** 装配一套真实资产库与经验域服务（可选包装端口以制造失败路径）。 */
async function makeWorld(options: {
  runtime?: ExperienceRuntimePort
  wrapStore?: (port: ExperienceStorePort) => ExperienceStorePort
} = {}): Promise<LoopWorld> {
  const dir = await mkdtemp(join(tmpdir(), "vw-experience-loop-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new AssetStore(dir, { now: () => 1_000 })
  await store.init()
  cleanups.push(async () => store.close())
  const warnings: string[] = []
  const base = storePortOf(store)
  const service = new ExperienceService({
    store: options.wrapStore ? options.wrapStore(base) : base,
    runtime: options.runtime ?? fakeRuntime(),
    embedding: keywordEmbedding(),
    now: () => 1_000,
    logger: { warn: (message: string) => warnings.push(message) },
  })
  return { store, service, warnings }
}

/** 模型侧候选（九个语义字段；关键词同时进入任务侧与决策侧检索文本）。 */
function candidateOf(keyword: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responsibility: `对${keyword}情形的执行正确性负责`,
    task_type: "软件开发",
    decision_domain: `${keyword}的决策域`,
    situation: `${keyword}情形下需要判断前置条件是否稳定`,
    trigger: `准备处理${keyword}情形时`,
    principle: `${keyword}原则：前置条件未稳定时并行会放大返工`,
    recommended_action: `${keyword}行动：先建立显式完成闸门再并行`,
    exclusions: [`${keyword}不适用时`],
    evidence: [`一次${keyword}相关执行`],
    ...overrides,
  }
}

/** 一条满分正向评价（w = 1、v = 1，使期望值可用手算验证）。 */
function positiveEvaluation(experienceId: string): {
  experienceId: string
  fitScore: 1
  decisionEffect: 1
  informationGain: 1
  causalConfidence: 1
  evidence: string
} {
  return {
    experienceId,
    fitScore: 1,
    decisionEffect: 1,
    informationGain: 1,
    causalConfidence: 1,
    evidence: "该经验直接改变了本次并行/串行选择",
  }
}

/** 期望存在的经验行（缺失即测试装配错误，直接失败而不是让后续断言变得含糊）。 */
function requireEntry(entry: ExperienceEntry | undefined): ExperienceEntry {
  if (!entry) throw new Error("测试装配错误：期望经验行存在")
  return entry
}

/** 期望存在的统计行。 */
function requireStats(row: ExperienceStatsEntry | undefined): ExperienceStatsEntry {
  if (!row) throw new Error("测试装配错误：期望统计行存在")
  return row
}

/** 统计比较面（去掉记账时间：重建会刷新它，而其余字段必须逐字段一致）。 */
function statsShapeOf(row: ExperienceStatsEntry): Omit<ExperienceStatsEntry, "updatedAt"> {
  const { updatedAt: _ignored, ...rest } = row
  return rest
}

/** 提交两条经验并返回（高相关、低相关）。 */
async function seedTwoExperiences(service: ExperienceService): Promise<{ high: ExperienceEntry; low: ExperienceEntry }> {
  const caller = { isChild: false, sessionId: "session-1" }
  await service.initializePrompt({ caller, type: "agent" })
  const submitted = await service.submit({
    caller,
    type: "agent",
    candidates: { experiences: [candidateOf(HIGH_KEYWORD), candidateOf(LOW_KEYWORD)] },
  })
  return { high: requireEntry(submitted.inserted[0]), low: requireEntry(submitted.inserted[1]) }
}

describe("经验评价闭环（真实资产库 + 真实经验域）", () => {
  it("test_完整闭环_候选只读到显式注入到反馈到统计到再召回_各环节事实一致", async () => {
    const { store, service } = await makeWorld()
    const caller = { isChild: false, sessionId: "session-1" }
    const { high, low } = await seedTwoExperiences(service)

    // 1) 候选摘要阶段：只读、不产生使用事实（统计行仍不存在）
    const candidates = await service.recall({ caller, type: "agent", query: HIGH_KEYWORD })
    if (candidates.kind !== "candidates") throw new Error("query 阶段应返回候选摘要")
    expect(candidates.hits.map((hit) => hit.id)).toEqual([high.id, low.id])
    expect(await store.getStats([high.id])).toEqual([])

    // 2) ids 显式注入阶段：这才是「使用事实」边界
    const details = await service.recall({ caller, type: "agent", ids: [high.id] })
    if (details.kind !== "details") throw new Error("ids 阶段应返回完整条目")
    expect(details.entries.map((entry) => entry.id)).toEqual([high.id])
    const injected = requireStats((await store.getStats([high.id]))[0])
    expect(injected.recalledCount).toBe(1)
    // 冷启动：只有使用事实、还没有评价 → 质量信号为 0、信任保持中性
    expect(injected.usedCount).toBe(0)
    expect(injected.qualitySignal).toBe(0)
    expect(injected.trust).toBe(0.5)

    // 3) 反馈：只受理被显式注入过的经验，未使用的经验被跳过且文案不做补救引导
    const feedback = await service.feedback({
      caller,
      type: "agent",
      evaluations: [positiveEvaluation(high.id), positiveEvaluation(low.id)],
    })
    expect(feedback.accepted.map((entry) => entry.experienceId)).toEqual([high.id])
    expect(feedback.skipped.map((item) => item.experienceId)).toEqual([low.id])
    const reason = feedback.skipped[0]?.reason ?? ""
    expect(reason).toContain("没有使用的经验，不能评价")
    // 用户裁决：不得把「再补一次召回」变成评价的合法路径
    expect(reason).not.toContain("ids")
    expect(reason).not.toContain("再召回")
    expect(reason).not.toContain("重新召回")

    // 4) 统计：一次评价的折算值可手算（w = 1×1 = 1、v = 1×(0.5+0.5×1) = 1）
    const evaluated = requireStats((await store.getStats([high.id]))[0])
    expect(evaluated.usedCount).toBe(1)
    expect(evaluated.recalledCount).toBe(1)
    expect(evaluated.effectiveSampleCount).toBeCloseTo(1, 10)
    expect(evaluated.empiricalValue).toBeCloseTo(1 / 4, 10)
    expect(evaluated.stability).toBe(1)
    const evidenceStrength = 1 - Math.exp(-1 / 8)
    expect(evaluated.evidenceStrength).toBeCloseTo(evidenceStrength, 10)
    expect(evaluated.qualitySignal).toBeCloseTo(0.25 * evidenceStrength, 10)
    expect(evaluated.trust).toBeCloseTo(0.5 + 0.45 * 0.25 * evidenceStrength, 10)

    // 5) 经验本体不被反馈改动（评价只进历史与统计投影）
    const afterFeedback = requireEntry((await store.getRows([high.id], { activeOnly: false }))[0])
    expect(afterFeedback.principle).toBe(high.principle)
    expect(afterFeedback.recommendedAction).toBe(high.recommendedAction)
    expect(afterFeedback.decisionDomain).toBe(high.decisionDomain)
    expect(afterFeedback.updatedAt).toBe(high.updatedAt)

    // 6) 下一次召回：score 是「归一化相关性 × 有界信任修正」，排序按它决定
    const again = await service.recall({ caller, type: "agent", query: HIGH_KEYWORD })
    if (again.kind !== "candidates") throw new Error("query 阶段应返回候选摘要")
    const expectedHighScore = 1 * (1 + 0.2 * evaluated.qualitySignal)
    const expectedLowScore = 0.6 * (1 + 0.2 * 0)
    expect(again.hits[0]?.id).toBe(high.id)
    expect(again.hits[0]?.score).toBeCloseTo(expectedHighScore, 10)
    expect(again.hits[1]?.id).toBe(low.id)
    expect(again.hits[1]?.score).toBeCloseTo(expectedLowScore, 10)

    // 7) 全量重建必须与增量路径逐字段一致（统计是可重放的派生投影）
    const beforeRebuild = statsShapeOf(requireStats((await store.getStats([high.id]))[0]))
    await service.rebuildStats()
    const afterRebuild = statsShapeOf(requireStats((await store.getStats([high.id]))[0]))
    expect(afterRebuild).toEqual(beforeRebuild)
    // 重建的作用面是「全部经验行」：从未被使用/评价过的经验也获得中性统计行，
    // 使界面不会出现「有的经验有统计、有的没有」这种取决于是否跑过重建的差异。
    const lowAfterRebuild = requireStats((await store.getStats([low.id]))[0])
    expect(lowAfterRebuild.trust).toBe(0.5)
    expect(lowAfterRebuild.qualitySignal).toBe(0)
    expect(lowAfterRebuild.usedCount).toBe(0)
    expect(lowAfterRebuild.recalledCount).toBe(0)
  })

  it("test_高信任的低相关经验_不得击败同样被召回的高相关经验", async () => {
    const { store, service } = await makeWorld()
    const caller = { isChild: false, sessionId: "session-1" }
    const { high, low } = await seedTwoExperiences(service)

    // 让低相关经验积累五条满分评价（每次评价前都必须先显式注入它，才具备评价资格）
    for (let index = 0; index < 5; index += 1) {
      await service.recall({ caller, type: "agent", ids: [low.id] })
      await service.feedback({ caller, type: "agent", evaluations: [positiveEvaluation(low.id)] })
    }
    const lowStats = requireStats((await store.getStats([low.id]))[0])
    expect(lowStats.usedCount).toBe(5)
    expect(lowStats.trust).toBeGreaterThan(0.5)

    const recalled = await service.recall({ caller, type: "agent", query: HIGH_KEYWORD })
    if (recalled.kind !== "candidates") throw new Error("query 阶段应返回候选摘要")

    // 高相关且信任中性者仍然第一（§15：信任不是第二个召回轴）
    expect(recalled.hits[0]?.id).toBe(high.id)
    // 低相关高信任的得分被 ±20% 夹住：0.6 × (1 + 0.2×q) ≤ 0.6 × 1.2
    const lowHit = recalled.hits.find((hit) => hit.id === low.id)
    if (!lowHit) throw new Error("低相关经验应仍在候选池内")
    expect(lowHit.score).toBeGreaterThan(0.6)
    expect(lowHit.score).toBeLessThanOrEqual(0.6 * 1.2 + 1e-12)
  })

  it("test_使用事实写入失败_召回仍返回完整经验并按中性信任继续", async () => {
    const world = await makeWorld({
      wrapStore: (port) => ({
        ...port,
        recordUsage: async () => {
          throw new Error("使用事实表不可写")
        },
      }),
    })
    const caller = { isChild: false, sessionId: "session-1" }
    const { high } = await seedTwoExperiences(world.service)

    const details = await world.service.recall({ caller, type: "agent", ids: [high.id] })

    // §35：辅助路径失败不得让经验完全不可用
    if (details.kind !== "details") throw new Error("ids 阶段应返回完整条目")
    expect(details.entries.map((entry) => entry.id)).toEqual([high.id])
    expect(world.warnings.some((message) => message.includes("使用事实写入失败"))).toBe(true)
    // 降级不等于静默成功：这次注入确实没有留下使用事实
    expect(await world.store.getStats([high.id])).toEqual([])
  })

  it("test_统计读取失败_召回按信任中性继续并留下可诊断告警", async () => {
    const world = await makeWorld({
      wrapStore: (port) => ({
        ...port,
        getStats: async () => {
          throw new Error("统计表不可读")
        },
      }),
    })
    const caller = { isChild: false, sessionId: "session-1" }
    const { high } = await seedTwoExperiences(world.service)

    const recalled = await world.service.recall({ caller, type: "agent", query: HIGH_KEYWORD })

    if (recalled.kind !== "candidates") throw new Error("query 阶段应返回候选摘要")
    // 高相关经验的得分等于纯归一化相关性（cos = 1 → sim01 = 1），即信任修正为中性
    expect(recalled.hits[0]?.id).toBe(high.id)
    expect(recalled.hits[0]?.score).toBeCloseTo(1, 10)
    expect(world.warnings.some((message) => message.includes("经验统计读取失败"))).toBe(true)
  })
})

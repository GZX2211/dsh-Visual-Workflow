// tests/integration/experience-prompt-versioning.test.ts
//
// 提示词资产与经验生成协同的集成测试（真实 SQLite 资产库 + 真实 ExperienceService）：
// - 初始化取到当前活跃版本，经验行的 generation_prompt_id/version 记录该版本；
// - 保存新版本后，下一次初始化取到新正文，新经验记录新版本；
// - 回滚只移动 Active 指针：新经验回到旧版本，已落库经验保持生成时的版本不变。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../../src/host/assets/index.js'
import {
  ExperienceService,
  type ExperienceEmbeddingPort,
  type ExperienceRuntimePort,
  type ExperienceStorePort,
} from '../../src/host/experience/index.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 受控嵌入：决策侧文本含「第二/第三」时落到不同轴，保证判重结论可预测。 */
function fakeEmbedding(): ExperienceEmbeddingPort {
  return {
    source: 'local',
    dimension: 3,
    async ensureReady() {},
    async embed(texts: string[]): Promise<Float64Array[]> {
      return texts.map((text) => {
        if (text.includes('第二决策')) return new Float64Array([0, 1, 0])
        if (text.includes('第三决策')) return new Float64Array([0, 0, 1])
        return new Float64Array([1, 0, 0])
      })
    },
  }
}

function fakeRuntime(): ExperienceRuntimePort {
  return {
    activeRunForSession: () => null,
    runForChild: () => null,
    modelForCaller: () => '',
  }
}

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

async function makeWorld(): Promise<{ store: AssetStore; service: ExperienceService }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-experience-prompt-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new AssetStore(dir, { now: () => 1_000 })
  await store.init()
  cleanups.push(async () => store.close())
  const service = new ExperienceService({
    store: storePortOf(store),
    runtime: fakeRuntime(),
    embedding: fakeEmbedding(),
    now: () => 1_000,
  })
  return { store, service }
}

function candidate(decisionDomain: string): Record<string, unknown> {
  return {
    responsibility: '对实际执行任务的正确性负责',
    task_type: '软件开发',
    decision_domain: decisionDomain,
    situation: '提示词策略可能随版本变化',
    trigger: '准备生成经验时',
    principle: '经验必须记录生成时使用的提示词版本',
    recommended_action: '按当前活跃提示词生成经验并保留 provenance',
    exclusions: [],
    evidence: ['一次版本切换后的经验生成'],
  }
}

const caller = { isChild: false, sessionId: 'session-1' }

describe('提示词版本与经验 provenance 协同', () => {
  it('test_保存新版本与回滚_新经验记录对应版本且历史经验不变', async () => {
    const { store, service } = await makeWorld()

    // v1：初始化并生成第一条经验
    const v1 = await service.initializePrompt({ caller, type: 'agent' })
    expect(v1.prompt).toMatchObject({ id: 'ep-agent@1', promptVersion: 'V1' })
    await service.submit({ caller, type: 'agent', candidates: { experiences: [candidate('第一决策')] } })

    // v2：保存新正文后重新初始化，生成第二条经验
    await store.savePromptAssetVersion({ assetId: 'ep-agent', prompt: '第二版正文：优先记录可迁移原则' })
    const v2 = await service.initializePrompt({ caller, type: 'agent' })
    expect(v2.prompt).toMatchObject({ id: 'ep-agent@2', promptVersion: 'V2', prompt: expect.stringContaining('第二版正文') })
    await service.submit({ caller, type: 'agent', candidates: { experiences: [candidate('第二决策')] } })

    // 回滚到 v1：重新初始化后生成第三条经验
    await store.rollbackPromptAsset('ep-agent', 1)
    const rolled = await service.initializePrompt({ caller, type: 'agent' })
    expect(rolled.prompt).toMatchObject({ id: 'ep-agent@1', promptVersion: 'V1' })
    await service.submit({ caller, type: 'agent', candidates: { experiences: [candidate('第三决策')] } })

    const entries = await store.listRows(10)
    const provenance = entries
      .map((entry) => [entry.decisionDomain, entry.generationPromptId, entry.generationPromptVersion])
      .sort()
    expect(provenance).toEqual([
      ['第一决策', 'ep-agent@1', 'V1'],
      ['第三决策', 'ep-agent@1', 'V1'],
      ['第二决策', 'ep-agent@2', 'V2'],
    ])
  })
})

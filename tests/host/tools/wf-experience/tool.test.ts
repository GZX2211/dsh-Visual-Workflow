// tests/host/tools/wf-experience/tool.test.ts
//
// wf_experience（tool.ts）单测：注册面（experiences 参数 / 输出 schema / description W-03）与
// 经验入库语义（父代理专属 / 参数校验 / label 唯一性归并 / 只插入选中项 / custom 写入
// review_feedback / 未选中不入库 / 卡片取消映射 / 服务缺失 / 去重 skipped 透出）。

import { afterEach, describe, expect, it } from 'vitest'
import { WF_EXPERIENCE } from '../../../../src/host/shared/protocol.js'
import type { ExperienceDraft, ExperienceEntry } from '../../../../src/host/shared/asset-types.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { registerWfExperience, type WfExperienceHost } from '../../../../src/host/tools/wf-experience/tool.js'
import {
  childAgent,
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  rootAgent,
  start,
  type TestEnv,
} from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

/** 候选卡片答案（label 即 insight 文本）。 */
interface CardAnswer {
  answers: Array<{ id: string; selected: string[]; custom: string }>
}

/** fake 经验库：记录入库调用与草稿；可按「已存在键」预置 skipped（镜像 AssetStore 契约）。 */
class FakeAssets {
  calls: Array<{ drafts: ExperienceDraft[]; reviewedAt: number }> = []
  /** 预置的已存在键（`taskType\u0000insight`）：命中即 skipped。 */
  existing = new Set<string>()
  private seq = 0
  async insertExperiences(
    drafts: ExperienceDraft[],
    reviewedAt: number,
  ): Promise<{ inserted: ExperienceEntry[]; skipped: Array<{ insight: string; reason: string }> }> {
    this.calls.push({ drafts, reviewedAt })
    const inserted: ExperienceEntry[] = []
    const skipped: Array<{ insight: string; reason: string }> = []
    for (const draft of drafts) {
      const key = `${draft.taskType}\u0000${draft.insight}`
      if (this.existing.has(key)) {
        skipped.push({ insight: draft.insight, reason: '已存在同 task_type + insight 的经验' })
        continue
      }
      this.seq += 1
      this.existing.add(key)
      const extras = draft as ExperienceDraft & { reviewFeedback?: string }
      inserted.push({
        id: `ex-${this.seq}`,
        // 入库即活跃：经验没有版本控制，状态只有「活跃 / 已归档」两态
        active: true,
        reflectionPromptVersion: '1',
        taskType: draft.taskType,
        taskContext: draft.taskContext,
        insight: draft.insight,
        ...(draft.evidence ? { evidence: draft.evidence } : {}),
        ...(draft.sourceRunId ? { sourceRunId: draft.sourceRunId } : {}),
        ...(extras.reviewFeedback ? { reviewFeedback: extras.reviewFeedback } : {}),
        reviewedAt,
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
      })
    }
    return { inserted, skipped }
  }
}

interface Harness extends TestEnv {
  host: WfExperienceHost
  assets: FakeAssets
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 注册 wf_experience（`userQuestions: false` 用于缺服务用例）。 */
async function makeHarness(options: { userQuestions?: boolean } = {}): Promise<Harness> {
  const env = await makeEnv()
  const assets = new FakeAssets()
  const host: WfExperienceHost = {
    assets,
    getRootAgent: (sessionId) => env.agents.getRootAgent(sessionId),
    orchestrator: env.runtime,
    now: () => env.clock.now,
  }
  const disposeTools = registerTools(env, host, [registerWfExperience], options)
  return { ...env, host, assets, disposeTools }
}

/** 三条基线候选（第 3 条是第 1 条的语义重复：同 task_type + insight）。 */
function baseExperiences(): Array<Record<string, unknown>> {
  return [
    { task_type: '软件开发', task_context: '为桌面端应用补一个导出功能', insight: '单一职责节点比大节点更易续跑', evidence: '节点 A 失败后仅重跑 A' },
    { task_type: '软件开发', task_context: '为桌面端应用补一个导出功能', insight: '把数据校验前置给独立节点可减少返工', source_run_id: 'run-1' },
    { task_type: '软件开发', task_context: '同一条经验的另一种说法', insight: '单一职责节点比大节点更易续跑' },
  ]
}

describe('wf_experience 注册与 schema', () => {
  it('注册成功；disposer 注销全量生效（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_EXPERIENCE])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_EXPERIENCE)).toBe(true)
  })

  it('experiences 参数：数组必填、元素对象开放且必填三字段；不使用官方子集外的 minItems/maxItems', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    const experiences = (def.parameters.properties ?? {}).experiences as JsonSchemaNode
    expect(def.parameters.required).toEqual(['experiences'])
    expect(experiences.type).toBe('array')
    expect(experiences.minItems).toBeUndefined()
    expect(experiences.maxItems).toBeUndefined()
    const item = experiences.items as JsonSchemaNode
    expect(item.additionalProperties).toBe(true)
    expect(item.required).toEqual(['task_type', 'task_context', 'insight'])
  })

  it('输出 schema：inserted/skipped/selectedCount 必填且对象闭合', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_EXPERIENCE)!.output.schema as JsonSchemaNode
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['inserted', 'skipped', 'selectedCount'])
    const inserted = (schema.properties ?? {}).inserted as JsonSchemaNode
    expect(inserted.items).toMatchObject({ additionalProperties: false, required: ['id', 'taskType'] })
    const skipped = (schema.properties ?? {}).skipped as JsonSchemaNode
    expect(skipped.items).toMatchObject({ additionalProperties: false, required: ['insight', 'reason'] })
  })

  it('description 符合官方标准英文（W-03：英文主体、说明副作用与失败语义）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_EXPERIENCE)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    expect(description).toContain('WF_NOT_ROOT')
    expect(description).toContain('WF_BAD_ARGS')
    expect(description).toContain('multi-select card')
  })
})

describe('wf_experience 工具执行', () => {
  it('子代理调用被拒绝（WF_NOT_ROOT）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    await expect(def.execute({ experiences: baseExperiences() }, execOf(childAgent)))
      .rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })

  it('形状非法 / 条数为 0 / 超上限 / 必填为空 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    await expect(def.execute({}, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: 'x' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: [] }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: [null] }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: [{ task_type: '  ', task_context: 'c', insight: 'i' }] }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: [{ task_type: 't', task_context: '', insight: 'i' }] }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ experiences: [{ task_type: 't', task_context: 'c', insight: '   ' }] }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    const tooMany = Array.from({ length: 9 }, (_item, index) => ({ task_type: 't', task_context: `c${index}`, insight: `i${index}` }))
    await expect(def.execute({ experiences: tooMany }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    expect(h.assets.calls).toHaveLength(0)
  })

  it('userQuestions 服务缺失 → WF_NO_ASK_PROVIDER（未入库）', async () => {
    const h = await makeHarness({ userQuestions: false })
    await start(h)
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    await expect(def.execute({ experiences: baseExperiences() }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_NO_ASK_PROVIDER' })
    expect(h.assets.calls).toHaveLength(0)
  })

  it('根代理未激活 → WF_NO_ROOT_AGENT', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.roots.delete('session-1')
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    await expect(def.execute({ experiences: baseExperiences() }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_NO_ROOT_AGENT' })
  })

  it('卡片取消（ASK_ABORTED）→ WF_CANCELLED（未入库）', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.fail = Object.assign(new Error('卡片已关闭'), { code: 'ASK_ABORTED' })
    const def = h.tools.definitions.get(WF_EXPERIENCE)!
    await expect(def.execute({ experiences: baseExperiences() }, execOf(rootAgent)))
      .rejects.toMatchObject({ code: 'WF_CANCELLED' })
    expect(h.assets.calls).toHaveLength(0)
  })

  it('正常路径：只入库选中项，reviewedAt 与 custom 修改意见写入', async () => {
    const h = await makeHarness()
    await start(h)
    const entry = h.runtime.activeRunForSession('session-1')!
    entry.lastActiveAt = h.clock.now
    h.clock.now += 1000
    // 用户勾选第 1 条（与第 3 条语义重复，归并后同一 label）并补充修改意见
    h.questions.answer = {
      answers: [{ id: WF_EXPERIENCE, selected: ['单一职责节点比大节点更易续跑'], custom: '请把结论收窄到长流程场景' }],
    } satisfies CardAnswer
    const def = h.tools.definitions.get(WF_EXPERIENCE)!

    const result = await def.execute({ experiences: baseExperiences() }, execOf(rootAgent)) as {
      inserted: Array<{ id: string; taskType: string }>
      skipped: Array<{ insight: string; reason: string }>
      selectedCount: number
    }

    // 卡片：一个多选问题，label 唯一（3 条候选归并成 2 个选项）
    expect(h.questions.calls).toHaveLength(1)
    const question = (h.questions.calls[0].questions as Array<Record<string, unknown>>)[0]
    expect(question).toMatchObject({ id: WF_EXPERIENCE, multiSelect: true })
    const options = question.options as Array<{ label: string; description: string }>
    expect(options.map((option) => option.label)).toEqual([
      '单一职责节点比大节点更易续跑',
      '把数据校验前置给独立节点可减少返工',
    ])
    expect(options[0].description).toBe('软件开发｜为桌面端应用补一个导出功能')
    expect(h.questions.calls[0].agent).toEqual(h.host.getRootAgent('session-1'))

    // 只入库选中项；未选中的候选完全不落库
    expect(h.assets.calls).toHaveLength(1)
    const { drafts, reviewedAt } = h.assets.calls[0]
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      taskType: '软件开发',
      taskContext: '为桌面端应用补一个导出功能',
      insight: '单一职责节点比大节点更易续跑',
      evidence: '节点 A 失败后仅重跑 A',
    })
    expect((drafts[0] as ExperienceDraft & { reviewFeedback?: string }).reviewFeedback).toBe('请把结论收窄到长流程场景')
    expect(reviewedAt).toBe(h.clock.now)
    expect(result).toEqual({
      inserted: [{ id: 'ex-1', taskType: '软件开发' }],
      skipped: [],
      selectedCount: 1,
    })
    // 阻塞提问期间触碰空闲基准
    expect(entry.lastActiveAt).toBe(h.clock.now)
  })

  it('未选中任何项 → 不入库且返回空 inserted', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.answer = { answers: [{ id: WF_EXPERIENCE, selected: [], custom: '' }] } satisfies CardAnswer
    const def = h.tools.definitions.get(WF_EXPERIENCE)!

    const result = await def.execute({ experiences: baseExperiences() }, execOf(rootAgent))

    expect(result).toEqual({ inserted: [], skipped: [], selectedCount: 0 })
    expect(h.assets.calls).toHaveLength(0)
  })

  it('卡片无答案（答案为空数组）→ 同样不入库', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.answer = { answers: [] } satisfies CardAnswer
    const def = h.tools.definitions.get(WF_EXPERIENCE)!

    expect(await def.execute({ experiences: baseExperiences() }, execOf(rootAgent)))
      .toEqual({ inserted: [], skipped: [], selectedCount: 0 })
    expect(h.assets.calls).toHaveLength(0)
  })

  it('同 task_type + insight 已存在 → 出现在 skipped（透出未入库原因）', async () => {
    const h = await makeHarness()
    await start(h)
    h.assets.existing.add('软件开发\u0000单一职责节点比大节点更易续跑')
    h.questions.answer = {
      answers: [{ id: WF_EXPERIENCE, selected: ['单一职责节点比大节点更易续跑', '把数据校验前置给独立节点可减少返工'], custom: '' }],
    } satisfies CardAnswer
    const def = h.tools.definitions.get(WF_EXPERIENCE)!

    const result = await def.execute({ experiences: baseExperiences() }, execOf(rootAgent)) as {
      inserted: Array<{ id: string; taskType: string }>
      skipped: Array<{ insight: string; reason: string }>
      selectedCount: number
    }

    expect(result.inserted).toEqual([{ id: 'ex-1', taskType: '软件开发' }])
    expect(result.skipped).toEqual([{ insight: '单一职责节点比大节点更易续跑', reason: '已存在同 task_type + insight 的经验' }])
    expect(result.selectedCount).toBe(2)
  })

  it('自定义 question / header 透传到卡片；缺省时用中文默认问句', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.answer = { answers: [{ id: WF_EXPERIENCE, selected: [], custom: '' }] } satisfies CardAnswer
    const def = h.tools.definitions.get(WF_EXPERIENCE)!

    await def.execute({ experiences: baseExperiences(), question: '挑一条入库', header: '经验' }, execOf(rootAgent))
    expect((h.questions.calls[0].questions as Array<Record<string, unknown>>)[0]).toMatchObject({
      question: '挑一条入库',
      header: '经验',
    })

    await def.execute({ experiences: baseExperiences() }, execOf(rootAgent))
    expect((h.questions.calls[1].questions as Array<Record<string, unknown>>)[0]).toMatchObject({
      question: '请选择要入库的经验（可多选）',
      header: '经验入库',
    })
  })
})

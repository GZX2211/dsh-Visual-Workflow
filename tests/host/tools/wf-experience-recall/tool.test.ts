// tests/host/tools/wf-experience-recall/tool.test.ts
//
// wf_experience_recall 单测：两阶段调用（query 取候选摘要 / ids 取完整内容）、只读与无副作用、
// 摘要来自 domain 且工具不得重算、参数混用与形状非法一律 WF_EXPERIENCE_BAD_ARGS、
// 调用方身份与类型职责校验、以及召回失败的稳定归一口径。

import { afterEach, describe, expect, it } from 'vitest'
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_NOT_FOUND,
  ERR_EXPERIENCE_RECALL_FAILED,
  ERR_EXPERIENCE_WRONG_TYPE,
  WF_EXPERIENCE_RECALL,
} from '../../../../src/host/shared/protocol.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { MAX_RECALL_IDS } from '../../../../src/host/experience/constants.js'
import { registerWfExperienceRecall } from '../../../../src/host/tools/wf-experience-recall/tool.js'
import { modelFacingProblemOf } from '../../experience/fixtures/assertions.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import {
  childAgent,
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  rootAgent,
  type TestEnv,
} from '../fixtures/tool-harness.js'
import {
  experienceEntryFixture,
  FakeExperienceHost,
  recallHitFixture,
} from '../fixtures/experience-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: FakeExperienceHost
  disposeTools: () => void
}

async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host = new FakeExperienceHost()
  const disposeTools = registerTools(env, host, [registerWfExperienceRecall])
  return { ...env, host, disposeTools }
}

async function execute(h: Harness, args: Record<string, unknown>, agent: unknown = rootAgent): Promise<unknown> {
  const def = h.tools.definitions.get(WF_EXPERIENCE_RECALL)
  if (!def) throw new Error('wf_experience_recall 未注册')
  return await def.execute(args, execOf(agent))
}

/** 取执行失败的错误（含非 WfError）；WfError 额外校验模型可见面规范（稳定码写进 message + 英文）。 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  const reason = await promise.catch((error: unknown) => error)
  if (reason instanceof WfError) {
    const problem = modelFacingProblemOf(reason)
    if (problem !== null) throw new Error(problem)
  }
  return reason
}

function englishRatio(text: string): number {
  const letters = [...text].filter((ch) => /[A-Za-z ]/.test(ch)).length
  return letters / text.length
}

describe('wf_experience_recall：注册与 schema', () => {
  it('注册成功；disposer 注销全量生效', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_EXPERIENCE_RECALL])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_EXPERIENCE_RECALL)).toBe(true)
  })

  it('参数：type 必填（两值枚举）；query / ids / topK 可选', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_EXPERIENCE_RECALL)!
    expect(def.parameters.required).toEqual(['type'])
    const properties = def.parameters.properties ?? {}
    // 取值域是契约：断言两值集合（实现层与域层 EXPERIENCE_TYPES 同源，此处独立锁定）
    expect((properties.type as JsonSchemaNode).enum).toEqual(['agent', 'orchestrator'])
    expect((properties.query as JsonSchemaNode).type).toBe('string')
    expect((properties.ids as JsonSchemaNode).type).toBe('array')
    expect((properties.topK as JsonSchemaNode).type).toBe('integer')
  })

  it('输出 schema 宽松（不给宿主校验制造把成功调用变错误的机会）', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_EXPERIENCE_RECALL)!.output.schema as JsonSchemaNode
    expect(schema.additionalProperties).toBe(true)
    expect(schema.required).toBeUndefined()
  })

  it('description 为官方标准英文，说明阶段分工、候选排序与使用事实副作用', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_EXPERIENCE_RECALL)!.description
    expect(description.length).toBeGreaterThan(200)
    expect(description).not.toMatch(/[\u4e00-\u9fff]/)
    expect(englishRatio(description)).toBeGreaterThan(0.85)
    for (const code of [ERR_EXPERIENCE_WRONG_TYPE, ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_RECALL_FAILED]) {
      expect(description).toContain(code)
    }
    // 召回发生在任务开始或执行途中；使用经验后应在同一收尾阶段提交反馈
    expect(description).toContain('at the start of a task or while it is running')
    expect(description).toContain('final completion stage')
    expect(description).toContain('wf_experience_feedback')
    // 候选排序指引保留；内部信任修正幅度（±20%）不进模型可见面
    expect(description).toContain('relevance')
    expect(description).toContain('trust')
    expect(description).not.toContain('20%')
    // 工具分工说明已移出常驻面（属工具选择信息，由各工具自身描述承载）
    expect(description).not.toContain('wf_org_catalog')
    // ids 阶段会记录「这些经验被使用过」这一事实（副作用不得被描述成完全只读）
    expect(description).toContain('count as used')
  })
})

describe('wf_experience_recall：两阶段调用', () => {
  it('query 阶段：返回候选 [{id, score, summary, source}]，摘要与通道直接取 domain 结果', async () => {
    const h = await makeHarness()
    h.host.recallReply = {
      kind: 'candidates',
      hits: [recallHitFixture({ id: 'ex-7', score: 0.42, summary: 'domain 给出的摘要', source: 'bm25' })],
      source: 'bm25',
    }

    const result = await execute(h, { type: 'agent', query: '如何拆分长流程节点', topK: 3 })

    expect(result).toEqual({
      kind: 'candidates',
      hits: [{ id: 'ex-7', score: 0.42, summary: 'domain 给出的摘要', source: 'bm25' }],
      source: 'bm25',
    })
    expect(h.host.recallCalls).toEqual([
      { caller: { isChild: false, sessionId: 'session-1' }, type: 'agent', query: '如何拆分长流程节点', topK: 3 },
    ])
  })

  it('query 阶段无候选：返回空候选（只读工具不编造、不报错）', async () => {
    const h = await makeHarness()
    h.host.recallReply = { kind: 'candidates', hits: [], source: 'semantic' }

    expect(await execute(h, { type: 'agent', query: '从未学过的问题' }))
      .toEqual({ kind: 'candidates', hits: [], source: 'semantic' })
  })

  it('ids 阶段：返回完整经验条目', async () => {
    const h = await makeHarness()
    const entry = experienceEntryFixture({ id: 'ex-9' })
    h.host.recallReply = { kind: 'details', entries: [entry] }

    const result = await execute(h, { type: 'agent', ids: ['ex-9'] })

    expect(result).toEqual({ kind: 'details', entries: [entry] })
    expect(h.host.recallCalls[0].ids).toEqual(['ex-9'])
    expect(h.host.recallCalls[0].query).toBeUndefined()
  })

  it('ids 归一化：空白项跳过、重复项去重且保持模型给出的顺序', async () => {
    const h = await makeHarness()
    h.host.recallReply = { kind: 'details', entries: [] }

    await execute(h, { type: 'agent', ids: [' ex-2 ', '', 'ex-1', 'ex-2', '   '] })

    expect(h.host.recallCalls[0].ids).toEqual(['ex-2', 'ex-1'])
  })

  it('子代理召回：只允许 agent，并透传 childId', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'agent', query: '协作机制' }, childAgent)

    expect(h.host.recallCalls[0].caller).toEqual({ isChild: true, sessionId: 'session-1', childId: 'child-1' })
  })

  it('父代理召回 orchestrator 经验：工具层无门禁，类型原样透传', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'orchestrator', query: '编排策略' })

    expect(h.host.recallCalls[0]).toEqual({
      caller: { isChild: false, sessionId: 'session-1' },
      type: 'orchestrator',
      query: '编排策略',
    })
  })
})

describe('wf_experience_recall：参数与身份校验', () => {
  it('query 与 ids 混用 / 都不传 → WF_EXPERIENCE_BAD_ARGS（消息给出两阶段用法）', async () => {
    const h = await makeHarness()

    const mixed = await failureOf(execute(h, { type: 'agent', query: 'q', ids: ['ex-1'] }))
    expect((mixed as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    // 只断言消息指名了两个阶段参数（结构信息），不锁定整句文案
    expect((mixed as WfError).message).toContain('query')
    expect((mixed as WfError).message).toContain('ids')

    const neither = await failureOf(execute(h, { type: 'agent' }))
    expect((neither as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)

    const blank = await failureOf(execute(h, { type: 'agent', query: '   ', ids: ['  '] }))
    expect((blank as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)

    expect(h.host.recallCalls).toEqual([])
  })

  it('ids 非数组 → WF_EXPERIENCE_BAD_ARGS', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', ids: 'ex-1' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(h.host.recallCalls).toEqual([])
  })

  it('ids 超过条数上限 → WF_EXPERIENCE_BAD_ARGS（在抵达 domain 前拒绝并提示分批）', async () => {
    const h = await makeHarness()
    const oversized = Array.from({ length: MAX_RECALL_IDS + 1 }, (_, index) => `ex-${index}`)

    const failure = await failureOf(execute(h, { type: 'agent', ids: oversized }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as Error).message).toContain(`${MAX_RECALL_IDS}`)
    expect((failure as Error).message).toContain('batches')
    expect(h.host.recallCalls).toEqual([])
  })

  it('ids 恰好等于上限 → 正常召回', async () => {
    const h = await makeHarness()
    const atLimit = Array.from({ length: MAX_RECALL_IDS }, (_, index) => `ex-${index}`)

    await execute(h, { type: 'agent', ids: atLimit })

    expect(h.host.recallCalls[0]?.ids).toEqual(atLimit)
  })

  it('topK 非法（0 / 负数 / 非数字）→ WF_EXPERIENCE_BAD_ARGS', async () => {
    const h = await makeHarness()

    for (const topK of [0, -1, '3', Number.NaN]) {
      const failure = await failureOf(execute(h, { type: 'agent', query: 'q', topK }))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    }
    expect(h.host.recallCalls).toEqual([])
  })

  it('ids 阶段传 topK → WF_EXPERIENCE_BAD_ARGS（topK 只属于 query 阶段）', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', ids: ['ex-1'], topK: 5 }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(h.host.recallCalls).toEqual([])
  })

  it('type 缺失 / 非法 → WF_EXPERIENCE_BAD_ARGS', async () => {
    const h = await makeHarness()

    const missing = await failureOf(execute(h, { query: 'q' }))
    expect((missing as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)

    const invalid = await failureOf(execute(h, { type: 'worker', query: 'q' }))
    expect((invalid as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(h.host.recallCalls).toEqual([])
  })

  it('已退役的 team 取值 → WF_EXPERIENCE_BAD_ARGS（不再属于合法取值域，未抵达 domain）', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'team', query: 'q' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain('orchestrator')
    expect(h.host.recallCalls).toEqual([])
  })

  it('子代理声明非 agent 类型 → WF_EXPERIENCE_WRONG_TYPE（在抵达 domain 前就拒绝）', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'orchestrator', query: 'q' }, childAgent))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(h.host.recallCalls).toEqual([])
  })

  it('无法识别调用者会话 → WF_BAD_CALLER', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', query: 'q' }, { id: 'child-1', session: { header: { origin: 'subagent' } } }))

    expect((failure as WfError).code).toBe('WF_BAD_CALLER')
  })

  it('tools 服务不可用 → 注册显式失败（不静默跳过）', () => {
    expect(() => registerWfExperienceRecall({ get: () => undefined }, new FakeExperienceHost()))
      .toThrowError(/tools 服务不可用/)
  })
})

describe('wf_experience_recall：失败语义', () => {
  it('domain 抛稳定错误码：原样透传（码与消息都不改写）', async () => {
    const h = await makeHarness()
    const domainMessage = 'WF_EXPERIENCE_NOT_FOUND: experience ex-404 does not exist or has been cleaned up'
    h.host.recallFail = new WfError(domainMessage, ERR_EXPERIENCE_NOT_FOUND)

    const failure = await failureOf(execute(h, { type: 'agent', ids: ['ex-404'] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_NOT_FOUND)
    expect((failure as WfError).message).toBe(domainMessage)
  })

  it('非稳定错误的检索失败：归一为 WF_EXPERIENCE_RECALL_FAILED 并保留原始消息', async () => {
    const h = await makeHarness()
    h.host.recallFail = new Error('embedding index corrupted')

    const failure = await failureOf(execute(h, { type: 'agent', query: 'q' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_RECALL_FAILED)
    expect((failure as WfError).message).toContain('embedding index corrupted')
  })
})

// tests/host/tools/wf-experience-learn/tool.test.ts
//
// wf_experience_learn 单测：单工具双态（空集取生成 Prompt / 传候选入库）、调用方身份透传、
// 参数与错误码语义（错误码由 domain 决定时只做透传且不得伪装成功）、以及「未知字段必须
// 原样抵达 domain」这一验证点（工具层不得静默丢弃，否则 WF_EXPERIENCE_VALIDATION 永不触发）。

import { afterEach, describe, expect, it } from 'vitest'
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
  ERR_EXPERIENCE_NOT_INITIALIZED,
  ERR_EXPERIENCE_VALIDATION,
  ERR_EXPERIENCE_WRONG_TYPE,
  WF_EXPERIENCE_LEARN,
} from '../../../../src/host/shared/protocol.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { registerWfExperienceLearn } from '../../../../src/host/tools/wf-experience-learn/tool.js'
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
import { FakeExperienceHost } from '../fixtures/experience-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: FakeExperienceHost
  disposeTools: () => void
}

async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host = new FakeExperienceHost()
  const disposeTools = registerTools(env, host, [registerWfExperienceLearn])
  return { ...env, host, disposeTools }
}

/** 一条字段完整的候选（snake_case：模型侧入参）。 */
function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responsibility: '对交付物质量负责',
    task_type: '软件开发',
    decision_domain: '任务拆分',
    situation: '长流程中出现单点失败',
    trigger: '需要拆大节点时',
    principle: '单一职责节点比大节点更易续跑',
    recommended_action: '按可独立重跑的最小单元拆节点',
    exclusions: ['节点间强共享状态时'],
    evidence: ['节点 A 失败后只重跑了 A'],
    ...overrides,
  }
}

/** 调用工具执行体（未注册时抛错，避免断言落到 undefined 上）。 */
async function execute(h: Harness, args: Record<string, unknown>, agent: unknown = rootAgent): Promise<unknown> {
  const def = h.tools.definitions.get(WF_EXPERIENCE_LEARN)
  if (!def) throw new Error('wf_experience_learn 未注册')
  return await def.execute(args, execOf(agent))
}

/** 取执行失败的错误（含非 WfError）。 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.catch((reason: unknown) => reason)
}

/** 描述里英文字母与空格占比（官方标准英文提示词：英文散文为主，不夹中文说明）。 */
function englishRatio(text: string): number {
  const letters = [...text].filter((ch) => /[A-Za-z ]/.test(ch)).length
  return letters / text.length
}

describe('wf_experience_learn：注册与 schema', () => {
  it('注册成功；disposer 注销全量生效', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_EXPERIENCE_LEARN])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_EXPERIENCE_LEARN)).toBe(true)
  })

  it('参数：experiences 与 type 必填；候选对象开放（未知字段可抵达 domain，由 domain 拒绝）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_EXPERIENCE_LEARN)!
    expect(def.parameters.required).toEqual(['experiences', 'type'])
    const experiences = (def.parameters.properties ?? {}).experiences as JsonSchemaNode
    expect(experiences.type).toBe('array')
    expect(experiences.minItems).toBeUndefined()
    expect(experiences.maxItems).toBeUndefined()
    expect((experiences.items as JsonSchemaNode).additionalProperties).toBe(true)
    const type = (def.parameters.properties ?? {}).type as JsonSchemaNode
    expect(type.enum).toEqual(['agent', 'team', 'orchestrator'])
  })

  it('输出 schema 宽松（不给宿主校验制造把成功调用变错误的机会）', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_EXPERIENCE_LEARN)!.output.schema as JsonSchemaNode
    expect(schema.additionalProperties).toBe(true)
    expect(schema.required).toBeUndefined()
  })

  it('description 为官方标准英文，并说明前置条件、失败语义与「无值得保留的经验时跳过」', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_EXPERIENCE_LEARN)!.description
    expect(description.length).toBeGreaterThan(200)
    expect(description).not.toMatch(/[\u4e00-\u9fff]/)
    expect(englishRatio(description)).toBeGreaterThan(0.85)
    for (const code of [
      ERR_EXPERIENCE_NOT_INITIALIZED,
      ERR_EXPERIENCE_WRONG_TYPE,
      ERR_EXPERIENCE_VALIDATION,
      ERR_EXPERIENCE_BAD_ARGS,
      ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
    ]) {
      expect(description).toContain(code)
    }
    expect(description).toContain('do not submit')
  })
})

describe('wf_experience_learn：初始化态（空集取生成 Prompt）', () => {
  it('空数组 → 返回 active Prompt；不调用 submit', async () => {
    const h = await makeHarness()

    const result = await execute(h, { experiences: [], type: 'orchestrator' })

    expect(result).toEqual({
      kind: 'initialized',
      promptId: 'exp-orchestrator',
      promptVersion: 'V1',
      name: 'orchestrator experience prompt',
      prompt: 'PROMPT BODY FOR orchestrator',
      experienceType: 'orchestrator',
    })
    expect(h.host.initializeCalls).toEqual([{ caller: { isChild: false, sessionId: 'session-1' }, type: 'orchestrator' }])
    expect(h.host.submitCalls).toEqual([])
  })

  it('子代理初始化：只允许 agent，并透传 childId（domain 靠它定位所属运行）', async () => {
    const h = await makeHarness()

    const result = await execute(h, { experiences: [], type: 'agent' }, childAgent)

    expect(result).toMatchObject({ kind: 'initialized', experienceType: 'agent' })
    expect(h.host.initializeCalls).toEqual([
      { caller: { isChild: true, sessionId: 'session-1', childId: 'child-1' }, type: 'agent' },
    ])
  })

  it('重复初始化幂等：每次都由 domain 返回当前 active Prompt，工具不缓存', async () => {
    const h = await makeHarness()

    const first = await execute(h, { experiences: [], type: 'agent' })
    const second = await execute(h, { experiences: [], type: 'agent' })

    expect(second).toEqual(first)
    expect(h.host.initializeCalls).toHaveLength(2)
  })
})

describe('wf_experience_learn：提交态', () => {
  it('合法提交：snake_case 映射为 domain 草稿并入库，输出 inserted / skipped', async () => {
    const h = await makeHarness()
    h.host.skipped = [{ reason: '近似重复经验（相似度 0.91）', decisionRetrievalText: 'decision_domain: 任务拆分' }]

    const result = await execute(h, { experiences: [candidate()], type: 'agent' })

    expect(result).toEqual({
      kind: 'submitted',
      inserted: [{ id: 'ex-1', experienceType: 'agent' }],
      skipped: [{ reason: '近似重复经验（相似度 0.91）' }],
    })
    expect(h.host.submitCalls).toHaveLength(1)
    const call = h.host.submitCalls[0]
    expect(call.type).toBe('agent')
    expect(call.caller).toEqual({ isChild: false, sessionId: 'session-1' })
    expect(call.candidates).toEqual([
      {
        experienceType: 'agent',
        responsibility: '对交付物质量负责',
        taskType: '软件开发',
        decisionDomain: '任务拆分',
        situation: '长流程中出现单点失败',
        trigger: '需要拆大节点时',
        principle: '单一职责节点比大节点更易续跑',
        recommendedAction: '按可独立重跑的最小单元拆节点',
        exclusions: ['节点间强共享状态时'],
        evidence: ['节点 A 失败后只重跑了 A'],
      },
    ])
  })

  it('未知字段原样抵达 domain（工具层不得静默丢弃，否则 WF_EXPERIENCE_VALIDATION 永不触发）', async () => {
    const h = await makeHarness()
    h.host.submitFail = new WfError('候选含未知字段 insight', ERR_EXPERIENCE_VALIDATION)

    const failure = await failureOf(execute(h, { experiences: [candidate({ insight: '旧字段' })], type: 'agent' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_VALIDATION)
    const sent = h.host.submitCalls[0].candidates as Array<Record<string, unknown>>
    expect(sent).toHaveLength(1)
    expect(sent[0].insight).toBe('旧字段')
    expect(Object.hasOwn(sent[0], 'task_type')).toBe(false)
  })

  it('形状非法的候选元素原样抵达 domain（由 domain 报出可诊断的校验错误）', async () => {
    const h = await makeHarness()
    h.host.submitFail = new WfError('候选必须是对象', ERR_EXPERIENCE_VALIDATION)

    const failure = await failureOf(execute(h, { experiences: ['不是对象', null], type: 'agent' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(h.host.submitCalls[0].candidates).toEqual(['不是对象', null])
  })

  it('未取生成 Prompt 直接提交：透传 WF_EXPERIENCE_NOT_INITIALIZED（消息原样抵达模型），不产生入库结果', async () => {
    const h = await makeHarness()
    const guidance = '请先调用 wf_experience_learn 并传空 experiences 数组取得生成 Prompt'
    h.host.submitFail = new WfError(guidance, ERR_EXPERIENCE_NOT_INITIALIZED)

    const failure = await failureOf(execute(h, { experiences: [candidate()], type: 'agent' }))

    expect(failure).toBeInstanceOf(WfError)
    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_NOT_INITIALIZED)
    expect((failure as WfError).message).toBe(guidance)
    expect(h.host.submitCalls).toHaveLength(1)
  })

  it('语义嵌入不可用（退化 BM25）：透传 WF_EXPERIENCE_EMBEDDING_UNAVAILABLE，不伪装成功', async () => {
    const h = await makeHarness()
    h.host.submitFail = new WfError('嵌入服务退化到 BM25，未写入任何经验', ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)

    const failure = await failureOf(execute(h, { experiences: [candidate()], type: 'agent' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE)
  })

  it('多条候选按模型给出的顺序映射（数组顺序是语义）', async () => {
    const h = await makeHarness()

    await execute(h, { experiences: [candidate({ principle: 'P1' }), candidate({ principle: 'P2' })], type: 'team' })

    const sent = h.host.submitCalls[0].candidates as Array<Record<string, unknown>>
    expect(sent.map((item) => item.principle)).toEqual(['P1', 'P2'])
    expect(sent.map((item) => item.experienceType)).toEqual(['team', 'team'])
  })
})

describe('wf_experience_learn：参数与身份校验', () => {
  it('experiences 缺失 / 非数组 → WF_EXPERIENCE_BAD_ARGS，且不触碰 domain', async () => {
    const h = await makeHarness()

    for (const args of [{ type: 'agent' }, { experiences: 'x', type: 'agent' }, { experiences: null, type: 'agent' }]) {
      const failure = await failureOf(execute(h, args))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    }
    expect(h.host.initializeCalls).toEqual([])
    expect(h.host.submitCalls).toEqual([])
  })

  it('type 缺失 / 非法 → WF_EXPERIENCE_BAD_ARGS（消息给出合法取值）', async () => {
    const h = await makeHarness()

    const missing = await failureOf(execute(h, { experiences: [] }))
    expect((missing as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((missing as WfError).message).toContain('agent')

    const invalid = await failureOf(execute(h, { experiences: [], type: 'worker' }))
    expect((invalid as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(h.host.initializeCalls).toEqual([])
  })

  it('子代理声明非 agent 类型 → WF_EXPERIENCE_WRONG_TYPE（在抵达 domain 前就拒绝）', async () => {
    const h = await makeHarness()

    for (const type of ['team', 'orchestrator']) {
      const failure = await failureOf(execute(h, { experiences: [], type }, childAgent))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
      expect((failure as WfError).message).toContain('agent')
    }
    expect(h.host.initializeCalls).toEqual([])
  })

  it('父代理声明与自身职责不符的类型由 domain 裁决，工具只做透传', async () => {
    const h = await makeHarness()
    h.host.submitFail = new WfError('当前父代理正在承担编排职责，不能提交 agent 经验', ERR_EXPERIENCE_WRONG_TYPE)

    const failure = await failureOf(execute(h, { experiences: [candidate()], type: 'agent' }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect(h.host.submitCalls[0].type).toBe('agent')
  })

  it('无法识别调用者会话 → WF_BAD_CALLER', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { experiences: [], type: 'agent' }, childAgentWithoutParent))

    expect((failure as WfError).code).toBe('WF_BAD_CALLER')
  })

  it('tools 服务不可用 → 注册显式失败（不静默跳过）', () => {
    expect(() => registerWfExperienceLearn({ get: () => undefined }, new FakeExperienceHost()))
      .toThrowError(/tools 服务不可用/)
  })
})

/** 子代理 header 缺 parentSession：isChild 成立但会话不可识别。 */
const childAgentWithoutParent = { id: 'child-1', session: { header: { origin: 'subagent' } } }

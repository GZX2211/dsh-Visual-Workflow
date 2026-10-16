// tests/host/tools/wf-experience-feedback/tool.test.ts
//
// wf_experience_feedback 单测：模型侧 snake_case 评价 → 经验域入参的映射与 deterministic 校验
// （五级锚点、未知字段、条数上限、证据长度、重复 id）、调用方身份与类型职责校验、
// 域层稳定错误码透传与非稳定错误归一，以及 accepted / skipped 的模型可见投影
// （域层 provenance 不得回显、skipped 文案不得被改写或追加引导）。

import { afterEach, describe, expect, it } from 'vitest'
import {
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_FEEDBACK_FAILED,
  ERR_EXPERIENCE_WRONG_TYPE,
  WF_EXPERIENCE_FEEDBACK,
} from '../../../../src/host/shared/protocol.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { EVALUATION_EVIDENCE_LIMIT, MAX_EVALUATIONS_PER_CALL, renderAnchorGlossary } from '../../../../src/host/experience/index.js'
import { registerWfExperienceFeedback } from '../../../../src/host/tools/wf-experience-feedback/tool.js'
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
import { evaluationEntryFixture, FakeExperienceHost } from '../fixtures/experience-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: FakeExperienceHost
  disposeTools: () => void
}

async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host = new FakeExperienceHost()
  const disposeTools = registerTools(env, host, [registerWfExperienceFeedback])
  return { ...env, host, disposeTools }
}

/** 一条字段完整的评价（snake_case：模型侧入参）。 */
function evaluation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    experience_id: 'ex-1',
    fit: 0.75,
    decision_effect: 0.5,
    information_gain: 0.75,
    causal_confidence: 0.75,
    evidence: '该经验直接影响了并行/串行选择',
    ...overrides,
  }
}

async function execute(h: Harness, args: Record<string, unknown>, agent: unknown = rootAgent): Promise<unknown> {
  const def = h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)
  if (!def) throw new Error('wf_experience_feedback 未注册')
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

/** 描述里英文字母与空格占比（官方标准英文提示词：英文散文为主，不夹中文说明）。 */
function englishRatio(text: string): number {
  const letters = [...text].filter((ch) => /[A-Za-z ]/.test(ch)).length
  return letters / text.length
}

/** 子代理 header 缺 parentSession：isChild 成立但会话不可识别。 */
const childAgentWithoutParent = { id: 'child-1', session: { header: { origin: 'subagent' } } }

describe('wf_experience_feedback：注册与 schema', () => {
  it('test_注册_disposer注销全量生效', async () => {
    const h = await makeHarness()

    expect([...h.tools.definitions.keys()]).toEqual([WF_EXPERIENCE_FEEDBACK])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_EXPERIENCE_FEEDBACK)).toBe(true)
  })

  it('test_参数_type与evaluations必填_type为三值枚举', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)!
    const properties = def.parameters.properties ?? {}

    expect(def.parameters.required).toEqual(['type', 'evaluations'])
    // 取值域是契约：断言两值集合（实现层与域层 EXPERIENCE_TYPES 同源，此处独立锁定）
    expect((properties.type as JsonSchemaNode).enum).toEqual(['agent', 'orchestrator'])
    expect((properties.evaluations as JsonSchemaNode).type).toBe('array')
  })

  it('test_参数_评价项列出四维评分并开放元素（未知字段由执行期校验拒绝）', async () => {
    const h = await makeHarness()
    const evaluations = (h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)!.parameters.properties ?? {}).evaluations as JsonSchemaNode
    const item = evaluations.items as JsonSchemaNode
    const properties = item.properties ?? {}

    // 开放元素是既定范式（与 wf_experience_learn 同）：未知字段必须抵达执行期被明确拒绝，
    // 而不是在 schema 层被判成宿主错误、拿不到 WF_EXPERIENCE_BAD_ARGS 的修正信息。
    expect(item.additionalProperties).toBe(true)
    expect(Object.keys(properties).sort()).toEqual([
      'causal_confidence',
      'decision_effect',
      'evidence',
      'experience_id',
      'fit',
      'information_gain',
    ])
    // 锚点枚举是模型侧唯一可选的取值域（本体来自经验域常量，不在此复制）
    expect((properties.fit as JsonSchemaNode).enum).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect((properties.decision_effect as JsonSchemaNode).enum).toEqual([-1, -0.5, 0, 0.5, 1])
    expect((properties.information_gain as JsonSchemaNode).enum).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect((properties.causal_confidence as JsonSchemaNode).enum).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('test_输出schema宽松_不给宿主校验制造把成功调用变错误的机会', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)!.output.schema as JsonSchemaNode

    expect(schema.additionalProperties).toBe(true)
    expect(schema.required).toBeUndefined()
  })

  it('test_description_为官方标准英文并回答调用时机前置条件失败语义与副作用', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)!.description

    expect(description.length).toBeGreaterThan(200)
    expect(description).not.toMatch(/[\u4e00-\u9fff]/)
    expect(englishRatio(description)).toBeGreaterThan(0.85)
    for (const code of [ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_WRONG_TYPE, ERR_EXPERIENCE_FEEDBACK_FAILED]) {
      expect(description).toContain(code)
    }
    // 反馈与学习同属任务最终完成阶段；跨工具的阶段导航（召回时机等）不进本工具常驻面
    expect(description).toContain('wf_experience_learn')
    expect(description).toContain('wf_experience_recall')
    expect(description).toContain('final completion stage')
    expect(description).not.toContain('at the start of a task or while it is running')
    // 内部机制（统计重算、信任修正幅度）与「经验内容不被修改」等说明不进常驻面
    expect(description).not.toContain('±20%')
    expect(description).not.toContain('re-aggregate')
    // 不可逆后果须以行为指引的形式保留（提交前想清楚）
    expect(description).toContain('can never be edited or deleted')
  })

  it('test_评分标准按需召回_不再常驻在 description', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_EXPERIENCE_FEEDBACK)!.description

    // 锚点表是「评分规范」，只在评分那一刻需要：改为空数组按需召回，不再常驻
    expect(description).not.toContain(renderAnchorGlossary())
    expect(description).toContain('empty evaluations array')
    // 常驻 description 仍每次请求付费，保留数量级膨胀护栏（按需化后上限下调）
    expect(description.length).toBeLessThan(2000)
  })

  it('test_空数组取评分标准_返回四维逐级行为定义且不写库', async () => {
    const h = await makeHarness()
    const result = (await execute(h, { type: 'orchestrator', evaluations: [] })) as {
      kind: string
      scoringStandard: string
    }

    expect(result.kind).toBe('scoringStandard')
    // 判据本体来自经验域（工具层不另写一份定义文本）
    expect(result.scoringStandard).toBe(renderAnchorGlossary())
    for (const parameter of ['fit', 'decision_effect', 'information_gain', 'causal_confidence']) {
      expect(result.scoringStandard).toContain(parameter)
    }
    expect(result.scoringStandard).toContain('0.75 = ')
    expect(result.scoringStandard).toContain('-1 = ')
    // 取标准是只读动作：不触发任何评价写入
    expect(h.host.feedbackCalls).toHaveLength(0)
  })
})

describe('wf_experience_feedback：提交与映射', () => {
  it('test_合法提交_snake_case映射为域层camelCase并透传调用方与类型', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'orchestrator', evaluations: [evaluation()] })

    expect(h.host.feedbackCalls).toEqual([
      {
        caller: { isChild: false, sessionId: 'session-1' },
        type: 'orchestrator',
        evaluations: [
          {
            experienceId: 'ex-1',
            fitScore: 0.75,
            decisionEffect: 0.5,
            informationGain: 0.75,
            causalConfidence: 0.75,
            evidence: '该经验直接影响了并行/串行选择',
          },
        ],
      },
    ])
  })

  it('test_evidence缺省_不进入域层入参（由域层按空串解释）', async () => {
    const h = await makeHarness()
    const args = evaluation()
    delete args.evidence

    await execute(h, { type: 'agent', evaluations: [args] })

    expect(h.host.feedbackCalls[0].evaluations[0]).toEqual({
      experienceId: 'ex-1',
      fitScore: 0.75,
      decisionEffect: 0.5,
      informationGain: 0.75,
      causalConfidence: 0.75,
    })
    expect(Object.hasOwn(h.host.feedbackCalls[0].evaluations[0], 'evidence')).toBe(false)
  })

  it('test_决策效果负锚点_原样透传（跨零维度不得被工具层裁剪）', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'agent', evaluations: [evaluation({ decision_effect: -1 }), evaluation({ experience_id: 'ex-2', decision_effect: -0.5 })] })

    expect(h.host.feedbackCalls[0].evaluations.map((item) => item.decisionEffect)).toEqual([-1, -0.5])
  })

  it('test_experienceId两端空白_归一后透传（同一 id 不因空白产生第二种身份）', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'agent', evaluations: [evaluation({ experience_id: '  ex-1  ' })] })

    expect(h.host.feedbackCalls[0].evaluations[0].experienceId).toBe('ex-1')
  })

  it('test_多条评价_保持模型给出的顺序', async () => {
    const h = await makeHarness()

    await execute(h, {
      type: 'agent',
      evaluations: [evaluation({ experience_id: 'ex-3' }), evaluation({ experience_id: 'ex-1' }), evaluation({ experience_id: 'ex-2' })],
    })

    expect(h.host.feedbackCalls[0].evaluations.map((item) => item.experienceId)).toEqual(['ex-3', 'ex-1', 'ex-2'])
  })

  it('test_accepted_只投影已记录评分_不回显域层provenance', async () => {
    const h = await makeHarness()
    h.host.feedbackAccepted = [evaluationEntryFixture({ experienceId: 'ex-7', fitScore: 0.25, decisionEffect: -0.5, informationGain: 0, causalConfidence: 1 })]

    const result = await execute(h, { type: 'agent', evaluations: [evaluation({ experience_id: 'ex-7' })] })

    expect(result).toEqual({
      accepted: [
        { experienceId: 'ex-7', fitScore: 0.25, decisionEffect: -0.5, informationGain: 0, causalConfidence: 1 },
      ],
      skipped: [],
    })
  })

  it('test_skipped_逐字透传域层原因且不追加引导语', async () => {
    const h = await makeHarness()
    const reason = 'an experience that was not used cannot be rated'
    h.host.feedbackAccepted = []
    h.host.feedbackSkipped = [{ experienceId: 'ex-9', reason }]

    const result = await execute(h, { type: 'agent', evaluations: [evaluation({ experience_id: 'ex-9' })] })

    expect(result).toEqual({ accepted: [], skipped: [{ experienceId: 'ex-9', reason }] })
    // 工具层不得补上「先召回再评价」这类引导：跳过是域层的准入结论，不是调用姿势提示
    expect((result as { skipped: Array<{ reason: string }> }).skipped[0].reason).not.toContain('wf_experience_recall')
  })

  it('test_子代理调用_透传childId（域层靠它定位所属运行）', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'agent', evaluations: [evaluation()] }, childAgent)

    expect(h.host.feedbackCalls[0].caller).toEqual({ isChild: true, sessionId: 'session-1', childId: 'child-1' })
  })
})

describe('wf_experience_feedback：锚点与参数校验', () => {
  it('test_评分非锚点_确定性拒绝且不触碰域层', async () => {
    const h = await makeHarness()
    const cases: Array<[string, unknown]> = [
      ['fit', 0.73],
      ['fit', '0.75'],
      ['fit', 1.25],
      ['decision_effect', 0.3],
      ['decision_effect', -0.75],
      ['information_gain', -0.25],
      ['information_gain', null],
      ['causal_confidence', true],
      ['causal_confidence', 2],
    ]

    for (const [field, value] of cases) {
      const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ [field]: value })] }))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
      expect((failure as WfError).message).toContain(`.${field}`)
    }
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_评分缺字段_拒绝并指出该字段（缺失与非法同一条判据）', async () => {
    const h = await makeHarness()
    const args = evaluation()
    delete args.decision_effect

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [args] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain('.decision_effect')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_锚点错误消息_列出全部合法锚点（模型可据此自我修正）', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ fit: 0.73 })] }))
    const message = (failure as WfError).message

    for (const anchor of ['0', '0.25', '0.5', '0.75', '1']) {
      expect(message).toContain(anchor)
    }
    expect(message).toContain('0.73')
  })

  it('test_未知字段_拒绝而不是静默丢弃', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ utility: 0.83, insight: '旧字段' })] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain('utility')
    expect((failure as WfError).message).toContain('insight')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_条数超限_拒绝并在消息中给出上限与实际条数', async () => {
    const h = await makeHarness()
    const tooMany = Array.from({ length: MAX_EVALUATIONS_PER_CALL + 1 }, (_, index) => evaluation({ experience_id: `ex-${index}` }))

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: tooMany }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain(String(MAX_EVALUATIONS_PER_CALL))
    expect((failure as WfError).message).toContain(String(MAX_EVALUATIONS_PER_CALL + 1))
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_条数恰好等于上限_受理（边界不误伤）', async () => {
    const h = await makeHarness()
    const atLimit = Array.from({ length: MAX_EVALUATIONS_PER_CALL }, (_, index) => evaluation({ experience_id: `ex-${index}` }))

    await execute(h, { type: 'agent', evaluations: atLimit })

    expect(h.host.feedbackCalls[0].evaluations).toHaveLength(MAX_EVALUATIONS_PER_CALL)
  })

  it('test_evaluations非数组_拒绝且不产生空写入（空数组是取评分标准路径，不在此列）', async () => {
    const h = await makeHarness()
    const cases: unknown[] = [undefined, null, 'ex-1', {}, [[]]]

    for (const evaluations of cases) {
      const failure = await failureOf(execute(h, { type: 'agent', evaluations }))
      expect((failure as WfError).code, `非数组入参：${String(evaluations)}`).toBe(ERR_EXPERIENCE_BAD_ARGS)
    }
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_评价元素非对象_拒绝并指出下标', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ experience_id: 'ex-1' }), '不是对象'] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain('evaluations[1]')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_experience_id为非空字符串校验_缺失空白或非字符串_拒绝', async () => {
    const h = await makeHarness()
    const cases: unknown[] = [undefined, '', '   ', 7, null, { id: 'ex-1' }]

    for (const experienceId of cases) {
      const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ experience_id: experienceId })] }))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
      expect((failure as WfError).message).toContain('experience_id')
    }
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_同一次调用内重复experience_id_拒绝（含两端空白造成的重复）', async () => {
    const h = await makeHarness()

    const duplicate = await failureOf(execute(h, {
      type: 'agent',
      evaluations: [evaluation({ experience_id: 'ex-1' }), evaluation({ experience_id: 'ex-1' })],
    }))
    expect((duplicate as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((duplicate as WfError).message).toContain('ex-1')

    const blankDuplicate = await failureOf(execute(h, {
      type: 'agent',
      evaluations: [evaluation({ experience_id: 'ex-1' }), evaluation({ experience_id: ' ex-1 ' })],
    }))
    expect((blankDuplicate as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_evidence非字符串或超长_拒绝；恰好等于上限时受理', async () => {
    const h = await makeHarness()

    for (const evidence of [7, ['事实'], { text: '事实' }]) {
      const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation({ evidence })] }))
      expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
      expect((failure as WfError).message).toContain('evidence')
    }

    const overlong = await failureOf(execute(h, {
      type: 'agent',
      evaluations: [evaluation({ evidence: 'x'.repeat(EVALUATION_EVIDENCE_LIMIT + 1) })],
    }))
    expect((overlong as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((overlong as WfError).message).toContain(String(EVALUATION_EVIDENCE_LIMIT))
    expect(h.host.feedbackCalls).toEqual([])

    await execute(h, { type: 'agent', evaluations: [evaluation({ evidence: 'x'.repeat(EVALUATION_EVIDENCE_LIMIT) })] })
    expect(h.host.feedbackCalls[0].evaluations[0].evidence).toHaveLength(EVALUATION_EVIDENCE_LIMIT)
  })
})

describe('wf_experience_feedback：身份与失败语义', () => {
  it('test_type缺失或非法_拒绝且不触碰域层', async () => {
    const h = await makeHarness()

    const missing = await failureOf(execute(h, { evaluations: [evaluation()] }))
    expect((missing as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)

    const invalid = await failureOf(execute(h, { type: 'worker', evaluations: [evaluation()] }))
    expect((invalid as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((invalid as WfError).message).toContain('agent')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_已退役的team取值_拒绝且不触碰域层', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'team', evaluations: [evaluation()] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toContain('orchestrator')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_父代理提交orchestrator评价_工具层无门禁原样透传', async () => {
    const h = await makeHarness()

    await execute(h, { type: 'orchestrator', evaluations: [evaluation()] })

    expect(h.host.feedbackCalls[0].type).toBe('orchestrator')
    expect(h.host.feedbackCalls[0].caller).toEqual({ isChild: false, sessionId: 'session-1' })
  })

  it('test_子代理声明非agent类型_在抵达域层前拒绝', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'orchestrator', evaluations: [evaluation()] }, childAgent))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect((failure as WfError).message).toContain('agent')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_无法识别调用者会话_返回WF_BAD_CALLER', async () => {
    const h = await makeHarness()

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation()] }, childAgentWithoutParent))

    expect((failure as WfError).code).toBe('WF_BAD_CALLER')
    expect(h.host.feedbackCalls).toEqual([])
  })

  it('test_域层稳定错误码_原样透传码与消息', async () => {
    const h = await makeHarness()
    const message = 'WF_EXPERIENCE_WRONG_TYPE: the selected type does not match what the caller is doing right now'
    h.host.feedbackFail = new WfError(message, ERR_EXPERIENCE_WRONG_TYPE)

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation()] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_WRONG_TYPE)
    expect((failure as WfError).message).toBe(message)
  })

  it('test_域层透出的WF_EXPERIENCE_BAD_ARGS_原样透传', async () => {
    const h = await makeHarness()
    const domainMessage = 'WF_EXPERIENCE_BAD_ARGS: evaluations must not be empty'
    h.host.feedbackFail = new WfError(domainMessage, ERR_EXPERIENCE_BAD_ARGS)

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation()] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_BAD_ARGS)
    expect((failure as WfError).message).toBe(domainMessage)
  })

  it('test_非稳定错误_归一为FEEDBACK_FAILED并保留原始消息', async () => {
    const h = await makeHarness()
    h.host.feedbackFail = new Error('feedback table write failed: database is locked')

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation()] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_FEEDBACK_FAILED)
    expect((failure as WfError).message).toContain('feedback table write failed: database is locked')
  })

  it('test_域层已抛FEEDBACK_FAILED_不再二次包裹', async () => {
    const h = await makeHarness()
    const message = 'WF_EXPERIENCE_FEEDBACK_FAILED: the evaluation was not written; retry later'
    h.host.feedbackFail = new WfError(message, ERR_EXPERIENCE_FEEDBACK_FAILED)

    const failure = await failureOf(execute(h, { type: 'agent', evaluations: [evaluation()] }))

    expect((failure as WfError).code).toBe(ERR_EXPERIENCE_FEEDBACK_FAILED)
    expect((failure as WfError).message).toBe(message)
  })

  it('test_tools服务不可用_注册显式失败', () => {
    expect(() => registerWfExperienceFeedback({ get: () => undefined }, new FakeExperienceHost()))
      .toThrowError(/tools 服务不可用/)
  })
})

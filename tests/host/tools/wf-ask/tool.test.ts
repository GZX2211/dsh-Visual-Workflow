// tests/host/tools/wf-ask/tool.test.ts
//
// wf_ask（tool.ts）单测：注册面（questions 参数/answers 输出 schema/description W-03）与
// 子代理提问语义（WF_NOT_CHILD / 运行态校验 / 参数归一化 / 官方 ask 调用形状 / 取消映射）。

import { afterEach, describe, expect, it } from 'vitest'
import { WF_ASK } from '../../../../src/host/shared/protocol.js'
import type { WfToolsHost } from '../../../../src/host/tools/infrastructure/caller.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { registerWfAsk } from '../../../../src/host/tools/wf-ask/tool.js'
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

interface Harness extends TestEnv {
  host: WfToolsHost
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 注册 wf_ask（`userQuestions: false` 用于缺服务用例）。 */
async function makeHarness(options: { userQuestions?: boolean } = {}): Promise<Harness> {
  const env = await makeEnv()
  const host: WfToolsHost = { orchestrator: env.runtime, getRootAgent: (sid) => env.agents.getRootAgent(sid) }
  const disposeTools = registerTools(env, host, [registerWfAsk], options)
  return { ...env, host, disposeTools }
}

describe('wf_ask 注册与 schema', () => {
  it('注册成功；disposer 注销全量生效（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_ASK])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_ASK)).toBe(true)
  })

  it('questions 参数：数组必填、选项对象 open，且不使用官方子集外的 minItems', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK)!
    const questions = (def.parameters.properties ?? {}).questions as JsonSchemaNode
    expect(def.parameters.required).toEqual(['questions'])
    expect(questions.type).toBe('array')
    // 【0.1.5-rc.1】官方 tools 的受支持 JSON Schema 子集为
    // type/oneOf/properties/required/additionalProperties/items/enum/const + 注解，
    // 不含 minItems/maxItems（register 只校验 output.schema，故此处不报错，但属非子集关键字）。
    // 「至少一条问题」的约束由 execute 运行时校验承担（见「空 questions → WF_BAD_ARGS」用例）。
    expect(questions.minItems).toBeUndefined()
    const item = questions.items as JsonSchemaNode
    expect(item.additionalProperties).toBe(true)
    expect(item.required).toEqual(['id', 'question'])
  })

  it('answers 输出：数组必填、元素声明 additionalProperties=false，数组本身无 required', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_ASK)!.output.schema as JsonSchemaNode
    const answers = (schema.properties ?? {}).answers as JsonSchemaNode
    expect(answers.type).toBe('array')
    expect(answers.required).toBeUndefined() // required 只出现在对象属性上，数组本身不参与
    expect(answers.items).toMatchObject({ additionalProperties: false, required: ['id', 'selected'] })
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_ASK)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(130)
  })
})

describe('wf_ask 工具执行', () => {
  it('根 Agent 调用被拒绝（WF_NOT_CHILD）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NOT_CHILD' })
  })

  it('子代理调用但无运行 → WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('运行已暂停 → 无激活运行（WF_NO_ACTIVE_RUN；暂停下无子代理可提问）', async () => {
    const h = await makeHarness()
    await start(h)
    h.runtime.activeRunForSession('session-1')!.snapshot.status = 'paused'
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('空 questions → WF_BAD_ARGS（schema 不含 minItems，约束由运行时承担）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({}, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ questions: [] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    // 全空 question 文本 → 同样拒绝
    await expect(def.execute({ questions: [{ id: 'q1', question: '  ' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('正常路径：以父 root 身份调用官方 ask，返回 answers，触碰空闲基准', async () => {
    const h = await makeHarness()
    await start(h)
    const entry = h.runtime.activeRunForSession('session-1')!
    entry.lastActiveAt = h.clock.now // 固定基准
    const def = h.tools.definitions.get(WF_ASK)!
    h.clock.now += 1000
    const result = await def.execute(
      { questions: [{ id: 'q1', question: '继续？', header: '确认', options: [{ label: '是' }, { label: '' }], multi_select: false }] },
      execOf(childAgent),
    )
    expect(result).toEqual({ answers: [{ id: 'q1', selected: ['是'], custom: '' }] })
    expect(h.questions.calls).toHaveLength(1)
    const call = h.questions.calls[0]
    // 规范化：空 label 选项剔除、header 保留、multi_select=false 时不注入 multiSelect
    expect(call.questions).toEqual([
      { id: 'q1', question: '继续？', header: '确认', options: [{ label: '是' }] },
    ])
    // agent 必须是父 root（精确存活 root 身份）
    expect(call.agent).toEqual(h.host.getRootAgent('session-1'))
    // 组合信号存在（运行 controller ∪ 调用方）
    expect(call.signal).toBeDefined()
    // 空闲基准被触碰
    expect(entry.lastActiveAt).toBe(h.clock.now)
  })

  it('id 缺省回退 q<index>；多选映射 multiSelect: true', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await def.execute({ questions: [{ question: 'A' }, { id: 'q9', question: 'B', multi_select: true }] }, execOf(childAgent))
    const normalized = h.questions.calls[0].questions as Array<Record<string, unknown>>
    expect(normalized[0].id).toBe('q0')
    expect(normalized[1]).toMatchObject({ id: 'q9', multiSelect: true })
  })

  it('官方 ASK_ABORTED → 映射为 WF_CANCELLED', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.fail = Object.assign(new Error('提问已取消'), { code: 'ASK_ABORTED' })
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })

  it('userQuestions 服务缺失 → 明确错误', async () => {
    const h = await makeHarness({ userQuestions: false })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ASK_PROVIDER' })
  })
})

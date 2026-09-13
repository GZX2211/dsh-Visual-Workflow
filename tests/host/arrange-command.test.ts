// tests/host/arrange-command.test.ts
//
// `/arrange` 斜杠命令单测（自主编排实施方案 §10 P2 验收项）：
//   1. 只采集 + 注入：命令 handler 只经 ctx.get('commands') 取服务、只 followup 一条用户消息，
//      **不产生任何图变更**（不断言 store 写接口「没被调用」那么简单——直接断言 get 调用面
//      只有 commands，即命令层根本没碰过数据层/运行时）；
//   2. 提示词内容：三层 SOP（L1/L2 稳定段）+ 规划变体标记（HEAD/MID/TAIL）齐备；
//   3. 降级与错误：无命令面（headless/模式二）静默跳过；空意图给用法不注入；Agent 未激活给错误；
//   4. 生命周期：register 的 disposer 被透传注销；消息 id 走注入缝（单测确定性）。
import { describe, expect, it } from 'vitest'
import {
  ARRANGE_ACCEPTED_TEXT,
  ARRANGE_COMMAND_NAME,
  ARRANGE_NO_AGENT,
  ARRANGE_USAGE,
  buildArrangePrompt,
  registerArrangeCommand,
  type ArrangeInjectedMessage,
} from '../../src/host/commands/arrange.js'
import {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  ORG_SOP_L1_GRAPH_SEMANTICS,
  ORG_SOP_DESIGN_METHOD,
} from '../../src/host/prompts/index.js'

// ---------------------------------------------------------------------------
// fake 命令面（只暴露 register；记录注册/注销）
// ---------------------------------------------------------------------------

interface RegisteredCommand {
  name: string
  description: string
  input?: { hint: string; attachments?: boolean }
  handler: (invocation: unknown) => unknown
}

function makeCtx(opts: { withCommands?: boolean } = {}) {
  const withCommands = opts.withCommands !== false
  const getCalls: string[] = []
  const registered: RegisteredCommand[] = []
  const disposed: string[] = []
  const commands = {
    register(definition: RegisteredCommand): () => void {
      registered.push(definition)
      return () => { disposed.push(definition.name) }
    },
  }
  const ctx = {
    get(name: string): unknown {
      getCalls.push(name)
      return name === 'commands' && withCommands ? commands : undefined
    },
  }
  return { ctx, getCalls, registered, disposed }
}

/** fake 接收 agent：记录 followup 投递的消息。 */
function makeAgent() {
  const messages: ArrangeInjectedMessage[] = []
  const agent = {
    id: 'session-1',
    followup(message: ArrangeInjectedMessage): void { messages.push(message) },
  }
  return { agent, messages }
}

describe('/arrange 命令注册', () => {
  it('命令面缺失（headless / 模式二）时静默跳过：返回 no-op disposer，不抛错', () => {
    const { ctx, registered } = makeCtx({ withCommands: false })
    const dispose = registerArrangeCommand(ctx)
    expect(registered).toHaveLength(0)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })

  it('注册元数据：name=arrange、description 非空、input.hint 存在、handler 为函数', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0].name).toBe(ARRANGE_COMMAND_NAME)
    expect(registered[0].name).toBe('arrange')
    expect(registered[0].description.trim().length).toBeGreaterThan(0)
    expect(String(registered[0].input?.hint ?? '').length).toBeGreaterThan(0)
    expect(registered[0].input?.attachments).not.toBe(true)
    expect(typeof registered[0].handler).toBe('function')
  })

  it('命令名不用中文（用户裁决）：正则校验为官方语法允许的小写名', () => {
    expect(/^[a-z][a-z0-9_-]*$/.test(ARRANGE_COMMAND_NAME)).toBe(true)
    expect(/[\u4e00-\u9fa5]/.test(ARRANGE_COMMAND_NAME)).toBe(false)
  })

  it('disposer 透传官方注销（注销失败不抛错，转日志缝）', () => {
    const { ctx, disposed } = makeCtx()
    const dispose = registerArrangeCommand(ctx)
    dispose()
    expect(disposed).toEqual(['arrange'])
    const warns: string[] = []
    const failCtx = { get: () => ({ register: () => () => { throw new Error('boom') } }) }
    const dispose2 = registerArrangeCommand(failCtx as unknown as { get(name: string): unknown }, { logger: { warn: (m) => warns.push(m) } })
    expect(() => dispose2()).not.toThrow()
    expect(warns).toHaveLength(1)
  })
})

describe('/arrange handler：只采集 + 注入，绝不改图', () => {
  it('只访问 commands 服务：命令层从不触碰数据层/运行时（零图变更的结构性证据）', () => {
    const { ctx, getCalls, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const { agent, messages } = makeAgent()
    registered[0].handler({ agent, rawInput: '做一个三阶段流水线' })
    expect(getCalls).toEqual(['commands'])
    expect(messages).toHaveLength(1)
  })

  it('注入一条官方 Message 契约的用户消息（id/role/content/source 齐备）', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx, { newMessageId: () => 'msg-1' })
    const { agent, messages } = makeAgent()
    const result = registered[0].handler({ agent, rawInput: '  按意图新建模板  ' }) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(result.text).toBe(ARRANGE_ACCEPTED_TEXT)
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('msg-1')
    expect(messages[0].role).toBe('user')
    expect(messages[0].source).toEqual({ kind: 'user' })
    expect(messages[0].content).toHaveLength(1)
    expect(messages[0].content[0].type).toBe('text')
  })

  it('注入文本＝规划变体（HEAD/MID/TAIL 标记 + L1 图语义与设计方法稳定段）', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const { agent, messages } = makeAgent()
    registered[0].handler({ agent, rawInput: '做一个内容生产流水线' })
    const text = messages[0].content[0].text
    expect(text).toContain(HEAD_MARKER)
    expect(text).toContain(MID_MARKER)
    expect(text).toContain(TAIL_MARKER)
    expect(text).toContain(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(text).toContain(ORG_SOP_DESIGN_METHOD)
    expect(text).toContain('做一个内容生产流水线')
  })

  it('目标默认 create（新建模板）：提示词指引走 create 通路而非要求用户先给 targetId', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const { agent, messages } = makeAgent()
    registered[0].handler({ agent, rawInput: '规划一个新流程' })
    const text = messages[0].content[0].text
    expect(text).toContain('create')
    expect(text).not.toContain('scope=\'instance\' 改实例，且必须带 targetId 与 expectRevision。')
    expect(text).toContain(TAIL_MARKER)
  })

  it('系统语言透传：给出时注入语言规则，缺省不注入', () => {
    const withLang = buildArrangePrompt({ userIntent: 'x', systemLanguage: '中文' })
    expect(withLang).toContain('必须使用中文')
    const without = buildArrangePrompt({ userIntent: 'x' })
    expect(without).not.toContain('必须使用')
  })

  it('空意图：返回用法错误且不注入任何消息（不消耗模型回合）', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const { agent, messages } = makeAgent()
    const result = registered[0].handler({ agent, rawInput: '   ' }) as { kind: string; text: string }
    expect(result.kind).toBe('error')
    expect(result.text).toBe(ARRANGE_USAGE)
    expect(messages).toHaveLength(0)
  })

  it('接收 Agent 未激活（无 followup）：返回错误且不抛错', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const result = registered[0].handler({ agent: {}, rawInput: 'x' }) as { kind: string; text: string }
    expect(result.kind).toBe('error')
    expect(result.text).toBe(ARRANGE_NO_AGENT)
    const noAgent = registered[0].handler({ rawInput: 'x' }) as { kind: string; text: string }
    expect(noAgent.kind).toBe('error')
  })

  it('followup 抛错时不吞异常（让命令面按失败结算）', () => {
    const { ctx, registered } = makeCtx()
    registerArrangeCommand(ctx)
    const agent = { id: 's', followup: () => { throw new Error('inject failed') } }
    expect(() => registered[0].handler({ agent, rawInput: 'x' })).toThrow('inject failed')
  })
})

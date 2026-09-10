// T-021 提示词注入装配测试：验证 bindParent 把父代理（根 Agent）提示词状态写入其 ctx，
// 注册 visual-workflow:prompt 段。
//
// 【0.1.5-rc.1 语义（本轮迁移后定案）】
// - 人设段由官方拆为两段：deployment:persona-prefix（order 0，人设散文）
//   与 deployment:persona-suffix（order 10200，实为环境事实「Your working directory is {{cwd}}.」）；
// - 角色 Prompt 设置时**只替换 harness:identity + deployment:persona-prefix**（接管人设），
//   deployment:persona-suffix **保留**（工作目录事实仍由官方在提示词末尾提供）；
// - 「人设段」开关（injectSystemPrompt）OFF：清空除角色段 / tool:* 散文段 / Code 协议段
//   之外的全部官方段与 contexts —— 此时 suffix 也被清空；
// - 工具散文段开关（injectToolSections）OFF：仅移除 tool:* 段；
// - Code Mode 协议段 tools:sdk / tools:ptc-only（旧名 tools:code-only）与 tools[] 恒保留。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import { createChildPromptSetup, VISUAL_WORKFLOW_PROMPT_SECTION } from '../../src/host/agent/prompt-setup.js'

/**
 * 0.1.5-rc.1 官方段名（**测试内独立字面量**：故意不与实现共享常量，
 * 否则实现把常量改错时测试会同源假绿）。
 */
const SEC = {
  identity: 'harness:identity',
  personaPrefix: 'deployment:persona-prefix',
  personaSuffix: 'deployment:persona-suffix',
  sdk: 'tools:sdk',
  ptcOnly: 'tools:ptc-only',
  codeOnly: 'tools:code-only',
  toolRead: 'tool:read',
  toolWorkflow: 'tool:workflow',
  workspace: 'workspace:instructions',
  plan: 'plan:policy',
} as const

/** 官方段名全集（用于「两开关都 OFF 只留角色段 + 协议段」的断言）。 */
function officialSections(): Array<{ name: string; text: string }> {
  return [
    { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: SEC.personaPrefix, text: 'You are a coding agent powered by the deepseek-flash model.' },
    { name: SEC.personaSuffix, text: 'Your working directory is D:\\proj.' },
    { name: SEC.plan, text: 'plan mode rules' },
    { name: SEC.workspace, text: 'AGENTS.md' },
    { name: SEC.toolRead, text: 'read tool' },
    { name: SEC.toolWorkflow, text: 'workflow tool' },
    { name: SEC.sdk, text: 'sdk proto' },
    { name: SEC.ptcOnly, text: 'only run_code' },
    { name: SEC.codeOnly, text: 'legacy only run_code' },
  ]
}

/** 段名集合的无序比较（段的排序由 order 决定，不属本测试关注点）。 */
function expectNames(out: AssembledLike, expected: string[]): void {
  expect(namesOf(out).slice().sort()).toEqual(expected.slice().sort())
}

/** 构造最小 childCtx fake：systemPrompt.section + on('system-prompt/assemble')。 */
function makeCtx() {
  const sections: Array<{ name: string; order: number; text: unknown }> = []
  const handlers = new Map<string, Array<(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>>>()
  const ctx = {
    systemPrompt: {
      section(input: { name: string; order: number; text: unknown }): () => void {
        sections.push(input)
        return () => {}
      },
    },
    on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void {
      handlers.set(name, [...(handlers.get(name) ?? []), listener])
      return () => {}
    },
    __sections: sections,
    __handlers: handlers,
  }
  return ctx as unknown as { systemPrompt: { section(a: { name: string; order: number; text(): string }): () => void }; on(name: string, l: (a: unknown, c: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void; __sections: Array<{ name: string; order: number; text(): string }>; __handlers: Map<string, Array<(a: unknown, c: unknown, next: () => Promise<unknown>) => Promise<unknown>>> }
}

/** 装配结果最小形状。 */
interface AssembledLike {
  sections?: Array<{ name: string; text: string }>
  contexts?: unknown[]
  tools?: Array<{ name: string }>
}

/**
 * 触发一次 system-prompt/assemble 瀑布。
 * 同时回传「输入的 tools 数组引用」，供断言 `tools[]` 未被改写（同一引用 = 零改动）。
 */
async function runAssemble(
  ctx: ReturnType<typeof makeCtx>,
  sections: Array<{ name: string; text: string }>,
  tools: Array<{ name: string }> = [{ name: 'read' }],
): Promise<{ out: AssembledLike; toolsIn: Array<{ name: string }> }> {
  const listener = ctx.__handlers.get('system-prompt/assemble')![0]
  const assembly = { sections, contexts: [{ name: 'rt', text: 'x' }], tools }
  const out = (await listener(assembly, undefined, () => Promise.resolve(assembly))) as AssembledLike
  return { out, toolsIn: tools }
}

/** 段名列表。 */
function namesOf(out: AssembledLike): string[] {
  return (out.sections ?? []).map((section) => section.name)
}

describe('T-021 提示词注入装配 bindParent（父代理根 Agent）', () => {
  it('bindParent 注入状态并注册 visual-workflow:prompt 段（section 文本来自状态）', () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: true, injectToolSections: true }, 'session-1')

    const roleSection = ctx.__sections.find((section) => section.name === VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(roleSection).toBeDefined()
    expect(roleSection!.order).toBe(1)
    expect(roleSection!.text()).toBe('父代理角色')
  })

  it('同一 sessionId 重复 bindParent 不重复注册段，仅更新状态', () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: 'A', injectSystemPrompt: true, injectToolSections: true }, 'session-1')
    setup.bindParent(ctx, { systemPrompt: 'B', injectSystemPrompt: false, injectToolSections: true }, 'session-1')
    expect(ctx.__sections.filter((section) => section.name === VISUAL_WORKFLOW_PROMPT_SECTION)).toHaveLength(1)
    expect(ctx.__sections[0].text()).toBe('B')
  })

  it('角色 Prompt 设置时替换 identity + persona 前缀，但**保留** persona 后缀（工作目录事实）', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: true, injectToolSections: true }, 's')
    const { out, toolsIn } = await runAssemble(ctx, [
      { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: SEC.personaPrefix, text: 'You are a coding agent powered by the deepseek-flash model.' },
      { name: SEC.personaSuffix, text: 'Your working directory is D:\\proj.' },
      { name: VISUAL_WORKFLOW_PROMPT_SECTION, text: '父代理角色' },
      { name: SEC.toolRead, text: 'read tool' },
      { name: SEC.workspace, text: 'AGENTS.md' },
    ])
    const names = namesOf(out)
    // 角色 Prompt 接管人设：identity 与 persona 前缀被替换掉
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(names).not.toContain(SEC.identity)
    expect(names).not.toContain(SEC.personaPrefix)
    // 【0.1.5-rc.1 关键断言】persona 后缀（工作目录事实）必须保留
    expect(names).toContain(SEC.personaSuffix)
    // 其余官方段（工作区说明）与工具段保留
    expect(names).toContain(SEC.workspace)
    expect(names).toContain(SEC.toolRead)
    // ON 时保留原上下文
    expect(out.contexts).toHaveLength(1)
    // ON 时 tools[] 零改动（同一引用）
    expect(out.tools).toBe(toolsIn)
    expect(out.tools!.map((tool) => tool.name)).toEqual(['read'])
  })

  it('未设置角色 Prompt 时官方段保持不变（不做任何改写，缓存/稳定性优化）', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '', injectSystemPrompt: true, injectToolSections: true }, 's')
    const { out, toolsIn } = await runAssemble(ctx, [
      { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: SEC.personaPrefix, text: '' },
      { name: SEC.personaSuffix, text: 'Your working directory is D:\\proj.' },
      { name: SEC.toolRead, text: 'read tool' },
    ])
    expect(namesOf(out)).toEqual([SEC.identity, SEC.personaPrefix, SEC.personaSuffix, SEC.toolRead])
    // OFF 时才清上下文；ON 保持原上下文
    expect(out.contexts).toHaveLength(1)
    expect(out.tools).toBe(toolsIn)
  })
  it('开关 OFF（人设段）：清空全部官方段（含 persona 前后缀）与上下文，仅留角色段 + tool:* + 协议段', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: false, injectToolSections: true }, 's')
    const { out, toolsIn } = await runAssemble(ctx, [
      { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: SEC.personaPrefix, text: 'persona prefix' },
      { name: SEC.personaSuffix, text: 'persona suffix' },
      { name: SEC.plan, text: 'plan' },
      { name: VISUAL_WORKFLOW_PROMPT_SECTION, text: '父代理角色' },
      { name: SEC.toolRead, text: 'read tool' },
      { name: SEC.sdk, text: 'sdk proto' },
      { name: SEC.ptcOnly, text: 'only run_code' },
      { name: SEC.codeOnly, text: 'legacy only run_code' },
      { name: SEC.workspace, text: 'AGENTS.md' },
    ])
    const names = namesOf(out)
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(names).toContain(SEC.toolRead)
    // Code Mode 协议段必须保留（含新名与旧名，旧实现误清，已修复）
    expect(names).toContain(SEC.sdk)
    expect(names).toContain(SEC.ptcOnly)
    expect(names).toContain(SEC.codeOnly)
    // 官方段全部清空——含 persona 前缀与后缀
    expect(names).not.toContain(SEC.identity)
    expect(names).not.toContain(SEC.personaPrefix)
    expect(names).not.toContain(SEC.personaSuffix)
    expect(names).not.toContain(SEC.plan)
    expect(names).not.toContain(SEC.workspace)
    expect(out.contexts).toHaveLength(0)
    // tools[] 零改动
    expect(out.tools).toBe(toolsIn)
  })

  it('角色 Prompt 设置 + 人设段 OFF：identity / persona 前后缀三段全无', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: false, injectToolSections: true }, 's')
    const { out } = await runAssemble(ctx, [
      ...officialSections(),
      { name: VISUAL_WORKFLOW_PROMPT_SECTION, text: '父代理角色' },
    ])
    const names = namesOf(out)
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(names).not.toContain(SEC.identity)
    expect(names).not.toContain(SEC.personaPrefix)
    expect(names).not.toContain(SEC.personaSuffix)
  })

  it('工具散文段开关 OFF：仅移除 tool:* 段，保留官方段（含 persona 前后缀）、协议段与工具 schema', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    // 空角色 Prompt（不触发官方身份段替换），专测工具散文段开关
    setup.bindParent(ctx, { systemPrompt: '', injectSystemPrompt: true, injectToolSections: false }, 's')
    const { out, toolsIn } = await runAssemble(ctx, officialSections())
    const names = namesOf(out)
    expect(names).not.toContain(SEC.toolRead)
    expect(names).not.toContain(SEC.toolWorkflow)
    // 官方段与 Code Mode 协议段保留
    expect(names).toContain(SEC.identity)
    expect(names).toContain(SEC.personaPrefix)
    expect(names).toContain(SEC.personaSuffix)
    expect(names).toContain(SEC.sdk)
    expect(names).toContain(SEC.ptcOnly)
    // 上下文随人设段开关保留（此例 ON）
    expect(out.contexts).toHaveLength(1)
    // 【关键】工具散文段开关**绝不**触碰工具注入表（同一引用）
    expect(out.tools).toBe(toolsIn)
    expect(out.tools!.map((tool) => tool.name)).toEqual(['read'])
  })

  it('两开关都 OFF：仅保留角色段 + Code Mode 协议段，清空其余（含 persona 前后缀）', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: false, injectToolSections: false }, 's')
    const { out, toolsIn } = await runAssemble(ctx, [
      ...officialSections(),
      { name: VISUAL_WORKFLOW_PROMPT_SECTION, text: '父代理角色' },
    ])
    expectNames(out, [VISUAL_WORKFLOW_PROMPT_SECTION, SEC.sdk, SEC.ptcOnly, SEC.codeOnly])
    expect(out.contexts).toHaveLength(0)
    expect(out.tools).toBe(toolsIn)
    expect(out.tools!.map((tool) => tool.name)).toEqual(['read'])
  })

  it('开关组合矩阵：任意组合下协议段恒保留、tools[] 恒零改动', async () => {
    for (const injectSystemPrompt of [true, false]) {
      for (const injectToolSections of [true, false]) {
        for (const systemPrompt of ['', '角色 Prompt']) {
          const setup = createChildPromptSetup()
          const ctx = makeCtx()
          setup.bindParent(ctx, { systemPrompt, injectSystemPrompt, injectToolSections }, 's')
          const { out, toolsIn } = await runAssemble(ctx, officialSections())
          const names = namesOf(out)
          const label = `injectSystemPrompt=${injectSystemPrompt} injectToolSections=${injectToolSections} role=${systemPrompt ? 'set' : 'empty'}`
          // Code Mode 协议段恒保留（新名 + 旧名）
          expect(names, label).toContain(SEC.sdk)
          expect(names, label).toContain(SEC.ptcOnly)
          expect(names, label).toContain(SEC.codeOnly)
          // tools[] 恒为同一引用（零改写）
          expect(out.tools, label).toBe(toolsIn)
          // tool:* 仅在 injectToolSections=false 时消失
          if (injectToolSections) {
            expect(names, label).toContain(SEC.toolRead)
          } else {
            expect(names, label).not.toContain(SEC.toolRead)
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// T-021b 全局首轮瀑布（registerGlobalAssemblyHook）：
// 子代理首轮系统提示词组装发生在 startContinuable 内部、withPending 状态仍活跃时。
// 全局 unscoped 瀑布就近读取 pending 状态，注入角色 Prompt 段并替换官方身份/人设前缀，
// 从而「第一轮」即用用户自设角色 Prompt，而非第二轮才替换（BUG 根因修复复核）。
// ---------------------------------------------------------------------------

describe('T-021b 子代理首轮角色 Prompt 注入（全局 unscoped 瀑布）', () => {
  it('在 withPending 作用域内（首轮组装）注入角色 Prompt 段并替换 identity + persona 前缀', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.registerGlobalAssemblyHook(ctx)
    let out: AssembledLike | undefined
    let toolsIn: Array<{ name: string }> | undefined
    await setup.withPending(
      { systemPrompt: '子代理角色', injectSystemPrompt: true, injectToolSections: true },
      async () => {
        // 模拟 startContinuable 内部、pending 仍活跃时的首轮组装
        const result = await runAssemble(ctx, [
          { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
          { name: SEC.personaPrefix, text: 'You are a coding agent powered by the deepseek-flash model.' },
          { name: SEC.personaSuffix, text: 'Your working directory is D:\\proj.' },
          { name: SEC.toolRead, text: 'read tool' },
          { name: SEC.sdk, text: 'sdk proto' },
        ])
        out = result.out
        toolsIn = result.toolsIn
      },
    )
    const names = namesOf(out!)
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(out!.sections!.find((s) => s.name === VISUAL_WORKFLOW_PROMPT_SECTION)!.text).toBe('子代理角色')
    expect(names).not.toContain(SEC.identity) // 角色 Prompt 替换官方身份段
    expect(names).not.toContain(SEC.personaPrefix) // 角色 Prompt 替换官方人设前缀
    expect(names).toContain(SEC.personaSuffix) // 【0.1.5-rc.1】工作目录事实保留
    expect(names).toContain(SEC.toolRead) // 工具散文段保留
    expect(names).toContain(SEC.sdk) // Code Mode 协议段保留
    expect(out!.contexts).toHaveLength(1)
    expect(out!.tools).toBe(toolsIn)
    expect(out!.tools!.map((tool) => tool.name)).toEqual(['read'])
  })

  it('pending 为空（后续回合/非视觉工作流代理）：全局瀑布原样返回，不篡改官方组装', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.registerGlobalAssemblyHook(ctx)
    // 在 withPending 之外触发（模拟后续回合），pending.getStore() 为空 → 不干预
    const { out, toolsIn } = await runAssemble(ctx, [
      { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: SEC.personaPrefix, text: 'prefix' },
      { name: SEC.personaSuffix, text: 'suffix' },
      { name: SEC.toolRead, text: 'read tool' },
    ])
    expect(namesOf(out)).toEqual([SEC.identity, SEC.personaPrefix, SEC.personaSuffix, SEC.toolRead])
    expect(out.contexts).toHaveLength(1)
    expect(out.tools).toBe(toolsIn)
  })

  it('首轮组装时角色 Prompt 为空：不注入角色段（两开关全开时保持官方组装不变）', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.registerGlobalAssemblyHook(ctx)
    let out: AssembledLike | undefined
    await setup.withPending({ systemPrompt: '', injectSystemPrompt: true, injectToolSections: true }, async () => {
      const result = await runAssemble(ctx, [
        { name: SEC.identity, text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: SEC.toolRead, text: 'read tool' },
      ])
      out = result.out
    })
    // 角色 Prompt 为空 → 无需替换身份段，官方组装保持原样
    expect(namesOf(out!)).toEqual([SEC.identity, SEC.toolRead])
  })

  it('首轮组装时人设段 OFF：persona 前后缀一并清空', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.registerGlobalAssemblyHook(ctx)
    let out: AssembledLike | undefined
    await setup.withPending({ systemPrompt: '子代理角色', injectSystemPrompt: false, injectToolSections: true }, async () => {
      const result = await runAssemble(ctx, officialSections())
      out = result.out
    })
    const names = namesOf(out!)
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(names).not.toContain(SEC.identity)
    expect(names).not.toContain(SEC.personaPrefix)
    expect(names).not.toContain(SEC.personaSuffix)
    expect(names).toContain(SEC.sdk)
    expect(names).toContain(SEC.ptcOnly)
  })

  it('hasPending：withPending 作用域内为 true，之外为 false（agent/session-start 判定视觉工作流子代理依据）', async () => {
    const setup = createChildPromptSetup()
    expect(setup.hasPending()).toBe(false)
    await setup.withPending({ systemPrompt: 'x', injectSystemPrompt: true, injectToolSections: true }, async () => {
      expect(setup.hasPending()).toBe(true)
    })
    expect(setup.hasPending()).toBe(false)
  })
})

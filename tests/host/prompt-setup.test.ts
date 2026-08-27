// T-021 提示词注入装配测试：验证 bindParent 把父代理（根 Agent）提示词状态写入其 ctx，
// 注册 visual-workflow:prompt 段；开关 OFF 时过滤瀑布仅保留角色段 + tool:* 段 + 工具 schema。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import { createChildPromptSetup, VISUAL_WORKFLOW_PROMPT_SECTION } from '../../src/host/agent/prompt-setup.js'

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

async function runAssemble(ctx: ReturnType<typeof makeCtx>, sections: Array<{ name: string; text: string }>): Promise<{ sections?: Array<{ name: string; text: string }>; contexts?: unknown[] }> {
  const listener = ctx.__handlers.get('system-prompt/assemble')![0]
  const assembly = { sections, contexts: [{ name: 'rt', text: 'x' }], tools: [] }
  return (await listener(assembly, undefined, () => Promise.resolve(assembly))) as { sections?: Array<{ name: string; text: string }>; contexts?: unknown[] }
}

describe('T-021 提示词注入装配 bindParent（父代理根 Agent）', () => {
  it('bindParent 注入状态并注册 visual-workflow:prompt 段（section 文本来自状态）', () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: true }, 'session-1')

    const roleSection = ctx.__sections.find((section) => section.name === VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(roleSection).toBeDefined()
    expect(roleSection!.order).toBe(1)
    expect(roleSection!.text()).toBe('父代理角色')
  })

  it('同一 sessionId 重复 bindParent 不重复注册段，仅更新状态', () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: 'A', injectSystemPrompt: true }, 'session-1')
    setup.bindParent(ctx, { systemPrompt: 'B', injectSystemPrompt: false }, 'session-1')
    expect(ctx.__sections.filter((section) => section.name === VISUAL_WORKFLOW_PROMPT_SECTION)).toHaveLength(1)
    expect(ctx.__sections[0].text()).toBe('B')
  })

  it('开关 ON（默认）：官方段保持不变（不做任何改写）', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: true }, 's')
    const out = await runAssemble(ctx, [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'deployment:persona', text: '' },
      { name: 'tool:read', text: 'read tool' },
    ])
    expect(out.sections!.map((section) => section.name)).toEqual(['harness:identity', 'deployment:persona', 'tool:read'])
    // OFF 时才清上下文；ON 保持原上下文
    expect(out.contexts).toHaveLength(1)
  })

  it('开关 OFF：仅保留角色段 + tool:* 段，清空官方段与上下文', async () => {
    const setup = createChildPromptSetup()
    const ctx = makeCtx()
    setup.bindParent(ctx, { systemPrompt: '父代理角色', injectSystemPrompt: false }, 's')
    const out = await runAssemble(ctx, [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'deployment:persona', text: '' },
      { name: VISUAL_WORKFLOW_PROMPT_SECTION, text: '父代理角色' },
      { name: 'tool:read', text: 'read tool' },
      { name: 'workspace:instructions', text: 'AGENTS.md' },
    ])
    const names = out.sections!.map((section) => section.name)
    expect(names).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(names).toContain('tool:read')
    expect(names).not.toContain('harness:identity')
    expect(names).not.toContain('deployment:persona')
    expect(names).not.toContain('workspace:instructions')
    expect(out.contexts).toHaveLength(0)
  })
})

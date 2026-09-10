// tests/host/tool-switches.test.ts
//
// 全局工具开关模块单测：
//   - ToolSwitchStore：持久化往返 / load 快照 / setDisabled 幂等 / 损坏文件容忍；
//   - filterToolsInAssembly 纯函数：assembly.tools 与 tool:<name> 散文段剔除、
//     tools:sdk / tools:code-only 恒保留、disabled 空集原样返回；
//   - registerToolSwitchFilter：瀑布读写（next 链）与即时生效语义。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterToolsInAssembly,
  registerToolSwitchFilter,
  ToolSwitchStore,
  type FilterContextLike,
  type PromptAssemblyLike,
} from '../../src/host/tools/tool-switches.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function makeStore(): Promise<{ dir: string; store: ToolSwitchStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-tool-switches-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return { dir, store: new ToolSwitchStore(dir) }
}

function sampleAssembly(): PromptAssemblyLike {
  return {
    sections: [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'tool:read', text: 'read 使用指引' },
      { name: 'tool:wf_run_node', text: '调度指引' },
      { name: 'tools:sdk', text: 'SDK 协议' },
      // 0.1.5-rc.1 官方新名（原 tools:code-only）
      { name: 'tools:ptc-only', text: 'PTC 规则' },
      // 旧名保留：≤0.1.2 宿主
      { name: 'tools:code-only', text: 'Code Mode 规则' },
    ],
    contexts: [{ name: 'ctx', text: 'x' }],
    tools: [
      { name: 'read', description: '读文件' },
      { name: 'wf_run_node', description: '调度' },
      { name: 'mcp__codegraph__codegraph_explore', description: '探索' },
    ],
  }
}

describe('ToolSwitchStore', () => {
  it('越界防护：空名拒绝、run_code 可关闭（由端点层拦截，存储层只做非空校验）', async () => {
    const { store } = await makeStore()
    await expect(store.setDisabled('', true)).rejects.toThrow('工具名不能为空')
    await store.setDisabled('read', true)
    expect(await store.readDisabled()).toEqual(['read'])
  })

  it('setDisabled 幂等 + 开关往返 + 内存快照即时更新', async () => {
    const { store } = await makeStore()
    await store.load()
    await store.setDisabled('read', true)
    await store.setDisabled('read', true)
    await store.setDisabled('wf_run_node', true)
    expect([...store.currentDisabled()].sort()).toEqual(['read', 'wf_run_node'])
    await store.setDisabled('read', false)
    expect([...store.currentDisabled()].sort()).toEqual(['wf_run_node'])
    expect(await store.readDisabled()).toEqual(['wf_run_node'])
  })

  it('setDisabledMany：批量关/开 + 幂等 + 空名忽略 + 内存快照即时更新', async () => {
    const { store } = await makeStore()
    await store.load()
    await store.setDisabledMany(['read', 'grep', '  ', ''], true)
    expect([...store.currentDisabled()].sort()).toEqual(['grep', 'read'])
    // 已存在单工具关闭后，批量开启应从清单移出
    await store.setDisabled('wf_run_node', true)
    await store.setDisabledMany(['read', 'wf_run_node'], false)
    expect([...store.currentDisabled()].sort()).toEqual(['grep'])
    expect(await store.readDisabled()).toEqual(['grep'])
  })

  it('setDisabledMany：空数组为 no-op（不写盘、不报错）', async () => {
    const { store } = await makeStore()
    await store.setDisabled('read', true)
    await store.setDisabledMany([], true)
    expect(await store.readDisabled()).toEqual(['read'])
  })

  it('损坏 JSON 容忍：按空清单处置，后续保存重写', async () => {
    const { dir, store } = await makeStore()
    await writeFile(join(dir, 'tool-switches.json'), '{broken', 'utf8')
    await store.load()
    expect(store.currentDisabled().size).toBe(0)
    await store.setDisabled('read', true)
    expect(await store.readDisabled()).toEqual(['read'])
  })
})

describe('filterToolsInAssembly', () => {
  it('disabled 空集：原样返回（引用不变，不改动官方组装）', () => {
    const assembly = sampleAssembly()
    expect(filterToolsInAssembly(assembly, new Set())).toBe(assembly)
  })

  it('剔除被关闭工具的 Schema 与 tool:<name> 散文段；协议段（新名 + 旧名）恒保留', () => {
    const out = filterToolsInAssembly(sampleAssembly(), new Set(['read', 'wf_run_node']))
    expect(out.tools?.map((t) => t.name)).toEqual(['mcp__codegraph__codegraph_explore'])
    expect(out.sections?.map((s) => s.name)).toEqual([
      'harness:identity',
      'tools:sdk',
      'tools:ptc-only',
      'tools:code-only',
    ])
    // 上下文与变量不触碰
    expect(out.contexts).toHaveLength(1)
  })

  it('与「工具散文段开关」的分界：全局关闭会同时剥夺调用能力（tools[] 剔除）', () => {
    // 这是与节点 injectToolSections（只过滤 sections、绝不动 tools[]）的本质区别。
    const assembly = sampleAssembly()
    const out = filterToolsInAssembly(assembly, new Set(['read']))
    expect(out.tools?.map((t) => t.name)).toEqual(['wf_run_node', 'mcp__codegraph__codegraph_explore'])
    expect(out.sections?.map((s) => s.name)).not.toContain('tool:read')
  })

  it('MCP 服务器关闭：schema 全量剔除但散文段（无 tool:mcp__* 段）不误伤', () => {
    const out = filterToolsInAssembly(sampleAssembly(), new Set(['mcp__codegraph__codegraph_explore']))
    expect(out.tools?.map((t) => t.name)).toEqual(['read', 'wf_run_node'])
    expect(out.sections?.map((s) => s.name)).toContain('tool:read')
  })

  it('确定性：同输入同输出（前缀稳定要求——同一 run 内组装结果稳定）', () => {
    const a = JSON.stringify(filterToolsInAssembly(sampleAssembly(), new Set(['read'])))
    const b = JSON.stringify(filterToolsInAssembly(sampleAssembly(), new Set(['read'])))
    expect(a).toBe(b)
  })
})

describe('registerToolSwitchFilter', () => {
  it('瀑布在 next 之后改写 assembly.tools；开关切换即时生效', async () => {
    const store = new ToolSwitchStore(await mkdtemp(join(tmpdir(), 'vw-tool-switches-2-')))
    const listeners: Array<(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    const ctx: FilterContextLike = {
      on(_name, listener) {
        listeners.push(listener)
        return () => {}
      },
    }
    registerToolSwitchFilter(ctx, store)
    expect(listeners).toHaveLength(1)
    // 未装载：空集 → 原样通过
    let assembly = await (listeners[0] as (a: unknown, _c: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      sampleAssembly(), {}, () => Promise.resolve(sampleAssembly()),
    ) as PromptAssemblyLike
    expect(assembly.tools).toHaveLength(3)
    // 装载并关闭 read：即时生效（无重注册）
    await store.load()
    await store.setDisabled('read', true)
    assembly = await (listeners[0] as (a: unknown, _c: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      sampleAssembly(), {}, () => Promise.resolve(sampleAssembly()),
    ) as PromptAssemblyLike
    expect(assembly.tools?.map((t) => t.name)).toEqual(['wf_run_node', 'mcp__codegraph__codegraph_explore'])
  })
})

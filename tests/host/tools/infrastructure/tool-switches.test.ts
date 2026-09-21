// tests/host/tools/infrastructure/tool-switches.test.ts
//
// 全局工具开关模块单测：
//   - ToolSwitchStore：持久化往返 / load 快照 / setDisabled 幂等 / 损坏文件容忍 /
//     **默认全部开启**（用户裁决 2026.09 删除「默认关闭种子」）/ 跨进程刷新 ensureFresh；
//   - filterToolsInAssembly 纯函数：assembly.tools 与 tool:<name> 散文段剔除、
//     tools:sdk / tools:code-only 恒保留、disabled 空集原样返回；
//   - registerToolSwitchFilter：瀑布读写（next 链）、跨进程刷新与即时生效语义。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterToolsInAssembly,
  registerToolSwitchFilter,
  ToolSwitchStore,
  type FilterContextLike,
  type PromptAssemblyLike,
} from '../../../../src/host/tools/infrastructure/tool-switches.js'
import { ORG_AUTHORING_TOOLS } from '../../../../src/host/shared/protocol.js'

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
    // 磁盘读取语义 = 用户关闭项（默认全部开启，无任何种子）
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
    expect((await store.readDisabled()).sort()).toEqual(['wf_run_node'])
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
    expect((await store.readDisabled()).sort()).toEqual(['grep'])
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
    expect([...store.currentDisabled()]).toEqual([])
    await store.setDisabled('read', true)
    expect(await store.readDisabled()).toEqual(['read'])
  })

  it('默认全部开启（用户裁决 2026.09：删除「默认关闭种子」）', async () => {
    const { store } = await makeStore()
    await store.load()
    // 历史 BUG：自主编排两工具曾被种子隐藏，而组合管理读磁盘清单把它显示成「已开启」，
    // 表现为「开关间歇性失灵」。删除种子后默认全部开启，两套状态不再分叉。
    for (const name of ORG_AUTHORING_TOOLS) {
      expect(store.currentDisabled().has(name)).toBe(false)
    }
    expect([...store.currentDisabled()]).toEqual([])
    expect(await store.effectiveDisabled()).toEqual([])
    // 用户仍可显式关闭（组合管理统一开关）
    await store.setDisabled(ORG_AUTHORING_TOOLS[0], true)
    expect(store.currentDisabled().has(ORG_AUTHORING_TOOLS[0])).toBe(true)
    expect(await store.effectiveDisabled()).toEqual([ORG_AUTHORING_TOOLS[0]])
  })

  it('历史文件兼容：遗留 enabled 记账键被忽略，且下一次写入自然清除', async () => {
    const { dir, store } = await makeStore()
    await writeFile(join(dir, 'tool-switches.json'), JSON.stringify({ disabled: [], enabled: ['wf_org_catalog'] }), 'utf8')
    await store.load()
    expect([...store.currentDisabled()]).toEqual([])
    await store.setDisabled('read', true)
    const raw = JSON.parse(await readFile(join(dir, 'tool-switches.json'), 'utf8')) as Record<string, unknown>
    expect(raw.enabled).toBeUndefined()
  })

  it('ensureFresh：另一个进程（另一进程实例）改盘后按需重读', async () => {
    const { dir, store } = await makeStore()
    await store.load()
    // 模拟模式二服务进程 / 其它 dsh 进程：同一 dataDir 的第二个 store 实例
    const other = new ToolSwitchStore(dir)
    await other.load()
    await other.setDisabled('read', true)
    // 未刷新前本进程仍是旧快照（这正是「同一个开关在不同 Agent 上表现不一致」的根因）
    expect(store.currentDisabled().has('read')).toBe(false)
    await store.ensureFresh()
    expect(store.currentDisabled().has('read')).toBe(true)
    expect(await store.effectiveDisabled()).toEqual(['read'])
    // 反向：另一进程开启 → 再次刷新后同步
    await other.setDisabled('read', false)
    expect(await store.effectiveDisabled()).toEqual([])
  })

  it('ensureFresh：指纹未变时保持快照；文件被删除按空清单重载', async () => {
    const { dir, store } = await makeStore()
    await store.load()
    await store.setDisabled('read', true)
    await store.ensureFresh()
    await store.ensureFresh()
    expect([...store.currentDisabled()]).toEqual(['read'])
    await rm(join(dir, 'tool-switches.json'), { force: true })
    await store.ensureFresh()
    expect([...store.currentDisabled()]).toEqual([])
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
  /** 造一个只收集 listener 的瀑布上下文。 */
  function makeFilterCtx(): {
    ctx: FilterContextLike
    run: (assembly: PromptAssemblyLike) => Promise<PromptAssemblyLike>
  } {
    const listeners: Array<(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    const ctx: FilterContextLike = {
      on(_name, listener) {
        listeners.push(listener)
        return () => {}
      },
    }
    return {
      ctx,
      run: (assembly) => (listeners[0] as (a: unknown, c: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
        assembly, {}, () => Promise.resolve(assembly),
      ) as Promise<PromptAssemblyLike>,
    }
  }

  it('瀑布在 next 之后改写 assembly.tools；开关切换即时生效', async () => {
    const store = new ToolSwitchStore(await mkdtemp(join(tmpdir(), 'vw-tool-switches-2-')))
    const listener = makeFilterCtx()
    registerToolSwitchFilter(listener.ctx, store)
    // 未装载：空集 → 原样通过
    let assembly = await listener.run(sampleAssembly())
    expect(assembly.tools).toHaveLength(3)
    // 装载并关闭 read：即时生效（无重注册）
    await store.load()
    await store.setDisabled('read', true)
    assembly = await listener.run(sampleAssembly())
    expect(assembly.tools?.map((t) => t.name)).toEqual(['wf_run_node', 'mcp__codegraph__codegraph_explore'])
  })

  it('瀑布每次组装前跨进程刷新：另一进程关闭的工具当次组装即被剔除', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-tool-switches-3-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const store = new ToolSwitchStore(dir)
    await store.load()
    const listener = makeFilterCtx()
    registerToolSwitchFilter(listener.ctx, store)
    // 另一进程（同一 dataDir）关闭 read：本进程未主动刷新也应看到
    const other = new ToolSwitchStore(dir)
    await other.load()
    await other.setDisabled('read', true)
    const assembly = await listener.run(sampleAssembly())
    expect(assembly.tools?.map((t) => t.name)).toEqual(['wf_run_node', 'mcp__codegraph__codegraph_explore'])
    expect(assembly.sections?.map((s) => s.name)).not.toContain('tool:read')
  })
})

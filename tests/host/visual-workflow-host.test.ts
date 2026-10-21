// tests/host/visual-workflow-host.test.ts
//
// 宿主事件观察的卸载守卫（D01-06）：`dispose()` 之后到达的 `agent/created` /
// `agent/disposed` 不得再产生任何副作用。
//
// 为什么单独成文件：既有 agent/created 用例（tests/integration/host-assembly.test.ts）
// 只覆盖「未卸载」路径，卸载竞态窗口无覆盖；本文件只断言「卸载后子代理 ctx 上
// 不被安装任何贡献」这一可观察事实。

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VisualWorkflowHost, VisualWorkflowHostServiceName, type Config } from '../../src/host/index.js'
import { VISUAL_WORKFLOW_PROMPT_SECTION } from '../../src/host/agent/prompt-setup.js'
import { PARENT_ROLE_DUTIES } from '../../src/host/prompts/index.js'
import type { SettingsServiceLike } from '../../src/host/system-language.js'

/** 构造含临时 dataDir 的完整配置（其余键取 schema 默认）。 */
function makeConfig(dir: string): Config {
  return {
    dataDir: dir,
    servicePortBase: 7860,
    apiKey: null,
    maxConcurrentPerService: 50,
    runIdleTimeoutMs: 1800000,
    runPollMs: 2000,
    reactIterationLimitDefault: 0,
    retryLimitDefault: 3,
    outputFullLimit: 102400,
    documentTextLimit: 20000,
    embeddingModelDir: null,
    embeddingEndpoint: null,
    teamMemberLimit: 8,
  }
}

/** 子代理 ctx 观察缝：记录四类贡献在它上面留下的可观察痕迹。 */
interface ChildCtxProbe {
  ctx: unknown
  sections: string[]
  listeners: string[]
  restricts: Array<{ deny?: string[] }>
}

function probeChildCtx(): ChildCtxProbe {
  const sections: string[] = []
  const listeners: string[] = []
  const restricts: Array<{ deny?: string[] }> = []
  return {
    sections,
    listeners,
    restricts,
    ctx: {
      on(name: string, _listener: unknown): () => void {
        listeners.push(name)
        return () => {}
      },
      systemPrompt: {
        section(input: { name: string }): () => void {
          sections.push(input.name)
          return () => {}
        },
      },
      get(name: string): unknown {
        return name === 'tools'
          ? {
              restrict(filter: { deny?: string[] }): () => void {
                restricts.push(filter)
                return () => {}
              },
            }
          : undefined
      },
    },
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  // 逆序串行清理：后创建的宿主先释放，再删它使用的 dataDir。并发执行会让 rm 与
  // 宿主释放（SQLite 仍持有文件）竞态，Windows 上表现为 EPERM（文件被占用）。
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** 取宿主私有事件处理器的调用面（与 host-assembly 集成测试同款最小结构收窄）。 */
type HostEventSurface = {
  childPrompt: { withPending<T>(state: unknown, operation: () => Promise<T>): Promise<T> }
  onAgentCreated(payload: unknown): void
  onAgentDisposed(payload: unknown): void
}

async function bootHost(
  dataDir?: string,
  settings?: SettingsServiceLike,
): Promise<{ root: Context; host: VisualWorkflowHost; dir: string }> {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'vw-r4-host-')))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const root = new Context()
  // 界面语言在宿主 init 时由 settings.describe() 读取：必须在 plugin 装配前提供。
  if (settings) root.provide('settings', settings)
  await root.plugin(VisualWorkflowHost, makeConfig(dir))
  const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost
  cleanups.push(async () => {
    await root.fiber.dispose()
  })
  return { root, host, dir }
}

describe('宿主卸载后的事件观察（D01-06）', () => {
  it('dispose 后到达的 agent/created 不再在子代理 ctx 上安装任何贡献', async () => {
    const { host } = await bootHost()
    host.dispose()
    expect(host.disposed).toBe(true)

    const probe = probeChildCtx()
    const surface = host as unknown as HostEventSurface
    // 与首建同形的注入：若处理器仍工作，四类贡献会落在 probe 上
    await surface.childPrompt.withPending(
      { systemPrompt: '卸载后不该出现', injectSystemPrompt: true, injectToolSections: true },
      async () => {
        surface.onAgentCreated({ agent: { id: 'child-after-dispose', ctx: probe.ctx } })
      },
    )

    expect(probe.sections).toEqual([])
    expect(probe.listeners).toEqual([])
    expect(probe.restricts).toEqual([])
    expect(probe.sections).not.toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
  })

  it('dispose 后到达的 agent/disposed 不抛错（幂等，不再触碰已清空的撤销表）', async () => {
    const { host } = await bootHost()
    host.dispose()
    const surface = host as unknown as HostEventSurface
    expect(() => surface.onAgentDisposed({ agent: { id: 'child-after-dispose' } })).not.toThrow()
    // 重复卸载仍幂等（与既有断言同口径）
    expect(() => host.dispose()).not.toThrow()
  })
})

describe('内置预设模板播种', () => {
  it('首次启动自动带上流程设计指南预设模板', async () => {
    const { host } = await bootHost()
    const preset = (await host.store.listFlowTemplates()).find((item) => item.id === 'tpl-mvciz28k-jvzw9u')
    expect(preset?.name).toBe('流程设计指南（预设模版）')
    expect(preset?.mode).toBe('mode1')
  })

  it('英文界面首次启动注入英文版；中文界面注入中文版', async () => {
    const english = await bootHost(undefined, {
      describe: () => [{ ns: 'locale', value: { preference: 'en' } }],
    })
    expect((await english.host.store.getFlowTemplate('tpl-mvciz28k-jvzw9u'))?.name).toBe(
      'Process Design Guide (Preset Template)',
    )

    const chinese = await bootHost(undefined, {
      describe: () => [{ ns: 'locale', value: { preference: 'zh' } }],
    })
    expect((await chinese.host.store.getFlowTemplate('tpl-mvciz28k-jvzw9u'))?.name).toBe('流程设计指南（预设模版）')
  })

  it('删除预设模板后重启不复活（播种标记随数据目录持久化）', async () => {
    const { root, host, dir } = await bootHost()
    expect(await host.store.deleteFlowTemplate('tpl-mvciz28k-jvzw9u')).toBe(true)
    await root.fiber.dispose()

    const second = await bootHost(dir)
    expect(await second.host.store.getFlowTemplate('tpl-mvciz28k-jvzw9u')).toBeNull()
  })

  it('播种标记损坏时只告警，不阻断插件启动（best-effort 降级）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-r4-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, 'builtin-seeds.json'), '{ 不是合法 JSON', 'utf8')

    const { host } = await bootHost(dir)
    // 播种被跳过：不把「标记读不到」误当成「从未播种」，也不写入模板。
    expect(await host.store.listFlowTemplates()).toEqual([])
    // 宿主其余能力照常：数据目录仍可正常读写。
    await host.store.saveFlowTemplate({
      id: 'tpl-after-corrupt-seed',
      mode: 'mode1',
      name: '仍可保存',
      description: '',
      nodes: [],
      lines: [],
    })
    expect((await host.store.listFlowTemplates()).map((item) => item.id)).toContain('tpl-after-corrupt-seed')
  })
})

describe('内置父代理模板播种', () => {
  it('初始化后模板库有且仅有一条父代理模板，正文来自五维职责唯一源', async () => {
    const { host } = await bootHost()

    const parents = (await host.store.listTemplates('role')).filter((role) => role.kind === 'parent')
    expect(parents).toHaveLength(1)
    expect(parents[0]).toMatchObject({
      id: 'role-parent-builtin',
      kind: 'parent',
      name: '父代理',
      presetId: 'standard',
      retryLimit: 3,
    })
    // 数据接线（不锁定正文内容）：播种正文即五维职责常量
    expect(parents[0].systemPrompt).toBe(PARENT_ROLE_DUTIES)
  })

  it('已有父代理模板时重启动不覆盖、不重复播种', async () => {
    const { root, host, dir } = await bootHost()
    const before = (await host.store.listTemplates('role')).find((role) => role.kind === 'parent')
    expect(before).toBeDefined()
    // 用户改写内置模板（模板侧无版本记账，改即生效）
    await host.store.saveTemplate('role', { ...before!, systemPrompt: '用户改写的父代理职责' })
    await root.fiber.dispose()

    const second = await bootHost(dir)
    const parents = (await second.host.store.listTemplates('role')).filter((role) => role.kind === 'parent')
    expect(parents).toHaveLength(1)
    expect(parents[0].id).toBe('role-parent-builtin')
    expect(parents[0].systemPrompt).toBe('用户改写的父代理职责')
  })
})

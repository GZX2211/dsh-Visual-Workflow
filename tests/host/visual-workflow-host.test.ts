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
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VisualWorkflowHost, VisualWorkflowHostServiceName, type Config } from '../../src/host/index.js'
import { VISUAL_WORKFLOW_PROMPT_SECTION } from '../../src/host/agent/prompt-setup.js'

/** 构造含临时 dataDir 的完整配置（其余键取 schema 默认）。 */
function makeConfig(dir: string): Config {
  return {
    dataDir: dir,
    servicePortBase: 7860,
    apiKey: null,
    maxConcurrentPerService: 50,
    wfAskAgentTtlMs: 120000,
    runIdleTimeoutMs: 1800000,
    runPollMs: 2000,
    reactIterationLimitDefault: 0,
    retryLimitDefault: 3,
    outputFullLimit: 102400,
    documentTextLimit: 20000,
    embeddingModelDir: null,
    embeddingEndpoint: null,
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
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 取宿主私有事件处理器的调用面（与 host-assembly 集成测试同款最小结构收窄）。 */
type HostEventSurface = {
  childPrompt: { withPending<T>(state: unknown, operation: () => Promise<T>): Promise<T> }
  onAgentCreated(payload: unknown): void
  onAgentDisposed(payload: unknown): void
}

async function bootHost(): Promise<{ root: Context; host: VisualWorkflowHost }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-r4-host-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const root = new Context()
  await root.plugin(VisualWorkflowHost, makeConfig(dir))
  const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost
  cleanups.push(async () => {
    await root.fiber.dispose()
  })
  return { root, host }
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

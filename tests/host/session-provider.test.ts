// tests/host/session-provider.test.ts
//
// CordisSessionProvider.createSession「新会话」预设装配：
//   - 具备 agentPresets 服务时：先 resolve，再在 agents.create 的 setup 里 mount，
//     header 记录 resolved id —— 否则新会话根 Agent 只继承全局层（宿主+插件+MCP）工具，
//     官方 standard 预设工具全部缺失（「启动时开启新会话」只显示注册工具/MCP 工具的根因）。
//   - 缺失 agentPresets 服务时：降级为不挂载（会话按全局层运行），且不写 agentPreset header。

import { describe, expect, it, vi } from 'vitest'
import { CordisSessionProvider } from '../../src/host/scheduler/session-provider.js'

/** 记录 agents.create 参数的 fake（含 setup 捕获）。 */
interface CreateCall {
  sessionId: string
  meta?: { cwd?: string; agentPreset?: string }
  setup?: (agentCtx: unknown) => Promise<unknown> | void
}

function fakeAgents() {
  const calls: CreateCall[] = []
  return {
    calls,
    service: {
      create: vi.fn(async (options: CreateCall) => {
        calls.push(options)
        return { agent: { id: options.sessionId } }
      }),
    },
  }
}

/** 记录 resolve/mount 调用的 fake agentPresets。 */
function fakePresets(resolved = { id: 'standard' }) {
  const calls: { resolve: string[]; mount: Array<{ agentCtx: unknown; id: string }> } = {
    resolve: [],
    mount: [],
  }
  return {
    calls,
    service: {
      resolve: vi.fn(async (id?: string) => {
        calls.resolve.push(id ?? '')
        return { id: resolved.id }
      }),
      mount: vi.fn(async (agentCtx: unknown, id?: string) => {
        calls.mount.push({ agentCtx, id: id ?? '' })
        return {}
      }),
    },
  }
}

/** 最小 ctx fake：get(name) 返回已注册服务。 */
function fakeCtx(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] } as never
}

describe('CordisSessionProvider.createSession 预设装配', () => {
  it('具备 agentPresets 服务：resolve 后写入 resolved id，并在 setup 内 mount', async () => {
    const agents = fakeAgents()
    const presets = fakePresets({ id: 'standard' })
    const provider = new CordisSessionProvider(fakeCtx({ agents: agents.service, agentPresets: presets.service }))

    const sessionId = await provider.createSession({ label: '工作流：测试', agentPreset: 'standard', cwd: 'D:\\work' })

    expect(sessionId).toMatch(/^sched-[0-9a-f]{16}$/)
    expect(presets.calls.resolve).toEqual(['standard'])
    const createCall = agents.calls[0]
    expect(createCall.meta).toMatchObject({ agentPreset: 'standard', cwd: 'D:\\work' })
    expect(typeof createCall.setup).toBe('function')

    // 触发 setup：把 preset 挂载到 agentCtx（官方工具/prompt 段对 agent 可见）
    const agentCtx = { marker: 'agent' }
    await (createCall.setup as (ctx: unknown) => Promise<unknown>)(agentCtx)
    expect(presets.calls.mount).toEqual([{ agentCtx, id: 'standard' }])
  })

  it('agentPreset 缺省：默认 standard', async () => {
    const agents = fakeAgents()
    const presets = fakePresets({ id: 'standard' })
    const provider = new CordisSessionProvider(fakeCtx({ agents: agents.service, agentPresets: presets.service }))

    await provider.createSession({ label: '定时任务：x' })
    expect(presets.calls.resolve).toEqual(['standard'])
    expect(agents.calls[0].meta?.agentPreset).toBe('standard')
  })

  it('agentPresets 服务缺失：降级不挂载，不写 agentPreset header', async () => {
    const agents = fakeAgents()
    const provider = new CordisSessionProvider(fakeCtx({ agents: agents.service }))

    await provider.createSession({ label: '无预设部署', cwd: 'D:\\work' })

    const createCall = agents.calls[0]
    expect(createCall.setup).toBeUndefined()
    expect(createCall.meta).toMatchObject({ cwd: 'D:\\work' })
    expect(createCall.meta?.agentPreset).toBeUndefined()
  })

  it('agents 服务缺失：抛出明确错误', async () => {
    const provider = new CordisSessionProvider(fakeCtx({}))
    await expect(
      provider.createSession({ label: 'x', agentPreset: 'standard' }),
    ).rejects.toThrow(/agents 服务不支持创建会话/)
  })
})

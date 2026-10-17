// tests/host/agent/member-launcher.test.ts
//
// Team 成员启动器单测（官方 Agent Team 路径）：
//   - available 判据：官方服务 / 根 Agent / provider / **官方工具面** 任一缺失即不可用；
//   - 创建路径：调用官方 spawnTeammate，首条 prompt = 官方身份前缀 + 插件任务块，
//     成员级组成（角色提示词 / 模型选择 / 工具白名单）在创建窗口内生效；
//   - 复用路径：官方成员名永久不可复用 → 已存在同名成员改用 sendMessage 派发；
//   - 失败路径：failed / provisioning 成员、无 provider、名额耗尽、组成签名变化告警；
//   - 状态读源：memberStatusOf 直接读官方 roster（插件不维护第二套成员状态）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../src/host/storage/flow-store.js'
import { TeamMemberLauncher, type TeamMemberLauncherDeps } from '../../../src/host/agent/member-launcher.js'
import { createChildToolFilterSetup } from '../../../src/host/agent/child-tool-filter.js'
import { createChildPromptSetup } from '../../../src/host/agent/prompt-setup.js'
import { createModelSelectionSetup } from '../../../src/host/agent/model-selection.js'
import type { NodeStartInput } from '../../../src/host/orchestrator/index.js'
import type { RoleNode } from '../../../src/host/shared/graph-model.js'
import type { AgentTeamsServiceLike, TeamMemberViewLike } from '../../../src/host/team/index.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

// ---------------------------------------------------------------------------
// Fake：子代理作用域上下文（模拟宿主在 agent/created 创建窗口内安装贡献）
// ---------------------------------------------------------------------------

type Listener = (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown

class FakeChildCtx {
  readonly sections: Array<{ name: string; order: number; text: unknown }> = []
  readonly restrictCalls: Array<{ allow?: string[]; deny?: string[] }> = []
  private readonly listeners = new Map<string, Listener[]>()

  readonly ctx = {
    on: (name: string, listener: Listener): (() => void) => {
      const list = this.listeners.get(name) ?? []
      list.push(listener)
      this.listeners.set(name, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    systemPrompt: {
      section: (input: { name: string; order: number; text: unknown }): (() => void) => {
        this.sections.push(input)
        return () => {}
      },
    },
    get: (name: string): unknown => (name === 'tools'
      ? { restrict: (filter: { allow?: string[]; deny?: string[] }): (() => void) => { this.restrictCalls.push(filter); return () => {} } }
      : undefined),
  }

  /** 瀑布链派发（沿用官方事件形状：除尾位 next 外参数逐个展开）。 */
  async dispatch(name: string, args: unknown[], terminal: () => Promise<unknown>): Promise<unknown> {
    const list = [...(this.listeners.get(name) ?? [])]
    let index = -1
    const chain = async (): Promise<unknown> => {
      index += 1
      const listener = list[index]
      if (!listener) return terminal()
      return (listener as (...rest: unknown[]) => unknown)(...args, chain)
    }
    return chain()
  }
}

// ---------------------------------------------------------------------------
// 装配 fake harness
// ---------------------------------------------------------------------------

interface SpawnCapture {
  request: { name: string; description: string; context: string; provider: string; prompt: unknown[] }
  child: FakeChildCtx
}

interface Harness {
  launcher: TeamMemberLauncher
  store: FlowStore
  teams: { spawnTeammate: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn>; listMembers: ReturnType<typeof vi.fn> }
  spawns: SpawnCapture[]
  memberRows: TeamMemberViewLike[]
  react: { setLimit: ReturnType<typeof vi.fn>; drop: ReturnType<typeof vi.fn>; consumeCapped: ReturnType<typeof vi.fn> }
  resolveTools: ReturnType<typeof vi.fn>
  logger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> }
  modelSelection: ReturnType<typeof createModelSelectionSetup>
  toolFilter: ReturnType<typeof createChildToolFilterSetup>
  promptSetup: ReturnType<typeof createChildPromptSetup>
  /** 组成签名可变入口（验证签名变化告警而不重建成员）。 */
  setSignature(value: string): void
}

async function makeHarness(options: { root?: boolean; provider?: string; service?: boolean; toolFace?: boolean; memberLimit?: number } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-member-launcher-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()

  const modelSelection = createModelSelectionSetup()
  const toolFilter = createChildToolFilterSetup()
  const promptSetup = createChildPromptSetup()
  let signature = 'signature-1'

  const memberRows: TeamMemberViewLike[] = []
  const spawns: SpawnCapture[] = []
  let seq = 0

  const teams = {
    listMembers: vi.fn(() => [...memberRows]),
    sendMessage: vi.fn(async () => ({ messageId: 'msg-1', status: 'accepted' as const })),
    spawnTeammate: vi.fn(async (_caller: unknown, request: { name: string; description: string; context: string; provider: string; prompt: unknown[] }) => {
      seq += 1
      const childId = `child-${seq}`
      const child = new FakeChildCtx()
      // 模拟宿主 agent/created：在创建窗口内安装每子代理作用域贡献（角色提示词/模型/工具白名单）
      promptSetup.contribution(child.ctx)
      modelSelection.contribution(child.ctx)
      toolFilter.contribution(child.ctx)
      spawns.push({ request, child })
      const row: TeamMemberViewLike = { id: childId, name: request.name, role: 'teammate', status: 'inactive' }
      memberRows.push(row)
      return { member: row }
    }),
  }

  const react = { setLimit: vi.fn(), drop: vi.fn(), consumeCapped: vi.fn(() => false) }
  const resolveTools = vi.fn(async () => ['read', 'write'])
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const agentTools = options.toolFace === false
    ? ['read', 'write', 'edit']
    : ['read', 'write', 'edit', 'spawn_teammate', 'send_message']

  const deps: TeamMemberLauncherDeps = {
    store,
    agents: () => ((options.root ?? true) ? { get: (id: string) => (id === 'session-1' ? { id } : undefined) } as never : null),
    subagents: () => ({ getProvider: (name: string) => ((options.provider ?? 'spawn') === name ? { name } : undefined) } as never),
    teams: () => ((options.service ?? true) ? (teams as unknown as AgentTeamsServiceLike) : null),
    toolsView: {
      visibleToolNames: async () => [],
      presetToolNames: async () => null,
      agentToolNames: async () => agentTools,
      agentToolNamesSync: () => agentTools,
    },
    toolSwitches: async () => new Set(['disabled-tool']),
    react: react as never,
    modelSelection,
    toolFilter,
    promptSetup,
    memberLimit: options.memberLimit ?? 8,
    logger,
    resolveTools: resolveTools as never,
    resolveRolePrompt: async (node: RoleNode) => `角色提示词：${node.data.label}`,
    detectProvider: (service) => (service.getProvider?.('spawn') ? 'spawn' : null),
    signatureOf: () => signature,
  }

  return {
    launcher: new TeamMemberLauncher(deps),
    store,
    teams,
    spawns,
    memberRows,
    react,
    resolveTools,
    logger,
    modelSelection,
    toolFilter,
    promptSetup,
    setSignature: (value: string) => { signature = value },
  }
}

function roleNode(id: string, label: string, extra: Record<string, unknown> = {}): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `你是${label}`,
      provider: 'commandcode',
      model: 'deepseek/deepseek-v4.1-flash',
      retryLimit: 1,
      ...extra,
    },
  } as RoleNode
}

function memberInput(overrides: Partial<NodeStartInput> = {}): NodeStartInput {
  return {
    sessionId: 'session-1',
    flowId: 'flow-1',
    mode: 'mode1',
    node: roleNode('n-be-dev', '后端开发工程师'),
    blocks: [{ type: 'text', text: '任务1' }],
    teamMember: true,
    signal: new AbortController().signal,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('TeamMemberLauncher.available', () => {
  it('服务 / 根 Agent / provider / 官方工具面任一缺失 → 不可用（调用方降级为普通子代理）', async () => {
    expect((await makeHarness()).launcher.available('session-1')).toBe(true)
    expect((await makeHarness({ service: false })).launcher.available('session-1')).toBe(false)
    expect((await makeHarness({ root: false })).launcher.available('session-1')).toBe(false)
    expect((await makeHarness({ provider: 'missing' })).launcher.available('session-1')).toBe(false)
    // 只挂领域服务（agent-team）而无工具/策略包（tool-agent-team）：成员拿不到官方九工具与 team:policy
    expect((await makeHarness({ toolFace: false })).launcher.available('session-1')).toBe(false)
  })
})

describe('TeamMemberLauncher.start（创建路径）', () => {
  it('官方服务不可用 → 返回 null（不抛错，由调用方降级）', async () => {
    const h = await makeHarness({ service: false })
    expect(await h.launcher.start(memberInput())).toBeNull()
    expect(h.teams.spawnTeammate).not.toHaveBeenCalled()
  })

  it('调用官方 spawnTeammate：成员名派生、职责为角色名、context=fresh、provider 探测', async () => {
    const h = await makeHarness()
    const result = await h.launcher.start(memberInput())

    expect(result).toEqual({ childId: 'child-1', target: 'm-n-be-dev', created: true })
    expect(h.teams.spawnTeammate).toHaveBeenCalledTimes(1)
    const request = h.spawns[0]?.request
    expect(request?.name).toBe('m-n-be-dev')
    expect(request?.description).toBe('后端开发工程师')
    expect(request?.context).toBe('fresh')
    expect(request?.provider).toBe('spawn')
  })

  it('首条 prompt 只含插件任务块：身份由官方 team:identity 系统上下文注入', async () => {
    const h = await makeHarness()
    await h.launcher.start(memberInput())

    expect(h.spawns[0]?.request.prompt).toEqual([{ type: 'text', text: '任务1' }])
  })

  it('成员级组成在创建窗口内生效：角色提示词段 / 工具白名单 / 模型选择三处均按该成员配置', async () => {
    const h = await makeHarness()
    await h.launcher.start(memberInput())

    const child = h.spawns[0]?.child
    expect(child).toBeDefined()
    expect(child!.sections[0]?.name).toBe('visual-workflow:prompt')
    expect((child!.sections[0]?.text as () => string)()).toBe('角色提示词：后端开发工程师')
    expect(child!.restrictCalls[0]).toEqual({ allow: ['read', 'write'] })
    // 官方时序：selection 由组装期捕获，故先组装后请求
    await child!.dispatch('system-prompt/assemble', [{ variables: {} }, {}], async () => ({ variables: {} }))
    const resolved = await child!.dispatch('agent/request', [{}], async () => ({ provider: 'parent', model: 'parent', reasoningEffort: 'low' }))
    expect(resolved).toEqual({ provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' })
  })

  it('成员工具白名单解析沿用普通节点路径口径（成员节点 + 全局关闭工具快照）', async () => {
    const h = await makeHarness()
    await h.launcher.start(memberInput())
    const firstArg = h.resolveTools.mock.calls[0]?.[0] as Record<string, unknown>
    expect(firstArg.node).toMatchObject({ id: 'n-be-dev' })
    expect(firstArg.sessionId).toBe('session-1')
    expect(firstArg.flowId).toBe('flow-1')
    expect([...(firstArg.disabledTools as Set<string>)]).toEqual(['disabled-tool'])
  })

  it('软截停上限按成员 child 登记（iterationLimit 缺省即清除）', async () => {
    const h = await makeHarness()
    await h.launcher.start(memberInput({ iterationLimit: 7 }))
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 7)

    const h2 = await makeHarness()
    await h2.launcher.start(memberInput())
    expect(h2.react.setLimit).toHaveBeenCalledWith('child-1', undefined)
  })
})

describe('TeamMemberLauncher.start（复用路径）', () => {
  it('官方成员名已存在 → 不重建，改用 sendMessage 派发本轮任务（created=false）', async () => {
    const h = await makeHarness()
    h.memberRows.push({ id: 'child-existing', name: 'm-n-be-dev', role: 'teammate', status: 'inactive' })

    const result = await h.launcher.start(memberInput())

    expect(h.teams.spawnTeammate).not.toHaveBeenCalled()
    expect(h.teams.sendMessage).toHaveBeenCalledTimes(1)
    const request = h.teams.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>
    expect(request.target).toBe('m-n-be-dev')
    expect(request.content).toEqual([{ type: 'text', text: '任务1' }])
    expect(result).toEqual({ childId: 'child-existing', target: 'm-n-be-dev', created: false })
  })

  it('复用路径同样刷新成员护栏上限并留存组成（供重发布重装）', async () => {
    const h = await makeHarness()
    h.memberRows.push({ id: 'child-existing', name: 'm-n-be-dev', role: 'teammate', status: 'running' })
    await h.launcher.start(memberInput({ iterationLimit: 7 }))
    expect(h.react.setLimit).toHaveBeenCalledWith('child-existing', 7)
    const restored = h.toolFilter.restore('child-existing', new FakeChildCtx().ctx)
    expect(restored).toBeTypeOf('function')
  })

  it('复用不占新名额：名额已满时既有成员仍可正常派发', async () => {
    const h = await makeHarness({ memberLimit: 1 })
    h.memberRows.push({ id: 'child-existing', name: 'm-n-be-dev', role: 'teammate', status: 'inactive' })

    const result = await h.launcher.start(memberInput())

    expect(result).toEqual({ childId: 'child-existing', target: 'm-n-be-dev', created: false })
  })
})

describe('TeamMemberLauncher.start（失败与诊断路径）', () => {
  it('同名成员创建失败（failed）：既不能复用也不能重建 → 抛出可行动错误', async () => {
    const h = await makeHarness()
    h.memberRows.push({ id: 'child-dead', name: 'm-n-be-dev', role: 'teammate', status: 'failed' })
    await expect(h.launcher.start(memberInput())).rejects.toThrow(/创建失败且名字已被占用/)
    expect(h.teams.spawnTeammate).not.toHaveBeenCalled()
    expect(h.teams.sendMessage).not.toHaveBeenCalled()
  })

  it('同名成员仍在创建（provisioning）：提示稍后重试', async () => {
    const h = await makeHarness()
    h.memberRows.push({ id: 'child-pending', name: 'm-n-be-dev', role: 'teammate', status: 'provisioning' })
    await expect(h.launcher.start(memberInput())).rejects.toThrow(/仍在创建中/)
  })

  it('无可用 provider：抛出明确错误', async () => {
    const h = await makeHarness({ provider: 'missing' })
    await expect(h.launcher.start(memberInput())).rejects.toThrow(/没有可用的子代理 provider/)
  })

  it('名额耗尽：新建成员前给出可行动错误（官方 maxMembers 按会话累计，含失败的成员）', async () => {
    const h = await makeHarness({ memberLimit: 1 })
    // lead 伪行不占名额（官方 listMembers 含 Lead 行）
    h.memberRows.push({ id: 'lead', name: 'lead', role: 'lead', status: 'running' })
    h.memberRows.push({ id: 'child-other', name: 'm-other', role: 'teammate', status: 'failed' })

    await expect(h.launcher.start(memberInput())).rejects.toThrow(/名额已用尽（已创建 1 \/ 上限 1）/)
    expect(h.teams.spawnTeammate).not.toHaveBeenCalled()
  })

  it('成员组成签名变化：复用既有成员并给出告警（官方成员在会话内不可重建）', async () => {
    const h = await makeHarness()
    h.memberRows.push({ id: 'child-existing', name: 'm-n-be-dev', role: 'teammate', status: 'inactive' })
    await h.launcher.start(memberInput())
    h.setSignature('signature-2')
    await h.launcher.start(memberInput())
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('但官方成员在会话内不可重建'))
  })
})

describe('TeamMemberLauncher.memberStatusOf（成员运行态权威读源）', () => {
  it('直接读官方 roster：命中返回官方状态，未创建返回 null', async () => {
    const h = await makeHarness()
    expect(h.launcher.memberStatusOf('session-1', 'n-be-dev')).toBeNull()

    h.memberRows.push({ id: 'child-1', name: 'm-n-be-dev', role: 'teammate', status: 'inactive' })
    expect(h.launcher.memberStatusOf('session-1', 'n-be-dev')).toBe('inactive')

    h.memberRows[0] = { id: 'child-1', name: 'm-n-be-dev', role: 'teammate', status: 'running' }
    expect(h.launcher.memberStatusOf('session-1', 'n-be-dev')).toBe('running')
  })

  it('官方服务不可用 → null（调用方退回图判定）', async () => {
    const h = await makeHarness({ service: false })
    expect(h.launcher.memberStatusOf('session-1', 'n-be-dev')).toBeNull()
  })
})

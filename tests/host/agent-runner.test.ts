// tests/host/agent-runner.test.ts
//
// 节点子代理执行引擎单测（T-022）：复用键/配置签名/白名单解析（可选注入）/
// ensureNodeChild（创建/签名重建）/startNodeTask（followup 派发）/interruptChild/
// 软截停消费/可见性双保险。
//
// DoD（任务清单 T-022）：签名重建、白名单∩父代理工具集、wf_ask/wf_ask_agent 仅
// 勾选注入、wf_run_node/wf_finish 子代理不可见、ReAct 软截停输出结论（guards 单测）。
// 断言依据：架构文档 §4.2 L218-219、需求文档 §4.4.2 规则 7 / §4.4.3 规则 5。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  NodeAgentRunner,
  childKey,
  childVisibilityContribution,
  nodeChildSignature,
  pickProviderName,
  resolveAgentTools,
  type AgentsServiceLike,
  type SubagentsServiceLike,
  type ToolsView,
} from '../../src/host/agent/runner.js'
import type { ReactGuardBridge } from '../../src/host/agent/guards.js'
import type { ModelSelectionSetup } from '../../src/host/agent/model-selection.js'
import type { NodeStartInput } from '../../src/host/orchestrator/runtime.js'
import type { RoleNode } from '../../src/host/shared/graph-model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 角色节点（固定 id）。 */
function agentNode(id: string, extra: Partial<RoleNode['data']> = {}): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label: `节点${id}`,
      systemPrompt: `任务：${id}`,
      provider: 'deepseek',
      model: 'deepseek-chat',
      presetId: 'combo-c1',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      proxySourceId: null,
      ...extra,
    },
  }
}

function blocks(text = '任务块'): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }]
}

/** 子代理服务 fake：记录创建/派发/中断/贡献注册。 */
class FakeSubagents implements SubagentsServiceLike {
  providers: string[] = ['spawn', 'fork', 'acp']
  started: Array<Parameters<SubagentsServiceLike['startContinuable']>[0]> = []
  followups: Array<{ parent: unknown; childId: string; content: unknown[]; source: unknown; signal?: AbortSignal }> = []
  interrupts: Array<{ childId: string; authority: { kind: 'user'; parentSessionId: string } }> = []
  setups: Array<(childCtx: unknown) => () => void> = []
  failStart: unknown = null
  private seq = 0
  list(): string[] {
    return [...this.providers]
  }
  async startContinuable(spec: Parameters<SubagentsServiceLike['startContinuable']>[0]): Promise<{ childId: string }> {
    this.started.push(spec)
    if (this.failStart !== null) {
      const error = this.failStart
      this.failStart = null
      throw error instanceof Error ? error : new Error(String(error))
    }
    this.seq += 1
    return { childId: `child-${this.seq}` }
  }
  async followup(parent: unknown, childId: string, content: unknown[], options: { source: unknown; signal?: AbortSignal }): Promise<void> {
    this.followups.push({ parent, childId, content, source: options.source, signal: options.signal })
  }
  async interrupt(childId: string, authority: { kind: 'user'; parentSessionId: string }): Promise<void> {
    this.interrupts.push({ childId, authority })
  }
  registerContinuableSetup(contribution: (childCtx: unknown) => () => void): () => void {
    this.setups.push(contribution)
    return () => {}
  }
}

/** agents 服务 fake：父代理 + 子代理（带 ctx 供模型选择挂接）。 */
class FakeAgentsService implements AgentsServiceLike {
  parents = new Map<string, { id: string; status?: string }>()
  children = new Map<string, { id: string; ctx?: unknown }>()
  get(id: string): unknown {
    return this.parents.get(id) ?? this.children.get(id)
  }
}

/** 工具视图 fake：可见集与 preset 解析可控。 */
class FakeToolsView implements ToolsView {
  visible: string[] = ['read', 'write', 'edit', 'wf_ask', 'wf_ask_agent', 'wf_db_query', 'wf_run_node', 'wf_finish', 'mcp__srv1__a', 'mcp__srv1__b']
  presets = new Map<string, string[] | null>()
  async visibleToolNames(): Promise<string[]> {
    return [...this.visible]
  }
  async presetToolNames(presetId: string): Promise<string[] | null> {
    return this.presets.get(presetId) ?? null
  }
}

interface RunnerHarness {
  runner: NodeAgentRunner
  store: FlowStore
  subagents: FakeSubagents
  agents: FakeAgentsService
  toolsView: FakeToolsView
  react: { setLimit: ReturnType<typeof vi.fn>; drop: ReturnType<typeof vi.fn>; consumeCapped: ReturnType<typeof vi.fn> }
  modelSelection: { contribution: ReturnType<typeof vi.fn>; attach: ReturnType<typeof vi.fn> }
}

async function makeHarness(): Promise<RunnerHarness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-runner-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const subagents = new FakeSubagents()
  const agents = new FakeAgentsService()
  agents.parents.set('session-1', { id: 'session-1' })
  const toolsView = new FakeToolsView()
  const react = { setLimit: vi.fn(), drop: vi.fn(), consumeCapped: vi.fn(() => false) }
  const modelSelection = { contribution: vi.fn(() => () => {}), attach: vi.fn() }
  const runner = new NodeAgentRunner({
    store,
    agents: () => agents,
    subagents: () => subagents,
    toolsView,
    react: react as unknown as ReactGuardBridge,
    modelSelection: modelSelection as unknown as ModelSelectionSetup,
  })
  return { runner, store, subagents, agents, toolsView, react, modelSelection }
}

function taskInput(overrides: Partial<NodeStartInput> = {}): NodeStartInput {
  return {
    sessionId: 'session-1',
    flowId: 'flow-1',
    node: agentNode('n-a1'),
    blocks: blocks(),
    signal: new AbortController().signal,
    iterationLimit: 7,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('childKey / nodeChildSignature / pickProviderName', () => {
  it('childKey：sessionId:flowId:nodeId 拼接', () => {
    expect(childKey('s1', 'f1', 'n1')).toBe('s1:f1:n1')
  })

  it('nodeChildSignature：工具清单排序；persona/provider/model/reasoning/presetId/tools 任一变化即签名变化', () => {
    const base = agentNode('n-a1')
    const signature = nodeChildSignature(base, ['read', 'bash'])
    expect(nodeChildSignature(base, ['bash', 'read'])).toBe(signature) // 排序无关
    expect(nodeChildSignature(agentNode('n-a1', { systemPrompt: '改' }), ['read', 'bash'])).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { provider: 'openai' }), ['read', 'bash'])).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { model: 'gpt-4' }), ['read', 'bash'])).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { reasoning: 'high' }), ['read', 'bash'])).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { presetId: 'combo-c2' }), ['read', 'bash'])).not.toBe(signature)
    expect(nodeChildSignature(base, ['read'])).not.toBe(signature)
  })

  it('pickProviderName：首选序 fork>spawn>codex>claude-code>dsh-sdk>acp；无首选回退首个；空清单 null', () => {
    expect(pickProviderName(['acp', 'spawn', 'fork'])).toBe('fork')
    expect(pickProviderName(['acp', 'codex'])).toBe('codex')
    expect(pickProviderName(['unknown-only'])).toBe('unknown-only')
    expect(pickProviderName([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 白名单解析
// ---------------------------------------------------------------------------

describe('resolveAgentTools 白名单解析（§4.2 L219）', () => {
  async function saveCombo(h: RunnerHarness, id: string, tools: string[], mcpServers: string[] = []): Promise<void> {
    await h.store.saveToolCombo({ id: id as `combo-${string}`, name: id, tools, mcpServers })
  }

  it('presetId 空 → 空白名单；无 db 连线不注入 wf_db_query', async () => {
    const h = await makeHarness()
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1', { presetId: '' }),
    })
    expect(tools).toEqual([])
  })

  it('combo：勾选 ∩ 可见（父代理工具集）+ 所选 MCP 前缀工具；wf_run_node/wf_finish 被白名单天然排除', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read', 'not-visible', 'wf_ask', 'wf_run_node', 'wf_finish'], ['srv1'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(tools.sort()).toEqual(['mcp__srv1__a', 'mcp__srv1__b', 'read', 'wf_ask'])
  })

  it('wf_ask/wf_ask_agent 仅勾选注入（无强制追加，PRD §4.4.2 规则 7）', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(tools).not.toContain('wf_ask')
    expect(tools).not.toContain('wf_ask_agent')
    expect(tools).toContain('read')
  })

  it('官方 preset：standing scope 工具名；服务缺失回退全部可见', async () => {
    const h = await makeHarness()
    h.toolsView.presets.set('standard', ['read', 'edit'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1', { presetId: 'standard' }),
    })
    expect(tools.sort()).toEqual(['edit', 'read'])

    const fallback = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1', { presetId: 'unknown-preset' }),
    })
    // 回退全部可见，但 wf_run_node/wf_finish 仍被无条件剔除（§4.4.2 规则 7）
    expect(fallback.sort()).toEqual(h.toolsView.visible.filter((n) => n !== 'wf_run_node' && n !== 'wf_finish').sort())
  })

  it('combo 不存在 → 明确报错', async () => {
    const h = await makeHarness()
    await expect(resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })).rejects.toThrow(/工具组合不存在/)
  })

  it('db-in 连线 → 追加 wf_db_query（§4.4.3 规则 5）；无连线不注入', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read'])
    // 保存带 db 连线的流程：database 节点 db-out → n-a1 db-in
    await h.store.saveWorkflow({
      id: 'flow-1', sessionId: 'session-1', mode: 'mode1', name: 'f', description: '', revision: 1,
      nodes: [
        { id: 'n-db', kind: 'database', position: { x: 0, y: 0 }, data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '' } },
        agentNode('n-a1'),
      ],
      lines: [{ id: 'l-db', source: 'n-db', target: 'n-a1', sourceHandle: 'db-out', targetHandle: 'db-in' }],
    }, 'session-1', { force: true })

    const withDb = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(withDb).toContain('wf_db_query')

    const withoutDb = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-none',
      node: agentNode('n-a1'),
    })
    expect(withoutDb).not.toContain('wf_db_query')
  })
})

// ---------------------------------------------------------------------------
// ensureNodeChild / startNodeTask
// ---------------------------------------------------------------------------

describe('NodeAgentRunner 创建/复用/派发', () => {
  it('首次创建：startContinuable 调用（provider 首选/任务块首条注入/persona/白名单/agentOptions）+ 护栏登记', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read', 'wf_ask'], mcpServers: [] })
    const result = await h.runner.startNodeTask(taskInput({ thinking: 'high' }))

    expect(result).toEqual({ childId: 'child-1', created: true })
    expect(h.subagents.started).toHaveLength(1)
    const spec = h.subagents.started[0]
    expect(spec.provider).toBe('fork') // 首选序
    expect(spec.label).toBe('visual-workflow:flow-1:n-a1')
    expect(spec.request.prompt).toEqual([{ type: 'text', text: '任务块' }]) // 首条消息=完整任务块
    expect(spec.request.persona).toBe('任务：n-a1')
    expect(spec.request.toolFilter).toEqual({ allow: ['read', 'wf_ask'] }) // 勾选∩可见（wf_ask 勾选注入）
    expect(spec.request.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 7)
  })

  it('签名一致复用：不重建；签名变化（persona）→ 重建（旧子代理保留历史）', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const first = await h.runner.ensureNodeChild(taskInput())
    const reused = await h.runner.ensureNodeChild(taskInput())
    expect(reused).toEqual({ childId: first.childId, created: false })
    expect(h.subagents.started).toHaveLength(1)

    const rebuilt = await h.runner.ensureNodeChild(taskInput({ node: agentNode('n-a1', { systemPrompt: '新任务' }) }))
    expect(rebuilt).toEqual({ childId: 'child-2', created: true })
    expect(h.subagents.started).toHaveLength(2)
  })

  it('白名单空 → 不传 toolFilter（边界由宿主组合决定）', async () => {
    const h = await makeHarness()
    await h.runner.ensureNodeChild(taskInput({ node: agentNode('n-a1', { presetId: '' }) }))
    expect(h.subagents.started[0].request.toolFilter).toBeUndefined()
  })

  it('父代理缺失 / subagents 缺失 / provider 不可用 → 明确报错', async () => {
    const h = await makeHarness()
    h.agents.parents.clear()
    await expect(h.runner.ensureNodeChild(taskInput())).rejects.toThrow(/Agent 未激活|Agent 服务不可用/)

    const h2 = await makeHarness()
    const runner2 = new NodeAgentRunner({
      store: h2.store,
      agents: () => null,
      subagents: () => new FakeSubagents(),
      toolsView: h2.toolsView,
      react: h2.react as unknown as ReactGuardBridge,
      modelSelection: h2.modelSelection as unknown as ModelSelectionSetup,
    })
    await expect(runner2.ensureNodeChild(taskInput())).rejects.toThrow(/Agent 服务不可用/)

    const h3 = await makeHarness()
    await h3.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    h3.subagents.providers = []
    await expect(h3.runner.ensureNodeChild(taskInput())).rejects.toThrow(/没有可用的子代理 provider/)
  })

  it('startNodeTask 复用派发：followup 调用（coordinator/relay source + signal 透传），立即返回', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const signal = new AbortController().signal
    await h.runner.startNodeTask(taskInput({ signal }))
    const result = await h.runner.startNodeTask(taskInput({ signal, blocks: blocks('第二轮') }))

    expect(result).toEqual({ childId: 'child-1', created: false })
    expect(h.subagents.followups).toHaveLength(1)
    const followup = h.subagents.followups[0]
    expect(followup.childId).toBe('child-1')
    expect(followup.parent).toEqual({ id: 'session-1' })
    expect(followup.content).toEqual([{ type: 'text', text: '第二轮' }])
    expect(followup.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'session-1' })
    expect(followup.signal).toBe(signal)
  })

  it('创建后挂接模型选择（经 child agent ctx）+ 复用派发后刷新护栏上限', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const childCtx = { marker: 'ctx' }
    h.agents.children.set('child-1', { id: 'child-1', ctx: childCtx })

    await h.runner.startNodeTask(taskInput({ thinking: 'high' }))
    expect(h.modelSelection.attach).toHaveBeenCalledWith(childCtx, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 7)
  })

  it('interruptChild：官方 interrupt（kind=user/parentSessionId）；异常吞掉（已停止视为成功）', async () => {
    const h = await makeHarness()
    await h.runner.interruptChild('child-9', 'session-1')
    expect(h.subagents.interrupts).toEqual([{ childId: 'child-9', authority: { kind: 'user', parentSessionId: 'session-1' } }])
  })

  it('consumeReactCapped 委托护栏桥；dispose 清理全部登记', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    await h.runner.ensureNodeChild(taskInput())
    h.react.consumeCapped.mockReturnValueOnce(true)
    expect(h.runner.consumeReactCapped('child-1')).toBe(true)
    h.runner.dispose()
    expect(h.react.drop).toHaveBeenCalledWith('child-1')
  })
})

// ---------------------------------------------------------------------------
// 可见性双保险贡献
// ---------------------------------------------------------------------------

describe('childVisibilityContribution（wf_run_node/wf_finish 双保险隐藏）', () => {
  it('tools.restrict 可用 → deny 两工具并返回 disposer', () => {
    const denies: unknown[] = []
    const disposed: unknown[] = []
    const fakeTools = {
      restrict: (filter: { deny?: string[] }) => {
        denies.push(filter)
        return () => disposed.push('disposed')
      },
    }
    const contribution = childVisibilityContribution()
    const childCtx = { get: (name: string) => (name === 'tools' ? fakeTools : undefined) }
    const disposer = contribution(childCtx)
    expect(denies).toEqual([{ deny: ['wf_run_node', 'wf_finish'] }])
    disposer()
    expect(disposed).toEqual(['disposed'])
  })

  it('tools 缺失/restrict 抛错 → 返回 no-op（白名单仍兜底）', () => {
    const contribution = childVisibilityContribution()
    expect(contribution({ get: () => undefined })()).toBeUndefined()
    const throwingTools = { restrict: () => { throw new Error('unknown tool') } }
    expect(() => contribution({ get: () => throwingTools })()).not.toThrow()
  })
})

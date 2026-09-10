// tests/host/agent-runner.test.ts
//
// 节点子代理执行引擎单测（T-022）：复用键/配置签名/白名单解析（可选注入）/
// ensureNodeChild（创建/签名重建）/startNodeTask（相邻 Agent 通道派发）/interruptChild/
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
  detectSubagentProvider,
  nodeChildSignature,
  pickProviderName,
  resolveAgentTools,
  type AgentsServiceLike,
  type SubagentsServiceLike,
  type ToolsView,
} from '../../src/host/agent/runner.js'
import type { ReactGuardBridge } from '../../src/host/agent/guards.js'
import type { ModelSelectionSetup } from '../../src/host/agent/model-selection.js'
import type { ChildPromptSetup } from '../../src/host/agent/prompt-setup.js'
import type { NodeStartInput } from '../../src/host/orchestrator/runtime.js'
import type { RoleNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

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
  /** 复用派发记录（0.1.5-rc.1：sendMessage 为唯一推荐通道）。 */
  dispatches: Array<{ sender: unknown; targetId: string; content: unknown[]; signal?: AbortSignal }> = []
  interrupts: Array<{ childId: string; authority: { kind: 'user'; parentSessionId: string } }> = []
  setups: Array<(childCtx: unknown) => () => void> = []
  failStart: unknown = null
  /** 时序断言钩子（派发触发时回调，用于验证 setLimit 先于派发）。 */
  onDispatch?: () => void
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
  /** 相邻 Agent 投递（live 父 Agent → direct child）；0.1.5-rc.1 已无 followup 通道。 */
  async sendMessage(sender: unknown, targetId: string, content: unknown[], options: { signal?: AbortSignal }): Promise<void> {
    this.onDispatch?.()
    this.dispatches.push({ sender, targetId, content, signal: options.signal })
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
  // run_code：官方在非 native 模式自动注入 scope（visible 含它，但不得进 allow 名单）；
  // str_replace_editor：官方简单模式专用工具——存在于可见并集（来自无关 preset standing
  // scope），但不在父代理 scope 视图（简单模式未启用），运行时被兜底剔除
  visible: string[] = ['read', 'write', 'edit', 'wf_ask', 'wf_ask_agent', 'wf_db_query', 'wf_run_node', 'wf_finish', 'run_code', 'str_replace_editor', 'mcp__srv1__a', 'mcp__srv1__b']
  presets = new Map<string, string[] | null>()
  /** 父代理 scope 视图（默认=可见集去掉 run_code 与幽灵工具；测试可覆盖）。 */
  agentTools: string[] | null = null
  async visibleToolNames(): Promise<string[]> {
    return [...this.visible]
  }
  async presetToolNames(presetId: string): Promise<string[] | null> {
    return this.presets.get(presetId) ?? null
  }
  async agentToolNames(): Promise<string[]> {
    return this.agentTools ?? this.visible.filter((name) => name !== 'run_code' && name !== 'str_replace_editor')
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
    promptSetup: { contribution: ReturnType<typeof vi.fn>; attach: ReturnType<typeof vi.fn> }
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
    const promptSetup = { contribution: vi.fn(() => () => {}), withPending: vi.fn((_state, operation) => operation()), attach: vi.fn() }
  const runner = new NodeAgentRunner({
    store,
    agents: () => agents,
    subagents: () => subagents,
    toolsView,
    react: react as unknown as ReactGuardBridge,
    modelSelection: modelSelection as unknown as ModelSelectionSetup,
    promptSetup: promptSetup as unknown as ChildPromptSetup,
  })
  return { runner, store, subagents, agents, toolsView, react, modelSelection, promptSetup }
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

  it('nodeChildSignature：工具清单排序；rolePrompt/injectSystemPrompt/provider/model/reasoning/presetId/tools 任一变化即签名变化', () => {
    const base = agentNode('n-a1')
    const signature = nodeChildSignature(base, ['read', 'bash'], '')
    expect(nodeChildSignature(base, ['bash', 'read'], '')).toBe(signature) // 排序无关
    expect(nodeChildSignature(base, ['read', 'bash'], '改')).not.toBe(signature) // rolePrompt 变化
    expect(nodeChildSignature(base, ['read', 'bash'], '', false)).not.toBe(signature) // injectSystemPrompt 关闭
    expect(nodeChildSignature(agentNode('n-a1', { provider: 'openai' }), ['read', 'bash'], '')).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { model: 'gpt-4' }), ['read', 'bash'], '')).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { reasoning: 'high' }), ['read', 'bash'], '')).not.toBe(signature)
    expect(nodeChildSignature(agentNode('n-a1', { presetId: 'combo-c2' }), ['read', 'bash'], '')).not.toBe(signature)
    expect(nodeChildSignature(base, ['read'], '')).not.toBe(signature)
  })

  it('pickProviderName：首选序 spawn>fork>codex>claude-code>dsh-sdk>acp；无首选回退首个；空清单 null', () => {
    expect(pickProviderName(['acp', 'spawn', 'fork'])).toBe('spawn')
    expect(pickProviderName(['acp', 'codex'])).toBe('codex')
    expect(pickProviderName(['unknown-only'])).toBe('unknown-only')
    expect(pickProviderName([])).toBeNull()
  })

  it('spawn 优先越权隔离回归：节点子代理不继承父编排上下文；仅 spawn 缺失时回退 fork', () => {
    // 官方：fork.inheritsParentContext=true（completedTurnPrefix 父会话种子）；spawn.inheritsParentContext=false（零父上下文）。
    // 工作流节点必须走 spawn（own session / own system prompt / zero parent context），否则父代理对话/提示词整段泄露给子节点。
    expect(pickProviderName(['fork', 'spawn'])).toBe('spawn')
    expect(pickProviderName(['spawn'])).toBe('spawn')
    // 仅 fork 可用（spawn 未注册）时仍可回退，保证运行可用而非崩溃
    expect(pickProviderName(['fork', 'acp'])).toBe('fork')
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

  it('combo：勾选 ∩ 可见（父代理工具集）+ 所选 MCP 前缀工具；wf_run_node/wf_finish/run_code/str_replace_editor 被白名单天然排除', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read', 'not-visible', 'wf_ask', 'wf_run_node', 'wf_finish', 'run_code', 'str_replace_editor'], ['srv1'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(tools).not.toContain('run_code') // 官方保留名（presentation transport）永不进入 allow
    // str_replace_editor：官方简单模式专用工具，当前父代理视图（简单模式未启用）不含它
    // → 运行时兜底剔除，避免官方 tools.restrict 抛 "names unknown global tool"
    expect(tools).not.toContain('str_replace_editor')
    expect(tools.sort()).toEqual(['mcp__srv1__a', 'mcp__srv1__b', 'read', 'wf_ask'])
  })

  it('str_replace_editor：父代理视图含它（简单模式启用）→ 保留进 allow', async () => {
    const h = await makeHarness()
    h.toolsView.agentTools = [...h.toolsView.visible, 'str_replace_editor']
    await saveCombo(h, 'combo-c1', ['read', 'str_replace_editor'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(tools).toContain('str_replace_editor')
    expect(tools).toContain('read')
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
    // 回退全部可见，但 wf_run_node/wf_finish 仍被无条件剔除（§4.4.2 规则 7）；
    // run_code 为官方保留名、str_replace_editor 不在父代理视图（简单模式未启用）同样剔除
    expect(fallback.sort()).toEqual(
      h.toolsView.visible.filter((n) => n !== 'wf_run_node' && n !== 'wf_finish' && n !== 'run_code' && n !== 'str_replace_editor').sort(),
    )
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

  it('模式二 db-in 连线同样注入 wf_db_query（服务文档按 mode 分派读取）', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read'])
    // 服务文档存于 services/ 目录（getWorkflow 读 workflows/ 恒为 null）
    const serviceFlow: WorkflowDocument = {
      id: 'svc-flow-1', sessionId: 'session-1', mode: 'mode2', name: '服务', description: '', revision: 1,
      nodes: [
        { id: 'n-db', kind: 'database', position: { x: 0, y: 0 }, data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '' } },
        agentNode('n-a1'),
      ],
      lines: [{ id: 'l-db', source: 'n-db', target: 'n-a1', sourceHandle: 'db-out', targetHandle: 'db-in' }],
    }
    await h.store.saveService(serviceFlow as never, 'session-1', { force: true })

    // 修复前：hasDbInLine 固定走 getWorkflow → null → wf_db_query 永不注入
    const withDb = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'svc-flow-1', mode: 'mode2',
      node: agentNode('n-a1'),
    })
    expect(withDb).toContain('wf_db_query')
    // 服务无 db 连线 → 不注入
    const noLineFlow: WorkflowDocument = { ...serviceFlow, id: 'svc-flow-2', lines: [] }
    await h.store.saveService(noLineFlow as never, 'session-1', { force: true })
    const withoutDb = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'svc-flow-2', mode: 'mode2',
      node: agentNode('n-a1'),
    })
    expect(withoutDb).not.toContain('wf_db_query')
  })

  it('全局关闭工具：组合勾选亦被剔除（父代理不可用 → 子代理不得携带，双保险第二层）', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read', 'write', 'wf_ask'], ['srv1'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
      disabledTools: new Set(['write', 'mcp__srv1__a']),
    })
    expect(tools).toContain('read')
    expect(tools).toContain('wf_ask')
    expect(tools).toContain('mcp__srv1__b')
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('mcp__srv1__a')
  })

  it('全局关闭工具：db-in 注入的 wf_db_query 同样被剔除', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read'])
    await h.store.saveWorkflow({
      id: 'flow-1', sessionId: 'session-1', mode: 'mode1', name: 'f', description: '', revision: 1,
      nodes: [
        { id: 'n-db', kind: 'database', position: { x: 0, y: 0 }, data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '' } },
        agentNode('n-a1'),
      ],
      lines: [{ id: 'l-db', source: 'n-db', target: 'n-a1', sourceHandle: 'db-out', targetHandle: 'db-in' }],
    }, 'session-1', { force: true })
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
      disabledTools: new Set(['wf_db_query']),
    })
    expect(tools).not.toContain('wf_db_query')
    expect(tools).toContain('read')
  })
})

// ---------------------------------------------------------------------------
// ensureNodeChild / startNodeTask
// ---------------------------------------------------------------------------

describe('NodeAgentRunner 创建/复用/派发', () => {
  it('首次创建：startContinuable 调用（provider 首选/任务块首条注入/不再传 persona/白名单/agentOptions）+ 护栏登记', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read', 'wf_ask'], mcpServers: [] })
    const result = await h.runner.startNodeTask(taskInput({ thinking: 'high' }))

    expect(result).toEqual({ childId: 'child-1', created: true })
    expect(h.subagents.started).toHaveLength(1)
    const spec = h.subagents.started[0]
    expect(spec.provider).toBe('spawn') // 首选序（零父上下文，避免父编排/上下文泄露）
    expect(spec.label).toBe('节点n-a1')
    expect(spec.request.prompt).toEqual([{ type: 'text', text: '任务块' }]) // 首条消息=完整任务块
    expect(spec.request.persona).toBeUndefined() // 角色 Prompt 改为 system prompt 段，不再传官方 persona
    expect(spec.request.toolFilter).toEqual({ allow: ['read', 'wf_ask'] }) // 勾选∩可见（wf_ask 勾选注入）
    expect(spec.request.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 7)
  })

  it('签名一致复用：不重建；签名变化（rolePrompt）→ 重建（旧子代理保留历史）', async () => {
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
      promptSetup: h2.promptSetup as unknown as ChildPromptSetup,
    })
    await expect(runner2.ensureNodeChild(taskInput())).rejects.toThrow(/Agent 服务不可用/)

    const h3 = await makeHarness()
    await h3.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    h3.subagents.providers = []
    await expect(h3.runner.ensureNodeChild(taskInput())).rejects.toThrow(/没有可用的子代理 provider/)
  })

  it('startNodeTask 复用派发：走 sendMessage（相邻 Agent 通道，signal 透传），立即返回', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const signal = new AbortController().signal
    await h.runner.startNodeTask(taskInput({ signal }))
    const result = await h.runner.startNodeTask(taskInput({ signal, blocks: blocks('第二轮') }))

    expect(result).toEqual({ childId: 'child-1', created: false })
    expect(h.subagents.dispatches).toHaveLength(1)
    const dispatch = h.subagents.dispatches[0]
    expect(dispatch.targetId).toBe('child-1')
    expect(dispatch.sender).toEqual({ id: 'session-1' })
    expect(dispatch.content).toEqual([{ type: 'text', text: '第二轮' }])
    expect(dispatch.signal).toBe(signal)
  })

  it('复用路径：setLimit 先于派发（软截停上限按次覆盖立即生效）', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    await h.runner.startNodeTask(taskInput()) // 首次创建
    h.react.setLimit.mockClear()
    const order: string[] = []
    const setLimitSpy = vi.fn((_childId: string, limit: number | undefined) => order.push(`setLimit:${limit}`))
    h.react.setLimit = setLimitSpy
    h.subagents.onDispatch = () => order.push('dispatch')
    // 第二轮复用并按次覆盖 limit：修复前 setLimit 在派发（await）之后执行，
    // 新回合第一步 pre-step 会读到旧上限；修复后必须先在派发前登记
    await h.runner.startNodeTask(taskInput({ iterationLimit: 3, blocks: blocks('第二轮') }))
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 3)
    expect(order).toEqual(['setLimit:3', 'dispatch'])
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

describe('childVisibilityContribution（wf_run_node/wf_run_node_wait/wf_finish 双保险隐藏）', () => {
  it('tools.restrict 可用 → deny 三个工具并返回 disposer', () => {
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
    expect(denies).toEqual([{ deny: ['wf_run_node', 'wf_run_node_wait', 'wf_finish'] }])
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

// ---------------------------------------------------------------------------
// DSH 0.1.2 子代理 seam（rc.1 SubagentRuntime 使用面）
// ---------------------------------------------------------------------------
// 取证（0.1.2-rc.1 类型）：rc.2 的 list()/followup/registerContinuableSetup 移除；
// 改 getProvider 按名探测、sendMessage/queuePrompt 相邻投递、interrupt(target, authority)。
// 每子代理作用域装配由 runner 在 startContinuable 返回后按 agents.get(childId).ctx 安装。

/** rc.1 面子代理服务 fake（无 list/followup/registerContinuableSetup）。 */
class Rc1FakeSubagents implements SubagentsServiceLike {
  providers: Record<string, unknown> = { spawn: {}, fork: {}, acp: {} }
  started: Array<Parameters<SubagentsServiceLike['startContinuable']>[0]> = []
  sent: Array<{ sender: unknown; targetId: string; content: unknown[]; signal?: AbortSignal }> = []
  queued: Array<{ parent: unknown; childId: string; content: unknown[]; source: unknown; signal?: AbortSignal }> = []
  interrupts: Array<{ childId: string; authority: { kind: 'user'; parentSessionId: string } }> = []
  /** startContinuable 成功后回调（模拟官方 provider 发布 child agent → agents.get(childId) 可达）。 */
  onStart?: (childId: string) => void
  private seq = 0

  getProvider(name: string): unknown {
    return this.providers[name]
  }
  async startContinuable(spec: Parameters<SubagentsServiceLike['startContinuable']>[0]): Promise<{ childId: string }> {
    this.started.push(spec)
    this.seq += 1
    const childId = `rc1-${this.seq}`
    this.onStart?.(childId)
    return { childId }
  }
  async sendMessage(sender: unknown, targetId: string, content: Array<{ type: 'text'; text: string }>, options: { signal?: AbortSignal }): Promise<unknown> {
    this.sent.push({ sender, targetId, content, signal: options.signal })
    return `mid-${targetId}`
  }
  async queuePrompt(parent: unknown, childId: string, content: Array<{ type: 'text'; text: string }>, source?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.queued.push({ parent, childId, content, source, signal })
    return `mid-${childId}`
  }
  interrupt(childId: string, authority: { kind: 'user'; parentSessionId: string }): void {
    this.interrupts.push({ childId, authority })
  }
}

/** rc.1 面「仅 queuePrompt、无 sendMessage」的子代理 fake（投递回退分支用）。 */
class Rc1QueueOnlySubagents implements SubagentsServiceLike {
  providers: Record<string, unknown> = { spawn: {} }
  started: Array<Parameters<SubagentsServiceLike['startContinuable']>[0]> = []
  queued: Array<{ parent: unknown; childId: string; content: unknown[]; source: unknown; signal?: AbortSignal }> = []
  interrupts: Array<{ childId: string; authority: { kind: 'user'; parentSessionId: string } }> = []
  onStart?: (childId: string) => void
  private seq = 0

  getProvider(name: string): unknown {
    return this.providers[name]
  }
  async startContinuable(spec: Parameters<SubagentsServiceLike['startContinuable']>[0]): Promise<{ childId: string }> {
    this.started.push(spec)
    this.seq += 1
    const childId = `rc1-${this.seq}`
    this.onStart?.(childId)
    return { childId }
  }
  async queuePrompt(parent: unknown, childId: string, content: Array<{ type: 'text'; text: string }>, source?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.queued.push({ parent, childId, content, source, signal })
    return `mid-${childId}`
  }
  interrupt(childId: string, authority: { kind: 'user'; parentSessionId: string }): void {
    this.interrupts.push({ childId, authority })
  }
}

describe('DSH 0.1.2 子代理 seam（getProvider 探测 / childSetup 安装 / sendMessage 复用派发 / interrupt）', () => {
  it('detectSubagentProvider：getProvider 按名探测命中首选；缺失回退 list()', () => {
    const rc1 = new Rc1FakeSubagents()
    expect(detectSubagentProvider(rc1)).toBe('spawn') // spawn 注册 → 首选
    delete rc1.providers.spawn
    expect(detectSubagentProvider(rc1)).toBe('fork')
    rc1.providers = {}
    expect(detectSubagentProvider(rc1)).toBeNull()
    // 旧面 fake（仅 list）回退 list() 清单
    const legacy = new FakeSubagents()
    legacy.providers = ['acp', 'fork']
    expect(detectSubagentProvider(legacy)).toBe('fork')
  })

  it('创建：startContinuable(provider=spawn)（getProvider 探测）返回 created=true；装配由 host 的 agent/session-start 负责', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    // 换成 rc.1 面 subagents：startContinuable 即发布 child agent（带 ctx）
    const rc1 = new Rc1FakeSubagents()
    rc1.onStart = (childId) => { h.agents.children.set(childId, { id: childId, ctx: { tag: `ctx-${childId}` } }) }
    // 0.1.2 起每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）不再由 runner 在
    // startContinuable 返回后安装，而是由 host 层监听 agent/session-start 在创建窗口内安装
    // （见 visual-workflow-host.ts），避免首轮系统提示词/工具第二轮才更新。runner 只负责创建。
    const runner = new NodeAgentRunner({
      store: h.store,
      agents: () => h.agents,
      subagents: () => rc1,
      toolsView: h.toolsView,
      react: h.react as unknown as ReactGuardBridge,
      modelSelection: h.modelSelection as unknown as ModelSelectionSetup,
      promptSetup: h.promptSetup as unknown as ChildPromptSetup,
    })
    const result = await runner.startNodeTask(taskInput())
    expect(result).toEqual({ childId: 'rc1-1', created: true })
    expect(rc1.started).toHaveLength(1)
    expect(rc1.started[0].provider).toBe('spawn') // getProvider 探测，而非 list()
    runner.dispose()
  })

  it('复用派发走 sendMessage（live 父 Agent → direct child），不再调 followup', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const rc1 = new Rc1FakeSubagents()
    rc1.onStart = (childId) => { h.agents.children.set(childId, { id: childId, ctx: { tag: `ctx-${childId}` } }) }
    const runner = new NodeAgentRunner({
      store: h.store,
      agents: () => h.agents,
      subagents: () => rc1,
      toolsView: h.toolsView,
      react: h.react as unknown as ReactGuardBridge,
      modelSelection: h.modelSelection as unknown as ModelSelectionSetup,
      promptSetup: h.promptSetup as unknown as ChildPromptSetup,
    })
    const signal = new AbortController().signal
    await runner.startNodeTask(taskInput({ signal }))
    const result = await runner.startNodeTask(taskInput({ signal, blocks: blocks('第二轮') }))
    expect(result).toEqual({ childId: 'rc1-1', created: false })
    expect(rc1.sent).toHaveLength(1)
    expect(rc1.sent[0].targetId).toBe('rc1-1')
    expect(rc1.sent[0].sender).toEqual({ id: 'session-1' }) // sender = live 父 Agent
    expect(rc1.sent[0].content).toEqual([{ type: 'text', text: '第二轮' }])
    expect(rc1.sent[0].signal).toBe(signal)
    expect((rc1 as unknown as { followups?: unknown }).followups).toBeUndefined()
    runner.dispose()
  })

  it('复用派发无 sendMessage 时回退 queuePrompt；interrupt 走 rc.1 签名', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    // 模拟宿主仅提供 queuePrompt（无 sendMessage）：deliverReuse 回退 queuePrompt
    const queueOnly = new Rc1QueueOnlySubagents()
    queueOnly.onStart = (childId) => h.agents.children.set(childId, { id: childId, ctx: {} })
    const runner = new NodeAgentRunner({
      store: h.store,
      agents: () => h.agents,
      subagents: () => queueOnly,
      toolsView: h.toolsView,
      react: h.react as unknown as ReactGuardBridge,
      modelSelection: h.modelSelection as unknown as ModelSelectionSetup,
      promptSetup: h.promptSetup as unknown as ChildPromptSetup,
    })
    await runner.startNodeTask(taskInput())
    const reused = await runner.startNodeTask(taskInput({ blocks: blocks('第三轮') }))
    expect(reused).toEqual({ childId: 'rc1-1', created: false })
    expect(queueOnly.queued).toHaveLength(1)
    expect(queueOnly.queued[0].childId).toBe('rc1-1')
    expect(queueOnly.queued[0].content).toEqual([{ type: 'text', text: '第三轮' }])

    // interrupt：rc.1 服务方法 interrupt(target, { kind:'user', parentSessionId })
    await runner.interruptChild('rc1-1', 'session-1')
    expect(queueOnly.interrupts).toEqual([{ childId: 'rc1-1', authority: { kind: 'user', parentSessionId: 'session-1' } }])
    runner.dispose()
  })
})

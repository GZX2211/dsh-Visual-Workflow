// tests/host/agent/runner.test.ts
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
import { FlowStore } from '../../../src/host/storage/flow-store.js'
import {
  CordisToolsView,
  NodeAgentRunner,
  childKey,
  childVisibilityContribution,
  detectSubagentProvider,
  nodeChildSignature,
  pickProviderName,
  resolveAgentTools,
  agentPresetsServiceOf,
  withPresetScope,
  type AgentsServiceLike,
  type SubagentsServiceLike,
  type ToolsView,
} from '../../../src/host/agent/runner.js'
import type { ReactGuardBridge } from '../../../src/host/agent/guards.js'
import type { ModelSelectionSetup } from '../../../src/host/agent/model-selection.js'
import type { ChildPromptSetup } from '../../../src/host/agent/prompt-setup.js'
import type { ChildToolFilterSetup } from '../../../src/host/agent/child-tool-filter.js'
import type { NodeStartInput } from '../../../src/host/orchestrator/index.js'
import type { RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { CHILD_AGENT_HIDDEN_TOOLS } from '../../../src/host/shared/protocol.js'

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

/** 子代理服务 fake：记录创建/派发/中断（旧宿主面；无 getProvider，走 list 回退）。 */
class FakeSubagents implements SubagentsServiceLike {
  providers: string[] = ['spawn', 'fork', 'acp']
  started: Array<Parameters<SubagentsServiceLike['startContinuable']>[0]> = []
  /** 复用派发记录（0.1.5-rc.1：sendMessage 为唯一推荐通道）。 */
  dispatches: Array<{ sender: unknown; targetId: string; content: unknown[]; signal?: AbortSignal }> = []
  interrupts: Array<{ childId: string; authority: { kind: 'user'; parentSessionId: string } }> = []
  failStart: unknown = null
  failDelivery: unknown = null
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
    if (this.failDelivery !== null) throw this.failDelivery
    this.dispatches.push({ sender, targetId, content, signal: options.signal })
  }
  async interrupt(childId: string, authority: { kind: 'user'; parentSessionId: string }): Promise<void> {
    this.interrupts.push({ childId, authority })
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
  // scope），但不在父代理 scope 视图（简单模式未启用），运行时被兜底剔除；
  // wf_run_node_wait / wf_org_catalog / wf_graph_patch：CHILD_AGENT_HIDDEN_TOOLS 成员，
  // 即使被组合勾选也永不进 allow（父代理专属）
  visible: string[] = ['read', 'write', 'edit', 'wf_ask', 'wf_ask_agent', 'wf_db_query', 'wf_run_node', 'wf_run_node_wait', 'wf_finish', 'wf_org_catalog', 'wf_graph_patch', 'run_code', 'str_replace_editor', 'mcp__srv1__a', 'mcp__srv1__b']
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
    promptSetup: { contribution: ReturnType<typeof vi.fn>; attach: ReturnType<typeof vi.fn>; withPending: ReturnType<typeof vi.fn> }
    toolFilter: ChildToolFilterSetup
    retireChild: ReturnType<typeof vi.fn>
    warnings: string[]
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
  const toolFilter = fakeGroupDeps().toolFilter
  const retireChild = vi.fn()
  const warnings: string[] = []
    const promptSetup = { contribution: vi.fn(() => () => {}), withPending: vi.fn((_state, operation) => operation()), attach: vi.fn() }
  const runner = new NodeAgentRunner({
    store,
    agents: () => agents,
    subagents: () => subagents,
    toolsView,
    ...fakeGroupDeps(),
    toolFilter,
    retireChild,
    logger: { warn: (message) => warnings.push(message), info: () => {}, debug: () => {} },
    react: react as unknown as ReactGuardBridge,
    modelSelection: modelSelection as unknown as ModelSelectionSetup,
    promptSetup: promptSetup as unknown as ChildPromptSetup,
  })
  return { runner, store, subagents, agents, toolsView, react, modelSelection, promptSetup, toolFilter, retireChild, warnings }
}

/**
 * 协作组路径依赖桩：本文件只验证节点路径，故官方 Team 视为未挂载（teams 返回 null），
 * 工具白名单装配为无操作。协作组自身的行为由其专属测试文件覆盖。
 */
function fakeGroupDeps(): { teams: () => null; toolFilter: ChildToolFilterSetup } {
  return {
    teams: () => null,
    toolFilter: {
      contribution: () => () => {},
      withPending: async <T>(_allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T> => operation(),
      remember: () => {},
      restore: () => () => {},
    } as unknown as ChildToolFilterSetup,
  }
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

  it('pickProviderName：首选序 spawn>codex>claude-code>dsh-sdk>acp；无首选回退首个；空清单 null', () => {
    expect(pickProviderName(['acp', 'spawn', 'fork'])).toBe('spawn')
    expect(pickProviderName(['acp', 'codex'])).toBe('codex')
    expect(pickProviderName(['unknown-only'])).toBe('unknown-only')
    expect(pickProviderName([])).toBeNull()
  })

  it('spawn 优先越权隔离回归：节点子代理不继承父编排上下文；仅 fork 可用时拒绝创建', () => {
    // 官方：fork.inheritsParentContext=true（completedTurnPrefix 父会话种子）；spawn.inheritsParentContext=false（零父上下文）。
    // 工作流节点必须走 spawn（own session / own system prompt / zero parent context），否则父代理对话/提示词整段泄露给子节点。
    expect(pickProviderName(['fork', 'spawn'])).toBe('spawn')
    expect(pickProviderName(['spawn'])).toBe('spawn')
    // 有隔离 provider 时可选择它；仅 fork 时拒绝启动。
    expect(pickProviderName(['fork', 'acp'])).toBe('acp')
    expect(pickProviderName(['fork'])).toBeNull()
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

  it('combo：勾选 ∩ 可见（父代理工具集）+ 所选 MCP 前缀工具；CHILD_AGENT_HIDDEN_TOOLS/run_code/str_replace_editor 被白名单天然排除', async () => {
    const h = await makeHarness()
    await saveCombo(h, 'combo-c1', ['read', 'not-visible', 'wf_ask', 'wf_run_node', 'wf_run_node_wait', 'wf_finish', 'wf_org_catalog', 'wf_graph_patch', 'run_code', 'str_replace_editor'], ['srv1'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1'),
    })
    expect(tools).not.toContain('run_code') // 官方保留名（presentation transport）永不进入 allow
    // 父代理专属工具（自主编排两工具 + 调度三工具）：勾选也不下发子代理
    // （架构文档 §4.5 父子可见性表；runner 侧双保险第一层）
    for (const name of CHILD_AGENT_HIDDEN_TOOLS) {
      expect(tools).not.toContain(name)
    }
    // str_replace_editor：官方简单模式专用工具，当前父代理视图（简单模式未启用）不含它
    // → 运行时兜底剔除，避免官方 tools.restrict 抛 "names unknown global tool"
    expect(tools).toContain('str_replace_editor')
    expect(tools.sort()).toEqual(['mcp__srv1__a', 'mcp__srv1__b', 'read', 'str_replace_editor', 'wf_ask'])
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

  it('官方 preset：standing scope 工具名；无法解析时拒绝启动', async () => {
    const h = await makeHarness()
    h.toolsView.presets.set('standard', ['read', 'edit'])
    const tools = await resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1', { presetId: 'standard' }),
    })
    expect(tools.sort()).toEqual(['edit', 'read'])

    await expect(resolveAgentTools({
      store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1',
      node: agentNode('n-a1', { presetId: 'unknown-preset' }),
    })).rejects.toMatchObject({ code: 'WF_CHILD_TOOL_POLICY_FAILED' })
  })

  it('执行契约要求的 read 不会被空 preset 或全局禁用静默剔除', async () => {
    const h = await makeHarness()
    const node = agentNode('n-a1', { presetId: null, execution: { requiredTools: ['read'] } })
    await expect(resolveAgentTools({ store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1', node })).rejects.toMatchObject({ code: 'WF_CHILD_TOOL_POLICY_FAILED' })
    h.toolsView.presets.set('standard', ['read'])
    node.data.presetId = 'standard'
    await expect(resolveAgentTools({ store: h.store, toolsView: h.toolsView, sessionId: 'session-1', flowId: 'flow-1', node, disabledTools: new Set(['read']) })).rejects.toThrow('read')
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
    expect(spec.request.toolFilter).toBeUndefined() // 勾选∩可见（wf_ask 勾选注入）
    expect(spec.request.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(h.react.setLimit).toHaveBeenCalledWith('child-1', 7)
  })

  it('签名一致复用：不重建；签名变化（rolePrompt）→ 重建且旧 child 上报 + 尽力中断', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    const first = await h.runner.ensureNodeChild(taskInput())
    const reused = await h.runner.ensureNodeChild(taskInput())
    expect(reused).toEqual({ childId: first.childId, created: false })
    expect(h.subagents.started).toHaveLength(1)
    expect(h.subagents.interrupts).toHaveLength(0)

    const rebuilt = await h.runner.ensureNodeChild(taskInput({ node: agentNode('n-a1', { systemPrompt: '新任务' }) }))
    // 行为变化（2026.10）：签名变化重建时额外上报被替换的旧 childId——编排器据此把旧
    // child 退役，使其迟到 subagent/end 不再覆写同一节点的状态（旧行为：无声替换，
    // 旧 child 的产出会张冠李戴）。create/reuse 两条路径的 created 语义不变。
    expect(rebuilt).toEqual({ childId: 'child-2', created: true, replacedChildId: 'child-1' })
    expect(h.subagents.started).toHaveLength(2)
    // 旧子代理被尽力中断（保留会话；authority 为触发本次重建的会话）
    await vi.waitFor(() => {
      expect(h.subagents.interrupts).toEqual([
        { childId: 'child-1', authority: { kind: 'user', parentSessionId: 'session-1' } },
      ])
    }, { timeout: 5000 })
  })

  it('复用路径（签名一致）不触发中断：只有重建才中断旧 child', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    await h.runner.ensureNodeChild(taskInput())
    await h.runner.ensureNodeChild(taskInput())
    await h.runner.ensureNodeChild(taskInput())
    expect(h.subagents.started).toHaveLength(1)
    expect(h.subagents.interrupts).toHaveLength(0)
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
      ...fakeGroupDeps(),
      react: h2.react as unknown as ReactGuardBridge,
      modelSelection: h2.modelSelection as unknown as ModelSelectionSetup,
      promptSetup: h2.promptSetup as unknown as ChildPromptSetup,
    })
    await expect(runner2.ensureNodeChild(taskInput())).rejects.toThrow(/Agent 服务不可用/)

    const h3 = await makeHarness()
    await h3.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    h3.subagents.providers = []
    await expect(h3.runner.ensureNodeChild(taskInput())).rejects.toMatchObject({ code: "WF_ISOLATED_PROVIDER_UNAVAILABLE", message: expect.stringContaining("@deepseek-ai/dsh-subagent-spawn-in-process"), retryable: false })
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

describe("childVisibilityContribution", () => {
  it("test_parent_tools_guarded_even_when_registry_mask_cannot_hide_own_tools", () => {
    const denied: Array<(exec: { name: string }) => string | undefined> = []
    const tools = { get: () => ({}), restrict: () => () => {}, guard: (check: (exec: { name: string }) => string | undefined) => { denied.push(check); return () => {} } }
    childVisibilityContribution()({ get: () => tools })
    for (const name of CHILD_AGENT_HIDDEN_TOOLS) expect(denied[0]({ name })).toContain("WF_NOT_ROOT")
    expect(denied[0]({ name: "read" })).toBeUndefined()
  })
  it("test_permission_service_missing_rejects_creation", () => {
    expect(() => childVisibilityContribution()({ get: () => undefined })).toThrow("无法安全启动")
  })
})

// ---------------------------------------------------------------------------
// DSH 0.1.2 子代理 seam（rc.1 SubagentRuntime 使用面）
// ---------------------------------------------------------------------------
// 取证（0.1.2-rc.1 类型）：rc.2 的 list()/followup/registerContinuableSetup 移除；
// 改 getProvider 按名探测、sendMessage/queuePrompt 相邻投递、interrupt(target, authority)。
// 每子代理作用域装配由宿主在 agent/created 创建窗口内安装到 childCtx（runner 只负责创建）。

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
    expect(detectSubagentProvider(rc1)).toBe('acp')
    rc1.providers = {}
    expect(detectSubagentProvider(rc1)).toBeNull()
    // 旧面 fake（仅 list）回退 list() 清单
    const legacy = new FakeSubagents()
    legacy.providers = ['acp', 'fork']
    expect(detectSubagentProvider(legacy)).toBe('acp')
  })

  it('创建：startContinuable(provider=spawn)（getProvider 探测）返回 created=true；装配由 host 的 agent/created 负责', async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: 'combo-c1', name: 'c1', tools: ['read'], mcpServers: [] })
    // 换成 rc.1 面 subagents：startContinuable 即发布 child agent（带 ctx）
    const rc1 = new Rc1FakeSubagents()
    rc1.onStart = (childId) => { h.agents.children.set(childId, { id: childId, ctx: { tag: `ctx-${childId}` } }) }
    // 0.1.2 起每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）不再由 runner 在
    // startContinuable 返回后安装，而是由 host 层监听 agent/created 在创建窗口内安装
    // （见 visual-workflow-host.ts），避免首轮系统提示词/工具第二轮才更新。runner 只负责创建。
    const runner = new NodeAgentRunner({
      store: h.store,
      agents: () => h.agents,
      subagents: () => rc1,
      toolsView: h.toolsView,
      ...fakeGroupDeps(),
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
      ...fakeGroupDeps(),
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
      ...fakeGroupDeps(),
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

// ---------------------------------------------------------------------------
// CordisToolsView：按公开能力读取新旧 Preset Scope
// ---------------------------------------------------------------------------

/** `Symbol.asyncDispose` 运行时取值（host program lib 为 es2022，不含 esnext.disposable）。 */
const ASYNC_DISPOSE = (Symbol as unknown as { asyncDispose: symbol }).asyncDispose

/** 构造 CordisToolsView 所需的最小 ctx fake。 */
function toolsViewCtx(services: Record<string, unknown>, warn = vi.fn()): { get(name: string): unknown; logger: { warn: typeof warn } } {
  return { get: (name: string) => services[name], logger: { warn } }
}

describe('CordisToolsView / preset standing scope（acquireScope 租约）', () => {
  it('presetToolNames：取租约 → schemas(key) → 释放租约', async () => {
    const presetKey = { preset: 'standard' }
    let released = 0
    const view = new CordisToolsView(toolsViewCtx({
      tools: { schemas: (scope?: unknown) => (scope === presetKey ? [{ name: 'read' }, { name: 'write' }] : []) },
      agentPresets: {
        list: async () => [{ id: 'standard' }],
        acquireScope: async () => ({ key: presetKey, [ASYNC_DISPOSE]: async () => { released += 1 } }),
      },
    }))

    expect(await view.presetToolNames('standard')).toEqual(['read', 'write'])
    expect(released).toBe(1)
  })

  it("test_old_standing_key_standard_reads_tools_without_disposal", async () => {
    const dispose = vi.fn()
    const key = { [ASYNC_DISPOSE]: dispose }
    const view = new CordisToolsView(toolsViewCtx({
      tools: { schemas: (scope: unknown) => scope === key ? [{ name: "read" }, { name: "write" }] : [{ name: "global_only" }] },
      agentPresets: { list: async () => [{ id: "standard" }], standingKeyFor: async () => key },
    }))

    expect(await view.presetToolNames("standard")).toEqual(["read", "write"])
    expect(dispose).not.toHaveBeenCalled()
  })

  it("test_acquire_failure_keeps_diagnostic_and_rejects", async () => {
    const view = new CordisToolsView(toolsViewCtx({
      tools: { schemas: () => [{ name: 'read' }] },
      agentPresets: {
        list: async () => [{ id: 'standard' }],
        acquireScope: async () => { throw new Error('preset 未激活') },
      },
    }))

    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", presetStage: "preset_scope_acquire_failed", reason: "preset 未激活", errorType: "Error" })
  })

  it("test_missing_lease_key_rejects_and_releases_once", async () => {
    let released = 0
    const view = new CordisToolsView(toolsViewCtx({
      tools: { schemas: () => [{ name: 'read' }] },
      agentPresets: {
        list: async () => [{ id: 'standard' }],
        acquireScope: async () => ({ [ASYNC_DISPOSE]: async () => { released += 1 } }),
      },
    }))

    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_scope_key_invalid" })
    expect(released).toBe(1)
  })

  it('visibleToolNames：并入全局层与各 preset standing scope，且每个租约都被释放', async () => {
    const scopeA = { preset: 'a' }
    const scopeB = { preset: 'b' }
    let released = 0
    const view = new CordisToolsView(toolsViewCtx({
      tools: {
        schemas: (scope?: unknown) => {
          if (scope === undefined) return [{ name: 'glob' }]
          if (scope === scopeA) return [{ name: 'read' }]
          if (scope === scopeB) return [{ name: 'write' }]
          return []
        },
      },
      agentPresets: {
        list: async () => [{ id: 'a' }, { id: 'b' }],
        acquireScope: async (id?: string) => ({
          key: id === 'a' ? scopeA : scopeB,
          [ASYNC_DISPOSE]: async () => { released += 1 },
        }),
      },
    }))

    expect((await view.visibleToolNames()).sort()).toEqual(['glob', 'read', 'write'])
    expect(released).toBe(2)
  })
})

describe("Preset capability diagnostics and lifecycle", () => {
  it("test_node_schema_failure_releases_lease_and_rejects_with_run_diagnostic_before_start", async () => {
    const h = await makeHarness()
    const dispose = vi.fn()
    const warn = vi.fn()
    const schemas = vi.fn((key?: unknown) => {
      if (key === undefined) throw new Error("unrelated global enumeration must not precede preset execution")
      throw new TypeError("chosen scope schemas failed")
    })
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas }, agentPresets: {
      list: async () => [{ id: "standard" }], acquireScope: async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }),
    } }, warn))
    h.toolsView.visibleToolNames = view.visibleToolNames.bind(view)
    h.toolsView.presetToolNames = view.presetToolNames.bind(view)
    await expect(h.runner.startNodeTask(taskInput({ runId: "run-schema", node: agentNode("load_data", { presetId: "standard" }) }))).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", presetStage: "preset_tool_schema_failed", reason: "chosen scope schemas failed" })
    expect(schemas).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(h.subagents.started).toEqual([])
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ runId: "run-schema", nodeId: "load_data", stage: "preset_tool_schema_failed", errorType: "TypeError" })
    h.runner.dispose()
  })

  it("test_release_failure_logs_once_without_expanding_the_parsed_whitelist", async () => {
    const warn = vi.fn()
    const dispose = vi.fn(async () => { throw new TypeError("release refused token=private-token") })
    const key = {}
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: (scope: unknown) => scope === key ? [{ name: "read" }] : [{ name: "unapproved" }] }, agentPresets: {
      list: async () => [], acquireScope: async () => ({ key, [ASYNC_DISPOSE]: dispose }),
    } }, warn))
    expect(await view.presetToolNames("standard", { runId: "run-release", nodeId: "load_data" })).toEqual(["read"])
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ presetId: "standard", runId: "run-release", nodeId: "load_data", stage: "preset_scope_release_failed", errorType: "TypeError", reason: "release refused token=[redacted]" })
  })

  it("test_read_and_release_failures_remain_separate_and_creation_stays_closed", async () => {
    const warn = vi.fn()
    const dispose = vi.fn(async () => { throw new Error("release failed") })
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => { throw new TypeError("schemas failed") } }, agentPresets: {
      list: async () => [], acquireScope: async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }),
    } }, warn))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_tool_schema_failed", reason: "schemas failed" })
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.map(([message]) => JSON.parse(message).stage)).toEqual(["preset_scope_release_failed", "preset_tool_schema_failed"])
  })

  it("test_adapter_without_either_scope_method_rejects_before_read", async () => {
    const read = vi.fn()
    await expect(withPresetScope({ list: async () => [] }, "standard", read)).rejects.toMatchObject({ presetStage: "preset_api_unsupported" })
    expect(read).not.toHaveBeenCalled()
  })

  it("test_old_standard_node_starts_child_with_pending_whitelist_without_request_tool_filter", async () => {
    const h = await makeHarness()
    const key = {}
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: (scope?: unknown) => scope === key ? [{ name: "read" }, { name: "write" }] : [] }, agentPresets: {
      list: async () => [{ id: "standard" }], standingKeyFor: async () => key,
    } }))
    h.toolsView.visibleToolNames = view.visibleToolNames.bind(view)
    h.toolsView.presetToolNames = view.presetToolNames.bind(view)
    const result = await h.runner.startNodeTask(taskInput({ runId: "run-old", node: agentNode("load_data", { presetId: "standard", execution: { requiredTools: ["read", "write"] } }) }))
    expect(result).toEqual({ childId: "child-1", created: true })
    expect(h.subagents.started).toHaveLength(1)
    expect(h.subagents.started[0]!.request).not.toHaveProperty("toolFilter")
    h.runner.dispose()
  })

  it("test_old_scope_failure_prevents_child_creation_and_reports_run_node", async () => {
    const h = await makeHarness()
    const warn = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => [{ name: "read" }] }, agentPresets: {
      list: async () => [{ id: "standard" }], standingKeyFor: async () => { throw new Error("standing scope unavailable") },
    } }, warn))
    h.toolsView.visibleToolNames = view.visibleToolNames.bind(view)
    h.toolsView.presetToolNames = view.presetToolNames.bind(view)
    await expect(h.runner.startNodeTask(taskInput({ runId: "run-failed", node: agentNode("load_data", { presetId: "standard" }) }))).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", presetStage: "preset_scope_acquire_failed" })
    expect(h.subagents.started).toEqual([])
    expect(warn.mock.calls.map(([message]) => JSON.parse(message))).toContainEqual(expect.objectContaining({ runId: "run-failed", nodeId: "load_data", stage: "preset_scope_acquire_failed" }))
    h.runner.dispose()
  })

  it("test_both_scope_apis_prefers_acquire_and_releases_once", async () => {
    const key = {}
    const dispose = vi.fn()
    const standingKeyFor = vi.fn(async () => ({}))
    const presets = { list: async () => [], acquireScope: vi.fn(async () => ({ key, [ASYNC_DISPOSE]: dispose })), standingKeyFor }
    const ctx = toolsViewCtx({ agentPresets: presets })
    expect(agentPresetsServiceOf(ctx)).toBe(presets)
    expect(await withPresetScope(presets, "standard", (scope) => scope)).toBe(key)
    expect(presets.acquireScope).toHaveBeenCalledWith("standard")
    expect(standingKeyFor).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("test_new_acquire_failure_does_not_fallback_to_standing_key", async () => {
    const standingKeyFor = vi.fn(async () => ({}))
    const schemas = vi.fn(() => [{ name: "global_only" }])
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas }, agentPresets: {
      list: async () => [], acquireScope: async () => { throw new TypeError("new API failed") }, standingKeyFor,
    } }))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_scope_acquire_failed", errorType: "TypeError", reason: "new API failed" })
    expect(standingKeyFor).not.toHaveBeenCalled()
    expect(schemas).not.toHaveBeenCalled()
  })

  it("test_old_key_failure_rejects_without_global_tool_fallback", async () => {
    const schemas = vi.fn(() => [{ name: "global_only" }])
    const warn = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas }, agentPresets: {
      list: async () => [], standingKeyFor: async () => { throw new RangeError("preset standard not found") },
    } }, warn))
    await expect(view.presetToolNames("standard", { runId: "run-old", nodeId: "load_data" })).rejects.toMatchObject({ presetStage: "preset_scope_acquire_failed", reason: "preset standard not found" })
    expect(schemas).not.toHaveBeenCalled()
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ presetId: "standard", runId: "run-old", nodeId: "load_data", stage: "preset_scope_acquire_failed", errorType: "RangeError", reason: "preset standard not found" })
  })

  it.each([
    [undefined, "preset_service_missing"],
    [{ list: async () => [] }, "preset_api_unsupported"],
    [{ standingKeyFor: async () => ({}) }, "preset_api_unsupported"],
  ])("test_missing_preset_capabilities_%s_rejects_with_stage_%s", async (agentPresets, presetStage) => {
    const view = new CordisToolsView(toolsViewCtx({ agentPresets, tools: { schemas: () => [] } }))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", presetId: "standard", presetStage })
  })

  it.each([undefined, null, "standard", 0])("test_invalid_lease_key_%s_never_reads_global_schemas", async (key) => {
    const schemas = vi.fn(() => [{ name: "global_only" }])
    const dispose = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas }, agentPresets: {
      list: async () => [], acquireScope: async () => ({ key, [ASYNC_DISPOSE]: dispose }),
    } }))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_scope_key_invalid" })
    expect(schemas).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("test_invalid_old_scope_key_rejects_before_read", async () => {
    const read = vi.fn()
    await expect(withPresetScope({ list: async () => [], standingKeyFor: async () => null }, "standard", read)).rejects.toMatchObject({ presetStage: "preset_scope_key_invalid" })
    expect(read).not.toHaveBeenCalled()
  })

  it.each([null, undefined, {}])("test_invalid_schema_result_%s_rejects_and_releases", async (result) => {
    const dispose = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => result }, agentPresets: {
      list: async () => [], acquireScope: async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }),
    } }))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_tool_schema_failed", errorType: "TypeError" })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("test_schema_exception_preserves_reason_and_releases_once", async () => {
    const dispose = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => { throw new RangeError("registry read failed") } }, agentPresets: {
      list: async () => [], acquireScope: async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }),
    } }))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ presetStage: "preset_tool_schema_failed", errorType: "RangeError", reason: "registry read failed" })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("test_empty_schemas_are_valid_and_repeated_reads_release_every_lease", async () => {
    const dispose = vi.fn()
    const acquireScope = vi.fn(async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }))
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => [] }, agentPresets: { list: async () => [], acquireScope } }))
    for (let i = 0; i < 5; i++) expect(await view.presetToolNames("standard")).toEqual([])
    expect(acquireScope).toHaveBeenCalledTimes(5)
    expect(dispose).toHaveBeenCalledTimes(5)
  })

  it("test_async_read_failure_releases_after_read_finishes", async () => {
    const dispose = vi.fn()
    await expect(withPresetScope({ list: async () => [], acquireScope: async () => ({ key: {}, [ASYNC_DISPOSE]: dispose }) }, "standard", async () => {
      await Promise.resolve()
      expect(dispose).not.toHaveBeenCalled()
      throw new Error("async reader failed")
    })).rejects.toMatchObject({ presetStage: "preset_tool_schema_failed", reason: "async reader failed" })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("test_diagnostics_redact_credentials_but_keep_original_error_type", async () => {
    const warn = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => [] }, agentPresets: {
      list: async () => [], standingKeyFor: async () => { throw new TypeError("mount refused api_key=private-key Bearer private-bearer https://user:private-password@example.com/failed?token=private-query") },
    } }, warn))
    await expect(view.presetToolNames("standard")).rejects.toMatchObject({ errorType: "TypeError", presetStage: "preset_scope_acquire_failed" })
    const diagnostic = warn.mock.calls[0]![0] as string
    expect(diagnostic).toContain("mount refused")
    expect(diagnostic).toContain("[redacted]")
    for (const secret of ["private-key", "private-bearer", "private-password", "private-query"]) expect(diagnostic).not.toContain(secret)
  })

  it("test_visible_catalog_skips_failed_preset_with_diagnostic", async () => {
    const key = {}
    const warn = vi.fn()
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: (scope?: unknown) => scope === key ? [{ name: "read" }] : [{ name: "global_only" }] }, agentPresets: {
      list: async () => [{ id: "broken" }, { id: "standard" }], standingKeyFor: async (id: string) => {
        if (id === "broken") throw new Error("broken mount")
        return key
      },
    } }, warn))
    expect(await view.visibleToolNames()).toEqual(["global_only", "read"])
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ presetId: "broken", stage: "preset_scope_acquire_failed", reason: "broken mount" })
  })

  it("test_old_preset_resolution_keeps_hidden_disabled_and_required_tool_rules", async () => {
    const h = await makeHarness()
    const key = {}
    const view = new CordisToolsView(toolsViewCtx({ tools: { schemas: (scope?: unknown) => (scope === key ? ["read", "write", "subagent", ...CHILD_AGENT_HIDDEN_TOOLS] : ["global_only"]).map((name) => ({ name })) }, agentPresets: {
      list: async () => [{ id: "standard" }], standingKeyFor: async () => key,
    } }))
    const node = agentNode("load_data", { presetId: "standard", execution: { requiredTools: ["read", "write"] } })
    const input = { store: h.store, toolsView: view, sessionId: "session-1", flowId: "flow-1", node }
    expect(await resolveAgentTools(input)).toEqual(["read", "write", "subagent"])
    await expect(resolveAgentTools({ ...input, disabledTools: new Set(["write"]) })).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", message: expect.stringContaining("write") })
    const empty = new CordisToolsView(toolsViewCtx({ tools: { schemas: () => [] }, agentPresets: { list: async () => [], standingKeyFor: async () => key } }))
    await expect(resolveAgentTools({ ...input, toolsView: empty })).rejects.toMatchObject({ code: "WF_CHILD_TOOL_POLICY_FAILED", message: expect.stringContaining("read, write") })
  })
})

function subagentFailure(code: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(`宿主投递失败：${code}`, { cause }), { name: "SubagentError", code })
}

describe("NOT_RESUMABLE 安全重建", () => {
  it.each(["reuse", "rebuild", "legacy"])("test_native_file_refs_%s_delivers_latest_public_refs_without_changing_scope", async (mode) => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read"], mcpServers: [] })
    const scope = vi.spyOn(h.toolFilter, "withPending")
    const firstRef = { attachmentId: "authorized-a", name: "A.payload", bytes: 3, path: "/private/host/a", source: "session" as const }
    const nextRef = { attachmentId: "authorized-b", name: "B.payload", bytes: 5, path: "/private/host/b", source: "binding" as const }
    const first = await h.runner.startNodeTask(taskInput({ attachments: [firstRef] }))
    expect(h.subagents.started[0].request.prompt).toEqual([...blocks(), { type: "file", attachment: { attachmentId: firstRef.attachmentId, name: firstRef.name, bytes: firstRef.bytes } }])
    const queue = vi.fn(async () => {})
    if (mode === "legacy") {
      Object.assign(h.subagents, { sendMessage: undefined, queuePrompt: queue })
    } else if (mode === "rebuild") h.subagents.failDelivery = subagentFailure("NOT_RESUMABLE")

    const latest = taskInput({ blocks: blocks("Read the newly authorized task file"), attachments: [nextRef], attempt: 2 })
    const result = await h.runner.startNodeTask(latest)

    const content = [...latest.blocks, { type: "file", attachment: { attachmentId: nextRef.attachmentId, name: nextRef.name, bytes: nextRef.bytes } }]
    if (mode === "rebuild") {
      expect(result).toEqual({ childId: "child-2", created: true, replacedChildId: first.childId })
      expect(h.subagents.started[1].request.prompt).toEqual(content)
      expect(h.subagents.dispatches).toEqual([])
      expect(h.retireChild).toHaveBeenCalledExactlyOnceWith(first.childId)
    } else {
      expect(result).toEqual({ childId: first.childId, created: false })
      expect(h.subagents.started).toHaveLength(1)
      if (mode === "legacy") expect(queue).toHaveBeenCalledExactlyOnceWith(h.agents.parents.get("session-1"), first.childId, content, undefined, latest.signal)
      else expect(h.subagents.dispatches[0].content).toEqual(content)
    }
    expect(scope.mock.calls.map(([allow]) => allow)).toEqual(mode === "rebuild" ? [["read"], ["read"]] : [["read"]])
    expect(latest.attachments).toEqual([nextRef])
  })

  it("test_reuse_resumable_keeps_ID_and_latest_blocks", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    const first = await h.runner.startNodeTask(taskInput())
    const latest = taskInput({ blocks: blocks("第二轮最新任务") })
    const second = await h.runner.startNodeTask(latest)
    expect(second).toEqual({ childId: first.childId, created: false })
    expect(h.subagents.started).toHaveLength(1)
    expect(h.subagents.dispatches).toEqual([{ sender: h.agents.parents.get("session-1"), targetId: first.childId, content: latest.blocks, signal: latest.signal }])
    expect(h.retireChild).not.toHaveBeenCalled()
  })

  it("test_rebuild_NOT_RESUMABLE_preserves_policy_prompt_model_blocks_and_cause", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    h.toolsView.presets.set("standard", ["read", "write", "wf_run_node"])
    const toolPending = vi.spyOn(h.toolFilter, "withPending")
    const input = taskInput({ node: agentNode("n-a1", { presetId: "standard", systemPrompt: "只执行节点任务" }), runId: "run-2", attempt: 2 })
    const first = await h.runner.startNodeTask(input)
    const cause = new Error("持久会话读取失败")
    h.subagents.failDelivery = subagentFailure("NOT_RESUMABLE", cause)
    const latest = { ...input, blocks: [{ type: "text" as const, text: "最新 CSV 输入" }, { type: "text" as const, text: "完整契约" }] }
    const rebuilt = await h.runner.startNodeTask(latest)
    expect(rebuilt).toEqual({ childId: "child-2", created: true, replacedChildId: first.childId })
    expect(h.subagents.dispatches).toHaveLength(0)
    expect(h.subagents.started).toHaveLength(2)
    expect(h.subagents.started[1].request.prompt).toEqual(latest.blocks)
    expect(h.subagents.started[1].request.agentOptions).toEqual({ provider: "deepseek", model: "deepseek-chat" })
    expect(h.subagents.started[1].provider).toBe("spawn")
    expect(toolPending.mock.calls.map(([allow]) => allow)).toEqual([["read", "write"], ["read", "write"]])
    expect(h.promptSetup.withPending).toHaveBeenLastCalledWith({ systemPrompt: "只执行节点任务", injectSystemPrompt: true, injectToolSections: true }, expect.any(Function))
    expect(h.retireChild).toHaveBeenCalledExactlyOnceWith(first.childId)
    expect(h.react.drop).toHaveBeenCalledWith(first.childId)
    expect(h.subagents.interrupts).toEqual([{ childId: first.childId, authority: { kind: "user", parentSessionId: "session-1" } }])
    expect(JSON.parse(h.warnings[0])).toMatchObject({ runId: "run-2", nodeId: "n-a1", childId: first.childId, attempt: 2, errorCode: "NOT_RESUMABLE", accepted: false, cause: cause.message })
    h.subagents.failDelivery = null
    expect(await h.runner.startNodeTask(latest)).toEqual({ childId: "child-2", created: false })
  })

  it.each(["UNAUTHORIZED", "CANCELLED", "ACTIVATION_CLOSING", "DELIVERY_FAILED"])("test_reuse_%s_preserves_failure_without_rebuild", async (code) => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    await h.runner.startNodeTask(taskInput())
    const error = subagentFailure(code)
    h.subagents.failDelivery = error
    await expect(h.runner.startNodeTask(taskInput())).rejects.toBe(error)
    expect(h.subagents.started).toHaveLength(1)
    expect(h.retireChild).not.toHaveBeenCalled()
  })

  it.each([
    new Error("subagent is unavailable"),
    Object.assign(new Error("unavailable"), { code: "NOT_RESUMABLE" }),
    { name: "SubagentError", code: "NOT_RESUMABLE", message: "unavailable" },
  ])("test_reuse_unverified_error_%j_does_not_rebuild", async (error) => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    await h.runner.startNodeTask(taskInput())
    h.subagents.failDelivery = error
    await expect(h.runner.startNodeTask(taskInput())).rejects.toBe(error)
    expect(h.subagents.started).toHaveLength(1)
  })

  it("test_reuse_ambiguous_accepted_delivery_does_not_duplicate_executor", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    await h.runner.startNodeTask(taskInput())
    h.subagents.onDispatch = () => {
      h.subagents.dispatches.push({ sender: {}, targetId: "child-1", content: blocks() })
      throw subagentFailure("DELIVERY_FAILED")
    }
    await expect(h.runner.startNodeTask(taskInput())).rejects.toMatchObject({ code: "DELIVERY_FAILED" })
    expect(h.subagents.dispatches).toHaveLength(1)
    expect(h.subagents.started).toHaveLength(1)
  })

  it("test_rebuild_creation_failure_preserves_cache_and_causes_without_loop", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    await h.runner.startNodeTask(taskInput())
    const resume = subagentFailure("NOT_RESUMABLE")
    const creation = subagentFailure("ACTIVATION_CLOSING", new Error("父代理关闭"))
    h.subagents.failDelivery = resume
    h.subagents.failStart = creation
    await expect(h.runner.startNodeTask(taskInput())).rejects.toBe(creation)
    expect(creation).toMatchObject({ resumeError: resume, childId: "child-1" })
    expect(h.subagents.started).toHaveLength(2)
    expect(await h.runner.ensureNodeChild(taskInput())).toEqual({ childId: "child-1", created: false })
    expect(h.retireChild).not.toHaveBeenCalled()
    expect(h.warnings.map((message) => JSON.parse(message).phase)).toEqual(["child_resume", "child_rebuild"])
  })

  it("test_dispatch_concurrent_node_rejects_duplicate_and_releases_lock", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const original = h.subagents.startContinuable.bind(h.subagents)
    const create = vi.spyOn(h.subagents, "startContinuable").mockImplementation(async (spec) => { await gate; return original(spec) })
    const first = h.runner.startNodeTask(taskInput())
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    await expect(h.runner.startNodeTask(taskInput())).rejects.toMatchObject({ code: "WF_BUSY" })
    release()
    await first
    expect((await h.runner.startNodeTask(taskInput())).created).toBe(false)
    expect(h.subagents.started).toHaveLength(1)
    expect(h.subagents.dispatches).toHaveLength(1)
  })

  it.each(["abort", "pause"])("test_rebuild_during_%s_does_not_create_child", async (kind) => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    const controller = new AbortController()
    let active = true
    const input = taskInput({ signal: controller.signal, assertActive: () => { if (!active) throw Object.assign(new Error("暂停"), { code: "WF_PAUSED" }) } })
    await h.runner.startNodeTask(input)
    h.subagents.failDelivery = subagentFailure("NOT_RESUMABLE")
    h.subagents.onDispatch = () => { if (kind === "abort") controller.abort(); else active = false }
    await expect(h.runner.startNodeTask(input)).rejects.toMatchObject({ code: kind === "abort" ? "CANCELLED" : "WF_PAUSED" })
    expect(h.subagents.started).toHaveLength(1)
  })

  it("test_dispatch_pre_cancelled_does_not_create_child", async () => {
    const h = await makeHarness()
    await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read", "write"], mcpServers: [] })
    await expect(h.runner.startNodeTask(taskInput({ signal: AbortSignal.abort() }))).rejects.toMatchObject({ code: "CANCELLED" })
    expect(h.subagents.started).toHaveLength(0)
  })
})

it("test_reuse_error_explicitly_accepted_does_not_rebuild_even_with_NOT_RESUMABLE", async () => {
  const h = await makeHarness()
  await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read"], mcpServers: [] })
  await h.runner.startNodeTask(taskInput())
  const error = Object.assign(subagentFailure("NOT_RESUMABLE"), { accepted: true })
  h.subagents.failDelivery = error
  await expect(h.runner.startNodeTask(taskInput())).rejects.toBe(error)
  expect(h.subagents.started).toHaveLength(1)
})

it("test_creation_cancelled_after_host_returns_interrupts_new_child_and_keeps_old_cache", async () => {
  const h = await makeHarness()
  await h.store.saveToolCombo({ id: "combo-c1", name: "测试权限", tools: ["read"], mcpServers: [] })
  await h.runner.startNodeTask(taskInput())
  h.subagents.failDelivery = subagentFailure("NOT_RESUMABLE")
  const controller = new AbortController()
  const original = h.subagents.startContinuable.bind(h.subagents)
  vi.spyOn(h.subagents, "startContinuable").mockImplementation(async (spec) => {
    const result = await original(spec)
    controller.abort()
    return result
  })
  await expect(h.runner.startNodeTask(taskInput({ signal: controller.signal }))).rejects.toMatchObject({ code: "CANCELLED" })
  expect(await h.runner.ensureNodeChild(taskInput())).toEqual({ childId: "child-1", created: false })
  expect(h.retireChild).toHaveBeenCalledExactlyOnceWith("child-2")
  expect(h.react.drop).toHaveBeenCalledWith("child-2")
  expect(h.subagents.interrupts.map(({ childId }) => childId)).toEqual(["child-2"])
})

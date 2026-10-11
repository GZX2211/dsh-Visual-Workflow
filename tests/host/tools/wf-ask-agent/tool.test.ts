// tests/host/tools/wf-ask-agent/tool.test.ts
//
// wf_ask_agent 工具单测（非阻塞两态协议）：
//   - 注册与 schema（cmd 必填/两态枚举/description W-03 英文）；
//   - ask 非阻塞：投递后立即返回受理凭证 {cmd,askId,from,to}，对端是否回复都不挂起；
//     to 用 fake 时钟推进；投递经投递缝（目标在线 steer / 冷态 followup）；
//   - reply 反向投递：回复文本作为新消息送达发起者（非本调用返回值），
//     送达成功后释放登记；同发起者可并存多条未回复 ask（无 WF_BUSY）；
//   - 越权拒绝（R-04）：非运行节点子代理 ask / 目标非节点子代理 / 父代理 ask /
//     父代理 reply / reply 归属不匹配 / askId 不存在 / cmd 非法；
//   - TTL 惰性清理：到期登记被移除，其 askId 不再接受 reply；
//   - 冷态回退：目标不在线 → subagents.followup（官方冷恢复，source 透传）；
//   - 节点 id 寻址：ask 按成员节点 id 投递、reply 按发起者节点 id 反向投递；
//   - 生命周期：运行停止后调用被拒（终态条目已释放）、审计日志事件。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type CoordinatorMessage,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type TurnEndInfo,
} from '../../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import { WF_ASK_AGENT, WF_RUN_NODE } from '../../../../src/host/shared/protocol.js'
import { registerWfRunNode } from '../../../../src/host/tools/wf-run-node/tool.js'
import { registerWfAskAgent, type WfAskAgentHost } from '../../../../src/host/tools/wf-ask-agent/tool.js'
import type { ToolDefinitionLike, ToolExecLike } from '../../../../src/host/tools/infrastructure/define-tool.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'

// ---------------------------------------------------------------------------
// 测试替身与装配
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
  vi.useRealTimers()
})

function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

/** 标准测试流程（模式一）：start → a1 → a2 → end。 */
function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '协作流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '成员A'), agent('n-a2', '成员B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  session: { events: unknown[] } = { events: [] }
  steers: CoordinatorMessage[] = []
  constructor(id: string) {
    this.id = id
  }
  steer(message: CoordinatorMessage): void {
    this.steers.push(message)
  }
}

class FakeChild implements RootAgentLike {
  id: string
  status = 'running'
  steers: CoordinatorMessage[] = []
  constructor(id: string) {
    this.id = id
  }
  steer(message: CoordinatorMessage): void {
    this.steers.push(message)
  }
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  children = new Map<string, FakeChild>()
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  getChildAgent(childId: string): RootAgentLike | null {
    return this.children.get(childId) ?? null
  }
  followupRoot(): void {}
  latestTurnEnd(): TurnEndInfo | null {
    return null
  }
  childRunning(): boolean {
    return false
  }
}

class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    return { childId: `child-${this.calls.length}`, created: true }
  }
  async interruptChild(): Promise<void> {}
}

class FakeToolsRegistry {
  definitions = new Map<string, ToolDefinitionLike>()
  register(def: ToolDefinitionLike): () => void {
    if (this.definitions.has(def.name)) throw new Error(`duplicate tool: ${def.name}`)
    this.definitions.set(def.name, def)
    return () => {
      this.definitions.delete(def.name)
    }
  }
}

interface FollowupCall {
  parentId: string
  childId: string
  content: unknown[]
  options: { source: unknown; signal?: AbortSignal }
}

/** ask 受理凭证（工具结果形状）。 */
interface AskReceipt {
  cmd: string
  askId: string
  from: string
  to: string
}

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  agents: FakeAgents
  tools: FakeToolsRegistry
  followups: FollowupCall[]
  infos: string[]
  disposeTools: () => void
  childSteers: (childId: string) => CoordinatorMessage[]
  rootSteers: () => CoordinatorMessage[]
}

interface HarnessOptions {
  config?: Partial<OrchestratorConfig>
  /** 注入可控时钟（TTL 用例；缺省用 defaultClock）。 */
  now?: () => number
}

/**
 * 缺省可控时钟：固定起点 + 每次读取单调 +1ms。
 * 分段计时类逻辑（如运行空闲超时）可据此推进，同时使 TTL 判断完全脱离真实墙钟；
 * 每个 harness 独立持有，避免跨用例共享可变状态。
 */
function makeClock(): () => number {
  let value = 1_000
  return () => {
    value += 1
    return value
  }
}

/** 装配：真实编排运行时 + fake 依赖 + 注册 wf_run_node 与 wf_ask_agent。 */
async function makeHarness(options?: HarnessOptions): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-askagent-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
  const infos: string[] = []
  const uuidSeq = { n: 0 }
  // 每个 harness 独立时钟：TTL 用例传入可变时钟，其余用例用本实例的单调时钟
  const clock = options?.now ?? makeClock()
  const runtime = new OrchestratorRuntime({
    store,
    runner,
    agents,
    config: {
      outputFullLimit: 400,
      documentTextLimit: 200,
      runIdleTimeoutMs: 500,
      retryLimitDefault: 3,
      reactIterationLimitDefault: 50,
      // 多数用例不关心 TTL：默认放宽到 30s，使登记不会在用例执行期间意外过期
      wfAskAgentTtlMs: 30_000,
      ...options?.config,
    },
    logger: { warn: () => {}, info: (message) => infos.push(message), debug: () => {} },
    newRunId: () => 'run-1',
    uuid: () => `uuid-${(uuidSeq.n += 1)}`,
    // 缺省注入可控时钟：不关心 TTL 的用例不受真实墙钟抖动影响；TTL 用例自行注入可变时钟
    now: clock,
  })
  const tools = new FakeToolsRegistry()
  const followups: FollowupCall[] = []
  const host: WfAskAgentHost = {
    orchestrator: runtime,
    getRootAgent: (sid) => agents.getRootAgent(sid),
    getChildAgent: (cid) => agents.getChildAgent(cid),
    followupChild: async (parent, childId, content, options2) => {
      followups.push({ parentId: parent.id, childId, content, options: options2 })
      return `msg-${childId}`
    },
  }
  const ctx = { get: (name: string) => (name === 'tools' ? tools : null) }
  const disposeTools = (() => {
    const d1 = registerWfRunNode(ctx, host)
    const d2 = registerWfAskAgent(ctx, host)
    return () => {
      d1()
      d2()
    }
  })()
  return {
    runtime,
    store,
    agents,
    tools,
    followups,
    infos,
    disposeTools,
    childSteers: (childId) => agents.children.get(childId)?.steers ?? [],
    rootSteers: () => agents.roots.get('session-1')?.steers ?? [],
  }
}

/** 构造工具执行上下文（agent 形状按官方 Session header 事实）。 */
function execOf(agent2: unknown, signal?: AbortSignal): ToolExecLike {
  return { signal: signal ?? new AbortController().signal, agent: agent2 }
}

const rootAgent = { id: 'session-1', session: { header: {} } }
const child1 = { id: 'child-1', session: { header: { origin: 'subagent', parentSession: 'session-1' } } }
const child2 = { id: 'child-2', session: { header: { origin: 'subagent', parentSession: 'session-1' } } }
const stranger = { id: 'stranger', session: { header: { origin: 'subagent', parentSession: 'session-1' } } }

/** 保存流程并启动运行；启动 n-a1/n-a2 两个节点子代理并登记在线。 */
async function start(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
  const runDef = h.tools.definitions.get(WF_RUN_NODE)!
  await runDef.execute({ nodeId: 'n-a1' }, execOf(rootAgent))
  await runDef.execute({ nodeId: 'n-a2' }, execOf(rootAgent))
  h.agents.children.set('child-1', new FakeChild('child-1'))
  h.agents.children.set('child-2', new FakeChild('child-2'))
}

const ASK_ARGS = { cmd: 'ask', targetChildId: 'child-2', message: '请把中间结果发给我' }

/**
 * 发起 ask 并返回受理凭证（模拟模型从工具结果读取 askId）。
 * harness 默认 TTL 为 30s 且注入可控时钟，故登记在用例执行期间不会意外过期。
 */
async function ask(h: Harness, args: Record<string, unknown> = ASK_ARGS): Promise<AskReceipt> {
  const def = h.tools.definitions.get(WF_ASK_AGENT)!
  const result = (await def.execute(args, execOf(child1))) as Partial<AskReceipt>
  expect(typeof result.askId).toBe('string')
  expect(result.askId).not.toBe('')
  return { cmd: String(result.cmd), askId: String(result.askId), from: String(result.from), to: String(result.to) }
}

// ---------------------------------------------------------------------------
// 注册与 schema
// ---------------------------------------------------------------------------

describe('wf_ask_agent 注册与 schema', () => {
  it('注册成功；cmd 必填且为两态枚举；参数集齐（resolve 已退役）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    expect(def.parameters.required).toEqual(['cmd'])
    const cmd = (def.parameters.properties ?? {}).cmd as JsonSchemaNode
    expect(cmd.enum).toEqual(['ask', 'reply'])
    expect(Object.keys(def.parameters.properties ?? {}).sort()).toEqual(['askId', 'cmd', 'message', 'targetChildId'].sort())
    h.disposeTools()
    expect(h.tools.definitions.has(WF_ASK_AGENT)).toBe(false)
  })

  it('description 符合官方标准英文（W-03）且声明不等待语义', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    expect(def.description.length).toBeGreaterThan(40)
    const ascii = [...def.description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / def.description.length).toBeGreaterThan(0.9)
    const words = def.description.split(/\s+/).length
    expect(words).toBeLessThanOrEqual(130)
    // 非阻塞契约必须在模型可见描述中明确（避免模型误以为调用会等到回复）
    expect(def.description).toContain('returns immediately')
    expect(def.description).toContain('does not wait')
    expect(def.description).not.toContain('blocks until')
  })
})

// ---------------------------------------------------------------------------
// 参数契约：逐 cmd 的必填组合必须在模型可见 description 里写明
// ---------------------------------------------------------------------------

/** 取某参数的说明文本（缺参数即抛，避免空集断言假通过）。 */
function paramDescriptionOf(def: ToolDefinitionLike, name: string): string {
  const node = (def.parameters.properties ?? {})[name] as { description?: unknown } | undefined
  const description = String(node?.description ?? '')
  if (!description) throw new Error(`参数 ${name} 缺少 description`)
  return description
}

describe('wf_ask_agent 参数必填组合的模型可见契约', () => {
  it('targetChildId 说明它只在 cmd=ask 时必填', async () => {
    const h = await makeHarness()
    const text = paramDescriptionOf(h.tools.definitions.get(WF_ASK_AGENT)!, 'targetChildId')
    expect(text).toContain('cmd=ask')
    expect(text.toLowerCase()).toContain('required')
  })

  it('askId 说明它只在 cmd=reply 时必填', async () => {
    const h = await makeHarness()
    const text = paramDescriptionOf(h.tools.definitions.get(WF_ASK_AGENT)!, 'askId')
    expect(text).toContain('cmd=reply')
    expect(text.toLowerCase()).toContain('required')
  })

  it('message 说明 ask 与 reply 都必填', async () => {
    const h = await makeHarness()
    const text = paramDescriptionOf(h.tools.definitions.get(WF_ASK_AGENT)!, 'message')
    expect(text).toContain('cmd=ask')
    expect(text).toContain('cmd=reply')
    expect(text.toLowerCase()).toContain('required')
  })

  it('cmd 仍是唯一 schema 必填项（条件必填只由文档表达，未改 schema 形状）', async () => {
    const h = await makeHarness()
    expect(h.tools.definitions.get(WF_ASK_AGENT)!.parameters.required).toEqual(['cmd'])
  })
})

// ---------------------------------------------------------------------------
// ask 非阻塞
// ---------------------------------------------------------------------------

describe('ask 非阻塞投递', () => {
  it('对端始终不回复，ask 仍立即返回受理凭证（不挂起）', async () => {
    const h = await makeHarness()
    await start(h)

    const receipt = await ask(h)

    expect(receipt).toMatchObject({ cmd: 'ask', from: 'child-1', to: 'child-2' })
    // 对端只收到投递，从未回复；此处无需任何计时器推进即已完成
    expect(h.childSteers('child-2')).toHaveLength(1)
  })

  it('投递消息含 askId 与回复指引，并明确告知对方不会阻塞等待', async () => {
    const h = await makeHarness()
    await start(h)

    const receipt = await ask(h)

    const msg = h.childSteers('child-2')[0]
    expect(msg.role).toBe('user')
    expect(msg.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    const text = String((msg.content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('请把中间结果发给我')
    expect(text).toContain('n-a1')
    expect(text).toContain('child-1')
    expect(text).toContain(receipt.askId)
    expect(text).toContain('不会阻塞等待')
  })

  it('同一发起者可连续发起多条 ask，各自独立受理（已取消 WF_BUSY）', async () => {
    const h = await makeHarness()
    await start(h)

    const first = await ask(h)
    const second = await ask(h, { cmd: 'ask', targetChildId: 'child-2', message: '第二问' })

    expect(first.askId).not.toBe(second.askId)
    expect(h.childSteers('child-2')).toHaveLength(2)
    // 两条登记并存，可分别回复
    expect(h.runtime.runs.get('run-1')?.asks.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// reply 反向投递
// ---------------------------------------------------------------------------

describe('reply 反向投递到发起者', () => {
  it('reply 把回复作为新消息投递给发起者（source 指向回复方），并释放登记', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)

    const replyResult = await def.execute(
      { cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: '结果：42' },
      execOf(child2),
    )

    expect(replyResult).toEqual({ cmd: 'reply', askId: receipt.askId, from: 'child-2', to: 'child-1' })
    // 回复经投递缝反向送达发起者会话（而非作为调用结果返回）
    const back = h.childSteers('child-1')
    expect(back).toHaveLength(1)
    expect(back[0].source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-2' })
    const text = String((back[0].content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('结果：42')
    expect(text).toContain('n-a2')
    expect(text).toContain(receipt.askId)
    // 送达成功后释放登记：该 askId 不再接受重复回复
    expect(h.runtime.runs.get('run-1')?.asks.size).toBe(0)
  })

  it('回复后再次 reply 同一 askId → WF_ASK_NOT_FOUND', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))

    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'again' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_ASK_NOT_FOUND' })
  })

  it('回复投递失败时保留登记并报 WF_DELIVERY_FAILED（允许回复方重试）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    // 发起者离线且父 root 未激活 → 冷恢复不可用 → 投递失败
    h.agents.children.delete('child-1')
    h.agents.roots.delete('session-1')
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_DELIVERY_FAILED' })
    // 登记未被释放（回复方可恢复后重试）
    expect(h.runtime.runs.get('run-1')?.asks.size).toBe(1)
  })

  it('发起者冷态时 reply 经 followup 冷恢复送达', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    h.agents.children.delete('child-1')

    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: '冷恢复回复' }, execOf(child2))

    expect(h.followups).toHaveLength(1)
    expect(h.followups[0].childId).toBe('child-1')
    expect(h.followups[0].parentId).toBe('session-1')
    const text = String((h.followups[0].content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('冷恢复回复')
  })
})

// ---------------------------------------------------------------------------
// 越权拒绝（R-04）
// ---------------------------------------------------------------------------

describe('越权拒绝（R-04）', () => {
  it('非当前运行节点子代理发起 ask → WF_ASK_FORBIDDEN', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute(ASK_ARGS, execOf(stranger))).rejects.toMatchObject({ code: 'WF_ASK_FORBIDDEN' })
  })

  it('目标不是当前运行节点子代理 → WF_ASK_TARGET_UNKNOWN', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'ask', targetChildId: 'stranger', message: 'hi' }, execOf(child1))).rejects.toMatchObject({
      code: 'WF_ASK_TARGET_UNKNOWN',
    })
  })

  it('父代理调用 ask → WF_NOT_CHILD', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute(ASK_ARGS, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NOT_CHILD' })
  })

  it('父代理调用 reply → WF_NOT_CHILD', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'x' }, execOf(rootAgent)),
    ).rejects.toMatchObject({ code: 'WF_NOT_CHILD' })
  })

  it('退役的 resolve 命令 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'resolve', askId: 'uuid-1', action: 'abort' }, execOf(rootAgent))).rejects.toMatchObject({
      code: 'WF_BAD_ARGS',
    })
  })

  it('reply 归属不匹配：非目标调用 reply → WF_ASK_MISMATCH 且登记保留', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    // 发起者自己回复（reply 应由目标 child-2 调用）
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'x' }, execOf(child1)),
    ).rejects.toMatchObject({ code: 'WF_ASK_MISMATCH' })
    // 目标仍可正常回复
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))
    expect(h.childSteers('child-1')).toHaveLength(1)
  })

  it('reply 的 targetChildId 非发起者 → WF_ASK_MISMATCH', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-9', askId: receipt.askId, message: 'x' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_ASK_MISMATCH' })
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))
    expect(h.childSteers('child-1')).toHaveLength(1)
  })

  it('askId 不存在 → WF_ASK_NOT_FOUND', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: 'uuid-nope', message: 'x' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_ASK_NOT_FOUND' })
  })

  it('cmd 非法 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'yell', targetChildId: 'child-2', message: 'x' }, execOf(child1))).rejects.toMatchObject({
      code: 'WF_BAD_ARGS',
    })
  })

  it('ask 缺 message / 缺 targetChildId → WF_BAD_ARGS；reply 缺 message → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'ask', targetChildId: 'child-2' }, execOf(child1))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ cmd: 'ask', message: 'hi' }, execOf(child1))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    const receipt = await ask(h)
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('不能向自己发起协作通信 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'ask', targetChildId: 'child-1', message: 'hi' }, execOf(child1))).rejects.toMatchObject({
      code: 'WF_BAD_ARGS',
    })
  })

  it('运行停止后调用 → WF_NO_ACTIVE_RUN（终态条目已释放）；未运行 → WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await h.runtime.stopRun('run-1')
    // 终态条目已从内存释放（防膨胀），统一按无活动运行拒绝
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })

    const h2 = await makeHarness()
    const def2 = h2.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def2.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})

// ---------------------------------------------------------------------------
// TTL 惰性清理
// ---------------------------------------------------------------------------

describe('待回复登记 TTL 惰性清理', () => {
  it('TTL 未到期：仍可回复并反向投递', async () => {
    let clock = 1_000
    const h = await makeHarness({ config: { wfAskAgentTtlMs: 500 }, now: () => clock })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)

    clock += 499 // 未到期
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))

    expect(h.childSteers('child-1')).toHaveLength(1)
  })

  it('TTL 到期：登记被惰性清理，其 askId 不再接受 reply（WF_ASK_NOT_FOUND）', async () => {
    let clock = 1_000
    const h = await makeHarness({ config: { wfAskAgentTtlMs: 500 }, now: () => clock })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)

    clock += 500 // 到期（expiresAt <= now）
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_ASK_NOT_FOUND' })
    // 到期仅静默清理：不向任何代理发消息
    expect(h.childSteers('child-1')).toHaveLength(0)
    expect(h.runtime.runs.get('run-1')?.asks.size).toBe(0)
    const audit = h.infos.filter((line) => line.includes('ttl-expired'))
    expect(audit).toHaveLength(1)
  })

  it('到期清理不影响其他未到期登记', async () => {
    let clock = 1_000
    const h = await makeHarness({ config: { wfAskAgentTtlMs: 500 }, now: () => clock })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const first = await ask(h)
    clock += 400
    const second = await ask(h, { cmd: 'ask', targetChildId: 'child-2', message: '第二问' })

    clock += 200 // first 到期（1000+500=1500 <= 1600），second（1400+500=1900）未到期
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: second.askId, message: '新回复' }, execOf(child2))

    expect(h.childSteers('child-1')).toHaveLength(1)
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: first.askId, message: '旧回复' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_ASK_NOT_FOUND' })
  })

  it('缺省 TTL：默认 harness 的受理窗口远大于用例时长（旧值 500ms 的墙钟依赖已消除）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    const startedAt = h.runtime.now()

    // 模拟并行负载下 ask → reply 之间的真实调度间隙；旧默认 TTL=500ms 且用真实时钟时该登记必然过期
    await new Promise((resolve) => setTimeout(resolve, 600))
    const repliedAt = h.runtime.now()

    // 可控时钟不随真实等待推进：登记窗口只由缺省 TTL 决定，故 600ms 停顿事件不会误杀登记
    expect(repliedAt - startedAt).toBeLessThan(30_000)
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2)),
    ).resolves.toEqual({ cmd: 'reply', askId: receipt.askId, from: 'child-2', to: 'child-1' })
  })
})

// ---------------------------------------------------------------------------
// 冷态回退
// ---------------------------------------------------------------------------

describe('冷态回退（followup 冷恢复）', () => {
  it('目标不在线（agents 注册表无）→ subagents.followup 投递（source 透传、父 root 授权）', async () => {
    const h = await makeHarness()
    await start(h)
    // 模拟目标冷态：child-2 从注册表释放（激活已回收），但 childIndex 仍登记（本 run 启动过）
    h.agents.children.delete('child-2')
    const def = h.tools.definitions.get(WF_ASK_AGENT)!

    const receipt = await ask(h)

    expect(receipt.to).toBe('child-2')
    const call = h.followups[0]
    expect(call.parentId).toBe('session-1')
    expect(call.childId).toBe('child-2')
    expect(call.options.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    const text = String((call.content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('请把中间结果发给我')

    // 冷恢复后目标可回复
    const replyResult = (await def.execute(
      { cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' },
      execOf(child2),
    )) as { cmd?: string }
    expect(replyResult.cmd).toBe('reply')
    expect(h.childSteers('child-1')).toHaveLength(1)
  })

  it('目标不在线且父 root 未激活 → 投递失败（WF_DELIVERY_FAILED），且不留残余登记', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.children.delete('child-2')
    h.agents.roots.delete('session-1')
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_DELIVERY_FAILED' })
    expect(h.runtime.runs.get('run-1')?.asks.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 节点 id 寻址（协作块成员稳定寻址）
// ---------------------------------------------------------------------------

describe('节点 id 寻址（协作块成员稳定寻址）', () => {
  it('ask 按成员节点 id 寻址在线目标 → 投递给该节点子代理；reply 按发起者节点 id 反向投递', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!

    const receipt = await ask(h, { cmd: 'ask', targetChildId: 'n-a2', message: '请把结果发给我' })

    expect(receipt).toMatchObject({ cmd: 'ask', from: 'child-1', to: 'child-2' })
    expect(h.childSteers('child-2')).toHaveLength(1)
    // reply 用发起者节点 id（n-a1）而非会话 id（child-1）
    await def.execute({ cmd: 'reply', targetChildId: 'n-a1', askId: receipt.askId, message: '结果：21' }, execOf(child2))
    const back = h.childSteers('child-1')
    expect(back).toHaveLength(1)
    expect(String((back[0].content[0] as { text?: unknown }).text ?? '')).toContain('结果：21')
  })

  it('冷态目标：ask 按成员节点 id 寻址 → followup 冷恢复唤醒（目标已停止/离线也可达）', async () => {
    const h = await makeHarness()
    await start(h)
    // 模拟目标已停止/离线：从 agents 注册表释放（激活已回收），但 childIndex 仍登记
    h.agents.children.delete('child-2')
    const def = h.tools.definitions.get(WF_ASK_AGENT)!

    const receipt = await ask(h, { cmd: 'ask', targetChildId: 'n-a2', message: '请唤醒后回复' })

    expect(h.followups[0].childId).toBe('child-2') // 解析到该节点的子代理 id 后冷恢复
    const replyResult = (await def.execute(
      { cmd: 'reply', targetChildId: 'n-a1', askId: receipt.askId, message: '已唤醒，结果：7' },
      execOf(child2),
    )) as { cmd?: string }
    expect(replyResult.cmd).toBe('reply')
    expect(h.childSteers('child-1')).toHaveLength(1)
  })

  it('未知节点 id / 未启动节点 / 自己的节点 id → 拒绝', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    // 任意未知 id（既非子代理会话 id 也非本 run 节点 id）
    await expect(def.execute({ cmd: 'ask', targetChildId: 'n-ghost', message: 'hi' }, execOf(child1))).rejects.toMatchObject({ code: 'WF_ASK_TARGET_UNKNOWN' })
    // 本 run 存在但未启动的节点（start 阶段节点未派生子代理）
    await expect(def.execute({ cmd: 'ask', targetChildId: 'n-start', message: 'hi' }, execOf(child1))).rejects.toMatchObject({ code: 'WF_ASK_TARGET_UNKNOWN' })
    // 发起者自己的节点 id → 禁止自投
    await expect(def.execute({ cmd: 'ask', targetChildId: 'n-a1', message: 'hi' }, execOf(child1))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('子代理会话 id 寻址（兼容既有用法）与节点 id 寻址等价', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!

    const receipt = await ask(h, { cmd: 'ask', targetChildId: 'child-2', message: '用会话 id 也试试' })

    expect(receipt.to).toBe('child-2')
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))
    expect(h.childSteers('child-1')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 生命周期与审计
// ---------------------------------------------------------------------------

describe('生命周期与审计', () => {
  it('运行终止后调用被拒（WF_NO_ACTIVE_RUN）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    await h.runtime.stopRun('run-1')
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
    await expect(
      def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2)),
    ).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('ask/deliver/reply/reply-deliver 审计事件写入宿主日志', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const receipt = await ask(h)
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: receipt.askId, message: 'ok' }, execOf(child2))

    const audit = h.infos.filter((line) => line.includes('wf_ask_agent audit'))
    // 审计行格式：wf_ask_agent audit: askId=<id> <event> <detail>
    expect(audit.some((line) => line.includes(' ask '))).toBe(true)
    expect(audit.some((line) => line.includes('deliver'))).toBe(true)
    expect(audit.some((line) => line.includes('reply'))).toBe(true)
    expect(audit.some((line) => line.includes('reply-deliver'))).toBe(true)
  })

  it('投递失败写入 deliver-failed 审计，且不产生虚假成功记录', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    h.agents.children.delete('child-2')
    h.agents.roots.delete('session-1')
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_DELIVERY_FAILED' })
    const audit = h.infos.filter((line) => line.includes('wf_ask_agent audit'))
    expect(audit.some((line) => line.includes('deliver-failed'))).toBe(true)
  })
})

// tests/host/wf-ask-agent.test.ts
//
// wf_ask_agent 工具单测（里程碑 2）：
//   - 注册与 schema（cmd 必填/三态枚举/description W-03 英文）；
//   - ask → reply 正常链路：插队投递（目标 steer，source=coordinator relay）、
//     reply 解除发起者阻塞（工具结果 = 回复文本）；
//   - 越权拒绝（R-04）：非运行节点子代理 ask / 目标非节点子代理 / 父代理 ask /
//     子代理 resolve / reply 归属不匹配 / askId 不存在；
//   - 超时裁决：超时注入父代理（steer 通知）、resolve 三动作（continue 重启计时
//     再次超时再次通知 / resend 重发 / abort 让发起者以超时错误继续）、未超时
//     resolve 拒绝；
//   - 冷态回退：目标不在线 → subagents.followup（官方冷恢复，source 透传）；
//   - 生命周期：运行终止时挂起 ask 释放（WF_CANCELLED）、同发起者重复 ask
//     拒绝（WF_BUSY）、审计日志事件。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type CoordinatorMessage,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import { WF_ASK_AGENT, WF_RUN_NODE } from '../../src/host/shared/protocol.js'
import { registerWfTools } from '../../src/host/tools/wf-tools.js'
import { registerWfAskAgent, type WfAskAgentHost } from '../../src/host/tools/wf-ask-agent.js'
import type { ToolDefinitionLike, ToolExecLike } from '../../src/host/tools/define-tool.js'
import type { JsonSchemaNode } from '../../src/host/tools/define-tool.js'

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

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  agents: FakeAgents
  tools: FakeToolsRegistry
  followups: FollowupCall[]
  infos: string[]
  disposeTools: () => void
  askIdOf: () => string
  childSteers: (childId: string) => CoordinatorMessage[]
  rootSteers: () => CoordinatorMessage[]
}

/** 装配：真实编排运行时 + fake 依赖 + 注册 wf_run_node 与 wf_ask_agent。 */
async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-askagent-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
  const infos: string[] = []
  const uuidSeq = { n: 0 }
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
      wfAskAgentTimeoutMs: 500,
      ...config,
    },
    logger: { warn: () => {}, info: (message) => infos.push(message), debug: () => {} },
    newRunId: () => 'run-1',
    uuid: () => `uuid-${(uuidSeq.n += 1)}`,
  })
  const tools = new FakeToolsRegistry()
  const followups: FollowupCall[] = []
  const host: WfAskAgentHost = {
    orchestrator: runtime,
    getRootAgent: (sid) => agents.getRootAgent(sid),
    getChildAgent: (cid) => agents.getChildAgent(cid),
    followupChild: async (parent, childId, content, options) => {
      followups.push({ parentId: parent.id, childId, content, options })
      return `msg-${childId}`
    },
  }
  const ctx = { get: (name: string) => (name === 'tools' ? tools : null) }
  const disposeTools = (() => {
    const d1 = registerWfTools(ctx, host)
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
    askIdOf: () => {
      const run = runtime.runs.get('run-1')
      const keys = run ? [...run.asks.keys()] : []
      if (keys.length === 0) throw new Error('no pending ask')
      return keys[0]
    },
    childSteers: (childId) => agents.children.get(childId)?.steers ?? [],
    rootSteers: () => agents.roots.get('session-1')?.steers ?? [],
  }
}

/** 构造工具执行上下文（agent 形状按官方 Session header 事实）。 */
function execOf(agent: unknown, signal?: AbortSignal): ToolExecLike {
  return { signal: signal ?? new AbortController().signal, agent }
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

// ---------------------------------------------------------------------------
// 注册与 schema
// ---------------------------------------------------------------------------

describe('wf_ask_agent 注册与 schema', () => {
  it('注册成功；cmd 必填且为三态枚举；参数集齐', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    expect(def.parameters.required).toEqual(['cmd'])
    const cmd = (def.parameters.properties ?? {}).cmd as JsonSchemaNode
    expect(cmd.enum).toEqual(['ask', 'reply', 'resolve'])
    const action = (def.parameters.properties ?? {}).action as JsonSchemaNode
    expect(action.enum).toEqual(['continue', 'resend', 'abort'])
    expect(Object.keys(def.parameters.properties ?? {}).sort()).toEqual(['action', 'askId', 'cmd', 'message', 'targetChildId'].sort())
    h.disposeTools()
    expect(h.tools.definitions.has(WF_ASK_AGENT)).toBe(false)
  })

  it('description 符合官方标准英文（W-03）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    expect(def.description.length).toBeGreaterThan(40)
    const ascii = [...def.description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / def.description.length).toBeGreaterThan(0.9)
    const words = def.description.split(/\s+/).length
    expect(words).toBeLessThanOrEqual(130)
  })
})

// ---------------------------------------------------------------------------
// ask → reply 正常链路
// ---------------------------------------------------------------------------

describe('ask → reply 正常链路', () => {
  it('ask 挂起阻塞发起者；目标收到插队 steer（source=coordinator relay 含 askId）；reply 解除阻塞', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const msg = h.childSteers('child-2')[0]
    expect(msg.role).toBe('user')
    expect(msg.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    expect(msg.content[0].text).toContain('请把中间结果发给我')
    expect(msg.content[0].text).toContain('n-a1')
    expect(msg.content[0].text).toContain('child-1')
    const askId = h.askIdOf()
    expect(msg.content[0].text).toContain(askId)

    const replyResult = await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: '结果：42' }, execOf(child2))
    expect(replyResult).toEqual({ cmd: 'reply', askId, from: 'child-2', to: 'child-1' })
    await expect(askPromise).resolves.toMatchObject({ cmd: 'ask', askId, from: 'child-1', to: 'child-2', reply: '结果：42' })
  })

  it('回复后 ask 记录释放：再次 reply 同一 askId 报 WF_ASK_NOT_FOUND', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
    await expect(def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'again' }, execOf(child2))).rejects.toMatchObject({
      code: 'WF_ASK_NOT_FOUND',
    })
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

  it('父代理发起 ask → WF_NOT_CHILD', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute(ASK_ARGS, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NOT_CHILD' })
  })

  it('子代理执行 resolve → WF_NOT_ROOT', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'resolve', askId: 'uuid-1', action: 'abort' }, execOf(child1))).rejects.toMatchObject({
      code: 'WF_NOT_ROOT',
    })
  })

  it('reply 归属不匹配：非目标调用 reply → WF_ASK_MISMATCH', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    // 发起者自己回复（reply 应由目标 child-2 调用）
    await expect(def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'x' }, execOf(child1))).rejects.toMatchObject({
      code: 'WF_ASK_MISMATCH',
    })
    // 目标仍在等待，可正常回复
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('reply 的 targetChildId 非发起者 → WF_ASK_MISMATCH', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await expect(def.execute({ cmd: 'reply', targetChildId: 'child-9', askId, message: 'x' }, execOf(child2))).rejects.toMatchObject({
      code: 'WF_ASK_MISMATCH',
    })
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('askId 不存在（reply/resolve）→ WF_ASK_NOT_FOUND', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'reply', targetChildId: 'child-1', askId: 'uuid-nope', message: 'x' }, execOf(child2))).rejects.toMatchObject({
      code: 'WF_ASK_NOT_FOUND',
    })
    await expect(def.execute({ cmd: 'resolve', askId: 'uuid-nope', action: 'abort' }, execOf(rootAgent))).rejects.toMatchObject({
      code: 'WF_ASK_NOT_FOUND',
    })
  })

  it('未超时的 ask 不可 resolve → WF_ASK_NOT_TIMED_OUT', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await expect(def.execute({ cmd: 'resolve', askId, action: 'abort' }, execOf(rootAgent))).rejects.toMatchObject({
      code: 'WF_ASK_NOT_TIMED_OUT',
    })
    // 未受影响：仍可正常回复
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('同发起者挂起中重复 ask → WF_BUSY', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_BUSY' })
    const askId = h.askIdOf()
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('cmd 非法 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute({ cmd: 'yell', targetChildId: 'child-2', message: 'x' }, execOf(child1))).rejects.toMatchObject({
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
// 超时与父代理裁决
// ---------------------------------------------------------------------------

describe('超时与父代理裁决', () => {
  it('超时注入父代理（steer 通知含超时详情）；resolve abort 让发起者以超时错误继续', async () => {
    vi.useFakeTimers()
    const h = await makeHarness({ wfAskAgentTimeoutMs: 30000 })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()

    await vi.advanceTimersByTimeAsync(30000)
    expect(h.rootSteers()).toHaveLength(1)
    const notice = h.rootSteers()[0]
    expect(notice.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'visual-workflow' })
    expect(notice.content[0].text).toContain('协作通信超时')
    expect(notice.content[0].text).toContain(askId)
    expect(notice.content[0].text).toContain('请把中间结果发给我')

    const res = await def.execute({ cmd: 'resolve', askId, action: 'abort' }, execOf(rootAgent))
    expect(res).toEqual({ cmd: 'resolve', askId, action: 'abort' })
    await expect(askPromise).rejects.toMatchObject({ code: 'WF_ASK_AGENT_TIMEOUT' })
  })

  it('resolve continue：重启计时，再次超时再次通知父代理', async () => {
    vi.useFakeTimers()
    const h = await makeHarness({ wfAskAgentTimeoutMs: 30000 })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()

    await vi.advanceTimersByTimeAsync(30000)
    expect(h.rootSteers()).toHaveLength(1)
    const res = await def.execute({ cmd: 'resolve', askId, action: 'continue' }, execOf(rootAgent))
    expect(res).toEqual({ cmd: 'resolve', askId, action: 'continue' })
    // 发起者仍挂起；计时重启 → 再次超时 → 第二次通知
    await vi.advanceTimersByTimeAsync(30000)
    expect(h.rootSteers()).toHaveLength(2)
    // 第二次超时后仍可裁决：abort 释放发起者
    await def.execute({ cmd: 'resolve', askId, action: 'abort' }, execOf(rootAgent))
    await expect(askPromise).rejects.toMatchObject({ code: 'WF_ASK_AGENT_TIMEOUT' })
  })

  it('resolve resend：重新投递（再次 steer 目标），计时重启', async () => {
    vi.useFakeTimers()
    const h = await makeHarness({ wfAskAgentTimeoutMs: 30000 })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()

    await vi.advanceTimersByTimeAsync(30000)
    const res = await def.execute({ cmd: 'resolve', askId, action: 'resend' }, execOf(rootAgent))
    expect(res).toEqual({ cmd: 'resolve', askId, action: 'resend' })
    expect(h.childSteers('child-2')).toHaveLength(2)
    // 重发后目标可回复
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('resolve action 非法 → WF_BAD_ARGS', async () => {
    vi.useFakeTimers()
    const h = await makeHarness({ wfAskAgentTimeoutMs: 30000 })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await vi.advanceTimersByTimeAsync(30000)
    await expect(def.execute({ cmd: 'resolve', askId, action: 'pause' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    // 非法 action 不改变状态：仍可 abort 收尾
    await def.execute({ cmd: 'resolve', askId, action: 'abort' }, execOf(rootAgent))
    await expect(askPromise).rejects.toMatchObject({ code: 'WF_ASK_AGENT_TIMEOUT' })
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
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.followups).toHaveLength(1))
    const call = h.followups[0]
    expect(call.parentId).toBe('session-1')
    expect(call.childId).toBe('child-2')
    expect(call.options.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    const text = String((call.content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('请把中间结果发给我')

    // 冷恢复后目标可回复解除阻塞
    const askId = h.askIdOf()
    const replyResult = (await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))) as { cmd?: string }
    expect(replyResult.cmd).toBe('reply')
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
  })

  it('目标不在线且父 root 未激活 → 投递失败（WF_DELIVERY_FAILED）', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.children.delete('child-2')
    h.agents.roots.delete('session-1')
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    await expect(def.execute(ASK_ARGS, execOf(child1))).rejects.toMatchObject({ code: 'WF_DELIVERY_FAILED' })
  })
})

// ---------------------------------------------------------------------------
// 生命周期与审计
// ---------------------------------------------------------------------------

describe('生命周期与审计', () => {
  it('运行终止时挂起 ask 释放（WF_CANCELLED）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    // 提前挂处理：终止路径的 reject 在 stopRun 内部同步发生
    void (askPromise as Promise<unknown>).catch(() => {})
    await h.runtime.stopRun('run-1')
    await expect(askPromise).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })

  it('ask/deliver/reply 审计事件写入宿主日志', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await def.execute({ cmd: 'reply', targetChildId: 'child-1', askId, message: 'ok' }, execOf(child2))
    await expect(askPromise).resolves.toMatchObject({ reply: 'ok' })
    const audit = h.infos.filter((line) => line.includes('wf_ask_agent audit'))
    // 审计行格式：wf_ask_agent audit: askId=<id> <event> <detail>
    expect(audit.some((line) => line.includes(' ask '))).toBe(true)
    expect(audit.some((line) => line.includes('deliver'))).toBe(true)
    expect(audit.some((line) => line.includes('reply'))).toBe(true)
  })

  it('超时与裁决事件写入审计（timeout/resolve-abort）', async () => {
    vi.useFakeTimers()
    const h = await makeHarness({ wfAskAgentTimeoutMs: 30000 })
    await start(h)
    const def = h.tools.definitions.get(WF_ASK_AGENT)!
    const askPromise = def.execute(ASK_ARGS, execOf(child1))
    await vi.waitFor(() => expect(h.childSteers('child-2')).toHaveLength(1))
    const askId = h.askIdOf()
    await vi.advanceTimersByTimeAsync(30000)
    await def.execute({ cmd: 'resolve', askId, action: 'abort' }, execOf(rootAgent))
    await expect(askPromise).rejects.toMatchObject({ code: 'WF_ASK_AGENT_TIMEOUT' })
    const audit = h.infos.filter((line) => line.includes('wf_ask_agent audit'))
    expect(audit.some((line) => line.includes('timeout'))).toBe(true)
    expect(audit.some((line) => line.includes('resolve-abort'))).toBe(true)
  })
})

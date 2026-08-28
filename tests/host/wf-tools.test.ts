// tests/host/wf-tools.test.ts
//
// wf_* 工具注册单测：
//   - defineTool DSL 编译产物（参数 required 提取/隐式开放根/输出 schema）；
//   - callerOf 身份派生（根 Agent 与子代理判定）；
//   - wf_run_node / wf_finish：归属校验（子代理拒绝 WF_NOT_ROOT）、参数透传、
//     暂停门与 wait 阻塞路径（复用真实编排运行时）；
//   - wf_ask：仅子代理可调用（WF_NOT_CHILD）、运行态校验、questions 规范化、
//     官方 userQuestions.ask 调用形状（agent=父 root、组合信号）、取消映射；
//   - description 符合官方标准英文写法（W-03 断言）；
//   - disposer 注销全量生效。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type CallerInfo,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import { WF_ASK, WF_FINISH, WF_RUN_NODE, WF_RUN_NODE_WAIT } from '../../src/host/shared/protocol.js'
import { callerOf, registerWfTools, type WfToolsHost } from '../../src/host/tools/wf-tools.js'
import { stableStringify, textRender } from '../../src/host/tools/text-render.js'
import type { JsonSchemaNode, ToolDefinitionLike, ToolExecLike } from '../../src/host/tools/define-tool.js'

// ---------------------------------------------------------------------------
// 测试替身与装配
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
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

/** 标准测试流程（模式一）：start → a1 → pause → a2 → end。 */
function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-pause', 'pause'), agent('n-a2', '子任务B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
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

/** fake tools 注册表：收集定义与注销调用。 */
class FakeToolsRegistry {
  definitions = new Map<string, ToolDefinitionLike>()
  unregistered = new Set<string>()
  register(def: ToolDefinitionLike): () => void {
    if (this.definitions.has(def.name)) throw new Error(`duplicate tool: ${def.name}`)
    this.definitions.set(def.name, def)
    return () => {
      this.unregistered.add(def.name)
      this.definitions.delete(def.name)
    }
  }
}

/** fake userQuestions 服务。 */
class FakeUserQuestions {
  calls: Array<{ questions: unknown[]; agent: unknown; signal?: AbortSignal }> = []
  answer = { answers: [{ id: 'q1', selected: ['是'], custom: '' }] }
  fail: unknown = null
  async ask(request: { questions: unknown[]; agent?: unknown; signal?: AbortSignal }): Promise<{ answers?: unknown[] }> {
    this.calls.push({ questions: request.questions, agent: request.agent, signal: request.signal })
    if (this.fail !== null) {
      const error = this.fail
      this.fail = null
      throw error
    }
    return this.answer
  }
}

interface Harness {
  runtime: OrchestratorRuntime
  host: WfToolsHost
  store: FlowStore
  tools: FakeToolsRegistry
  questions: FakeUserQuestions
  clock: { now: number }
  disposeTools: () => void
}

/** 装配：真实编排运行时 + fake 依赖 + 注册三个工具。 */
async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-wftools-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
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
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    now: () => clock.now,
    newRunId: () => `run-${clock.now}`,
    uuid: () => `uuid-${clock.now}`,
  })
  const tools = new FakeToolsRegistry()
  const questions = new FakeUserQuestions()
  const host: WfToolsHost = { orchestrator: runtime, getRootAgent: (sid) => agents.getRootAgent(sid) }
  const ctx = { get: (name: string) => (name === 'userQuestions' ? questions : name === 'tools' ? tools : null) }
  const disposeTools = registerWfTools(ctx, host)
  return { runtime, host, store, tools, questions, clock, disposeTools }
}

/** 构造工具执行上下文（agent 形状按官方 Session header 事实）。 */
function execOf(agent: unknown, signal?: AbortSignal): ToolExecLike {
  return { signal: signal ?? new AbortController().signal, agent }
}

const rootAgent = { id: 'session-1', session: { header: {} } }
const childAgent = {
  id: 'child-1',
  session: { header: { origin: 'subagent', parentSession: 'session-1' } },
}

/** 保存流程并 startRun。 */
async function start(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
}

/** 保存并启动一个模式二后台服务流程（仅 start → a1 → end，无暂停节点）。 */
async function startService(h: Harness): Promise<void> {
  const flow = makeFlow()
  flow.mode = 'mode2'
  flow.name = '测试服务'
    flow.nodes = [
      {
        id: 'n-parent',
        kind: 'parent',
        position: { x: 0, y: 0 },
        data: { label: '父代理', systemPrompt: '', provider: '', model: '', presetId: 'standard', retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '' },
      },
      ...flow.nodes
        .filter((n) => n.kind !== 'pause')
        .map((n) => n.kind === 'start' || n.kind === 'end'
          ? { ...n, data: { ...n.data, label: stageLabel(n.kind, 'mode2') } }
          : n),
    ]
    flow.lines = flow.lines.filter((line) => line.source !== 'n-pause' && line.target !== 'n-pause')
  await h.store.saveService(flow as never, 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id, mode: 'mode2' })
}

// ---------------------------------------------------------------------------
// callerOf 身份派生
// ---------------------------------------------------------------------------

describe('callerOf 身份派生', () => {
  it('根 Agent：isChild=false，sessionId 取 agent.id', () => {
    const caller = callerOf(execOf(rootAgent))
    expect(caller).toEqual({ isChild: false, sessionId: 'session-1' })
  })

  it('根 Agent 无 session：仍判为根，sessionId 取 agent.id', () => {
    const caller = callerOf(execOf({ id: 'session-9' }))
    expect(caller).toEqual({ isChild: false, sessionId: 'session-9' })
  })

  it('子代理：isChild=true，sessionId 取 header.parentSession（父会话）', () => {
    const caller = callerOf(execOf(childAgent))
    expect(caller).toEqual({ isChild: true, sessionId: 'session-1' })
  })

  it('parentSession 存在但 origin 缺失也判为子代理（兼容旧字段组合）', () => {
    const caller = callerOf(execOf({ id: 'child-2', session: { header: { parentSession: 'session-1' } } }))
    expect(caller.isChild).toBe(true)
    expect(caller.sessionId).toBe('session-1')
  })

  it('无 agent：isChild=false、sessionId 为空（调用方错误由编排器拒绝）', () => {
    const caller = callerOf(execOf(null))
    expect(caller).toEqual({ isChild: false, sessionId: '' })
  })
})

// ---------------------------------------------------------------------------
// defineTool DSL 编译产物与注册
// ---------------------------------------------------------------------------

describe('工具注册与 schema 编译', () => {
    it('四个 wf_* 工具全部注册，disposer 注销全量生效', async () => {
      const h = await makeHarness()
      expect([...h.tools.definitions.keys()].sort()).toEqual([WF_ASK, WF_FINISH, WF_RUN_NODE, WF_RUN_NODE_WAIT].sort())
      h.disposeTools()
      expect(h.tools.definitions.size).toBe(0)
      expect(h.tools.unregistered.size).toBe(4)
    })
    it('parameters 为隐式开放对象根（无 additionalProperties），内联 required 提取为数组；两个 run 工具均无 wait', async () => {
      const h = await makeHarness()
      for (const name of [WF_RUN_NODE, WF_RUN_NODE_WAIT]) {
        const def = h.tools.definitions.get(name)!
        expect(def.parameters.type).toBe('object')
        expect(def.parameters.additionalProperties).toBeUndefined()
        expect(def.parameters.required).toEqual(['nodeId'])
        const props = def.parameters.properties ?? {}
        expect(Object.keys(props).sort()).toEqual(['iterationLimit', 'nodeId', 'retryLimit', 'thinking'].sort())
        expect(props.wait).toBeUndefined()
        expect((props.nodeId as JsonSchemaNode).required).toBeUndefined()
      }
    })
    it('output.schema：对象 additionalProperties=false、内联 required 提取、enum 保留（异步/阻塞工具状态枚举不同）', async () => {
      const h = await makeHarness()
      const asyncDef = h.tools.definitions.get(WF_RUN_NODE)!
      const asyncSchema = asyncDef.output.schema as JsonSchemaNode
      expect(asyncSchema.type).toBe('object')
      expect(asyncSchema.additionalProperties).toBe(false)
      expect(asyncSchema.required).toEqual(['nodeId', 'status'])
      const asyncStatus = (asyncSchema.properties ?? {}).status as JsonSchemaNode
      expect(asyncStatus.enum).toEqual(['started', 'paused'])

      const waitDef = h.tools.definitions.get(WF_RUN_NODE_WAIT)!
      const waitSchema = waitDef.output.schema as JsonSchemaNode
      const waitStatus = (waitSchema.properties ?? {}).status as JsonSchemaNode
      expect(waitStatus.enum).toEqual(['paused', 'ok', 'fail'])

      const askDef = h.tools.definitions.get(WF_ASK)!
      const askSchema = askDef.output.schema as JsonSchemaNode
      const answers = (askSchema.properties ?? {}).answers as JsonSchemaNode
      expect(answers.type).toBe('array')
      expect(answers.required).toBeUndefined() // required 只出现在对象属性上，数组本身不参与
    })

  it('wf_ask 的 questions 参数：数组必填、minItems=1、选项对象 open', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK)!
    const questions = (def.parameters.properties ?? {}).questions as JsonSchemaNode
    expect(questions.type).toBe('array')
    expect(questions.minItems).toBe(1)
    const item = questions.items as JsonSchemaNode
    expect(item.additionalProperties).toBe(true)
    expect(item.required).toEqual(['id', 'question'])
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    for (const def of h.tools.definitions.values()) {
      expect(def.description.length).toBeGreaterThan(20)
      // 英文占比 ≥ 90%（description 不应出现中文）
      const ascii = [...def.description].filter((ch) => /[A-Za-z ]/.test(ch)).length
      expect(ascii / def.description.length).toBeGreaterThan(0.9)
      // 目标 ≤ 120 tokens：按空格分词粗略估计
      const words = def.description.split(/\s+/).length
      expect(words).toBeLessThanOrEqual(130)
    }
  })
})

// ---------------------------------------------------------------------------
// textRender / stableStringify
// ---------------------------------------------------------------------------

describe('textRender 键序稳定', () => {
  it('同一对象不同插入序输出一致（键序稳定）', () => {
    const a = stableStringify({ nodeId: 'n1', status: 'ok', childId: 'c1' })
    const b = stableStringify({ childId: 'c1', status: 'ok', nodeId: 'n1' })
    expect(a).toBe(b)
    expect(a).toBe('{"childId":"c1","nodeId":"n1","status":"ok"}')
  })

  it('嵌套对象同样按键排序；数组保持元素顺序', () => {
    const out = stableStringify({ answers: [{ selected: [], id: 'q1' }, { id: 'q2', selected: ['a'] }], ok: true })
    expect(out).toBe('{"answers":[{"id":"q1","selected":[]},{"id":"q2","selected":["a"]}],"ok":true}')
  })

  it('字符串值原样输出；undefined 字段剔除；null 归一', () => {
    expect(textRender({}, 'hello').at(0)?.text).toBe('hello')
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(stableStringify(undefined)).toBe('null')
  })
})

// ---------------------------------------------------------------------------
// wf_run_node execute（真实编排运行时）
// ---------------------------------------------------------------------------

describe('wf_run_node 工具执行', () => {
  it('根 Agent：异步启动返回 started，caller/参数/signal 正确透传', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    const signal = new AbortController().signal
    const result = await def.execute({ nodeId: 'n-a1', thinking: 'high', iterationLimit: 7, retryLimit: 2 }, execOf(rootAgent, signal))
    expect(result).toMatchObject({ nodeId: 'n-a1', status: 'started' })
    expect((result as { childId?: string }).childId).toBeTruthy()
    // 节点状态回写 running
    const snapshot = h.runtime.runSnapshot('run-1000000')!
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')?.status).toBe('running')
  })

  it('子代理调用被拒绝（WF_NOT_ROOT）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })

  it('未运行的工作流被拒绝（WF_NO_ACTIVE_RUN）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('暂停节点触发暂停门：返回 paused、run 置 paused、断点持久化', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    const result = await def.execute({ nodeId: 'n-pause' }, execOf(rootAgent))
    expect(result).toEqual({ nodeId: 'n-pause', status: 'paused' })
    const snapshot = h.runtime.runSnapshot('run-1000000')!
    expect(snapshot.status).toBe('paused')
    expect(snapshot.resumeFromNodeId).toBe('n-pause')
    // 锁保留：paused 运行仍占用运行锁（flowLockInfo 可查）
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'paused' })
  })

  it('wf_run_node_wait 阻塞：subagent/end 完成后返回 ok + output', async () => {
    const h = await makeHarness()
    await startService(h)
    const def = h.tools.definitions.get(WF_RUN_NODE_WAIT)!
    const promise = def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))
    // 等待 wfRunNode 完成启动阶段（waiter/childIndex 注册是异步的；过早派发
    // subagent/end 会因 childIndex 尚未登记而漏掉唤醒）
    await vi.waitFor(() => {
      expect(h.runtime.childMetaFor('child-1')).not.toBeNull()
    })
    // 子代理结束事件回写（与 wait 等待共用完成通道）
    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '任务完成总结' }],
    })
    const result = await promise
    expect(result).toMatchObject({ nodeId: 'n-a1', status: 'ok' })
    expect((result as { output?: string }).output).toContain('任务完成总结')
  })

  it('运行已停止（controller aborted）时调用被拒绝（WF_CANCELLED）', async () => {
    const h = await makeHarness()
    await start(h)
    const entry = h.runtime.activeRunForSession('session-1')!
    entry.controller.abort('test')
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})

// ---------------------------------------------------------------------------
// wf_finish execute
// ---------------------------------------------------------------------------

describe('wf_finish 工具执行', () => {
  it('根 Agent：收尾 completed，幂等重复返回终态', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_FINISH)!
    const first = await def.execute({ status: 'completed', summary: '全部完成' }, execOf(rootAgent))
    expect(first).toMatchObject({ ok: true, status: 'completed' })
    const second = await def.execute({ summary: '重复' }, execOf(rootAgent))
    expect(second).toMatchObject({ ok: true, status: 'completed', idempotent: true })
  })

  it('子代理调用被拒绝（WF_NOT_ROOT）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_FINISH)!
    await expect(def.execute({}, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })

  it('无运行调用报错（WF_NO_ACTIVE_RUN）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_FINISH)!
    await expect(def.execute({}, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})

// ---------------------------------------------------------------------------
// wf_ask execute
// ---------------------------------------------------------------------------

describe('wf_ask 工具执行', () => {
  it('根 Agent 调用被拒绝（WF_NOT_CHILD）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NOT_CHILD' })
  })

  it('子代理调用但无运行 → WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('运行已暂停 → 无激活运行（WF_NO_ACTIVE_RUN；暂停下无子代理可提问）', async () => {
    const h = await makeHarness()
    await start(h)
    h.runtime.activeRunForSession('session-1')!.snapshot.status = 'paused'
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('空 questions → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({}, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ questions: [] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    // 全空 question 文本 → 同样拒绝
    await expect(def.execute({ questions: [{ id: 'q1', question: '  ' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('正常路径：以父 root 身份调用官方 ask，返回 answers，触碰空闲基准', async () => {
    const h = await makeHarness()
    await start(h)
    const entry = h.runtime.activeRunForSession('session-1')!
    entry.lastActiveAt = h.clock.now // 固定基准
    const def = h.tools.definitions.get(WF_ASK)!
    h.clock.now += 1000
    const result = await def.execute(
      { questions: [{ id: 'q1', question: '继续？', header: '确认', options: [{ label: '是' }, { label: '' }], multi_select: false }] },
      execOf(childAgent),
    )
    expect(result).toEqual({ answers: [{ id: 'q1', selected: ['是'], custom: '' }] })
    expect(h.questions.calls).toHaveLength(1)
    const call = h.questions.calls[0]
    // 规范化：空 label 选项剔除、header 保留、multi_select=false 时不注入 multiSelect
    expect(call.questions).toEqual([
      { id: 'q1', question: '继续？', header: '确认', options: [{ label: '是' }] },
    ])
    // agent 必须是父 root（精确存活 root 身份）
    expect(call.agent).toEqual(h.host.getRootAgent('session-1'))
    // 组合信号存在（运行 controller ∪ 调用方）
    expect(call.signal).toBeDefined()
    // 空闲基准被触碰
    expect(entry.lastActiveAt).toBe(h.clock.now)
  })

  it('id 缺省回退 q<index>；多选映射 multiSelect: true', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_ASK)!
    await def.execute({ questions: [{ question: 'A' }, { id: 'q9', question: 'B', multi_select: true }] }, execOf(childAgent))
    const normalized = h.questions.calls[0].questions as Array<Record<string, unknown>>
    expect(normalized[0].id).toBe('q0')
    expect(normalized[1]).toMatchObject({ id: 'q9', multiSelect: true })
  })

  it('官方 ASK_ABORTED → 映射为 WF_CANCELLED', async () => {
    const h = await makeHarness()
    await start(h)
    h.questions.fail = Object.assign(new Error('提问已取消'), { code: 'ASK_ABORTED' })
    const def = h.tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })

  it('userQuestions 服务缺失 → 明确错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-wftools-noq-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const store = new FlowStore(dir)
    await store.init()
    const agents = new FakeAgents()
    agents.roots.set('session-1', new FakeRoot('session-1'))
    const runtime = new OrchestratorRuntime({
      store,
      runner: new FakeRunner(),
      agents,
      config: { outputFullLimit: 400, documentTextLimit: 200, runIdleTimeoutMs: 500, retryLimitDefault: 3, reactIterationLimitDefault: 50, wfAskAgentTimeoutMs: 500 },
      newRunId: () => 'run-x',
    })
    const tools = new FakeToolsRegistry()
    const host: WfToolsHost = { orchestrator: runtime, getRootAgent: (sid) => agents.getRootAgent(sid) }
    // ctx 只提供 tools，不提供 userQuestions
    const dispose = registerWfTools({ get: (name) => (name === 'tools' ? tools : null) }, host)
    await store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const def = tools.definitions.get(WF_ASK)!
    await expect(def.execute({ questions: [{ id: 'q1', question: '继续？' }] }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ASK_PROVIDER' })
    dispose()
  })
})

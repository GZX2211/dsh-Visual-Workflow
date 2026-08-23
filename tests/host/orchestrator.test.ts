// tests/host/orchestrator.test.ts
//
// 编排核心单测（T-021）：运行锁 / 快照 / startRun / 编排指令注入 / subagent/end
// 观察 / 护栏 / currentResolvedFlow / terminate / 幂等收尾 / wait 阻塞 / 暂停门。
// DoD：状态机全覆盖；wf_run_node 异步/wait 阻塞/pause 门三路径正确；编排指令模板
// 满足 W-01/W-02（前缀稳定 + 关键约束双位 + 动态值仅注入末段）。
//
// 断言依据：需求文档 §4.1.2/§4.4.2/§4.7、架构文档 §4.3/§13、任务清单 T-021 DoD。
// 依赖缝：FakeAgents/FakeRunner 模拟父代理与节点执行引擎——T-022 实现真实引擎后
// 本文件的行为契约不变（接口即契约）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  GLOBAL_RUN_CALL_LIMIT,
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
import {
  OUTPUT_SUMMARY_LIMIT,
  createRunSnapshot,
  lastAssistantText,
  setNodeStatus,
  statusText,
  terminalizeNodes,
  truncateText,
} from '../../src/host/orchestrator/snapshot.js'
import { WATCHDOG_INTERVAL_MS, reconcileStaleRuns, scheduleIdleWatchdog, sweepWatchdogOnce } from '../../src/host/orchestrator/watchdog.js'
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from '../../src/host/prompts/markers.js'
import { ORCH_HARD_CONSTRAINTS } from '../../src/host/prompts/orchestration.js'
import { NODE_HARD_CONSTRAINTS } from '../../src/host/prompts/node-task.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { FileNode, RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 测试替身与装配
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 阶段节点（固定 id，确定性测试）。 */
function stage(id: string, kind: 'start' | 'end' | 'pause', mode: 'mode1' | 'mode2' = 'mode1'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, mode) } }
}

/** 角色节点（固定 id + 可覆盖数据）。 */
function agent(id: string, label: string, extra: Partial<RoleNode['data']> = {}): RoleNode {
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
      proxySourceId: null,
      ...extra,
    },
  }
}

/** 文件节点。 */
function fileNode(id: string, label: string, extra: Partial<FileNode['data']> = {}): FileNode {
  return {
    id,
    kind: 'file',
    position: { x: 0, y: 0 },
    data: { label, fileKind: 'text', content: '', fileName: '', ...extra },
  }
}

/** 标准测试流程（模式一）：start → a1 → pause → a2 → end + a2 的虚拟节点。 */
function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [
      stage('n-start', 'start', 'mode1'),
      agent('n-a1', '子任务A'),
      stage('n-pause', 'pause', 'mode1'),
      agent('n-a2', '子任务B'),
      stage('n-end', 'end', 'mode1'),
      { id: 'n-proxy-a2', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-a2' },
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 会话根 Agent fake。 */
class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

/** AgentHost fake：available/根 Agent/注入/回合终态/子代理存活全部可控。 */
class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  availableFlag = true
  turnEnd: TurnEndInfo | null = null
  runningChildren = new Set<string>()
  injectFail: unknown = null
  available(): boolean {
    return this.availableFlag
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    if (this.injectFail) throw this.injectFail
    ;(agent as FakeRoot).messages.push(message)
  }  latestTurnEnd(): TurnEndInfo | null {
    return this.turnEnd
  }
  childRunning(id: string): boolean {
    return this.runningChildren.has(id)
  }
}

/** NodeRunner fake：记录启动入参/中断调用；可注入失败。 */
class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  interrupts: Array<{ childId: string; sessionId: string }> = []
  nextFail: unknown = null
  private seq = 0
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    if (this.nextFail !== null) {
      const error = this.nextFail
      this.nextFail = null
      throw error instanceof Error ? error : new Error(String(error))
    }
    this.seq += 1
    return { childId: `child-${this.seq}`, created: true }
  }
  async interruptChild(childId: string, sessionId: string): Promise<void> {
    this.interrupts.push({ childId, sessionId })
  }
}

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  agents: FakeAgents
  runner: FakeRunner
  clock: { now: number }
  warnings: string[]
}

/** 装配：临时目录真实 FlowStore + fake 依赖 + 可控时钟与 id 生成。 */
async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-orch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const runSeq = { n: 0 }
  const uuidSeq = { n: 0 }
  const warnings: string[] = []
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
      ...config,
    },
    logger: { warn: (message) => warnings.push(message), info: () => {}, debug: () => {} },
    now: () => clock.now,
    newRunId: () => {
      runSeq.n += 1
      return `run-${runSeq.n}`
    },
    uuid: () => {
      uuidSeq.n += 1
      return `uuid-${uuidSeq.n}`
    },
  })
  return { runtime, store, agents, runner, clock, warnings }
}

const caller: CallerInfo = { isChild: false, sessionId: 'session-1' }
const childCaller: CallerInfo = { isChild: true, sessionId: 'session-1' }

/** 保存流程并 startRun；返回结果与内存 run entry。 */
async function start(h: Harness, flow: WorkflowDocument) {
  await h.store.saveWorkflow(flow, 'session-1', { force: true })
  const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id })
  const entry = h.runtime.activeRunForSession('session-1')
  if (!entry) throw new Error('startRun 后应有激活 run')
  return { result, entry }
}

// ---------------------------------------------------------------------------
// snapshot 纯函数
// ---------------------------------------------------------------------------

describe('snapshot 纯函数', () => {
  it('truncateText：超限截断并追加标记，未超限原样', () => {
    expect(truncateText('abc', 5)).toBe('abc')
    expect(truncateText('abcdef', 3)).toBe('abc…（已截断）')
    expect(truncateText(null, 3)).toBe('')
  })

  it('statusText 覆盖全部 6 种 run 状态', () => {
    expect(statusText('running')).toBe('运行中')
    expect(statusText('paused')).toBe('已暂停')
    expect(statusText('completed')).toBe('完成')
    expect(statusText('failed')).toBe('失败')
    expect(statusText('stopped')).toBe('已停止')
    expect(statusText('interrupted')).toBe('已中断')
  })

  it('createRunSnapshot：全节点 pending、attempts 0、endedAt null、mode/flowName 正确', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    expect(snapshot.id).toBe('run-1')
    expect(snapshot.flowName).toBe('测试流程')
    expect(snapshot.mode).toBe('mode1')
    expect(snapshot.status).toBe('running')
    expect(snapshot.endedAt).toBeNull()
    expect(snapshot.nodes).toHaveLength(6)
    for (const node of snapshot.nodes) {
      expect(node.status).toBe('pending')
      expect(node.attempts).toBe(0)
      expect(node.startedAt).toBeNull()
      expect(node.output).toBe('')
      expect(node.outputSummary).toBe('')
    }
  })

  it('setNodeStatus：ok 写完整输出（截断）与摘要（截断）；running/终态补时间戳；未知节点 no-op', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    const big = 'x'.repeat(7000)
    setNodeStatus(snapshot, 'n-a1', 'ok', { output: big, outputFullLimit: 400, now: 2000 })
    const entry = snapshot.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(entry.status).toBe('ok')
    expect(entry.output).toHaveLength(406)
    expect(entry.output.endsWith('…（已截断）')).toBe(true)
    expect(entry.outputSummary).toHaveLength(OUTPUT_SUMMARY_LIMIT + 6)
    expect(entry.endedAt).toBe(new Date(2000).toISOString())

    setNodeStatus(snapshot, 'n-a2', 'running', { attempts: 2, now: 3000 })
    const running = snapshot.nodes.find((n) => n.nodeId === 'n-a2')!
    expect(running.attempts).toBe(2)
    expect(running.startedAt).toBe(new Date(3000).toISOString())
    // 再次 running 不覆盖 startedAt
    setNodeStatus(snapshot, 'n-a2', 'running', { now: 4000 })
    expect(running.startedAt).toBe(new Date(3000).toISOString())

    setNodeStatus(snapshot, 'no-such', 'ok') // 不存在：静默 no-op
    expect(snapshot.nodes.every((n) => n.nodeId !== 'no-such')).toBe(true)
  })

  it('terminalizeNodes：pending→skipped、running→fail、ok 保留', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    setNodeStatus(snapshot, 'n-a1', 'ok', { now: 1000 })
    setNodeStatus(snapshot, 'n-a2', 'running', { now: 1000 })
    terminalizeNodes(snapshot, 5000)
    const byId = new Map(snapshot.nodes.map((n) => [n.nodeId, n]))
    expect(byId.get('n-a1')!.status).toBe('ok')
    expect(byId.get('n-a2')!.status).toBe('fail')
    expect(byId.get('n-start')!.status).toBe('skipped')
  })

  it('lastAssistantText：text 块拼接、非 text 块忽略、空输入空串、截断保护', () => {
    expect(lastAssistantText([{ type: 'text', text: 'A' }, { type: 'tool', text: 'B' }, { type: 'text', text: 'C' }], 0)).toBe('A\nC')
    expect(lastAssistantText([], 10)).toBe('')
    expect(lastAssistantText(null, 10)).toBe('')
    expect(lastAssistantText([{ type: 'text', text: 'abcdef' }], 3)).toBe('abc…（已截断）')
  })
})

// ---------------------------------------------------------------------------
// startRun 启动与运行锁
// ---------------------------------------------------------------------------

describe('startRun 启动与运行锁', () => {
  it('成功：锁建立、快照 running、事实源写入、指令注入、开始即落盘', async () => {
    const h = await makeHarness()
    const { result, entry } = await start(h, makeFlow())

    expect(result.runId).toBe('run-1')
    expect(result.defPath).toContain('orchestrations')
    expect(entry.snapshot.status).toBe('running')
    expect(entry.snapshot.flowName).toBe('测试流程')

    // 运行锁：flowLockInfo 返回本运行
    const lock = h.runtime.flowLockInfo('flow-1')
    expect(lock).toEqual({ flowId: 'flow-1', sessionId: 'session-1', runId: 'run-1', flowName: '测试流程', status: 'running' })

    // 注入消息契约：id + source 齐备（缺 source 父回合 UNKNOWN 失败——旧项目根因）
    const root = h.agents.roots.get('session-1')!
    expect(root.messages).toHaveLength(1)
    const msg = root.messages[0]
    expect(msg.id).toBe('uuid-1')
    expect(msg.role).toBe('user')
    expect(msg.source).toEqual({ kind: 'user' })
    expect(typeof msg.content[0].text).toBe('string')

    // 事实源文件已写（父代理只读）
    const def = await h.store.readOrchestration('run-1')
    expect(def?.id).toBe('flow-1')

    // 开始即落盘（§4.7：崩溃后历史可追溯）
    const persisted = await h.store.getRun('run-1')
    expect(persisted?.status).toBe('running')
  })

  it('编排指令模板满足 W-01/W-02：marker 顺序、硬约束双位、动态值仅在末段', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const text = h.agents.roots.get('session-1')!.messages[0].content[0].text

    // W-01 前缀稳定三段布局：head < mid < tail
    const headAt = text.indexOf(HEAD_MARKER)
    const midAt = text.indexOf(MID_MARKER)
    const tailAt = text.indexOf(TAIL_MARKER)
    expect(headAt).toBeGreaterThanOrEqual(0)
    expect(midAt).toBeGreaterThan(headAt)
    expect(tailAt).toBeGreaterThan(midAt)

    // W-02 关键约束双位：首段硬约束 + 末段重申
    const headSection = text.slice(0, midAt)
    const tailSection = text.slice(tailAt)
    expect(headSection).toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(tailSection).toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(tailSection).toContain(ORCH_HARD_CONSTRAINTS.finishIdempotent)
    expect(tailSection).toContain(TAIL_RESTATE_MARKER)

    // 动态值（暂停节点 id）仅注入末段且只出现一次
    expect(text.indexOf('n-pause')).toBe(text.lastIndexOf('n-pause'))
    expect(text.indexOf('n-pause')).toBeGreaterThan(tailAt)
    // 静态事实（节点清单）位于中段
    expect(text.slice(midAt, tailAt)).toContain('n-a1')
  })

  it('运行锁：同会话重复运行 WF_LOCKED；跨会话 WF_LOCKED 且携带 lockedSessionId', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_LOCKED',
      message: expect.stringContaining('本会话'),
    })
    await expect(h.runtime.startRun({ sessionId: 'session-2', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_LOCKED',
      lockedSessionId: 'session-1',
    })
  })

  it('参数缺失 WF_BAD_ARGS；工作流不存在 WF_NOT_FOUND', async () => {
    const h = await makeHarness()
    await expect(h.runtime.startRun({ sessionId: '', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-none' })).rejects.toMatchObject({ code: 'WF_NOT_FOUND' })
  })

  it('运行前完整性：缺启动/结束节点 WF_FLOW_INCOMPLETE（中文名按模式渲染）', async () => {
    const h = await makeHarness()
    const noStart = makeFlow()
    noStart.nodes = noStart.nodes.filter((n) => n.kind !== 'start')
    await h.store.saveWorkflow(noStart, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_FLOW_INCOMPLETE',
      message: expect.stringContaining('启动'),
    })

    const noEnd = makeFlow()
    noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end')
    await h.store.saveWorkflow(noEnd, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_FLOW_INCOMPLETE',
      message: expect.stringContaining('结束'),
    })
  })

  it('运行前校验：非法流程（自环）WF_FLOW_INVALID', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.lines.push({ id: 'l-loop', source: 'n-a1', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_FLOW_INVALID' })
  })

  it('Agent 能力不可用 / 根 Agent 未激活 / 父代理忙碌 分别报对应错误码', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    h.agents.availableFlag = false
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_AGENT_UNAVAILABLE' })
    h.agents.availableFlag = true

    h.agents.roots.delete('session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_ROOT_INACTIVE' })
    h.agents.roots.set('session-1', new FakeRoot('session-1'))

    h.agents.roots.get('session-1')!.status = 'running'
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_ROOT_BUSY' })
  })

  it('事实源写入失败：清理 run 并报 WF_DEF_WRITE_FAILED', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    h.store.saveOrchestration = async () => {
      throw new Error('磁盘错误')
    }
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_DEF_WRITE_FAILED' })
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
  })

  it('指令注入失败：清理 run 并报 WF_INJECT_FAILED', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    h.agents.injectFail = new Error('注入失败')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_INJECT_FAILED' })
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// wfRunNode：异步路径与护栏
// ---------------------------------------------------------------------------

describe('wfRunNode 异步路径与护栏', () => {
  it('异步启动：立即返回 started、节点 running、inflight 与 childIndex 登记', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    expect(result).toEqual({ nodeId: 'n-a1', status: 'started', childId: 'child-1' })
    const node = entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(node.status).toBe('running')
    expect(node.attempts).toBe(1)
    expect(entry.inflight.has('child-1')).toBe(true)
    expect(h.runtime.childMetaFor('child-1')).toEqual({ sessionId: 'session-1', flowId: 'flow-1', nodeId: 'n-a1' })
  })

  it('任务块注入：NODE 硬约束双位 + persona + 动态态（retryLimit）在末段', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text

    const midAt = text.indexOf(MID_MARKER)
    const tailAt = text.indexOf(TAIL_MARKER)
    expect(text.slice(0, midAt)).toContain(NODE_HARD_CONSTRAINTS.ownPromptOnly)
    expect(text.slice(tailAt)).toContain(NODE_HARD_CONSTRAINTS.ownPromptOnly)
    expect(text).toContain('任务：子任务A')
    expect(text.slice(tailAt)).toContain('Retry limit: 3')
  })

  it('文档 ctx-in：文本内容注入（超限截断）+ 受管文件路径索引', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.nodes.splice(1, 0, fileNode('n-file-text', '文档A', { fileKind: 'text', content: '长'.repeat(300) }))
    flow.nodes.splice(1, 0, fileNode('n-file-managed', '受管B', { fileKind: 'file', managedPath: 'data/files/b.pdf' }))
    flow.lines.push(
      { id: 'l-ctx-1', source: 'n-file-text', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'l-ctx-2', source: 'n-file-managed', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    )
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text
    expect(text).toContain('文档A')
    expect(text).toContain('…（已截断）') // documentTextLimit 200 截断
    expect(text).toContain('data/files/b.pdf')
  })

  it('虚拟节点解析：按主节点 key 共享子代理（§4.2.3.2 规则 7）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-proxy-a2' })
    expect(result).toEqual({ nodeId: 'n-a2', status: 'started', childId: 'child-1' })
    expect(h.runtime.childMetaFor('child-1')!.nodeId).toBe('n-a2')
  })

  it('节点级参数：retryLimit/iterationLimit/thinking 覆盖节点配置并透传', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1', retryLimit: 5, iterationLimit: 7, thinking: 'high' })
    const input = h.runner.calls[0]
    expect(input.iterationLimit).toBe(7)
    expect(input.thinking).toBe('high')
    const tail = input.blocks[0].text.slice(input.blocks[0].text.indexOf(TAIL_MARKER))
    expect(tail).toContain('Retry limit: 5')
    expect(tail).toContain('ReAct iteration limit: 7')
  })

  it('护栏：nodeId 缺失 WF_BAD_ARGS；节点不存在 WF_NODE_MISSING；非 agent 节点 WF_NODE_KIND', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await expect(h.runtime.wfRunNode(caller, {})).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-none' })).rejects.toMatchObject({ code: 'WF_NODE_MISSING' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-start' })).rejects.toMatchObject({ code: 'WF_NODE_KIND' })
  })

  it('护栏：全局调用上限 WF_GLOBAL_LIMIT；单节点重试上限 WF_RETRY_LIMIT', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    entry.callCount = GLOBAL_RUN_CALL_LIMIT
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_GLOBAL_LIMIT' })

    entry.callCount = 0
    entry.attempts.set('n-a1', 4) // retryLimit 3 → 最多 4 次
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_RETRY_LIMIT' })
  })

  it('子代理启动失败：抛原错误且节点标记 fail', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.runner.nextFail = new Error('子代理启动失败')
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toThrow('子代理启动失败')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
  })

  it('归属校验：子代理 WF_NOT_ROOT；无运行 WF_NO_ACTIVE_RUN；已结束 WF_STOPPED', async () => {
    const h = await makeHarness()
    await expect(h.runtime.wfRunNode(childCaller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })

    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({
      code: 'WF_STOPPED',
      message: expect.stringContaining('完成'),
    })
  })

  it('运行控制器已中止：WF_CANCELLED', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    entry.controller.abort()
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})

// ---------------------------------------------------------------------------
// 暂停门
// ---------------------------------------------------------------------------

describe('暂停门（§4.4.2 规则 3 / §4.7 规则 4）', () => {
  it('wfRunNode(暂停节点)：run=paused + 断点持久化 + 锁保留', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    expect(result).toEqual({ nodeId: 'n-pause', status: 'paused' })
    expect(entry.snapshot.status).toBe('paused')
    expect(entry.snapshot.resumeFromNodeId).toBe('n-pause')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-pause')!.status).toBe('ok')

    // 断点已持久化
    const persisted = await h.store.getRun('run-1')
    expect(persisted?.status).toBe('paused')
    expect(persisted?.resumeFromNodeId).toBe('n-pause')

    // 运行锁保留（§4.7 规则 4）
    expect(h.runtime.flowLockInfo('flow-1')?.status).toBe('paused')
    expect(h.runtime.pausedRun('session-1', 'flow-1')?.snapshot.id).toBe('run-1')
  })

  it('暂停后：其他节点调度 WF_PAUSED；同会话再运行 WF_PAUSED（带 runId）；跨会话 WF_LOCKED', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })).rejects.toMatchObject({ code: 'WF_PAUSED' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_PAUSED',
      pausedRunId: 'run-1',
    })
    await expect(h.runtime.startRun({ sessionId: 'session-2', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_LOCKED' })
  })

  it('wait:true 作用于暂停节点：仍立即返回 paused（不阻塞）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-pause', wait: true })
    expect(result.status).toBe('paused')
  })

  it('暂停状态下 wfFinish：幂等返回 paused，锁保留、状态不变', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const finish = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(finish).toMatchObject({ ok: true, status: 'paused', idempotent: true })
    expect(h.runtime.flowLockInfo('flow-1')?.status).toBe('paused')
  })
})

// ---------------------------------------------------------------------------
// wait 阻塞
// ---------------------------------------------------------------------------

describe('wait 阻塞（§4.4.2 规则 1，模式二调度）', () => {
  /** 等 wfRunNode 内部 fs 读取完成、启动调用已发出（waiter 已注册）。 */
  async function waitStarted(h: Harness): Promise<void> {
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    })
  }

  it('wait:true 挂起等待；subagent/end completed 唤醒 → ok + output', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await waitStarted(h)
    expect(settled).toBe(false) // 未完成前不返回

    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '产出摘要' }],
    })
    await expect(pending).resolves.toEqual({ nodeId: 'n-a1', status: 'ok', childId: 'child-1', output: '产出摘要' })
  })

  it('wait:true 节点输出：完整输出按 outputFullLimit 截断、摘要按 6000 字截断并持久化', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const big = 'y'.repeat(1000)
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: big }] })
    await pending

    const persisted = await h.store.getRun('run-1')
    const node = persisted!.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(node.status).toBe('ok')
    expect(node.output).toHaveLength(406) // 400 + 截断标记
    expect(node.outputSummary).toBe(big) // 1000 < 6000 不截断
  })

  it('wait:true 子代理失败：stopReason=error → fail', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'error' })
    await expect(pending).resolves.toEqual({ nodeId: 'n-a1', status: 'fail', childId: 'child-1', output: '' })
  })

  it('wait:true 重复调用：WF_BUSY', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    void h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })).rejects.toMatchObject({ code: 'WF_BUSY' })
  })

  it('wait:true 运行终止：waiter 以 WF_CANCELLED 拒绝', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' }) // 先挂断言，避免未处理拒绝
    await waitStarted(h)
    await h.runtime.stopRun('run-1')
    await assertion
  })

  it('wait:true 调用方取消信号：waiter 以 WF_CANCELLED 拒绝', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const controller = new AbortController()
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})

// ---------------------------------------------------------------------------
// subagent/end 观察回写
// ---------------------------------------------------------------------------

describe('subagent/end 观察回写（§8 #21）', () => {
  it('completed/max-tokens → 节点 ok；其他 stopReason → fail；inflight 清空', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(entry.inflight.has('child-1')).toBe(true)

    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'max-tokens', lastAssistantMessage: [{ type: 'text', text: '结论' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(entry.inflight.has('child-1')).toBe(false)

    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    await h.runtime.handleSubagentEnd({ id: 'child-2', stopReason: 'error' })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a2')!.status).toBe('fail')
  })

  it('未知 childId / 已终止运行：忽略不回写', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.handleSubagentEnd({ id: 'child-unknown', stopReason: 'completed' })
    expect(entry.snapshot.nodes.every((n) => n.status === 'pending')).toBe(true)

    // 启动后收尾：终态化把 running 收敛 fail；随后到达的 end 事件不得覆盖
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.wfFinish(caller, { status: 'completed' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'X' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
  })

  it('暂停状态下 end 仍回写节点 ok（该节点确实完成）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' }) // paused
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A完成' }] })
    expect(entry.snapshot.status).toBe('paused')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(entry.inflight.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// wfFinish 收尾
// ---------------------------------------------------------------------------

describe('wfFinish 收尾', () => {
  it('completed：终态、summary、pending→skipped、持久化、锁释放', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const result = await h.runtime.wfFinish(caller, { status: 'completed', summary: '全部完成' })

    expect(result).toEqual({ ok: true, runId: 'run-1', status: 'completed' })
    expect(entry.snapshot.endedAt).not.toBeNull()
    expect(entry.snapshot.summary).toBe('全部完成')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-start')!.status).toBe('skipped')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('completed')
  })

  it('failed：status=failed 分支', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfFinish(caller, { status: 'failed', summary: '无法继续' })
    expect(result.status).toBe('failed')
  })

  it('幂等：重复收尾/已终止运行静默返回 idempotent', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed' })
    const second = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(second).toMatchObject({ ok: true, status: 'completed', idempotent: true })
  })

  it('归属：子代理 WF_NOT_ROOT；无运行 WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await expect(h.runtime.wfFinish(childCaller, {})).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
    await expect(h.runtime.wfFinish(caller, {})).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})

// ---------------------------------------------------------------------------
// watchdog 看护与 reconcile
// ---------------------------------------------------------------------------

describe('watchdog 看护与陈旧记录对账', () => {
  it('空闲超时：无 inflight 且静默超过 idleTimeoutMs → stopped', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.clock.now += 500 // 达阈值
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('stopped')
  })

  it('inflight 保护：子代理在跑不计空闲；已消失自愈后按空闲终止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    h.agents.runningChildren.add('child-1')
    h.clock.now += 10_000
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('running') // 在跑：不判空闲

    h.agents.runningChildren.delete('child-1') // 会话已消失 → 自愈清 inflight（刷新 lastActiveAt）
    await sweepWatchdogOnce(h.runtime)
    expect(entry.inflight.size).toBe(0)
    expect(entry.snapshot.status).toBe('running') // 自愈当轮刷新活动时间，不立即判空闲

    h.clock.now += 600 // 超过 idleTimeoutMs → 下一轮扫描终止
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
  })

  it('父代理回合 error → failed；aborted → stopped', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.agents.turnEnd = { kind: 'error', error: new Error('编排错误') }
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('failed')
    expect(entry.snapshot.summary).toContain('编排错误')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()

    const h2 = await makeHarness()
    const { entry: entry2 } = await start(h2, makeFlow())
    h2.agents.turnEnd = { kind: 'aborted' }
    await sweepWatchdogOnce(h2.runtime)
    expect(entry2.snapshot.status).toBe('stopped')
  })

  it('scheduleIdleWatchdog：定时触发扫描，disposer 可停止', async () => {
    vi.useFakeTimers()
    try {
      const h = await makeHarness()
      const { entry } = await start(h, makeFlow())
      const dispose = scheduleIdleWatchdog(h.runtime, { intervalMs: WATCHDOG_INTERVAL_MS })
      h.clock.now += 10_000
      await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS)
      expect(entry.snapshot.status).toBe('stopped')
      dispose() // 停止后不再有副作用
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconcileStaleRuns：running/paused → interrupted（running 节点回退 pending、ok 保留）；completed 不动', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const stale = createRunSnapshot({ runId: 'stale-1', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    setNodeStatus(stale, 'n-a1', 'ok', { now: 1000 })
    setNodeStatus(stale, 'n-a2', 'running', { now: 1000 })
    stale.status = 'running'
    await h.store.saveRun(stale)

    const paused = createRunSnapshot({ runId: 'stale-2', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    paused.status = 'paused'
    paused.resumeFromNodeId = 'n-pause'
    await h.store.saveRun(paused)

    const done = createRunSnapshot({ runId: 'stale-3', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    done.status = 'completed'
    await h.store.saveRun(done)

    const changed = await reconcileStaleRuns(h.store, { now: () => 5000 })
    expect(changed).toBe(2)

    const r1 = await h.store.getRun('stale-1')
    expect(r1?.status).toBe('interrupted')
    expect(r1?.nodes.find((n) => n.nodeId === 'n-a2')!.status).toBe('pending')
    expect(r1?.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(r1?.endedAt).toBe(new Date(5000).toISOString())

    const r2 = await h.store.getRun('stale-2')
    expect(r2?.status).toBe('interrupted')
    expect(r2?.resumeFromNodeId).toBe('n-pause')

    expect((await h.store.getRun('stale-3'))?.status).toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// terminate / stop / dispose
// ---------------------------------------------------------------------------

describe('terminate / stop / dispose', () => {
  it('stopRun：中断 in-flight、pending→skipped、running→fail、持久化、锁释放', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.stopRun('run-1')

    expect(entry.snapshot.status).toBe('stopped')
    expect(entry.snapshot.summary).toBe('运行已停止')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-start')!.status).toBe('skipped')
    expect(h.runner.interrupts).toEqual([{ childId: 'child-1', sessionId: 'session-1' }])
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('stopped')
  })

  it('terminateRun 幂等：终止后再次终止返回 false', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    expect(await h.runtime.terminateRun(entry, { status: 'stopped', summary: 'x' })).toBe(true)
    expect(await h.runtime.terminateRun(entry, { status: 'stopped', summary: 'y' })).toBe(false)
  })

  it('stopRun 未知 runId：静默 no-op', async () => {
    const h = await makeHarness()
    await expect(h.runtime.stopRun('run-none')).resolves.toBeUndefined()
  })

  it('dispose：中止全部运行、阻塞等待拒绝、内存表清空', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' }) // 先挂断言，避免未处理拒绝
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    })
    h.runtime.dispose()
    await assertion
    expect(h.runtime.runs.size).toBe(0)
    expect(h.runtime.childMetaFor('child-1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// currentResolvedFlow 双向同步
// ---------------------------------------------------------------------------

describe('currentResolvedFlow 双向同步（§4.7 规则 1 ①）', () => {
  it('运行中画布修改即时生效：新增节点可被调度', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    // 运行中保存新版流程：新增节点 n-a3
    const updated = makeFlow()
    updated.nodes.splice(3, 0, agent('n-a3', '新增任务'))
    updated.lines.push({ id: 'l5', source: 'n-pause', target: 'n-a3', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    await h.store.saveWorkflow(updated, 'session-1', { force: true })

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a3' })
    expect(result.status).toBe('started')
  })

  it('读取失败回退起始快照（baseFlow）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    h.store.getWorkflow = async () => {
      throw new Error('读取失败')
    }
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(result.status).toBe('started') // baseFlow 中 n-a2 存在
  })

  it('runSnapshot 返回深拷贝：修改副本不影响内部状态', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const copy = h.runtime.runSnapshot('run-1')!
    copy.status = 'failed'
    copy.nodes[0].status = 'ok'
    expect(h.runtime.runSnapshot('run-1')!.status).toBe('running')
    expect(h.runtime.runSnapshot('run-1')!.nodes[0].status).toBe('pending')
    expect(h.runtime.runSnapshot('run-none')).toBeNull()
  })
})

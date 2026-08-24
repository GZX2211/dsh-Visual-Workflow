// tests/integration/workflow-e2e.test.ts
//
// 集成测试（T-063）：真实模块装配的长链路（真实 FlowStore / OrchestratorRuntime /
// GUI API / SessionMap / ServiceManager / 提示词模板；官方 seam 处用短路替身）。
// 与单元测试的差异：这里验证「跨模块协作」而非模块内行为——
//   1. API → run → 编排指令注入（硬约束双位）→ wf_run_node → subagent/end 回写
//      → wf_finish → 磁盘历史；运行中改图保存后重读新快照（双向同步）。
//   2. 暂停门 → paused 断点持久化 → resumeRun：已 ok 节点继承不重跑、续跑继承链。
//   3. wf_ask_agent 越权拒绝（非成员 ask → WF_ASK_FORBIDDEN；陌生目标 → 未知）
//      与正常 ask→deliver(steer)→reply 解锁闭环；工具注册签名合规（英文 description）。
//   4. 服务全链路：SessionMap 持久化隔离 / fork 组合参数 / serve patch 渲染。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'
import type { StageNode, RoleNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import { stageLabel } from '../../src/host/graph/model.js'
import { VisualWorkflowApi, type ApiHost } from '../../src/host/remote/api.js'
import { SessionMap } from '../../src/host/service/sessions-map.js'
import { ServiceManager, type ManagedChild } from '../../src/host/service/manager.js'
import { renderServePatch } from '../../src/host/service/serve-patch.js'
import { registerWfAskAgent } from '../../src/host/tools/wf-ask-agent.js'
import { WF_ASK_AGENT } from '../../src/host/shared/protocol.js'
import { ORCH_HARD_CONSTRAINTS } from '../../src/host/prompts/orchestration.js'
import { HEAD_MARKER } from '../../src/host/prompts/markers.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

// ---------------------------------------------------------------------------
// 替身（只替换官方 seam：根 Agent 宿主 / 节点执行器）
// ---------------------------------------------------------------------------

class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  availableFlag = true
  turnEnd: TurnEndInfo | null = null
  available(): boolean {
    return this.availableFlag
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    ;(agent as FakeRoot).messages.push(message)
  }
  latestTurnEnd(): TurnEndInfo | null {
    return this.turnEnd
  }
  childRunning(): boolean {
    return false
  }
}

class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  private seq = 0
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    this.seq += 1
    return { childId: `child-${this.seq}`, created: true }
  }
  async interruptChild(): Promise<void> {}
  consumeReactCapped(): boolean {
    return false
  }
}

function stage(id: string, kind: 'start' | 'end' | 'pause', mode: 'mode1' | 'mode2' = 'mode1'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, mode) } }
}

function agent(id: string, label: string, kind: 'agent' | 'parent' = 'agent'): RoleNode {
  return {
    id,
    kind,
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
    },
  }
}

function makeFlow(pause = false): WorkflowDocument {
  const nodes = [stage('n-start', 'start'), agent('n-a1', '子任务A')]
  const lines = [{ id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
  if (pause) {
    nodes.push(stage('n-pause', 'pause'), agent('n-a2', '子任务B'), stage('n-end', 'end'))
    lines.push(
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    )
  } else {
    nodes.push(stage('n-end', 'end'))
    lines.push({ id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
  }
  return { id: 'flow-1', sessionId: 'session-1', mode: 'mode1', name: 'E2E 流程', description: '', revision: 1, nodes, lines }
}

interface Harness {
  store: FlowStore
  runtime: OrchestratorRuntime
  agents: FakeAgents
  runner: FakeRunner
  api: VisualWorkflowApi
  dataDir: string
  root: FakeRoot
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-e2e-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  const root = new FakeRoot('session-1')
  agents.roots.set('session-1', root)
  const runner = new FakeRunner()
  let seq = 0
  const runtime = new OrchestratorRuntime({
    store,
    runner,
    agents,
    config: {
      outputFullLimit: 400,
      documentTextLimit: 200,
      runIdleTimeoutMs: 60_000,
      retryLimitDefault: 3,
      reactIterationLimitDefault: 50,
      wfAskAgentTimeoutMs: 60_000,
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    newRunId: () => `run-${++seq}`,
    uuid: () => `uuid-${++seq}`,
  })
  const api = new VisualWorkflowApi({ get: () => null }, {
    orchestrator: runtime,
    store,
    dataDir: dir,
    engine: { source: 'bm25', dimension: 0, async embed() { throw new Error('bm25 only') }, dispose() {} },
  } as ApiHost)
  return { store, runtime, agents, runner, api, dataDir: dir, root }
}

async function saveFlow(h: Harness, flow: WorkflowDocument): Promise<void> {
  await h.store.saveWorkflow(flow, flow.sessionId, { force: true })
}

/** 父代理调用 wf_run_node 并模拟子代理完成（subagent/end 回写）。 */
async function runNodeAndFinish(h: Harness, nodeId: string): Promise<{ childId: string }> {
  const result = (await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId })) as { childId?: string }
  const childId = result.childId ?? ''
  await h.runtime.handleSubagentEnd({
    id: childId,
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: `${nodeId} 的产出` }],
  })
  return { childId }
}

describe('e2e：编排运行全链路与双向同步', () => {
  it('API run → 编排指令注入（硬约束双位）→ 节点回写 → finish → 磁盘历史；运行中改图即时生效', async () => {
    const h = await makeHarness()
    await saveFlow(h, makeFlow())
    const flow = (await h.api.handle('getWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as WorkflowDocument

    // 1. 启动（API 层）→ 编排指令注入根 Agent（消息 id/source 齐备）
    const started = (await h.api.handle('run', { sessionId: 'session-1', flowId: flow.id })) as { runId: string; defPath: string }
    expect(started.runId).toBeTruthy()
    const directive = h.root.messages[0]?.content
    const directiveText = (directive as Array<{ text?: string }>)?.map((m) => m.text ?? '').join('') ?? ''
    expect(directiveText.startsWith(HEAD_MARKER)).toBe(true)
    // W-02 注意力双位：dispatchOnly 短语在首段与末段重申各出现一次
    expect(directiveText.split(ORCH_HARD_CONSTRAINTS.dispatchOnly).length - 1).toBeGreaterThanOrEqual(2)
    expect(h.root.messages[0]?.source).toEqual({ kind: 'user' })

    // 2. wf_run_node → 子代理启动（任务块含节点身份与上游 ctx）
    const result = await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a1' })
    expect(result.status).toBe('started')
    expect(h.runner.calls[0]?.node.id).toBe('n-a1')

    // 3. subagent/end → 快照回写 ok + 产出
    await h.runtime.handleSubagentEnd({
      id: result.childId,
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '完成报告' }],
    })
    const snapshot = h.runtime.runSnapshot(started.runId) as RunSnapshot
    const a1 = snapshot.nodes.find((n) => n.nodeId === 'n-a1')
    expect(a1?.status).toBe('ok')
    expect(a1?.output).toContain('完成报告')

    // 4. wf_finish → completed + 磁盘历史可查（终态后内存条目释放，断言磁盘）
    await h.runtime.wfFinish({ isChild: false, sessionId: 'session-1' }, { summary: '全部完成' })
    const finished = (await h.store.getRun(started.runId)) as RunSnapshot
    expect(finished.status).toBe('completed')
    const history = await h.store.listRuns('flow-1')
    expect(history.some((run) => run.id === started.runId && run.status === 'completed')).toBe(true)

    // 5. 双向同步：运行中改图（追加 n-a2 与连线，revision+1）→ 新 run 调度即读新快照
    const updated: WorkflowDocument = {
      ...flow,
      revision: 2,
      nodes: [...flow.nodes, agent('n-a2', '子任务C')],
      lines: [...flow.lines, { id: 'l3', source: 'n-a1', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
    }
    await h.store.saveWorkflow(updated, 'session-1', { force: true })
    const started2 = (await h.api.handle('run', { sessionId: 'session-1', flowId: flow.id })) as { runId: string }
    const second = await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a2' })
    expect(second.status).toBe('started')
    expect(h.runner.calls[1]?.node.id).toBe('n-a2')
    expect(h.runtime.runSnapshot(started2.runId)?.status).toBe('running')
  })
})

describe('e2e：暂停门与断点续跑', () => {
  it('paused 断点持久化 → resumeRun 继承链：已 ok 不重跑，续跑从断点右出', async () => {
    const h = await makeHarness()
    const flow = makeFlow(true)
    await saveFlow(h, flow)

    const started = (await h.api.handle('run', { sessionId: 'session-1', flowId: flow.id })) as { runId: string }
    // 执行 a1 后触碰暂停门
    await runNodeAndFinish(h, 'n-a1')
    const paused = (await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-pause' })) as { status: string }
    expect(paused.status).toBe('paused')
    const pausedSnapshot = h.runtime.runSnapshot(started.runId) as RunSnapshot
    expect(pausedSnapshot.status).toBe('paused')
    expect(pausedSnapshot.resumeFromNodeId).toBe('n-pause')

    // 磁盘持久化断言（断点数据落盘）
    const disk = (await h.store.getRun(started.runId)) as RunSnapshot
    expect(disk.status).toBe('paused')

    // 断点恢复：新 run 继承链
    const resumed = (await h.api.handle('runResume', { sessionId: 'session-1', flowId: flow.id, runId: started.runId })) as { runId: string; resumedFromRunId?: string }
    expect(resumed.runId).toBeTruthy()
    const snap2 = h.runtime.runSnapshot(resumed.runId) as RunSnapshot
    expect(snap2.resumedFromRunId).toBe(started.runId)
    const a1 = snap2.nodes.find((n) => n.nodeId === 'n-a1')
    expect(a1?.status).toBe('ok')
    expect(a1?.resumed).toBe(true)
    const a2 = snap2.nodes.find((n) => n.nodeId === 'n-a2')
    expect(a2?.status).toBe('pending')

    // 续跑：a2 执行；已 ok 的 a1 不再启动（runner 调用仅 a1 一次）
    expect(h.runner.calls.filter((call) => call.node.id === 'n-a1')).toHaveLength(1)
    await runNodeAndFinish(h, 'n-a2')
    await h.runtime.wfFinish({ isChild: false, sessionId: 'session-1' }, { summary: '续跑完成' })
    const resumedDisk = (await h.store.getRun(resumed.runId)) as RunSnapshot
    expect(resumedDisk.status).toBe('completed')
    expect(h.runner.calls.filter((call) => call.node.id === 'n-a1')).toHaveLength(1)
  })
})

describe('e2e：wf_ask_agent 越权拒绝与通信闭环', () => {
  it('ask→steer 投递→reply 解锁；非运营子代理 ask 被拒；陌生目标未知', async () => {
    const h = await makeHarness()
    const flow: WorkflowDocument = {
      ...makeFlow(),
      revision: 1,
      nodes: [stage('n-start', 'start'), agent('n-a1', 'A'), agent('n-a2', 'B'), stage('n-end', 'end')],
    }
    await saveFlow(h, flow)
    await h.api.handle('run', { sessionId: 'session-1', flowId: flow.id })

    // 注册两个节点子代理（childIndex 登记）
    const r1 = (await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a1' })) as { childId: string }
    const r2 = (await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a2' })) as { childId: string }

    // 正常 ask：deliver 被调用（steer 投递），reply 解锁
    const delivered: Array<{ to: string; text: string }> = []
    const delivery = {
      deliver: vi.fn(async (input: { to: string; message: { content?: Array<{ text?: string }> } }) => {
        delivered.push({
          to: input.to,
          text: (input.message.content ?? []).map((c) => c.text ?? '').join(''),
        })
      }),
    }
    const askPromise = h.runtime.wfAskAgent(
      { isChild: true, sessionId: 'session-1' },
      r1.childId,
      { cmd: 'ask', targetChildId: r2.childId, message: '请提供数据' },
      delivery as never,
    )
    await Promise.resolve() // 投递路径 microtask
    expect(delivered[0]?.to).toBe(r2.childId)
    const askId = /askId:\s*([0-9A-Za-z-]+)/.exec(delivered[0]?.text ?? '')?.[1] ?? ''
    expect(askId).toBeTruthy()
    const askResult = await h.runtime.wfAskAgent(
      { isChild: true, sessionId: 'session-1' },
      r2.childId,
      { cmd: 'reply', askId, targetChildId: r1.childId, message: '数据在此' },
      delivery as never,
    )
    expect(askResult.cmd).toBe('reply')
    const settled = await askPromise
    expect(settled).toMatchObject({ cmd: 'ask', reply: '数据在此' })

    // 越权拒绝：非本运行子代理 ask（childIndex 未登记）→ 禁止
    await expect(h.runtime.wfAskAgent(
      { isChild: true, sessionId: 'session-1' },
      'stranger-child',
      { cmd: 'ask', targetChildId: r2.childId, message: 'hi' },
      delivery as never,
    )).rejects.toMatchObject({ code: 'WF_ASK_FORBIDDEN' })

    // 陌生目标：目标非本运行节点子代理 → 目标未知
    await expect(h.runtime.wfAskAgent(
      { isChild: true, sessionId: 'session-1' },
      r1.childId,
      { cmd: 'ask', targetChildId: 'ghost-child', message: 'hi' },
      delivery as never,
    )).rejects.toMatchObject({ code: 'WF_ASK_TARGET_UNKNOWN' })
  })

  it('工具注册真身：wf_ask_agent 定义签名合规（description 英文标准写法、name 常量）', () => {
    const registered: Array<{ name?: string; description?: string; parameters?: unknown }> = []
    const ctx = { get: (name: string) => (name === 'tools' ? {
      register(def: { name?: string; description?: string; parameters?: unknown }) {
        registered.push(def)
        return () => {}
      },
    } : null) }
    const dispose = registerWfAskAgent(ctx as never, { orchestrator: null as never, followupChild: null as never } as never)
    expect(registered[0]?.name).toBe(WF_ASK_AGENT)
    const desc = String(registered[0]?.description ?? '')
    expect(desc).toMatch(/^Exchange blocking messages/) // 英文标准写法：何时调用开头
    expect(desc.length).toBeLessThan(700)
    dispose()
  })
})

describe('e2e：服务侧组合（fork 参数 / serve patch / 会话映射持久化）', () => {
  it('SessionMap：同 userId 稳定映射、不同 userId 隔离、重启后磁盘恢复', async () => {
    const h = await makeHarness()
    let seq = 0
    const map = new SessionMap({ store: h.store, serviceId: 'svc-1', newSessionId: () => `s-${++seq}` })
    const s1 = await map.resolve('user-A')
    const s2 = await map.resolve('user-B')
    const s1again = await map.resolve('user-A')
    expect(s1).not.toBe(s2)
    expect(s1again).toBe(s1)
    // 重启恢复：新实例从磁盘读出既有映射
    const map2 = new SessionMap({ store: h.store, serviceId: 'svc-1', newSessionId: () => 'never' })
    expect(await map2.resolve('user-A')).toBe(s1)
  })

  it('ServiceManager fork 组合 + serve patch 渲染（headless 组合覆盖、cmdline 透传）', async () => {
    const h = await makeHarness()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      mode: 'mode2',
      name: '示例服务',
      description: '',
      revision: 0,
      nodes: [agent('n-parent', '父', 'parent'), stage('n-start', 'start', 'mode2'), stage('n-end', 'end', 'mode2')],
      lines: [],
    } as never
    await h.store.saveService(service, 'session-1', { force: true })
    const spawns: Array<{ command: string; args: string[]; options: { cwd: string; shell: boolean } }> = []
    const manager = new ServiceManager({
      store: h.store,
      dataDir: h.dataDir,
      dshCommand: 'C:\\dsh\\dsh.cmd',
      spawn: ((command: string, args: string[], options: { cwd: string; shell: boolean }) => {
        spawns.push({ command, args, options })
        return {
          on: () => {},
          once: () => {},
          kill: () => {},
          pid: 42,
          unref: () => {},
        } as never
      }) as never,
      config: { servicePortBase: 7860, apiKey: null, maxConcurrentPerService: 50 },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    } as never)
    const started = (await manager.start('svc-1')) as { status: string; port: number }
    expect(started.status).toBe('running')
    expect(spawns[0].args).toContain('--visual-workflow-serve')
    expect(spawns[0].args).toContain('svc-1')
    expect(spawns[0].args).toContain('--port')
    expect(spawns[0].args).toContain('7860')
    expect(spawns[0].args).toContain('--patch')

    // serve patch 渲染：headless 覆盖 + webserver/服务插件行 + apiKey 为 null
    const patch = renderServePatch({
      serviceId: 'svc-1',
      dataDir: h.dataDir,
      port: 7860,
      apiKey: null,
      maxConcurrent: 50,
      pluginEntryUrl: 'file:///plugin/service-runner.js',
    })
    expect(patch).toContain('headless-runner')
    expect(patch).toContain('disabled: true')
    expect(patch).toContain('apiKey: null')
    expect(patch).toContain('visual-workflow-service')
  })
})

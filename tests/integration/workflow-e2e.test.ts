// tests/integration/workflow-e2e.test.ts
//
// 集成测试（T-063）：真实模块装配的长链路（真实 FlowStore / OrchestratorRuntime /
// GUI API / SessionMap / ServiceManager / 提示词模板；官方 seam 处用短路替身）。
// 与单元测试的差异：这里验证「跨模块协作」而非模块内行为——
//   1. API → run → 编排指令注入（硬约束双位）→ wf_run_node → subagent/end 回写
//      → wf_finish → 磁盘历史；运行中改图保存后重读新快照（双向同步）。
//   2. 暂停门 → paused 断点持久化 → resumeRun：已 ok 节点继承不重跑、续跑继承链。
//   3. wf_send_message 越权拒绝（调用方非本运行节点子代理 → 身份不合法；陌生目标 → 未知）
//      与正常 ask→deliver(steer)→reply 解锁闭环；工具注册签名合规（英文 description）。
//   4. 服务全链路：SessionMap 持久化隔离 / fork 组合参数 / serve patch 渲染。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, zh } from '../../src/client/i18n.js'
import { serializeFlow } from '../../src/client/lib/graph-serialize.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { resolveConfig } from '../../src/host/config.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/index.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'
import type { StageNode, RoleNode, WorkflowDocument, Line } from '../../src/host/shared/graph-model.js'
import { stageLabel } from '../../src/host/graph/index.js'
import { VisualWorkflowApi, type ApiHost } from '../../src/host/api/index.js'
import { SessionMap, ServiceManager, renderServePatch } from '../../src/host/service/index.js'
import { registerWfSendMessage } from '../../src/host/tools/wf-send-message/tool.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT, WF_SEND_MESSAGE } from '../../src/host/shared/protocol.js'

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
    },
  }
}

function makeFlow(pause = false): WorkflowDocument {
  const nodes = [stage('n-start', 'start'), agent('n-a1', '子任务A')]
  const lines: Line[] = [{ id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
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

async function makeHarness(systemLanguage: () => string = () => '中文'): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-e2e-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  const root = new FakeRoot('session-1')
  agents.roots.set('session-1', root)
  const runner = new FakeRunner()
  let seq = 0
  // 默认值取自 schema（不复制清单）；仅三处显式收窄以构造场景：
  //   - outputFullLimit/documentTextLimit：缩到 400/200 字节，使截断分支在短文本下即可触发；
  //   - runIdleTimeoutMs：60s（远小于 schema 默认 30 分钟），避免用例等待真实空闲窗口。
  const runDefaults = resolveConfig({ dataDir: dir })
  const runtime = new OrchestratorRuntime({
    store,
    systemLanguage,
    runner,
    agents,
    config: {
      outputFullLimit: 400,
      documentTextLimit: 200,
      runIdleTimeoutMs: 60_000,
      retryLimitDefault: runDefaults.retryLimitDefault,
      reactIterationLimitDefault: runDefaults.reactIterationLimitDefault,
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    newRunId: () => `run-${++seq}`,
    uuid: () => `uuid-${++seq}`,
  })
  const api = new VisualWorkflowApi({ get: () => null }, {
    orchestrator: runtime,
    store,
    dataDir: dir,
    engine: { source: 'bm25', dimension: 0, async ensureReady() {}, async embed() { throw new Error('bm25 only') }, dispose() {} },
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
  it.each([['en', en], ['zh', zh]] as const)('保存后的 %s 画布工作流可启动，且不出现阶段标签校验错误', async (_language, copy) => {
    const h = await makeHarness()
    const flow = makeFlow()
    const canvasNodes = flow.nodes.map((node) => node.kind === 'start' || node.kind === 'end'
      ? { ...node, data: { ...node.data, label: copy.nodeKinds[node.kind] } }
      : { ...node, data: { ...node.data } })
    const saved = serializeFlow(flow, canvasNodes, flow.lines)
    await saveFlow(h, saved)

    const started = await h.api.handle('run', { sessionId: flow.sessionId, flowId: flow.id }) as { runId: string }
    const result = await h.runtime.wfRunNode({ isChild: false, sessionId: flow.sessionId }, { nodeId: 'n-a1' })

    expect(result.status).toBe('started')
    expect(h.runner.calls[0]?.node.id).toBe('n-a1')
    await h.runtime.handleSubagentEnd({ id: result.childId, stopReason: 'completed', lastAssistantMessage: [] })
    await h.runtime.wfFinish({ isChild: false, sessionId: flow.sessionId }, { status: 'completed', summary: 'Done' })
    expect((await h.store.getRun(started.runId))?.status).toBe('completed')
  })

  it('API run → 编排指令注入（硬约束双位）→ 节点回写 → finish → 磁盘历史；运行中改图即时生效', async () => {
    const h = await makeHarness()
    await saveFlow(h, makeFlow())
    const flow = (await h.api.handle('getWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as WorkflowDocument

    // 1. 启动（API 层）→ 编排指令注入根 Agent（消息 id/source 齐备）
    const started = (await h.api.handle('run', { sessionId: 'session-1', flowId: flow.id })) as { runId: string; sessionId: string }
    expect(started.runId).toBeTruthy()
    const directive = h.root.messages[0]?.content
    const directiveText = (directive as Array<{ text?: string }>)?.map((m) => m.text ?? '').join('') ?? ''
    // 安全门禁：编排指令不含宿主路径（拓扑只经 wf_org_catalog 的 instance 通道召回）
    expect(directiveText).not.toContain('orchestrations')
    expect(directiveText).not.toMatch(/[A-Za-z]:[\\/]/)
    // 注入内容携带工作流名（数据，非提示词文案）；消息来源为 user（官方 Message 契约）
    expect(directiveText).toContain(flow.name)
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

describe('e2e：wf_send_message 越权拒绝与通信闭环', () => {
  it('子代理→子代理、子代理→父代理、父代理→子代理三向投递；非本运行子代理与陌生目标被拒', async () => {
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

    const textOf = (input: { message?: { content?: Array<{ text?: string }> } }): string =>
      (input.message?.content ?? []).map((c) => c.text ?? '').join('')
    const toChild: Array<{ childId: string; text: string }> = []
    const toParent: Array<{ text: string }> = []
    const delivery = {
      deliverToChild: vi.fn(async (input: { childId: string; message: { content?: Array<{ text?: string }> } }) => {
        toChild.push({ childId: input.childId, text: textOf(input) })
        return 'delivered' as const
      }),
      deliverToParent: vi.fn(async (input: { message: { content?: Array<{ text?: string }> } }) => {
        toParent.push({ text: textOf(input) })
        return 'delivered' as const
      }),
      deliverToTeammate: vi.fn(async () => {}),
    }

    // 子代理 → 子代理（nodeId 寻址，resolved 解析为对方 childId）
    const toPeer = await h.runtime.wfSendMessage(
      { isChild: true, sessionId: 'session-1' },
      r1.childId,
      { target: 'n-a2', message: '请提供数据' },
      delivery as never,
    )
    expect(toPeer).toEqual({ target: 'n-a2', resolved: r2.childId, status: 'delivered' })
    expect(toChild[0]?.childId).toBe(r2.childId)
    expect(toChild[0]?.text).toContain('请提供数据')

    // 子代理 → 父代理（固定别名）
    const toRoot = await h.runtime.wfSendMessage(
      { isChild: true, sessionId: 'session-1' },
      r1.childId,
      { target: 'parent', message: '需要你的决定' },
      delivery as never,
    )
    expect(toRoot).toEqual({ target: 'parent', resolved: 'parent', status: 'delivered' })
    expect(toParent[0]?.text).toContain('需要你的决定')

    // 父代理 → 子代理
    const fromRoot = await h.runtime.wfSendMessage(
      { isChild: false, sessionId: 'session-1' },
      'session-1',
      { target: 'n-a1', message: '补充指令' },
      delivery as never,
    )
    expect(fromRoot).toEqual({ target: 'n-a1', resolved: r1.childId, status: 'delivered' })

    // 越权拒绝：非本运行子代理（childIndex 未登记）→ 身份不合法
    await expect(h.runtime.wfSendMessage(
      { isChild: true, sessionId: 'session-1' },
      'stranger-child',
      { target: 'n-a2', message: 'hi' },
      delivery as never,
    )).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })

    // 陌生目标：目标非本运行节点子代理 → 目标未知
    await expect(h.runtime.wfSendMessage(
      { isChild: true, sessionId: 'session-1' },
      r1.childId,
      { target: 'ghost-child', message: 'hi' },
      delivery as never,
    )).rejects.toMatchObject({ code: 'WF_SEND_TARGET_UNKNOWN' })
  })

  it('工具注册真身：wf_send_message 定义签名合规（description 英文标准写法、name 常量）', () => {
    const registered: Array<{ name?: string; description?: string; parameters?: unknown }> = []
    const ctx = { get: (name: string) => (name === 'tools' ? {
      register(def: { name?: string; description?: string; parameters?: unknown }) {
        registered.push(def)
        return () => {}
      },
    } : null) }
    const dispose = registerWfSendMessage(ctx as never, {
      orchestrator: null as never,
      getChildAgent: null as never,
      followupRoot: null as never,
      followupChild: null as never,
      sendToTeammate: null as never,
    } as never)
    expect(registered[0]?.name).toBe(WF_SEND_MESSAGE)
    const desc = String(registered[0]?.description ?? '')
    expect(desc).toMatch(/^Send one durable message/) // 英文标准写法：何时调用开头
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
    // fork 参数形态：serviceId/port 经 patch config 传入；fork 只传占位 task
    // 位置参数（headless 应用 commander 不识别 app 级 flag，见 manager.ts 注释）
    expect(spawns[0].args).toContain('--profile')
    expect(spawns[0].args).toContain('headless')
    expect(spawns[0].args).toContain('--patch')
    expect(spawns[0].args).toContain('__visual_workflow_service__')

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

describe('UI locale 贯穿真实运行装配', () => {
  it.each([['en', 'English', '# Hard constraints'], ['zh', '中文', '# 硬性约束']])('%s 由父代理、子代理、断点与续跑共享', async (language, resolved, heading) => {
    // 故意让 Host 设置与 UI 相反：本次运行以 Client 的自动 locale 为准。
    const h = await makeHarness(() => language === 'en' ? '中文' : 'English')
    const flow = makeFlow(true)
    flow.name = 'Instagram Post Helper'
    flow.description = 'Prepare an Instagram post'
    for (const node of flow.nodes) {
      if (node.kind !== 'agent') continue
      node.data.label = node.id
      node.data.outputSchema = DEFAULT_OUTPUT_CONTRACT_TEXT
    }
    await saveFlow(h, flow)
    const start = await h.api.handle('run', { sessionId: flow.sessionId, flowId: flow.id, language }) as { runId: string }
    const parent = h.root.messages[0]!.content.map(item => item.text).join('')
    expect(parent).toContain(heading)
    if (language === 'en') expect(parent).not.toMatch(/[\u3400-\u9fff]/)
    expect(h.runtime.runSnapshot(start.runId)?.systemLanguage).toBe(resolved)
    const child = await h.runtime.wfRunNode({ isChild: false, sessionId: flow.sessionId }, { nodeId: 'n-a1' })
    const text = h.runner.calls[0]!.blocks.map(block => block.text).join('')
    expect(text).toContain(heading)
    if (language === 'en') {
      expect(text).toContain('Conclusion / Output file paths / Key decisions / Open questions')
      expect(text).not.toMatch(/[\u3400-\u9fff]/)
    }
    await h.runtime.handleSubagentEnd({ id: child.childId, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'Research complete' }] })
    await h.runtime.wfRunNode({ isChild: false, sessionId: flow.sessionId }, { nodeId: 'n-pause' })
    expect((await h.store.getRun(start.runId))?.systemLanguage).toBe(resolved)
    // 无 GUI 的续跑继承已持久化的运行语言，即使 Host 设置与它相反。
    const resumed = await h.runtime.resumeRun({ sessionId: flow.sessionId, flowId: flow.id, fromRunId: start.runId })
    expect(h.runtime.runSnapshot(resumed.runId)?.systemLanguage).toBe(resolved)
    expect(h.root.messages.at(-1)!.content[0]!.text).toContain(heading)
    await h.runtime.stopRun(resumed.runId)
    // 显式切换 UI 语言只作用于本次新续跑的运行。
    const switched = await h.api.handle('runResume', { sessionId: flow.sessionId, flowId: flow.id, runId: resumed.runId, language: language === 'en' ? 'zh' : 'en' }) as { runId: string }
    expect(h.runtime.runSnapshot(switched.runId)?.systemLanguage).toBe(resolved === 'English' ? '中文' : 'English')
    await h.runtime.stopRun(switched.runId)
  })
})

// tests/host/service-run.test.ts
//
// 模式二服务运行路径（runtime + FlowStore 服务文档）：
//   - startRun mode2：按 serviceId 经 getServiceAsFlow 加载（非工作流表）；
//   - 用户问题注入输入节点（快照 ok + 产出）；编排指令 dynamic 段含问题；
//   - 输入节点右出 ctx 连线：下游节点任务块显式注入问题（buildNodeBlocks start 源）；
//   - mode1 不受 question 影响；resumeRun mode2（服务断点续跑）。

import { afterEach, describe, expect, it } from 'vitest'
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
import type { ServiceState } from '../../src/host/shared/types.js'
import type { RoleNode, StageNode, WorkflowDocument, Line } from '../../src/host/shared/graph-model.js'
import { stageLabel } from '../../src/host/graph/model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function stage(id: string, kind: 'start' | 'end'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode2') } }
}

function parentNode(id: string): RoleNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: {
      label: '父代理',
      systemPrompt: '你是最终回答者',
      provider: 'deepseek',
      model: 'deepseek-chat',
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

function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: 'deepseek',
      model: 'deepseek-chat',
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

/** 标准模式二服务流：输入 → 父代理 → 子任务 → 输出（含输入右出 ctx 连线）。 */
function serviceFlow(serviceId: string): WorkflowDocument {
  const lines: Line[] = [
    { id: 'l1', source: 'n-in', target: 'n-parent', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l2', source: 'n-parent', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l3', source: 'n-a1', target: 'n-out', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    // 输入节点 ctx-out → 子任务 ctx-in（显式传递用户问题）
    { id: 'c1', source: 'n-in', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
  ]
  return {
    id: serviceId,
    sessionId: 'session-owner',
    mode: 'mode2',
    name: '问答服务',
    description: '回答用户问题',
    revision: 1,
    nodes: [stage('n-in', 'start'), parentNode('n-parent'), agent('n-a1', '子任务'), stage('n-out', 'end')],
    lines,
  }
}

function toService(flow: WorkflowDocument): ServiceState {
  return {
    id: flow.id,
    sessionId: flow.sessionId,
    name: flow.name,
    description: flow.description,
    revision: flow.revision ?? 1,
    nodes: flow.nodes,
    lines: flow.lines,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    status: 'stopped',
  }
}

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
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    ;(agent as FakeRoot).messages.push(message)
  }
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

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  agents: FakeAgents
  runner: FakeRunner
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-svcr-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  agents.roots.set('session-user-1', new FakeRoot('session-user-1'))
  const runner = new FakeRunner()
  const config: OrchestratorConfig = {
    outputFullLimit: 102400,
    documentTextLimit: 20000,
    runIdleTimeoutMs: 60000,
    retryLimitDefault: 3,
    reactIterationLimitDefault: 50,
    wfAskAgentTimeoutMs: 1000,
  }
  const runtime = new OrchestratorRuntime({
    store,
    runner,
    agents,
    config,
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    now: () => 1_000_000,
    newRunId: () => 'run-svc-1',
    uuid: () => 'msg-1',
  })
  return { runtime, store, agents, runner }
}

const caller: CallerInfo = { isChild: false, sessionId: 'session-user-1' }

/** 提取注入父代理的编排指令文本。 */
function lastDirective(h: Harness): string {
  const root = h.agents.roots.get('session-user-1')!
  const message = root.messages[root.messages.length - 1]
  const text = message.content?.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
  return text
}

describe('startRun mode2（服务文档加载）', () => {
  it('按 serviceId 经 getServiceAsFlow 加载并运行', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    const result = await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2' })
    expect(result.runId).toBe('run-svc-1')
    const snapshot = h.runtime.runSnapshot('run-svc-1')
    expect(snapshot?.flowId).toBe('svc-1')
    expect(snapshot?.mode).toBe('mode2')
    expect(snapshot?.sessionId).toBe('session-user-1')
  })

  it('服务不存在 → WF_NOT_FOUND', async () => {
    const h = await makeHarness()
    await expect(h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-none', mode: 'mode2' }))
      .rejects.toMatchObject({ code: 'WF_NOT_FOUND' })
  })

  it('mode1 不受影响（question 不注入输入节点）', async () => {
    const h = await makeHarness()
    const flow = serviceFlow('flow-1')
    flow.mode = 'mode1'
    // mode1 阶段节点名称锁定为「启动/结束」；ctx 连线仅模式二输入节点语义
    flow.lines = flow.lines.filter((l) => l.id !== 'c1')
    flow.nodes = [
      { id: 'n-in', kind: 'start', position: { x: 0, y: 0 }, data: { label: stageLabel('start', 'mode1') } },
      parentNode('n-parent'),
      agent('n-a1', '子任务'),
      { id: 'n-out', kind: 'end', position: { x: 0, y: 0 }, data: { label: stageLabel('end', 'mode1') } },
    ]
    await h.store.saveWorkflow(flow, 'session-user-1')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'flow-1', question: '忽略我' })
    const snapshot = h.runtime.runSnapshot('run-svc-1')
    const input = snapshot?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('pending')
  })
})

describe('用户问题注入', () => {
  it('问题写入输入节点产出（快照 ok + output），编排指令含问题', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '今天天气如何' })
    const snapshot = h.runtime.runSnapshot('run-svc-1')
    const input = snapshot?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('ok')
    expect(input?.output).toBe('今天天气如何')
    expect(input?.outputSummary).toBe('今天天气如何')
    // 编排指令 dynamic 段（W-01：不稳定内容仅末段）
    expect(lastDirective(h)).toContain('User question (service mode): 今天天气如何')
  })

  it('空问题不预填输入节点', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2' })
    const input = h.runtime.runSnapshot('run-svc-1')?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('pending')
    expect(lastDirective(h)).not.toContain('User question')
  })

  it('输入节点右出 ctx 连线：下游子代理任务块注入问题', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '帮我查资料' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const input = h.runner.calls[0]
    const blocksText = input.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(blocksText).toContain('帮我查资料')
  })

  it('无 ctx 连线时不注入问题（未连接不传递）', async () => {
    const h = await makeHarness()
    const flow = serviceFlow('svc-1')
    flow.lines = flow.lines.filter((l) => l.id !== 'c1')
    await h.store.saveService(toService(flow), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '秘密问题' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const blocksText = h.runner.calls[0].blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(blocksText).not.toContain('秘密问题')
  })
})

describe('resumeRun mode2（服务断点续跑）', () => {
  it('paused 服务运行可恢复（flow 从服务文档加载）', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '问题A' })
    // 模拟暂停门
    await h.runtime.stopRun('run-svc-1') // 先停掉当前锁
    h.runtime.runs.delete('run-svc-1')
    // 造一个磁盘 paused 记录（可恢复断点）
    const snapshot = h.runtime.runSnapshot('run-svc-1') ?? null
    // stopRun 已写磁盘；这里直接构造 paused 记录
    const prev = await h.store.getRun('run-svc-1')
    expect(prev).toBeTruthy()
    await h.store.saveRun({ ...prev!, status: 'paused', nodes: prev!.nodes.map((n) => n.nodeId === 'n-in' ? { ...n, status: 'ok', output: '问题A', outputSummary: '问题A' } : n) })
    const result = await h.runtime.resumeRun({ sessionId: 'session-user-1', flowId: 'svc-1' })
    expect(result.resumedFromRunId).toBe('run-svc-1')
    // 继承快照：已 ok 输入节点带产出（断点产出回填）
    const resumed = h.runtime.runSnapshot(result.runId)
    const input = resumed?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('ok')
    expect(input?.output).toBe('问题A')
    expect(input?.resumed).toBe(true)
    // 断点继续指令
    expect(lastDirective(h)).toContain('Resuming a prior run')
  })
})

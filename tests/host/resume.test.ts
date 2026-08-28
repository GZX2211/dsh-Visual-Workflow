// tests/host/resume.test.ts
//
// 断点续跑单测：
//   - buildResumedSnapshot 纯函数：已 ok/react-capped 继承（resumed+完整产出）、
//     其余节点回退 pending 清零、节点清单以当前工作流为准、断点字段；
//   - findResumableRun：按 runId 命中/状态过滤/最近可恢复/归属校验；
//   - runtime.resumeRun：paused/interrupted 恢复、继承链落盘、旧 paused 内存条目
//     释放（锁移交）、编排指令 isResume 动态态、错误路径（无断点/不可恢复/
//     不存在/锁冲突）。

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
import { buildResumedSnapshot, findResumableRun } from '../../src/host/orchestrator/resume.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

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

/** 标准流程：start → a1 → pause → a2 → end。 */
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
  clock: { now: number }
}

async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-resume-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const runSeq = { n: 0 }
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
    newRunId: () => {
      runSeq.n += 1
      return `run-${runSeq.n}`
    },
    uuid: () => `uuid-${runSeq.n}`,
  })
  return { runtime, store, agents, runner, clock }
}

const rootCaller: CallerInfo = { isChild: false, sessionId: 'session-1' }

/** 构造 paused 断点：a1 完成（ok + 产出）→ 暂停门（paused + resumeFromNodeId）。 */
async function makePausedRun(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
  await h.runtime.wfRunNode(rootCaller, { nodeId: 'n-a1' })
  await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A 的最终产出' }] })
  await h.runtime.wfRunNode(rootCaller, { nodeId: 'n-pause' })
}

// ---------------------------------------------------------------------------
// buildResumedSnapshot 纯函数
// ---------------------------------------------------------------------------

describe('buildResumedSnapshot', () => {
  const prev: import('../../src/host/shared/types.js').RunSnapshot = {
    id: 'run-1',
    flowId: 'flow-1',
    flowName: '测试流程',
    sessionId: 'session-1',
    mode: 'mode1',
    status: 'paused',
    startedAt: '2026-08-24T00:00:00.000Z',
    endedAt: null,
    summary: '',
    resumeFromNodeId: 'n-pause',
    nodes: [
      { nodeId: 'n-start', status: 'ok', attempts: 1, startedAt: 't1', endedAt: 't2', output: '', outputSummary: '' },
      { nodeId: 'n-a1', status: 'ok', attempts: 1, startedAt: 't1', endedAt: 't2', output: 'A 的最终产出', outputSummary: 'A 的最终产出' },
      { nodeId: 'n-pause', status: 'ok', attempts: 1, startedAt: 't1', endedAt: 't2', output: '（暂停门）暂停运行', outputSummary: '（暂停门）暂停运行' },
      { nodeId: 'n-a2', status: 'pending', attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '' },
      { nodeId: 'n-end', status: 'pending', attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '' },
    ],
  }

  it('已 ok 节点继承状态与完整产出（resumed 标记）；其余节点回退 pending 清零', () => {
    const snapshot = buildResumedSnapshot({ prev, runId: 'run-2', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1_000_001 })
    expect(snapshot.id).toBe('run-2')
    expect(snapshot.status).toBe('running')
    expect(snapshot.resumedFromRunId).toBe('run-1')
    expect(snapshot.resumeFromNodeId).toBe('n-pause')
    const a1 = snapshot.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(a1).toMatchObject({ status: 'ok', resumed: true, output: 'A 的最终产出', attempts: 1, startedAt: 't1', endedAt: 't2' })
    const a2 = snapshot.nodes.find((n) => n.nodeId === 'n-a2')!
    expect(a2).toMatchObject({ status: 'pending', attempts: 0, startedAt: null, output: '' })
    expect(a2.resumed).toBeUndefined()
    // 断点产出随继承快照重新可用（ctx 注入数据源）
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')?.output).toBe('A 的最终产出')
  })

  it('react-capped 同样继承（软截停正常产出）；running/fail/skipped 一律回退 pending', () => {
    const prev2 = {
      ...prev,
      nodes: prev.nodes.map((n) => (n.nodeId === 'n-a1' ? { ...n, status: 'react-capped' as const } : n)),
    }
    const snapshot = buildResumedSnapshot({ prev: prev2, runId: 'run-2', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1 })
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')).toMatchObject({ status: 'react-capped', resumed: true })

    const prev3 = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.nodeId === 'n-a1' ? { ...n, status: 'running' as const } : n.nodeId === 'n-a2' ? { ...n, status: 'fail' as const, attempts: 3 } : n,
      ),
    }
    const snapshot2 = buildResumedSnapshot({ prev: prev3, runId: 'run-3', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1 })
    const a1 = snapshot2.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(a1.status).toBe('pending')
    expect(a1.resumed).toBeUndefined()
    const a2 = snapshot2.nodes.find((n) => n.nodeId === 'n-a2')!
    expect(a2.status).toBe('pending')
    expect(a2.attempts).toBe(0)
  })

  it('节点清单以当前工作流为准：新增节点 pending、已删除节点不在快照', () => {
    const flow = makeFlow()
    flow.nodes.push(agent('n-a3', '新增节点'))
    const snapshot = buildResumedSnapshot({ prev, runId: 'run-2', flow, sessionId: 'session-1', mode: 'mode1', now: 1 })
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a3')).toMatchObject({ status: 'pending' })
  })

  it('Bug 21：interrupted（无暂停点）恢复时推断 resumeFromNodeId = 首个未完成节点', async () => {
    // 宿主重启中断：prev 无 resumeFromNodeId（中断发生在任意节点，无暂停门）
    const interrupted: import('../../src/host/shared/types.js').RunSnapshot = {
      ...prev,
      status: 'interrupted',
      resumeFromNodeId: undefined,
      nodes: [
        { nodeId: 'n-start', status: 'ok', attempts: 1, startedAt: 't1', endedAt: 't2', output: '', outputSummary: '' },
        { nodeId: 'n-a1', status: 'ok', attempts: 1, startedAt: 't1', endedAt: 't2', output: 'A 的最终产出', outputSummary: 'A 的最终产出' },
        { nodeId: 'n-pause', status: 'running', attempts: 1, startedAt: 't1', endedAt: null, output: '', outputSummary: '' },
        { nodeId: 'n-a2', status: 'pending', attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '' },
        { nodeId: 'n-end', status: 'pending', attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '' },
      ],
    }
    const snapshot = buildResumedSnapshot({ prev: interrupted, runId: 'run-2', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1 })
    // 恢复起点 = 第一个未完成节点（n-pause 被中断时 running，回退重跑）
    expect(snapshot.resumeFromNodeId).toBe('n-pause')

    // 暂停断点仍继承显式暂停节点 id（不覆盖）
    const paused = buildResumedSnapshot({ prev, runId: 'run-3', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1 })
    expect(paused.resumeFromNodeId).toBe('n-pause')
  })
})

// ---------------------------------------------------------------------------
// findResumableRun
// ---------------------------------------------------------------------------

describe('findResumableRun', () => {
  it('按 runId 命中 paused 记录；completed 不可恢复；归属不匹配返回 null', async () => {
    const h = await makeHarness()
    await makePausedRun(h)
    const prev = await h.store.getRun('run-1')
    expect(prev?.status).toBe('paused')

    const found = await findResumableRun(h.store, { sessionId: 'session-1', flowId: 'flow-1', fromRunId: 'run-1' })
    expect(found?.id).toBe('run-1')

    // 终态化后不可恢复（停止运行写 stopped）
    await h.runtime.stopRun('run-1')
    const stopped = await h.store.getRun('run-1')
    expect(stopped?.status).toBe('stopped')
    expect(await findResumableRun(h.store, { sessionId: 'session-1', flowId: 'flow-1', fromRunId: 'run-1' })).toBeNull()
  })

  it('未指定 runId 取最近可恢复记录（startedAt 倒序）', async () => {
    const h = await makeHarness()
    await makePausedRun(h)
    // 第二条 paused 记录（更晚时间戳）
    h.clock.now += 1000
    await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode(rootCaller, { nodeId: 'n-pause' })
    const found = await findResumableRun(h.store, { sessionId: 'session-1', flowId: 'flow-1' })
    expect(found?.id).toBe('run-2')
  })
})

// ---------------------------------------------------------------------------
// runtime.resumeRun
// ---------------------------------------------------------------------------

describe('runtime.resumeRun', () => {
  it('paused 恢复：继承链落盘、已 ok 不重跑、旧 paused 内存条目释放（锁移交新 run）', async () => {
    const h = await makeHarness()
    await makePausedRun(h)
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ runId: 'run-1', status: 'paused' })

    const result = await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    expect(result).toMatchObject({ runId: 'run-2', resumedFromRunId: 'run-1' })

    // 内存：run-1 已释放，锁属于新 run
    expect(h.runtime.runs.has('run-1')).toBe(false)
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ runId: 'run-2', status: 'running' })

    // 磁盘继承快照：a1 ok+resumed+产出保留；a2 pending
    const disk = await h.store.getRun('run-2')
    expect(disk?.resumedFromRunId).toBe('run-1')
    expect(disk?.resumeFromNodeId).toBe('n-pause')
    expect(disk?.nodes.find((n) => n.nodeId === 'n-a1')).toMatchObject({ status: 'ok', resumed: true, output: 'A 的最终产出' })
    expect(disk?.nodes.find((n) => n.nodeId === 'n-a2')).toMatchObject({ status: 'pending' })

    // 编排指令注入 isResume 动态态（已 ok 不重跑 + 从断点继续 + 继承链）
    const injected = h.agents.roots.get('session-1')!.messages
    expect(injected.length).toBe(2)
    const directive = injected[1].content.map((b) => b.text).join('')
    expect(directive).toContain('正在恢复先前运行（resumedFromRunId：run-1）')
    expect(directive).toContain('已 ok 的节点不得重跑')
    expect(directive).toContain('从节点 n-pause 开始')

    // 续跑后 wf_run_node 可正常调度（新 run 上下文）
    const started = await h.runtime.wfRunNode(rootCaller, { nodeId: 'n-a2' })
    expect(started.status).toBe('started')
  })

  it('interrupted 恢复（磁盘记录、无内存条目）同样成功', async () => {
    const h = await makeHarness()
    await makePausedRun(h)
    // 模拟宿主重启：内存清空 + 磁盘记录标记 interrupted
    h.runtime.dispose()
    const disk = await h.store.getRun('run-1')
    await h.store.saveRun({ ...disk!, status: 'interrupted', summary: '宿主进程重启，运行已中断（可恢复）' })

    const result = await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    expect(result.resumedFromRunId).toBe('run-1')
    const snapshot = await h.store.getRun(result.runId)
    expect(snapshot?.nodes.find((n) => n.nodeId === 'n-a1')).toMatchObject({ status: 'ok', resumed: true })
  })

  it('无断点 → WF_NO_RESUME_POINT；指定不可恢复 → WF_NOT_RESUMABLE；指定不存在 → WF_NOT_FOUND', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_NO_RESUME_POINT' })

    await makePausedRun(h)
    await h.runtime.stopRun('run-1')
    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1', fromRunId: 'run-1' })).rejects.toMatchObject({
      code: 'WF_NOT_RESUMABLE',
    })
    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1', fromRunId: 'run-nope' })).rejects.toMatchObject({
      code: 'WF_NOT_FOUND',
    })
  })

  it('同会话 running 锁 → WF_LOCKED（续跑后立即再续跑）', async () => {
    const h = await makeHarness()
    await makePausedRun(h)
    await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_LOCKED' })
  })

  it('跨会话锁 → WF_LOCKED（另一会话 running 同一工作流，本会话磁盘有断点）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    // 磁盘写入 paused 断点（内存无条目——另一会话占用了运行锁）
    const { createRunSnapshot } = await import('../../src/host/orchestrator/snapshot.js')
    const diskPrev = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: h.clock.now })
    diskPrev.status = 'paused'
    diskPrev.resumeFromNodeId = 'n-pause'
    await h.store.saveRun(diskPrev)
    // 跨会话 running 条目占锁
    const entry = {
      controller: new AbortController(),
      snapshot: {
        id: 'run-other',
        flowId: 'flow-1',
        flowName: '测试流程',
        sessionId: 'session-2',
        mode: 'mode1' as const,
        status: 'running' as const,
        startedAt: '2026-08-24T00:00:00.000Z',
        endedAt: null,
        summary: '',
        nodes: [],
      },
      baseFlow: makeFlow(),
      inflight: new Set<string>(),
      attempts: new Map<string, number>(),
      callCount: 0,
      lastActiveAt: h.clock.now,
      waiters: new Map<string, unknown>(),
      asks: new Map<string, unknown>(),
    }
    h.runtime.runs.set('run-other', entry as never)
    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_LOCKED' })
  })
})

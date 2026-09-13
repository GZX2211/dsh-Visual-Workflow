// tests/host/run-meta-freeze.test.ts
//
// 元参数冻结与落盘链路单测（自主编排方案 §6.4 / D-13）：
//   - startRun：把「有效元参数（实例 meta）」冻结进 run 快照，并随运行记录落盘；
//   - resumeRun：继承旧 run 的冻结值（不重读文档 meta）——「冻结即冻结」；
//   - 文档无 meta：不写 snapshot.meta（既有快照形状与旧数据零行为变化）；
//   - 链路一致性：getServiceAsFlow（模式二服务文档 → 工作流视图）转发 meta。
// 依赖缝：与 orchestrator.test.ts 同构（真实 FlowStore + fake AgentHost/NodeRunner）。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../src/host/shared/types.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function stage(id: string, kind: 'start' | 'end'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label, systemPrompt: '', provider: '', model: '', presetId: null,
      retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
    },
  }
}

/** 线性流程：start → a1 → end。 */
function makeFlow(id: string, sessionId: string, extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id,
    sessionId,
    mode: 'mode1',
    name: `流程-${id}`,
    description: '',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
    ...extra,
  }
}

class FakeRoot implements RootAgentLike {
  status = 'idle'
  messages: RootInjectedMessage[] = []
  constructor(readonly id: string) {}
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  turnEnd: TurnEndInfo | null = null
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
    return this.turnEnd
  }
  childRunning(): boolean {
    return false
  }
}

const runner = {
  async startNodeTask(): Promise<{ childId: string; created: boolean }> {
    return { childId: 'child-1', created: true }
  },
  async interruptChild(): Promise<void> {},
  consumeReactCapped(): boolean {
    return false
  },
}

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  dir: string
  clock: { now: number }
}

async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-meta-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const runSeq = { n: 0 }
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runtime = new OrchestratorRuntime({
    store,
    runner: runner as never,
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
    uuid: () => 'uuid-1',
  })
  return { runtime, store, dir, clock }
}

/** 直读磁盘运行记录（绕过 store 缓存语义，验证真实落盘）。 */
async function readRunFile(dir: string, runId: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'runs', `${runId}.json`), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

describe('startRun：元参数冻结与落盘', () => {
  it('实例 meta → snapshot.meta（规范化后）并随运行记录落盘', async () => {
    const h = await makeHarness()
    const flow = makeFlow('flow-1', 'session-1', { meta: { nodeMax: 12, groupMax: 3, forbiddenShapes: ['flowCycle'] } })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const snapshot = h.runtime.runSnapshot(result.runId)
    expect(snapshot?.meta).toEqual({ nodeMax: 12, groupMax: 3, forbiddenShapes: ['flowCycle'] })

    const persisted = await readRunFile(h.dir, result.runId)
    expect((persisted?.meta as Record<string, unknown>)?.nodeMax).toBe(12)
  })

  it('文档无 meta：不写 snapshot.meta（旧快照形状不变）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow('flow-2', 'session-1'), 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-2' })
    const snapshot = h.runtime.runSnapshot(result.runId)
    expect(snapshot && 'meta' in snapshot).toBe(false)
  })

  it('非法 meta 字段被规范化丢弃后冻结（不抛错）', async () => {
    const h = await makeHarness()
    const flow = makeFlow('flow-3', 'session-1', {
      meta: { nodeMax: -5, planFreedom: '乱写', 未知: 1 } as never,
    })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-3' })
    expect(h.runtime.runSnapshot(result.runId)?.meta).toBeUndefined()
  })
})

describe('resumeRun：冻结值继承（不重读文档 meta）', () => {
  it('续跑继承旧 run 的冻结值，且忽略文档中新增的 meta', async () => {
    const h = await makeHarness()
    const flow = makeFlow('flow-4', 'session-1', { meta: { nodeMax: 5 } })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const first = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-4' })
    const entry = h.runtime.activeRunForSession('session-1')
    expect(entry?.snapshot.meta).toEqual({ nodeMax: 5 })

    // 文档 meta 在运行中被改写（模拟画布改了实例预算）：冻结值不随之变化
    await h.store.saveWorkflow(makeFlow('flow-4', 'session-1', { meta: { nodeMax: 99 } }), 'session-1', { force: true })
    expect(entry?.snapshot.meta).toEqual({ nodeMax: 5 })

    // 停止后续跑：新 run 继承旧冻结值（磁盘断点需真实落盘，续跑查找读的是磁盘记录）
    entry!.snapshot.status = 'stopped'
    entry!.snapshot.endedAt = new Date(h.clock.now).toISOString()
    await h.store.saveRun(entry!.snapshot)
    entry!.controller.abort('stopped')
    const resumed = await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-4' })
    const resumedSnapshot = h.runtime.runSnapshot(resumed.runId)
    expect(resumedSnapshot?.resumedFromRunId).toBe(first.runId)
    expect(resumedSnapshot?.meta).toEqual({ nodeMax: 5 })
    const persisted = await readRunFile(h.dir, resumed.runId)
    expect((persisted?.meta as Record<string, unknown>)?.nodeMax).toBe(5)
  })
})

describe('模式二链路：服务文档 meta → 工作流视图', () => {
  it('getServiceAsFlow 转发实例 meta（不静默丢弃）', async () => {
    const h = await makeHarness()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      name: '服务',
      description: '',
      revision: 0,
      nodes: makeFlow('svc-1', 'session-1').nodes,
      lines: makeFlow('svc-1', 'session-1').lines,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'stopped',
      meta: { nodeMax: 7, milestoneMax: 2 },
    } as unknown as ServiceState
    await h.store.saveService(service, 'session-1', { force: true })
    const flow = await h.store.getServiceAsFlow('svc-1')
    expect(flow?.mode).toBe('mode2')
    expect(flow?.meta).toEqual({ nodeMax: 7, milestoneMax: 2 })
  })
})

// tests/host/agent-status-touch.test.ts
//
// 运行活性基准刷新单测（自主编排方案 §5.1）：
//   - OrchestratorRuntime.touchRunForSession：只刷新「本会话 + status==='running'」
//     的在编运行；paused/终态/他会话/无 run 均不动；
//   - 看护联动：父代理持续干活（官方 agent/status 反复转 running）时，即使超过
//     runIdleTimeoutMs 也不会被空闲看护误判为空闲并自动 stopped。
//
// 背景（为什么要这条通道）：父代理只在调用 wf_* 工具时刷新 lastActiveAt
// （runtime-execute.ts），规划/思考/读写文件期间不刷新 → 长规划会被看护误停。
// 依赖缝：与 orchestrator.test.ts 同构（真实 FlowStore + fake AgentHost/NodeRunner +
// 可控时钟），真实引擎接入后契约不变。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { sweepWatchdogOnce } from '../../src/host/orchestrator/watchdog.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 阶段节点（固定 id，确定性测试）。 */
function stage(id: string, kind: 'start' | 'end'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

/** 角色节点（固定 id + 固定数据）。 */
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

/** 线性流程：start → a1 → end（无父代理执行单元，父代理为纯调度者）。 */
function makeFlow(id: string, sessionId: string): WorkflowDocument {
  return {
    id,
    sessionId,
    mode: 'mode1',
    name: `流程-${id}`,
    description: '活性基准测试',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 会话根 Agent fake（仅满足编排启动所需最小面）。 */
class FakeRoot implements RootAgentLike {
  status = 'idle'
  messages: RootInjectedMessage[] = []
  constructor(readonly id: string) {}
}

/** AgentHost fake。 */
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

/** NodeRunner fake：只记录启动，返回稳定 childId。 */
const runner = {
  calls: 0,
  async startNodeTask(): Promise<{ childId: string; created: boolean }> {
    this.calls += 1
    return { childId: `child-${this.calls}`, created: true }
  },
  async interruptChild(): Promise<void> {
    // 测试不触发中断
  },
  consumeReactCapped(): boolean {
    return false
  },
}

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  clock: { now: number }
}

/** 装配：临时目录真实 FlowStore + fake 依赖 + 可控时钟与 id 生成。 */
async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-touch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const runSeq = { n: 0 }
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  agents.roots.set('session-2', new FakeRoot('session-2'))
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
  return { runtime, store, clock }
}

/** 保存流程并 startRun；返回内存 run 条目。 */
async function start(h: Harness, flow: WorkflowDocument) {
  await h.store.saveWorkflow(flow, flow.sessionId, { force: true })
  await h.runtime.startRun({ sessionId: flow.sessionId, flowId: flow.id })
  const entry = h.runtime.activeRunForSession(flow.sessionId)
  if (!entry) throw new Error('startRun 后应有激活 run')
  return entry
}

describe('touchRunForSession：运行活性基准刷新', () => {
  it('running 的本人会话运行：lastActiveAt 前进并返回 true', async () => {
    const h = await makeHarness()
    const entry = await start(h, makeFlow('flow-1', 'session-1'))
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-1')).toBe(true)
    expect(entry.lastActiveAt).toBe(before + 30_000)
  })

  it('paused 运行不刷新（看护只扫 running，无需活性基准）', async () => {
    const h = await makeHarness()
    const entry = await start(h, makeFlow('flow-2', 'session-1'))
    entry.snapshot.status = 'paused'
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-1')).toBe(false)
    expect(entry.lastActiveAt).toBe(before)
  })

  it('其他会话的运行不刷新（子代理/他会话事件不误刷本人运行）', async () => {
    const h = await makeHarness()
    const entry = await start(h, makeFlow('flow-3', 'session-1'))
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-2')).toBe(false)
    expect(entry.lastActiveAt).toBe(before)
  })

  it('空会话 id / 无任何运行：返回 false 且不抛错', async () => {
    const h = await makeHarness()
    expect(h.runtime.touchRunForSession('')).toBe(false)
    expect(h.runtime.touchRunForSession('session-1')).toBe(false)
  })

  it('看护联动：父代理持续干活（反复转 running）时不会因空闲超时被自动停止', async () => {
    const h = await makeHarness()
    const entry = await start(h, makeFlow('flow-4', 'session-1'))
    // 每次扫描都恰好处于「超过空闲门限」的时刻，但每次都被 agent/status 刷新救回
    for (let round = 0; round < 3; round += 1) {
      h.clock.now += 600 // > runIdleTimeoutMs(500)
      h.runtime.touchRunForSession('session-1')
      await sweepWatchdogOnce(h.runtime)
      expect(entry.snapshot.status).toBe('running')
    }
    // 对照组：不再刷新后，超时即被停止（证明前三次确实靠刷新续命）
    h.clock.now += 600
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
  })
})

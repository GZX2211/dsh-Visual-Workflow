// tests/host/scheduler-engine.test.ts
//
// 调度引擎状态机单测（fake 编排/会话/真实 FlowStore+TaskStore + 可控时钟）：
//   触发（new-session/current-session）/ 触发失败不重打 / 并发跳过 / 窗口 end 挂起 /
//   下一窗口续跑 / 暂停节点不自动续跑 / 用户接管失效 / 终态清空 / 停用不触发 / 重启跳过。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { SchedulerTaskStore } from '../../src/host/scheduler/task-store.js'
import { SchedulerEngine, type SchedulerOrchestrator } from '../../src/host/scheduler/engine.js'
import { localToUtc } from '../../src/host/scheduler/planner.js'
import type { WorkflowTemplate } from '../../src/host/shared/graph-model.js'
import type { ScheduledTask } from '../../src/host/shared/types.js'

const TZ = 'Asia/Shanghai'
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function makeTemplate(): WorkflowTemplate {
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '定时模板',
    description: '',
    nodes: [],
    lines: [],
  }
}

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    taskId: 'task-1',
    name: '测试任务',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 'session-owner',
    enabled: true,
    timezone: TZ,
    // 2026-09-01（周二）~ 09-30；每天；08:00-17:00 窗口
    window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [{ start: '08:00', end: '17:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['10:00', '14:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 编排 fake：状态完全可控（锁表 + run 快照表 + 调用记录）。 */
class FakeOrchestrator implements SchedulerOrchestrator {
  startCalls: Array<{ sessionId: string; flowId: string; mode?: string }> = []
  resumeCalls: Array<{ sessionId: string; flowId: string; fromRunId?: string }> = []
  suspendCalls: string[] = []
  locks = new Map<string, { runId: string; sessionId: string; status: string }>()
  runStates = new Map<string, { status: string }>()
  suspendResult = true
  seq = 0

  async startRun(input: { sessionId: string; flowId: string; mode?: 'mode1' | 'mode2' }): Promise<{ runId: string }> {
    this.startCalls.push(input)
    this.seq += 1
    const runId = `run-${this.seq}`
    this.runStates.set(runId, { status: 'running' })
    this.locks.set(input.flowId, { runId, sessionId: input.sessionId, status: 'running' })
    return { runId }
  }

  async resumeRun(input: { sessionId: string; flowId: string; fromRunId?: string }): Promise<{ runId: string }> {
    this.resumeCalls.push(input)
    this.seq += 1
    const runId = `run-${this.seq}`
    const prev = this.runStates.get(input.fromRunId ?? '')
    this.runStates.set(runId, { status: 'running' })
    this.locks.set(input.flowId, { runId, sessionId: input.sessionId, status: 'running' })
    if (prev?.status === 'paused') this.runStates.set(input.fromRunId ?? '', { status: 'paused' })
    return { runId }
  }

  async suspendRun(runId: string): Promise<boolean> {
    this.suspendCalls.push(runId)
    if (!this.suspendResult) return false
    const state = this.runStates.get(runId)
    if (state) state.status = 'paused'
    for (const [flowId, lock] of this.locks) {
      if (lock.runId === runId) {
        this.locks.set(flowId, { ...lock, status: 'paused' })
      }
    }
    return true
  }

  flowLockInfo(flowId: string): { runId: string; sessionId: string; status: string } | null {
    return this.locks.get(flowId) ?? null
  }

  runSnapshot(runId: string): { status: string } | null {
    return this.runStates.get(runId) ?? null
  }

  /** 测试辅助：推进 run 状态（模拟 subagent/end 完成、用户停止等）。 */
  setRunState(runId: string, status: string): void {
    this.runStates.set(runId, { status })
    for (const [flowId, lock] of this.locks) {
      if (lock.runId === runId) {
        if (status === 'running' || status === 'paused') this.locks.set(flowId, { ...lock, status })
        else this.locks.delete(flowId)
      }
    }
  }
}

/** 会话提供 fake：记录创建调用；可注入失败。 */
class FakeSessionProvider {
  created: Array<{ label: string; agentPreset?: string; cwd?: string }> = []
  fail: unknown = null
  async createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string> {
    if (this.fail) throw this.fail instanceof Error ? this.fail : new Error(String(this.fail))
    this.created.push(options)
    return `sched-${this.created.length}`
  }
}

interface Harness {
  engine: SchedulerEngine
  taskStore: SchedulerTaskStore
  flowStore: FlowStore
  orche: FakeOrchestrator
  sessions: FakeSessionProvider
  clock: { now: number }
}

async function makeHarness(task: ScheduledTask): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-sched-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const flowStore = new FlowStore(dir)
  await flowStore.init()
  const taskStore = new SchedulerTaskStore(dir)
  await taskStore.save(task)
  await flowStore.saveFlowTemplate(makeTemplate(), { force: true })
  const orche = new FakeOrchestrator()
  const sessions = new FakeSessionProvider()
  const clock = { now: Date.UTC(2026, 8, 1, 2, 0, 0) } // 2026-09-01 10:00 上海（触发点 10:00）
  const engine = new SchedulerEngine({
    taskStore,
    flowStore,
    orchestrator: orche,
    sessionProvider: sessions,
    now: () => clock.now,
    tickMs: 30_000,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  // 启动基准 = 当前时钟前 1 分钟（missedTrigger=skip：不追溯 1970；10:00 触发点仍在未来）
  ;(engine as unknown as { startedAtMs: number }).startedAtMs = clock.now - 60_000
  return { engine, taskStore, flowStore, orche, sessions, clock }
}

describe('调度引擎', () => {
  it('触发：new-session 模式创建会话+实例并 startRun', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep()
    expect(h.sessions.created).toHaveLength(1)
    expect(h.sessions.created[0]).toMatchObject({ label: '定时任务：测试任务', agentPreset: 'standard' })
    expect(h.orche.startCalls).toHaveLength(1)
    const start = h.orche.startCalls[0]
    expect(start.sessionId).toBe('sched-1')
    const flow = await h.flowStore.getWorkflow(start.sessionId, start.flowId)
    expect(flow?.name).toBe('定时模板')
    expect(flow?.mode).toBe('mode1')
    // 运行态记录
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.currentRunId).toBe('run-1')
    expect(rt.currentSessionId).toBe('sched-1')
    expect(rt.lastResult).toBe('started')
  })

  it('触发：current-session 模式直接复用创建者会话，不创建新会话', async () => {
    const h = await makeHarness(makeTask({ sessionMode: 'current-session' }))
    await h.engine.sweep()
    expect(h.sessions.created).toHaveLength(0)
    expect(h.orche.startCalls[0].sessionId).toBe('session-owner')
  })

  it('触发失败：模板缺失 → lastResult=failed 且同一触发点不重试', async () => {
    const h = await makeHarness(makeTask({ workflowTemplateId: 'tpl-missing' }))
    await h.engine.sweep() // 10:00 触发 → 失败
    const rt1 = await h.taskStore.readRuntime('task-1')
    expect(rt1.lastResult).toBe('failed')
    expect(rt1.lastError).toContain('不存在')
    expect(h.orche.startCalls).toHaveLength(0)
    // 同一时刻再 sweep：触发点已消费，不再重试
    await h.engine.sweep()
    const rt2 = await h.taskStore.readRuntime('task-1')
    expect(rt2.lastConsumedTriggerAt).toBe(rt1.lastConsumedTriggerAt)
  })

  it('并发跳过：上轮未结束时新触发点到达 → skipped 消费游标', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep() // 10:00 触发
    h.clock.now = Date.UTC(2026, 8, 1, 6, 0, 0) // 14:00 上海（第二触发点）
    await h.engine.sweep()
    expect(h.orche.startCalls).toHaveLength(1) // 未重复启动
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.lastResult).toBe('skipped')
    expect(rt.lastConsumedTriggerAt).toBe(localToUtc({ year: 2026, month: 9, day: 1, hour: 14, minute: 0 }, TZ))
  })

  it('窗口 end：运行中的 run 被挂起（paused），下一窗口 start 续跑', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep() // 10:00 触发（run-1 running）
    // 推进到 17:01 上海（窗口 08:00-17:00 已结束）
    h.clock.now = Date.UTC(2026, 8, 1, 9, 1, 0)
    await h.engine.sweep()
    expect(h.orche.suspendCalls).toEqual(['run-1'])
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.windowPausedRunId).toBe('run-1')
    // 次日 08:00 上海（窗口重开）→ 续跑
    h.clock.now = Date.UTC(2026, 8, 2, 0, 0, 0)
    await h.engine.sweep()
    expect(h.orche.resumeCalls).toHaveLength(1)
    expect(h.orche.resumeCalls[0]).toMatchObject({ sessionId: 'sched-1', flowId: expect.any(String) as string, fromRunId: 'run-1' })
    const rt2 = await h.taskStore.readRuntime('task-1')
    expect(rt2.currentRunId).toBe('run-2')
    expect(rt2.windowPausedRunId).toBe(null)
    expect(rt2.lastResult).toBe('resumed')
  })

  it('暂停节点（非引擎窗口暂停）不自动续跑：等待用户恢复', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep() // 10:00 触发 run-1
    // 用户流程遇到暂停节点：run-1 → paused（但 windowPausedRunId 为空）
    h.orche.setRunState('run-1', 'paused')
    h.clock.now = Date.UTC(2026, 8, 1, 2, 30, 0) // 10:30 上海（窗口内）
    await h.engine.sweep()
    expect(h.orche.resumeCalls).toHaveLength(0)
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.windowPausedRunId).toBe(null)
  })

  it('用户接管：同实例出现非引擎 run → 窗口限制失效并交还控制权', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep() // run-1
    const flowId = h.orche.startCalls[0].flowId
    // 用户在画布恢复：resumeRun 产生新 run-2（锁易主）
    h.orche.locks.set(flowId, { runId: 'run-user', sessionId: 'sched-1', status: 'running' })
    h.orche.runStates.set('run-user', { status: 'running' })
    await h.engine.sweep()
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.currentRunId).toBe(null)
    expect(rt.windowPausedRunId).toBe(null)
    expect(h.orche.suspendCalls).toHaveLength(0)
  })

  it('run 终态（stopped/failed/completed）：本轮清空，等待下一触发点', async () => {
    const h = await makeHarness(makeTask())
    await h.engine.sweep() // run-1
    h.orche.setRunState('run-1', 'stopped')
    await h.engine.sweep()
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.currentRunId).toBe(null)
    expect(rt.lastResult).toBe('started') // 历史结果保留
  })

  it('停用：不触发不挂起，配置保留', async () => {
    const h = await makeHarness(makeTask({ enabled: false }))
    await h.engine.sweep()
    expect(h.orche.startCalls).toHaveLength(0)
    expect(h.sessions.created).toHaveLength(0)
  })

  it('恢复（重启用后）：从启动基准起算，历史触发点不补打', async () => {
    // 任务在 08:00 有触发点；引擎启动基准 = 09:00（晚于触发点）→ 不补打
    const task = makeTask({ dailyTimeConfig: { timePoints: ['08:00'] } })
    const h = await makeHarness(task)
    h.clock.now = Date.UTC(2026, 8, 1, 1, 0, 0) // 09:00 上海
    ;(h.engine as unknown as { startedAtMs: number }).startedAtMs = h.clock.now
    await h.engine.sweep()
    expect(h.orche.startCalls).toHaveLength(0)
    const rt = await h.taskStore.readRuntime('task-1')
    expect(rt.lastConsumedTriggerAt).toBe(h.clock.now)
  })
})

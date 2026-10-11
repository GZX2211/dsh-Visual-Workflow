// tests/host/orchestrator/runtime-suspend.test.ts
//
// 编排运行时外部挂起与续跑（本组能力为定时任务的窗口挂起/续跑提供支撑）：
//   - suspendRun：外部挂起（run → paused + 锁保留 + 不中断 inflight，可续跑）；
//   - stopped 可恢复（用户裁决修正：停止后点「运行/恢复」断点续跑）；
//   - 窗口挂起 → resumeRun 续跑路径（复用现有断点续跑状态机）。
//
// 归属说明：全部断言落在 OrchestratorRuntime 自身（不 import scheduler 模块），
// 故归 orchestrator 测试目录，而非 scheduler 或 integration。

import { afterEach, describe, expect, it } from 'vitest'
import {
  findResumableRun,
  type OrchestratorRuntime,
} from '../../../src/host/orchestrator/index.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import {
  agent,
  cleanupTempDirs,
  makeHarness,
  stage,
} from './fixtures/harness.js'

afterEach(cleanupTempDirs)

/** 本文件的最小流程：start → a1 → end（挂起/续跑不涉及暂停门与协作组）。 */
function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 兼容旧调用点的装配别名：统一走共享夹具。 */
async function makeRuntime(): Promise<{
  runtime: OrchestratorRuntime
  store: Awaited<ReturnType<typeof makeHarness>>['store']
  agents: Awaited<ReturnType<typeof makeHarness>>['agents']
  clock: { now: number }
}> {
  const h = await makeHarness()
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  return { runtime: h.runtime, store: h.store, agents: h.agents, clock: h.clock }
}

describe('suspendRun（窗口挂起）', () => {
  it('运行中挂起：run → paused、锁保留、inflight 不中断、断点可续跑', async () => {
    const { runtime, store } = await makeRuntime()
    const start = await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const entry = runtime.entryFor(start.runId)
    expect(entry?.snapshot.status).toBe('running')
    // 挂起前登记一个 inflight 子代理（挂起不得中断）
    entry?.inflight.add('child-x')

    const ok = await runtime.suspendRun(start.runId, { summary: '窗口结束' })
    expect(ok).toBe(true)
    const snapshot = runtime.runSnapshot(start.runId)
    expect(snapshot?.status).toBe('paused')
    expect(snapshot?.summary).toBe('窗口结束')
    // 锁保留（paused 保留运行锁）
    expect(runtime.flowLockInfo('flow-1')?.status).toBe('paused')
    // inflight 未被中断清空
    expect(entry?.inflight.has('child-x')).toBe(true)
    // 磁盘持久化
    const disk = await store.getRun(start.runId)
    expect(disk?.status).toBe('paused')

    // 续跑（复用现有 resumeRun）
    const resumed = await runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1', fromRunId: start.runId })
    expect(resumed.resumedFromRunId).toBe(start.runId)
    expect(resumed.runId).not.toBe(start.runId)
  })

  it('非 running（已停止/不存在）幂等返回 false', async () => {
    const { runtime } = await makeRuntime()
    expect(await runtime.suspendRun('missing')).toBe(false)
    const start = await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await runtime.stopRun(start.runId)
    expect(await runtime.suspendRun(start.runId)).toBe(false)
  })
})

describe('stopped 可恢复（用户裁决修正）', () => {
  it('停止后的 run 可被 findResumableRun 找到并经 resumeRun 续跑', async () => {
    const { runtime, store, agents } = await makeRuntime()
    const start = await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await runtime.stopRun(start.runId)
    // 停止为终态：内存条目释放、锁释放
    expect(runtime.runSnapshot(start.runId)).toBe(null)
    expect(runtime.flowLockInfo('flow-1')).toBe(null)
    expect((await store.getRun(start.runId))?.status).toBe('stopped')
    // 可恢复查找
    const found = await findResumableRun(store, { sessionId: 'session-1', flowId: 'flow-1' })
    expect(found?.id).toBe(start.runId)
    // 手动恢复（历史面板「恢复」/画布再次运行）
    const resumed = await runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    expect(resumed.resumedFromRunId).toBe(start.runId)
    expect(agents.roots.get('session-1')?.messages.length).toBeGreaterThan(1)
  })

  it('failed/completed 仍不可恢复（词表外终态）', async () => {
    const { runtime, store } = await makeRuntime()
    const start = await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    // 父代理收尾标记 failed
    const entry = runtime.entryFor(start.runId)
    entry!.snapshot.status = 'running'
    // 直接走 terminate 语义模拟失败（wf_finish failed 路径的简化）
    await runtime.terminateRun(entry!, { status: 'failed', summary: 'x', abortReason: 'test' })
    expect((await store.getRun(start.runId))?.status).toBe('failed')
    expect(await findResumableRun(store, { sessionId: 'session-1', flowId: 'flow-1' })).toBe(null)
  })
})

// tests/host/orchestrator/runtime-lifecycle.test.ts
//
// 终止收尾层单测：统一终止、用户停止、终态条目释放与 dispose 清理。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFlow, makeHarness, caller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

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

  it('终态条目释放：wfFinish/stopRun 后内存 runs 表清空，磁盘历史保留，幂等可查', async () => {
    const h = await makeHarness()
    // wfFinish 完成 → 内存释放（runId 自增：第一次 run-1）
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })
    expect(h.runtime.runs.size).toBe(0)
    expect((await h.store.getRun('run-1'))?.status).toBe('completed')
    // 幂等：二次收尾经磁盘历史返回终态详情
    const second = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(second).toMatchObject({ ok: true, runId: 'run-1', status: 'completed', idempotent: true })
    // stopRun → 内存释放 + 磁盘 stopped（第二次运行：run-2）
    await start(h, makeFlow())
    await h.runtime.stopRun('run-2')
    expect(h.runtime.runs.size).toBe(0)
    expect((await h.store.getRun('run-2'))?.status).toBe('stopped')
    // 新运行可正常启动（锁已释放）
    const third = await start(h, makeFlow())
    expect(third.entry.snapshot.status).toBe('running')
    // paused 运行保留内存（续跑/锁查询需要）
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    expect(h.runtime.pausedRun('session-1', 'flow-1')).not.toBeNull()
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'paused' })
  })

  it('dispose：中止全部运行、阻塞等待拒绝、内存表清空', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' }) // 先挂断言，避免未处理拒绝
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    }, { timeout: 5000 })
    h.runtime.dispose()
    await assertion
    expect(h.runtime.runs.size).toBe(0)
    expect(h.runtime.childMetaFor('child-1')).toBeNull()
  })
})

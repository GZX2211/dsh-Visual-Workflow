// tests/host/orchestrator/run-terminal-notify.test.ts
//
// 运行终态通知缝单测：completed/failed/stopped 落定后各通知一次、run 级幂等、
// paused/interrupted 不通知、缝抛错不阻断收尾与资源释放、未注入缝时行为不变。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import { reconcileStaleRuns } from '../../../src/host/orchestrator/index.js'
import { makeFlow, makeHarness, caller, start, cleanupTempDirs, type Harness } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

/** 终态通知记录（缝入参原样收存）。 */
type TerminalCall = { sessionId: string; runId: string; status: string }

/** 装配：记录全部分终态通知；可注入抛错与 warn 文案。 */
async function makeNotifyHarness(options: { fail?: unknown } = {}): Promise<{ h: Harness; calls: TerminalCall[] }> {
  const calls: TerminalCall[] = []
  const h = await makeHarness(undefined, {
    onRunTerminal: (input) => {
      calls.push(input)
      if (options.fail) throw options.fail
    },
  })
  return { h, calls }
}

describe('onRunTerminal：wfFinish 收尾路径', () => {
  it('completed 落定后通知一次，入参会话/运行/状态正确', async () => {
    const { h, calls } = await makeNotifyHarness()
    await start(h, makeFlow())

    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })

    expect(calls).toEqual([{ sessionId: 'session-1', runId: 'run-1', status: 'completed' }])
  })

  it('failed 落定后通知一次，状态为 failed', async () => {
    const { h, calls } = await makeNotifyHarness()
    await start(h, makeFlow())

    await h.runtime.wfFinish(caller, { status: 'failed', summary: '无法继续' })

    expect(calls).toEqual([{ sessionId: 'session-1', runId: 'run-1', status: 'failed' }])
  })

  it('同一 run 重复收尾只通知一次（内存条目已释放的幂等分支不再通知）', async () => {
    const { h, calls } = await makeNotifyHarness()
    await start(h, makeFlow())

    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })
    const second = await h.runtime.wfFinish(caller, { status: 'completed' })

    expect(second).toMatchObject({ idempotent: true })
    expect(calls).toHaveLength(1)
  })
})

describe('onRunTerminal：terminateRun 终止路径', () => {
  it('stopped 落定后通知一次', async () => {
    const { h, calls } = await makeNotifyHarness()
    const { entry } = await start(h, makeFlow())

    await h.runtime.terminateRun(entry, { status: 'stopped', summary: '用户停止' })

    expect(calls).toEqual([{ sessionId: 'session-1', runId: 'run-1', status: 'stopped' }])
  })

  it('父代理出错自动 failed：经 terminateRun 通知一次', async () => {
    const { h, calls } = await makeNotifyHarness()
    const { entry } = await start(h, makeFlow())

    await h.runtime.failRunForParentError(entry, new Error('父代理崩了'))

    expect(calls).toEqual([{ sessionId: 'session-1', runId: 'run-1', status: 'failed' }])
  })

  it('重复终止（幂等返回 false）只通知一次', async () => {
    const { h, calls } = await makeNotifyHarness()
    const { entry } = await start(h, makeFlow())

    await h.runtime.terminateRun(entry, { status: 'stopped', summary: '停止' })
    expect(await h.runtime.terminateRun(entry, { status: 'stopped', summary: '再次停止' })).toBe(false)

    expect(calls).toHaveLength(1)
  })

  it('不可续跑态不通知：paused（挂起）与 interrupted（宿主重启对账）', async () => {
    const { h, calls } = await makeNotifyHarness()
    const { entry } = await start(h, makeFlow())

    expect(await h.runtime.suspendRun(entry.snapshot.id)).toBe(true)
    expect(entry.snapshot.status).toBe('paused')
    // 宿主重启对账把残留记录标记 interrupted（可恢复）：同样不通知
    expect(await h.runtime.persistRunSnapshot(entry)).toBeUndefined()
    const reconciled = await reconcileStaleRuns(h.store)

    expect(reconciled).toBe(1)
    expect((await h.store.getRun('run-1'))?.status).toBe('interrupted')
    expect(calls).toHaveLength(0)
  })
})

describe('onRunTerminal：失败语义与未注入缝', () => {
  it('缝抛错：终态、写盘、锁释放与内存回收照常完成，只多一条告警', async () => {
    const { h, calls } = await makeNotifyHarness({ fail: new Error('宿主收尾钩子异常') })
    const { entry } = await start(h, makeFlow())

    const result = await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })

    expect(result).toEqual({ ok: true, runId: 'run-1', status: 'completed' })
    expect(entry.snapshot.status).toBe('completed')
    expect((await h.store.getRun('run-1'))?.status).toBe('completed')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect(h.runtime.entryFor('run-1')).toBeNull()
    expect(calls).toHaveLength(1)
    expect(h.warnings.some((message) => message.includes('运行终态通知失败') && message.includes('宿主收尾钩子异常'))).toBe(true)
  })

  it('未注入缝：收尾行为与结果不变且不告警', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())

    const result = await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })

    expect(result).toEqual({ ok: true, runId: 'run-1', status: 'completed' })
    expect(entry.snapshot.status).toBe('completed')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect(h.warnings.filter((message) => message.includes('运行终态通知'))).toHaveLength(0)
  })

  it('幂等表随 run 生命周期回收：后续 run 不受前一 run 的通知记录影响', async () => {
    const { h, calls } = await makeNotifyHarness()
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed', summary: '第一次' })
    await start(h, makeFlow())

    await h.runtime.wfFinish(caller, { status: 'completed', summary: '第二次' })

    expect(calls).toEqual([
      { sessionId: 'session-1', runId: 'run-1', status: 'completed' },
      { sessionId: 'session-1', runId: 'run-2', status: 'completed' },
    ])
  })
})

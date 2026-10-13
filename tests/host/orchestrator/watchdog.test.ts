// tests/host/orchestrator/watchdog.test.ts
//
// 运行看护单测：空闲超时、父代理回合终态、定时扫描与宿主重启对账。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunSnapshot, reconcileStaleRuns, scheduleIdleWatchdog, setNodeStatus, sweepWatchdogOnce } from '../../../src/host/orchestrator/index.js'
import { makeFlow, makeHarness, caller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

describe('watchdog 看护与陈旧记录对账', () => {
  it('空闲超时：无 inflight 且静默超过 idleTimeoutMs → stopped', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.clock.now += 500 // 达阈值
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('stopped')
  })

  it('inflight 保护：子代理在跑不计空闲；已消失自愈后按空闲终止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    h.agents.runningChildren.add('child-1')
    h.clock.now += 10_000
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('running') // 在跑：不判空闲

    h.agents.runningChildren.delete('child-1') // 会话已消失 → 自愈清 inflight（刷新 lastActiveAt）
    await sweepWatchdogOnce(h.runtime)
    expect(entry.inflight.size).toBe(0)
    expect(entry.snapshot.status).toBe('running') // 自愈当轮刷新活动时间，不立即判空闲

    h.clock.now += 600 // 超过 idleTimeoutMs → 下一轮扫描终止
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
  })

  it('父代理回合 error → failed；aborted（对话区停止）→ 保持 running 不终止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.agents.turnEnd = { kind: 'error', error: new Error('编排错误') }
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('failed')
    expect(entry.snapshot.summary).toContain('编排错误')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()

    // 用户裁决：对话区官方「停止」只打断父代理回合（官方 cancel 不级联掐死子代理），
    // 语义是「打断+修正」而非「停止工作流」→ 运行保持 running，锁保留，画布继续回显
    const h2 = await makeHarness()
    const { entry: entry2 } = await start(h2, makeFlow())
    h2.agents.turnEnd = { kind: 'aborted' }
    await sweepWatchdogOnce(h2.runtime)
    expect(entry2.snapshot.status).toBe('running')
    expect(h2.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'running' })
    expect(h2.warnings.some((message) => message.includes('保持运行'))).toBe(true)
  })

  it('scheduleIdleWatchdog：定时触发扫描，disposer 可停止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const dispose = scheduleIdleWatchdog(h.runtime, { intervalMs: 20 })
    h.clock.now += 10_000
    // 显式超时（并行负载下默认 1s 会被调度放大而偶发失败；真实挂起仍会失败）
    await vi.waitFor(() => {
      expect(entry.snapshot.status).toBe('stopped')
    }, { timeout: 10_000 })
    dispose() // 停止后不再有副作用
    // 定时器只负责「触发扫描」；等待条件是运行快照，不受真实 fsync 抖动影响。
    // 落盘一致性断言改为经确定的扫描 API 复现（见下条用例），此处不再重复真实磁盘等待。
  })

  it('sweepWatchdogOnce：空闲超时 → 扫描 await 完成后落盘即为 stopped（不依赖真实磁盘等待）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    h.clock.now += 10_000
    // terminateRun 在返回前已 await 持久化，故扫描完成即落盘完成，无需轮询磁盘
    await sweepWatchdogOnce(h.runtime)
    expect((await h.store.getRun('run-1'))?.status).toBe('stopped')
  })

  it('reconcileStaleRuns：running/paused → interrupted（running 节点回退 pending、ok 保留）；completed 不动', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const stale = createRunSnapshot({ runId: 'stale-1', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    setNodeStatus(stale, 'n-a1', 'ok', { now: 1000 })
    setNodeStatus(stale, 'n-a2', 'running', { now: 1000 })
    stale.status = 'running'
    await h.store.saveRun(stale)

    const paused = createRunSnapshot({ runId: 'stale-2', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    paused.status = 'paused'
    paused.resumeFromNodeId = 'n-pause'
    await h.store.saveRun(paused)

    const done = createRunSnapshot({ runId: 'stale-3', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    done.status = 'completed'
    await h.store.saveRun(done)

    const changed = await reconcileStaleRuns(h.store, { now: () => 5000 })
    expect(changed).toBe(2)

    const r1 = await h.store.getRun('stale-1')
    expect(r1?.status).toBe('interrupted')
    expect(r1?.nodes.find((n) => n.nodeId === 'n-a2')!.status).toBe('pending')
    expect(r1?.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(r1?.endedAt).toBe(new Date(5000).toISOString())

    const r2 = await h.store.getRun('stale-2')
    expect(r2?.status).toBe('interrupted')
    expect(r2?.resumeFromNodeId).toBe('n-pause')

    expect((await h.store.getRun('stale-3'))?.status).toBe('completed')
  })

  it('reconcileStaleRuns：runs 目录混入非本资源文档时跳过它并完成对账（单个坏文件不中断整轮扫描）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const stale = createRunSnapshot({ runId: 'stale-1', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    stale.status = 'running'
    await h.store.saveRun(stale)

    // 历史遗留的旧格式聚合文档：JSON 合法、但不含 run 身份字段。
    // 对账按文件名扫描 runs/，过去经单资源读解析这种文件会抛错，使整轮对账失败并阻断宿主启动。
    await writeFile(join(h.dir, 'runs', 'wf-legacy.json'), JSON.stringify({ runs: [{ id: 'run-old' }] }), 'utf8')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const changed = await reconcileStaleRuns(h.store, { now: () => 5000 })
      expect(changed).toBe(1)
      expect((await h.store.getRun('stale-1'))?.status).toBe('interrupted')
      // 跳过必须留痕：否则「数据有问题」会退化成无人知道的静默少一条
      expect(warn.mock.calls.some((call) => String(call[0]).includes('wf-legacy.json'))).toBe(true)
    } finally {
      warn.mockRestore()
    }

    // 单资源读语义不变：坏文档仍抛可诊断错误（只有扫描/列表路径才跳过）
    await expect(h.store.getRun('wf-legacy')).rejects.toThrow(/wf-legacy\.json/)
  })
})

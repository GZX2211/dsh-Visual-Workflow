// tests/host/scheduler-api.test.ts
//
// GUI API 定时任务端点单测：白名单命中 / 保存校验（400 中文错误）与规范化 /
// 删除解绑 / 引擎缺失 501 / 运行态合并视图返回。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { SchedulerTaskStore } from '../../src/host/scheduler/task-store.js'
import type { SchedulerEngine } from '../../src/host/scheduler/engine.js'
import { VisualWorkflowApi, type ApiHost } from '../../src/host/remote/api.js'
import type { ScheduledTask } from '../../src/host/shared/types.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function makeTask(id = 'task-1'): ScheduledTask {
  return {
    taskId: id,
    name: '测试任务',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 'session-owner',
    enabled: true,
    timezone: 'Asia/Shanghai',
    window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [{ start: '09:00', end: '18:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['09:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

async function makeApi(): Promise<{ api: VisualWorkflowApi; store: SchedulerTaskStore; forgetSpy: ReturnType<typeof vi.fn> }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-sched-api-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const flowStore = new FlowStore(dir)
  await flowStore.init()
  const store = new SchedulerTaskStore(dir)
  const forgetSpy = vi.fn(async () => {})
  const scheduler = {
    listViews: vi.fn(async () => [{ task: makeTask(), runtime: { status: 'idle', nextTriggerAt: null, currentSessionId: null, currentFlowId: null, currentRunId: null, lastTriggeredAt: null, lastResult: null, lastError: '' } }]),
    forgetTask: forgetSpy,
  } as unknown as SchedulerEngine
  const host: ApiHost = {
    orchestrator: {} as never,
    store: flowStore,
    dataDir: dir,
    engine: {} as never,
    scheduler,
    schedulerTaskStore: store,
  }
  const api = new VisualWorkflowApi({ get: () => null }, host)
  return { api, store, forgetSpy }
}

describe('定时任务 API 端点', () => {
  it('schedulerTasks：返回引擎合并视图（含运行态）', async () => {
    const { api } = await makeApi()
    const result = await api.handle('schedulerTasks', {}) as Array<{ task: ScheduledTask; runtime: { status: string } }>
    expect(result).toHaveLength(1)
    expect(result[0].task.taskId).toBe('task-1')
    expect(result[0].runtime.status).toBe('idle')
  })

  it('schedulerTaskPut：合法保存并规范化（时刻升序）', async () => {
    const { api, store } = await makeApi()
    const raw = makeTask('task-put')
    raw.dailyTimeConfig = { timePoints: ['14:00', '09:00'] }
    const saved = await api.handle('schedulerTaskPut', { task: raw }) as ScheduledTask
    expect(saved.taskId).toBe('task-put')
    expect(saved.dailyTimeConfig?.timePoints).toEqual(['09:00', '14:00'])
    expect((await store.list()).map((t) => t.taskId)).toEqual(['task-put'])
  })

  it('schedulerTaskPut：非法字段 400（中文消息）', async () => {
    const { api } = await makeApi()
    const bad = makeTask('task-bad')
    bad.triggerMode = 'interval'
    bad.intervalConfig = { intervalMinutes: 0, startFrom: '09:00' }
    await expect(api.handle('schedulerTaskPut', { task: bad })).rejects.toMatchObject({ status: 400 })
    const missing = makeTask('task-missing')
    missing.workflowTemplateId = ''
    await expect(api.handle('schedulerTaskPut', { task: missing })).rejects.toThrow('请选择工作流模板')
    // 非 task- 前缀
    await expect(api.handle('schedulerTaskPut', { task: { ...makeTask(), taskId: 'combo-x' } })).rejects.toThrow('task-')
  })

  it('schedulerTaskDelete：删除成功解绑引擎；不存在返回 deleted=false', async () => {
    const { api, forgetSpy } = await makeApi()
    await api.handle('schedulerTaskPut', { task: makeTask('task-del') })
    const result = await api.handle('schedulerTaskDelete', { taskId: 'task-del' }) as { deleted: boolean }
    expect(result.deleted).toBe(true)
    expect(forgetSpy).toHaveBeenCalledWith('task-del')
    const none = await api.handle('schedulerTaskDelete', { taskId: 'task-missing' }) as { deleted: boolean }
    expect(none.deleted).toBe(false)
  })

  it('引擎/存储缺失：501', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-sched-api-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const flowStore = new FlowStore(dir)
    await flowStore.init()
    const host: ApiHost = { orchestrator: {} as never, store: flowStore, dataDir: dir, engine: {} as never }
    const api = new VisualWorkflowApi({ get: () => null }, host)
    await expect(api.handle('schedulerTasks', {})).rejects.toMatchObject({ status: 501 })
    await expect(api.handle('schedulerTaskPut', { task: makeTask() })).rejects.toMatchObject({ status: 501 })
  })

  it('未知端点 404（白名单外）', async () => {
    const { api } = await makeApi()
    await expect(api.handle('schedulerWhatever', {})).rejects.toMatchObject({ status: 404 })
  })
})

// tests/host/scheduler-task-store.test.ts
//
// 定时任务存储单测：CRUD / 前缀校验 / 运行时字段读写（跨任务合并原子写）/
// 文件形态（{ tasks, runtimes }）与损坏文件容忍。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SchedulerTaskStore, emptyPersistedRuntime } from '../../src/host/scheduler/task-store.js'
import type { ScheduledTask } from '../../src/host/shared/types.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function makeTask(id: string, name = `任务${id}`): ScheduledTask {
  return {
    taskId: id,
    name,
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 'session-owner',
    enabled: true,
    timezone: 'Asia/Shanghai',
    window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [{ start: '09:00', end: '18:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['10:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
  }
}

async function makeStore(): Promise<{ dir: string; store: SchedulerTaskStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-sched-store-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return { dir, store: new SchedulerTaskStore(dir) }
}

describe('SchedulerTaskStore', () => {
  it('save/list：任务按 updatedAt 倒序，同 id 更新不重复', async () => {
    const { store } = await makeStore()
    const a = makeTask('task-a')
    const b = makeTask('task-b')
    await store.save(a)
    await store.save(b)
    expect((await store.list()).map((t) => t.taskId)).toEqual(['task-b', 'task-a'])
    const updated = { ...a, name: '改名' }
    await store.save(updated)
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list.find((t) => t.taskId === 'task-a')?.name).toBe('改名')
  })

  it('save：非 task- 前缀 id 拒绝', async () => {
    const { store } = await makeStore()
    await expect(store.save(makeTask('combo-x'))).rejects.toThrow('task-')
  })

  it('delete：存在删除 true（运行时一并清除），不存在 false', async () => {
    const { store } = await makeStore()
    await store.save(makeTask('task-a'))
    await store.writeRuntime('task-a', { ...emptyPersistedRuntime(), currentRunId: 'run-1' })
    expect(await store.delete('task-a')).toBe(true)
    expect(await store.list()).toHaveLength(0)
    const rt = await store.readRuntime('task-a')
    expect(rt.currentRunId).toBe(null)
    expect(await store.delete('task-a')).toBe(false)
  })

  it('writeRuntime/readRuntime：按任务隔离合并，不覆盖其他任务', async () => {
    const { store } = await makeStore()
    await store.save(makeTask('task-a'))
    await store.save(makeTask('task-b'))
    await store.writeRuntime('task-a', { ...emptyPersistedRuntime(), currentRunId: 'run-a' })
    await store.writeRuntime('task-b', { ...emptyPersistedRuntime(), currentRunId: 'run-b' })
    expect((await store.readRuntime('task-a')).currentRunId).toBe('run-a')
    expect((await store.readRuntime('task-b')).currentRunId).toBe('run-b')
  })

  it('文件缺失/损坏：读作空列表，不抛错', async () => {
    const { dir, store } = await makeStore()
    expect(await store.list()).toEqual([])
    await writeFile(join(dir, 'scheduler-tasks.json'), '{broken', 'utf8')
    expect(await store.list()).toEqual([])
  })
})

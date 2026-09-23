// tests/client/lib/scheduler-task.test.ts
//
// 定时任务纯逻辑（lib/scheduler-task.ts）单测：时区探测 / 本地日期与偏移 /
// id 生成 / 空草稿默认值 / 视图深拷贝 / 表单即时校验 / ISO 格式化。
// 环境：纯函数测试，无需 jsdom（不触碰 DOM）。
//
// 确定性：时间一律注入固定 Date（localDateOnly/shiftDateOnly/createTaskDraft 均支持）；
// newTaskId 只断言前缀与不重复，不断言具体值（内含 Date.now 与随机源）。

import { describe, expect, it } from 'vitest'
import {
  WEEKDAY_LABELS,
  createTaskDraft,
  detectLocalTimezone,
  formatIso,
  localDateOnly,
  newTaskId,
  shiftDateOnly,
  taskFromView,
  validateTaskDraft,
} from '../../../src/client/lib/scheduler-task.js'
import type { ScheduledTask, ScheduledTaskView } from '../../../src/host/shared/types.js'

/** 定时任务夹具（字段与后端 ScheduledTask 契约一致）。 */
function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    taskId: 'task-1',
    name: '每日巡检',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 's-1',
    enabled: true,
    timezone: 'Asia/Shanghai',
    window: { startDate: '2026-09-01', endDate: '2026-10-01', daysOfWeek: [], timeRanges: [{ start: '09:00', end: '18:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['09:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('detectLocalTimezone：本地时区探测', () => {
  it('与运行时 Intl 解析结果一致（不可用时回退 Asia/Shanghai）', () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(detectLocalTimezone()).toBe(resolved || 'Asia/Shanghai')
  })
})

describe('localDateOnly：本地日期格式化', () => {
  it('月/日补零为 YYYY-MM-DD', () => {
    expect(localDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateOnly(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('shiftDateOnly：日期偏移', () => {
  it('正负偏移按天推进/回退，跨月正确', () => {
    expect(shiftDateOnly('2026-01-01', 30)).toBe('2026-01-31')
    expect(shiftDateOnly('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDateOnly('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateOnly('2026-09-01', 0)).toBe('2026-09-01')
  })
})

describe('newTaskId：任务 id 生成', () => {
  it('以 task- 前缀且多次生成不重复', () => {
    const ids = Array.from({ length: 5 }, () => newTaskId())
    for (const id of ids) expect(id.startsWith('task-')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('createTaskDraft：空任务草稿默认值', () => {
  it('以注入的 now 推导：今天起 30 天窗口、每天 09:00–18:00、定点 09:00', () => {
    const now = new Date(2026, 8, 1, 10, 30)
    const draft = createTaskDraft('s-1', now)
    expect(draft.ownerSessionId).toBe('s-1')
    expect(draft.name).toBe('')
    expect(draft.workflowTemplateId).toBe('')
    expect(draft.enabled).toBe(true)
    expect(draft.timezone).toBe(detectLocalTimezone())
    expect(draft.window.startDate).toBe('2026-09-01')
    expect(draft.window.endDate).toBe('2026-10-01')
    expect(draft.window.daysOfWeek).toEqual([])
    expect(draft.window.timeRanges).toEqual([{ start: '09:00', end: '18:00' }])
    expect(draft.triggerMode).toBe('daily_time')
    expect(draft.dailyTimeConfig).toEqual({ timePoints: ['09:00'] })
    expect(draft.intervalConfig).toEqual({ intervalMinutes: 120, startFrom: '09:00' })
    expect(draft.runtimePolicy).toEqual({ missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' })
    expect(draft.createdAt).toBe(now.toISOString())
    expect(draft.updatedAt).toBe(now.toISOString())
    expect(draft.taskId.startsWith('task-')).toBe(true)
  })
})

describe('taskFromView：视图 → 草稿深拷贝', () => {
  it('内容等价但与视图无引用共享（改草稿不污染列表数据）', () => {
    const view = { task: makeTask(), runtime: { status: 'idle' } } as unknown as ScheduledTaskView
    const draft = taskFromView(view)
    expect(draft).toEqual(view.task)
    draft.name = '被改过的名字'
    draft.window.timeRanges[0].start = '07:00'
    expect(view.task.name).toBe('每日巡检')
    expect(view.task.window.timeRanges[0].start).toBe('09:00')
  })
})

describe('validateTaskDraft：表单即时校验', () => {
  it('名称与工作流模板均必填，缺失返回词典键；齐全返回 null', () => {
    expect(validateTaskDraft(makeTask({ name: '   ' }))).toBe('schedulerNeedName')
    expect(validateTaskDraft(makeTask({ workflowTemplateId: '' }))).toBe('schedulerNeedTemplate')
    expect(validateTaskDraft(makeTask())).toBeNull()
  })
})

describe('formatIso：ISO → 本地可读', () => {
  it('空值返回破折号；非法值原样返回', () => {
    expect(formatIso(null)).toBe('—')
    expect(formatIso('')).toBe('—')
    expect(formatIso('not-a-date')).toBe('not-a-date')
  })

  it('合法 ISO → 本地可读格式（与运行时 Intl 同一口径，时区无关）', () => {
    const iso = '2026-09-01T10:30:00.000Z'
    const expected = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
    expect(formatIso(iso)).toBe(expected)
    expect(formatIso(iso)).toContain('2026')
  })
})

describe('WEEKDAY_LABELS：星期标签', () => {
  it('0=周日 … 6=周六', () => {
    expect([...WEEKDAY_LABELS]).toEqual(['日', '一', '二', '三', '四', '五', '六'])
  })
})

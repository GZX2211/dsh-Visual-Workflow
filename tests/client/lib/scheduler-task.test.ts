// tests/client/lib/scheduler-task.test.ts
//
// 定时任务纯逻辑（lib/scheduler-task.ts）单测：时区探测（可用/不可用两态） /
// 本地日期与偏移 / id 生成 / 空草稿默认值 / 视图深拷贝 / 表单即时校验 /
// ISO 格式化（跟随注入的界面 locale）。
// 环境：纯函数测试，无需 jsdom（不触碰 DOM）。
//
// 确定性：时间一律注入固定 Date（localDateOnly/shiftDateOnly/createTaskDraft 均支持）；
// newTaskId 只断言前缀与不重复，不断言具体值（内含 Date.now 与随机源）；
// 时区不可用经 Intl.DateTimeFormat.prototype.resolvedOptions 注入（不依赖本机时区）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as schedulerTaskLib from '../../../src/client/lib/scheduler-task.js'
import {
  createTaskDraft,
  detectLocalTimezone,
  FALLBACK_TIMEZONE,
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
  afterEach(() => { vi.restoreAllMocks() })

  it('可用时与运行时 Intl 解析结果一致', () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(detectLocalTimezone()).toBe(resolved || null)
  })

  it('解析结果为空时返回 null（不再静默按 Asia/Shanghai 解释）', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions)
    expect(detectLocalTimezone()).toBeNull()
  })

  it('探测抛错时返回 null（由调用方提示用户手动选择时区）', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('timezone unavailable')
    })
    expect(detectLocalTimezone()).toBeNull()
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
  afterEach(() => { vi.restoreAllMocks() })

  it('以注入的 now 推导：今天起 30 天窗口、每天 09:00–18:00、定点 09:00', () => {
    const now = new Date(2026, 8, 1, 10, 30)
    const draft = createTaskDraft('s-1', now)
    expect(draft.ownerSessionId).toBe('s-1')
    expect(draft.name).toBe('')
    expect(draft.workflowTemplateId).toBe('')
    expect(draft.enabled).toBe(true)
    expect(draft.timezone).toBe(detectLocalTimezone() ?? FALLBACK_TIMEZONE)
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

  it('探测不可用时草稿落兜底时区（宿主契约 timezone 必填；界面另行显式提示）', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions)
    const draft = createTaskDraft('s-1', new Date(2026, 8, 1, 10, 30))
    expect(draft.timezone).toBe(FALLBACK_TIMEZONE)
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

describe('formatIso：ISO → 本地可读（格式跟随注入的界面语言）', () => {
  it('空值返回破折号；非法值原样返回', () => {
    expect(formatIso(null, 'zh-CN')).toBe('—')
    expect(formatIso('', 'en-US')).toBe('—')
    expect(formatIso('not-a-date', 'zh-CN')).toBe('not-a-date')
  })

  it('合法 ISO → 与注入 locale 的 Intl 输出逐字一致（时区无关）', () => {
    const iso = '2026-09-01T10:30:00.000Z'
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } as const
    expect(formatIso(iso, 'zh-CN')).toBe(new Intl.DateTimeFormat('zh-CN', options).format(new Date(iso)))
    expect(formatIso(iso, 'en-US')).toBe(new Intl.DateTimeFormat('en-US', options).format(new Date(iso)))
    expect(formatIso(iso, 'zh-CN')).toContain('2026')
  })

  it('locale 真实影响格式：同一时刻中英输出不同（不再硬编码 zh-CN）', () => {
    const iso = '2026-09-01T10:30:00.000Z'
    expect(formatIso(iso, 'en-US')).not.toBe(formatIso(iso, 'zh-CN'))
  })
})

// ---------------------------------------------------------------------------
// 第三层：条件触发（草稿默认值 + 文件选择结果的绝对路径粗判）
// ---------------------------------------------------------------------------

/** 新增纯函数的受控访问（导出尚未存在时以「不是函数」失败，而不是整文件加载失败）。 */
interface ConditionDraftHelpers {
  isAbsoluteHostPath(value: string): boolean
}

const conditionHelpers = schedulerTaskLib as unknown as ConditionDraftHelpers

describe('createTaskDraft：条件层默认关闭', () => {
  it('新建草稿带 condition: { enabled: false, scriptPath: 空 }', () => {
    const draft = createTaskDraft('s-1', new Date(2026, 8, 1, 10, 30))
    expect((draft as ScheduledTask & { condition?: unknown }).condition).toEqual({ enabled: false, scriptPath: '' })
  })
})

describe('taskFromView：旧任务不凭空补条件字段', () => {
  it('旧任务（无 condition）→ 草稿不带该键，由表单按可选值处理', () => {
    const view = { task: makeTask(), runtime: { status: 'idle' } } as unknown as ScheduledTaskView
    const draft = taskFromView(view)
    expect('condition' in draft).toBe(false)
  })
})

describe('isAbsoluteHostPath：文件选择结果的绝对路径粗判（跨平台字符串判定）', () => {
  it('Windows 盘符、正斜杠、UNC 与 POSIX 根路径为 true', () => {
    for (const value of ['C:\\x\\a.mjs', 'C:/x/a.mjs', '\\\\server\\share\\a.mjs', '/x/a.mjs']) {
      expect(conditionHelpers.isAbsoluteHostPath(value), value).toBe(true)
    }
  })

  it('纯文件名、相对路径与空串为 false（不把文件名当路径写进草稿）', () => {
    for (const value of ['a.mjs', 'scripts\\a.mjs', './a.mjs', '']) {
      expect(conditionHelpers.isAbsoluteHostPath(value), value).toBe(false)
    }
  })
})

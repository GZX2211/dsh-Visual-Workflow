// tests/host/scheduler-planner.test.ts
//
// 定时任务规划器（planner.ts）纯函数单测：时区换算 / 触发点计算（定点+间隔跨天截断）/
// 执行窗口判定（日期范围×星期×时间段，含跨天区间）/ 下一触发点 / 窗口开始推算 /
// 校验与规范化。全部确定性注入（日期/时区固定，不读系统时钟）。

import { describe, expect, it } from 'vitest'
import {
  addDays, formatDateOnly, formatMinutes, isWithinWindow, isValidDate, localToUtc,
  nextTriggerAt, nextWindowStartAt, normalizeScheduledTask, parseDateOnly, parseTime,
  timeInRanges, triggerPointsForDate, validateScheduledTask, zonedParts,
} from '../../src/host/scheduler/planner.js'
import type { ScheduledTask, ScheduleWindowConfig } from '../../src/host/shared/types.js'

const TZ = 'Asia/Shanghai'

/** 标准窗口：2026-09-01 ~ 2026-09-30，工作日，daily_time 10:00/14:00/16:30。 */
function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    taskId: 'task-1',
    name: '测试任务',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 'session-owner',
    enabled: true,
    timezone: TZ,
    window: {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      daysOfWeek: [1, 2, 3, 4, 5],
      timeRanges: [{ start: '06:00', end: '09:00' }, { start: '12:00', end: '14:00' }, { start: '22:00', end: '23:59' }],
    },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['10:00', '14:00', '16:30'] },
    intervalConfig: { intervalMinutes: 70, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('时间基础工具', () => {
  it('parseTime：HH:mm 合法解析 / 非法返回 null', () => {
    expect(parseTime('06:00')).toBe(360)
    expect(parseTime('23:59')).toBe(1439)
    expect(parseTime('00:00')).toBe(0)
    expect(parseTime('24:00')).toBe(null)
    expect(parseTime('12:60')).toBe(null)
    expect(parseTime('9:00')).toBe(540)
    expect(parseTime('abc')).toBe(null)
    expect(parseTime('')).toBe(null)
  })

  it('formatMinutes：往返 + 负数环回', () => {
    expect(formatMinutes(360)).toBe('06:00')
    expect(formatMinutes(0)).toBe('00:00')
    expect(formatMinutes(1439)).toBe('23:59')
    expect(formatMinutes(1440 - 1 + 1440)).toBe('23:59')
  })

  it('parseDateOnly：合法日期/闰年校验/非法返回 null', () => {
    expect(parseDateOnly('2026-09-01')).toEqual({ year: 2026, month: 9, day: 1 })
    expect(parseDateOnly('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(parseDateOnly('2025-02-29')).toBe(null)
    expect(parseDateOnly('2025-13-01')).toBe(null)
    expect(parseDateOnly('2025-00-10')).toBe(null)
    expect(parseDateOnly('2025-09-31')).toBe(null)
    expect(parseDateOnly('abc')).toBe(null)
  })

  it('addDays：跨月/跨年/闰年', () => {
    expect(formatDateOnly(addDays({ year: 2026, month: 9, day: 30 }, 1))).toBe('2026-10-01')
    expect(formatDateOnly(addDays({ year: 2026, month: 1, day: 1 }, -1))).toBe('2025-12-31')
    expect(formatDateOnly(addDays({ year: 2024, month: 2, day: 28 }, 1))).toBe('2024-02-29')
  })
})

describe('时区换算', () => {
  it('zonedParts：UTC 时刻 → 上海本地墙钟（+08:00）', () => {
    const parts = zonedParts(Date.UTC(2026, 8, 1, 2, 0, 0), TZ)
    expect(parts.year).toBe(2026)
    expect(parts.month).toBe(9)
    expect(parts.day).toBe(1)
    expect(parts.hour).toBe(10)
    expect(parts.minute).toBe(0)
    expect(parts.weekday).toBe(2) // 2026-09-01 是周二
    expect(parts.dateOnly).toBe('2026-09-01')
  })

  it('localToUtc：上海本地时刻 → UTC（-08:00）+ 奇偶分钟校验', () => {
    const utc = localToUtc({ year: 2026, month: 9, day: 1, hour: 10, minute: 37 }, TZ)
    expect(utc).toBe(Date.UTC(2026, 8, 1, 2, 37, 0))
  })

  it('UTC 时区：墙钟等于 UTC', () => {
    const parts = zonedParts(Date.UTC(2026, 8, 1, 2, 37, 0), 'UTC')
    expect(parts.hour).toBe(2)
    expect(parts.minute).toBe(37)
  })
})

describe('窗口判定', () => {
  const window: ScheduleWindowConfig = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    daysOfWeek: [],
    timeRanges: [{ start: '06:00', end: '09:00' }, { start: '12:00', end: '14:00' }],
  }

  it('timeInRanges：普通区间闭开 + 跨天区间', () => {
    expect(timeInRanges(360, window.timeRanges)).toBe(true) // 06:00 含
    expect(timeInRanges(540, window.timeRanges)).toBe(false) // 09:00 不含
    expect(timeInRanges(719, window.timeRanges)).toBe(false) // 11:59
    expect(timeInRanges(720, window.timeRanges)).toBe(true) // 12:00
    const crossing = [{ start: '22:00', end: '06:00' }]
    expect(timeInRanges(1380, crossing)).toBe(true) // 23:00 当天段
    expect(timeInRanges(120, crossing)).toBe(true) // 02:00 凌晨段
    expect(timeInRanges(720, crossing)).toBe(false) // 12:00 窗口外
    expect(timeInRanges(1320, crossing)).toBe(true) // 22:00 含（起点）
    expect(timeInRanges(359, crossing)).toBe(true) // 05:59 凌晨段（终点前一刻）
    expect(timeInRanges(360, crossing)).toBe(false) // 06:00 不含
  })

  it('isValidDate：日期范围闭区间 + daysOfWeek 空=每天', () => {
    expect(isValidDate('2026-09-01', window)).toBe(true)
    expect(isValidDate('2026-09-30', window)).toBe(true)
    expect(isValidDate('2026-08-31', window)).toBe(false)
    expect(isValidDate('2026-10-01', window)).toBe(false)
    const weekday: ScheduleWindowConfig = { ...window, daysOfWeek: [2, 5] }
    expect(isValidDate('2026-09-01', weekday)).toBe(true) // 周二（2）
    expect(isValidDate('2026-09-04', weekday)).toBe(true) // 周五（5）
    expect(isValidDate('2026-09-05', weekday)).toBe(false) // 周六
    expect(isValidDate('2026-09-06', weekday)).toBe(false) // 周日
  })

  it('isValidDate：unbounded 忽略日期范围（仅 daysOfWeek 生效）', () => {
    const unbound: ScheduleWindowConfig = { ...window, unbounded: true }
    expect(isValidDate('2026-01-01', unbound)).toBe(true) // 任意日期
    expect(isValidDate('2027-12-31', unbound)).toBe(true)
    const unboundWeekday: ScheduleWindowConfig = { ...window, unbounded: true, daysOfWeek: [2] }
    expect(isValidDate('2026-09-01', unboundWeekday)).toBe(true) // 周二
    expect(isValidDate('2026-09-05', unboundWeekday)).toBe(false) // 周六
  })

  it('isWithinWindow：时段边界 + 跨天午夜段（上海时区）', () => {
    // 2026-09-01 06:30 上海 = 2026-08-31 22:30Z（窗口起点后，含）
    expect(isWithinWindow(Date.UTC(2026, 7, 31, 22, 30, 0), window, TZ)).toBe(true)
    // 09:00 上海 = 01:00Z（窗口终点不含）
    expect(isWithinWindow(Date.UTC(2026, 8, 1, 1, 0, 0), window, TZ)).toBe(false)
    // 10:00 上海 = 02:00Z（不在任何区间）
    expect(isWithinWindow(Date.UTC(2026, 8, 1, 2, 0, 0), window, TZ)).toBe(false)
    // 12:00 上海 = 04:00Z（第二区间起点含）
    expect(isWithinWindow(Date.UTC(2026, 8, 1, 4, 0, 0), window, TZ)).toBe(true)
    const cross: ScheduleWindowConfig = { ...window, timeRanges: [{ start: '22:00', end: '06:00' }] }
    // 2026-09-01 23:00 上海 = 15:00Z（当天傍晚段）
    expect(isWithinWindow(Date.UTC(2026, 8, 1, 15, 0, 0), cross, TZ)).toBe(true)
    // 2026-09-02 02:00 上海 = 2026-09-01 18:00Z（凌晨段跨天）
    expect(isWithinWindow(Date.UTC(2026, 8, 1, 18, 0, 0), cross, TZ)).toBe(true)
    // 2026-09-02 12:00 上海 = 04:00Z（窗口外）
    expect(isWithinWindow(Date.UTC(2026, 8, 2, 4, 0, 0), cross, TZ)).toBe(false)
  })
})

describe('触发点计算', () => {
  it('定点模式：时刻升序去重（不依赖输入顺序）', () => {
    const task = makeTask({ triggerMode: 'daily_time', dailyTimeConfig: { timePoints: ['16:30', '10:00', '14:00', '14:00'] } })
    expect(triggerPointsForDate(task, '2026-09-01')).toEqual([600, 840, 990])
  })

  it('间隔模式：从 startFrom 起步，跨天点（>=1440）废弃', () => {
    const task = makeTask({ triggerMode: 'interval', intervalConfig: { intervalMinutes: 70, startFrom: '09:00' } })
    const points = triggerPointsForDate(task, '2026-09-01')
    expect(points[0]).toBe(540) // 09:00
    expect(points[1]).toBe(610) // 10:10
    expect(points.at(-1)).toBe(1380) // 23:00（+70 跨天废弃；实现保证 1440 内最后点）
    expect(points.every((p) => p < 1440)).toBe(true)
    expect(points.some((p) => p >= 1440)).toBe(false)
  })
})

describe('nextTriggerAt / nextWindowStartAt', () => {
  it('定点模式：下一触发点 = 晚于基准且落在窗口内的第一个时刻', () => {
    // 任务每天 timePoints 10:00/14:00/16:30；窗口 08:00-17:00 → 首个窗口内点为 10:00
    const task = makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [1, 2, 3, 4, 5], timeRanges: [{ start: '08:00', end: '17:00' }] },
    })
    // after = 2026-09-01 00:00Z = 08:00 上海（本地分钟 480）
    const after = Date.UTC(2026, 8, 1, 0, 0, 0)
    expect(nextTriggerAt(task, after, TZ)).toBe(localToUtc({ year: 2026, month: 9, day: 1, hour: 10, minute: 0 }, TZ))
    // 基准恰好等于触发点：严格晚于 → 下一窗口内点 14:00
    const atPoint = localToUtc({ year: 2026, month: 9, day: 1, hour: 10, minute: 0 }, TZ)
    expect(nextTriggerAt(task, atPoint, TZ)).toBe(localToUtc({ year: 2026, month: 9, day: 1, hour: 14, minute: 0 }, TZ))
  })

  it('间隔模式：非窗口内的理论点被跳过，取窗口内点', () => {
    const task = makeTask({
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 60, startFrom: '09:00' },
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [1, 2, 3, 4, 5], timeRanges: [{ start: '12:00', end: '13:59' }] },
    })
    // after = 2026-09-01 00:00Z（08:00 上海本地）；理论点 09:00/10:00/11:00 在窗口外，
    // 12:00 落在 12:00-13:59 → 首个窗口内触发点为 12:00
    const after = Date.UTC(2026, 8, 1, 0, 0, 0)
    expect(nextTriggerAt(task, after, TZ)).toBe(localToUtc({ year: 2026, month: 9, day: 1, hour: 12, minute: 0 }, TZ))
  })

  it('daysOfWeek 与日期范围交集为空 → 永不触发（null）', () => {
    const task = makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-07', daysOfWeek: [0], timeRanges: [{ start: '08:00', end: '18:00' }] },
    })
    // 2026-09-01(周二) ~ 09-07(周一)：区间内周日为 09-06 → 有交集。改用无交集：
    const none = makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-04', daysOfWeek: [0], timeRanges: [{ start: '08:00', end: '18:00' }] },
    })
    expect(nextTriggerAt(none, Date.UTC(2026, 8, 1, 0, 0, 0), TZ)).toBe(null)
    expect(nextTriggerAt(task, Date.UTC(2026, 8, 1, 0, 0, 0), TZ)).not.toBe(null)
  })

  it('nextWindowStartAt：跳过无效日找到下一个窗口起点（含跨天区间）', () => {
    const window: ScheduleWindowConfig = {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      daysOfWeek: [1, 2, 3, 4, 5],
      timeRanges: [{ start: '22:00', end: '06:00' }],
    }
    // after = 2026-09-04 23:00Z（上海 09-05 07:00）：下一窗口 09-05（周六？09-05 是周六 → 无效）
    // 09-05 上海 07:00 = 09-04 23:00Z；下一有效日 09-07（周一）22:00 = 09-07 14:00Z
    const next = nextWindowStartAt(window, TZ, Date.UTC(2026, 8, 4, 23, 0, 0))
    expect(next).toBe(localToUtc({ year: 2026, month: 9, day: 7, hour: 22, minute: 0 }, TZ))
  })
})

describe('校验与规范化', () => {
  it('validateScheduledTask：非法字段返回中文错误（interval 范围/时刻重复/窗口非法）', () => {
    expect(validateScheduledTask(makeTask())).toBe(null)
    expect(validateScheduledTask(makeTask({ name: '' }))).toBe('任务名称不能为空')
    expect(validateScheduledTask(makeTask({ timezone: 'Mars/Olympus' }))).toBe('时区无效')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 0, startFrom: '09:00' },
    }))).toContain('1-1439')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 1440, startFrom: '09:00' },
    }))).toContain('1-1439')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'daily_time',
      dailyTimeConfig: { timePoints: ['10:00', '10:00'] },
    }))).toContain('不可重复')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-30', endDate: '2026-09-01', daysOfWeek: [], timeRanges: [{ start: '08:00', end: '18:00' }] },
    }))).toContain('起始日期不能晚于结束日期')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [7], timeRanges: [{ start: '08:00', end: '18:00' }] },
    }))).toContain('0-6')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [] },
    }))).toContain('至少需要一个可执行时间段')
  })

  it('normalizeScheduledTask：时刻升序去重 + policy 兜底 + 非法时间剔除', () => {
    const task = makeTask({
      triggerMode: 'daily_time',
      dailyTimeConfig: { timePoints: ['16:30', '10:00', '10:00', 'bad'] },
      runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    })
    const normalized = normalizeScheduledTask(task)
    expect(normalized.dailyTimeConfig?.timePoints).toEqual(['10:00', '16:30'])
    expect(normalized.runtimePolicy).toEqual({ missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' })
    const tzFallback = normalizeScheduledTask(makeTask({ timezone: '' }))
    expect(tzFallback.timezone).toBe('Asia/Shanghai')
    const enabledFallback = normalizeScheduledTask(makeTask({ enabled: false }))
    expect(enabledFallback.enabled).toBe(false)
  })
})

// tests/host/scheduler/window.test.ts
//
// 执行窗口判定单测（调度语义第一层）：时间段（含跨天区间）/日期范围闭区间/星期
// （空=每天）/unbounded，以及下一窗口开始时刻推算。
// 全部确定性注入（固定日期/时区，不读系统时钟）。

import { describe, expect, it } from 'vitest'
import { isValidDate, isWithinWindow, localToUtc, nextWindowStartAt, timeInRanges } from '../../../src/host/scheduler/index.js'
import type { ScheduleWindowConfig } from '../../../src/host/shared/types.js'
import { TZ } from './fixtures/task-fixture.js'

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

  it('nextWindowStartAt：跳过无效日找到下一个窗口起点（含跨天区间）', () => {
    const windowWithCross: ScheduleWindowConfig = {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      daysOfWeek: [1, 2, 3, 4, 5],
      timeRanges: [{ start: '22:00', end: '06:00' }],
    }
    // after = 2026-09-04 23:00Z（上海 09-05 07:00）：下一窗口 09-05（周六？09-05 是周六 → 无效）
    // 09-05 上海 07:00 = 09-04 23:00Z；下一有效日 09-07（周一）22:00 = 09-07 14:00Z
    const next = nextWindowStartAt(windowWithCross, TZ, Date.UTC(2026, 8, 4, 23, 0, 0))
    expect(next).toBe(localToUtc({ year: 2026, month: 9, day: 7, hour: 22, minute: 0 }, TZ))
  })
})

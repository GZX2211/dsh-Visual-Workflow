// tests/host/scheduler/trigger.test.ts
//
// 触发点计算单测（调度语义第二层）：定点模式（升序去重）/间隔模式（起始时刻 + k×间隔，
// 跨天点废弃），以及下一触发点推算（严格晚于基准 ∧ 落在执行窗口内）。
// 全部确定性注入（固定日期/时区，不读系统时钟）。

import { describe, expect, it } from 'vitest'
import { localToUtc, nextTriggerAt, triggerPointsForDate } from '../../../src/host/scheduler/index.js'
import { makeTask, TZ } from './fixtures/task-fixture.js'

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

describe('nextTriggerAt', () => {
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
})

// tests/host/scheduler/calendar.test.ts
//
// 日历与时刻基元单测：字符串解析/格式化往返（"HH:mm"/"YYYY-MM-DD"，含闰年真实性与
// 非法值拒绝）、日期偏移，以及 UTC 毫秒 ⇄ 指定 IANA 时区本地墙钟换算。
// 全部确定性注入（固定日期/时区，不读系统时钟）。

import { describe, expect, it } from 'vitest'
import { addDays, formatDateOnly, formatMinutes, localToUtc, parseDateOnly, parseTime, zonedParts } from '../../../src/host/scheduler/index.js'
import { TZ } from './fixtures/task-fixture.js'

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

// src/host/scheduler/trigger.ts
//
// 触发点计算（纯函数，零 IO/零时钟读取）——调度语义的第二层：
//   - 定点模式（daily_time）：每个有效日按 timePoints 升序触发；
//   - 间隔模式（interval）：每个有效日从 startFrom 起按 k*intervalMinutes 触发，
//     跨天截断（理论点 >= 次日 00:00 直接废弃，不产生当天后续触发）；
//   - 下一触发点推算（nextTriggerAt）。
//
// 触发点必须落在执行窗口内才成立（第一层见 ./window.ts）——两层并集才执行。

import type { ScheduledTask } from '../shared/types.js'
import {
  addDays,
  dateOnlyOf,
  formatDateOnly,
  localToUtc,
  MAX_SCAN_DAYS,
  MINUTES_PER_DAY,
  parseDateOnly,
  parseTime,
  zonedParts,
} from './calendar.js'
import { isValidDate, isWithinWindow } from './window.js'

/** 间隔模式的最小间隔（分钟）；触发点必须落在 [0, MINUTES_PER_DAY) 内。 */
export const DAILY_TIME_MIN_INTERVAL = 1

/** 某本地日期（须有效）上的全部理论触发点（本地分钟，升序；interval 跨天截断）。 */
export function triggerPointsForDate(task: Pick<ScheduledTask, 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'>, dateOnly: string): number[] {
  if (task.triggerMode === 'daily_time') {
    const points = (task.dailyTimeConfig?.timePoints ?? []).map(parseTime).filter((v): v is number => v !== null)
    return [...new Set(points)].sort((a, b) => a - b)
  }
  const cfg = task.intervalConfig
  const startFrom = parseTime(cfg?.startFrom)
  const interval = Math.floor(Number(cfg?.intervalMinutes))
  if (startFrom === null || !Number.isFinite(interval) || interval < DAILY_TIME_MIN_INTERVAL) return []
  const points: number[] = []
  for (let minutes = startFrom; minutes < MINUTES_PER_DAY; minutes += interval) {
    points.push(minutes)
  }
  return points
}

/**
 * 下一触发点（严格晚于 afterUtcMs）：扫描本地日期（after 当日 + MAX_SCAN_DAYS），
 * 仅考虑有效日；返回「触发点 ∈ 执行窗口区间」的最近触发时刻（UTC 毫秒）。
 * 窗口外/无有效日 → null（任务永久静默）。
 */
export function nextTriggerAt(task: ScheduledTask, afterUtcMs: number, timeZone: string): number | null {
  const afterDate = parseDateOnly(dateOnlyOf(afterUtcMs, timeZone)) ?? { year: 1970, month: 1, day: 1 }
  const afterParts = zonedParts(afterUtcMs, timeZone)
  const afterMinutes = afterParts.hour * 60 + afterParts.minute
  for (let offset = 0; offset <= MAX_SCAN_DAYS; offset += 1) {
    const date = addDays(afterDate, offset)
    const dateOnly = formatDateOnly(date)
    if (!isValidDate(dateOnly, task.window)) continue
    const points = triggerPointsForDate(task, dateOnly)
    for (const minutes of points) {
      // 第一天只取严格晚于当前本地时刻的点；后续日期从 0 点开始
      if (offset === 0 && minutes <= afterMinutes) continue
      // 触发点必须落在执行窗口内（第一层与第二层并集才执行）
      const pointUtc = localToUtc({ ...date, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone)
      if (isWithinWindow(pointUtc, task.window, timeZone)) return pointUtc
    }
  }
  return null
}

// src/host/scheduler/planner.ts
//
// 定时任务调度规划器（纯函数，零 IO/零全局状态/时钟注入）：
//   - 时区换算：UTC 毫秒 ↔ 指定 IANA 时区本地墙钟（Intl.DateTimeFormat 实现，
//     DST 双向近似迭代修正）；
//   - 触发点计算：定点模式（timePoints）与间隔模式（startFrom + k*intervalMinutes，
//     跨天截断：理论点 >= 次日 00:00 直接废弃不产生当天后续触发）；
//   - 执行窗口判定：日期范围（闭区间）× 星期（空=每天）× 时间段（timeRanges，
//     支持跨天区间 end<=start，如 22:00–06:00 覆盖次日凌晨）；
//   - 下一触发点 / 下一窗口开始时刻推算（nextTriggerAt/nextWindowStartAt）；
//   - 任务校验与规范化（validateScheduledTask/normalizeScheduledTask）。
//
// 语义依据：prompt/定时任务开发.md §一 JSON 结构、§二 字段与规则详细说明（新功能文档；
// 用户指令：不改写 docs/ 既有两份文档）。
//
// 约束（架构文档 §13/AGENTS.md）：纯函数优先、不读时钟/随机源、中文注释。

import type { ScheduledTask, ScheduleWindowConfig, TimeRangeConfig } from '../shared/types.js'

// ---------------------------------------------------------------------------
// 常量与基础工具
// ---------------------------------------------------------------------------

/** 一天的总分钟数（触发点计算边界）。 */
export const MINUTES_PER_DAY = 24 * 60

/** 全局触发起始点（本地分钟）；触发点必须落在 [0, MINUTES_PER_DAY) 内。 */
export const DAILY_TIME_MIN_INTERVAL = 1

/** 未来扫描天数上限（防止无解配置无限循环；远超任意业务窗口）。 */
export const MAX_SCAN_DAYS = 400

/** 解析 "HH:mm" 为本地分钟（0..1439）；非法返回 null。 */
export function parseTime(value: unknown): number | null {
  const text = String(value ?? '').trim()
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 本地分钟格式化 "HH:mm"。 */
export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hour = Math.floor(m / 60)
  const min = m % 60
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** 解析 "YYYY-MM-DD" 为 { year, month, day }；非法返回 null。 */
export function parseDateOnly(value: unknown): { year: number; month: number; day: number } | null {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 真实性校验（含闰年）
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

/** 本地日期格式化 "YYYY-MM-DD"。 */
export function formatDateOnly(date: { year: number; month: number; day: number }): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

/** 日期偏移（返回新的 {year,month,day}；跨月/跨年由 Date 归一化）。 */
export function addDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const utc = Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000
  const d = new Date(utc)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

// ---------------------------------------------------------------------------
// 时区换算
// ---------------------------------------------------------------------------

/** 指定时区的本地墙钟展开（weekday 0=周日 … 6=周六）。 */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 星期（0=周日）。 */
  weekday: number
  /** 本地日期（"YYYY-MM-DD"）。 */
  dateOnly: string
}

/** 把 UTC 毫秒时间戳展开为指定时区的本地墙钟（Intl 实现，线程安全/无全局状态）。 */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(new Date(utcMs))
  const get = (type: string): number => {
    const part = parts.find((item) => item.type === type)
    return Number((part?.value ?? '0').replace(/\D/g, '') || 0)
  }
  const weekdayText = parts.find((item) => item.type === 'weekday')?.value.toLowerCase() ?? ''
  const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const weekday = Math.max(0, weekdays.indexOf(weekdayText.slice(0, 3)))
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return {
    year,
    month,
    day,
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday,
    dateOnly: formatDateOnly({ year, month, day }),
  }
}

/**
 * 时区本地墙钟 → UTC 毫秒（近似迭代修正；DST 缺口/重叠采用迭代收敛值，确定性。
 * 说明：Asia/Shanghai 等目标时区无 DST，迭代 2-3 次即收敛到秒级精度）。
 * 迭代公式：guess 的本地墙钟名义值 nominal(guess) 与目标墙钟名义值 target 的
 * 差值即偏移误差，真实 UTC = guess - 误差。
 */
export function localToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): number {
  // 目标墙钟名义值（把墙钟字段当作 UTC 组装，仅用于差值比较，量纲一致）
  const target = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute)
  let utc = target
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(utc, timeZone)
    const nominal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const error = nominal - target
    if (error === 0) break
    utc -= error
  }
  return utc
}

/** UTC 毫秒 → 指定时区本地日期（"YYYY-MM-DD"）。 */
export function dateOnlyOf(utcMs: number, timeZone: string): string {
  return zonedParts(utcMs, timeZone).dateOnly
}

/** UTC 毫秒 → 指定时区星期（0=周日 … 6=周六）。 */
export function weekdayOf(utcMs: number, timeZone: string): number {
  return zonedParts(utcMs, timeZone).weekday
}

// ---------------------------------------------------------------------------
// 窗口判定（第一层：执行窗口）
// ---------------------------------------------------------------------------

/** 时刻（本地分钟）是否落在时间段数组的任一区间（跨天区间 end<=start 视为 [start,1440)∪[0,end)）。 */
export function timeInRanges(localMinutes: number, ranges: TimeRangeConfig[]): boolean {
  for (const range of ranges ?? []) {
    const start = parseTime(range.start)
    const end = parseTime(range.end)
    if (start === null || end === null) continue
    if (end > start) {
      if (localMinutes >= start && localMinutes < end) return true
    } else {
      // 跨天区间：当天 [start, 1440) ∪ 凌晨 [0, end)
      if (localMinutes >= start || localMinutes < end) return true
    }
  }
  return false
}

/** 日期（本地）是否有效：在 [startDate, endDate] 闭区间内且满足 daysOfWeek（空=每天）。 */
export function isValidDate(dateOnly: string, window: ScheduleWindowConfig): boolean {
  const parsed = parseDateOnly(dateOnly)
  if (!parsed) return false
  const start = parseDateOnly(window.startDate)
  const end = parseDateOnly(window.endDate)
  if (!start || !end) return false
  const key = (d: { year: number; month: number; day: number }): number => Date.UTC(d.year, d.month - 1, d.day)
  if (key(parsed) < key(start) || key(parsed) > key(end)) return false
  const days = window.daysOfWeek ?? []
  if (days.length === 0) return true
  const weekday = new Date(key(parsed)).getUTCDay()
  return days.includes(weekday)
}

/** 某本地日期上覆盖到的全部窗口区间（含前一日跨天区间延伸到本日的情形）。 */
export interface WindowSpan {
  /** 窗口开始（本地分钟；跨天区间时为前一日 start）。 */
  startMin: number
  /** 窗口结束（本地分钟；跨天区间时为次日 end）。 */
  endMin: number
  /** 窗口起始所属的本地日期（跨天区间凌晨部分属于前一日）。 */
  startDate: string
  /** 该区间是否跨天。 */
  crossesDays: boolean
}

/**
 * 计算某本地日期 D 上「生效」的窗口区间列表（即该日期内窗口为「开」的时刻范围）：
 *   - 非跨天区间 [s,e)：D 的 [s,e)（要求 D 有效）；
 *   - 跨天区间 [s,1440)∪[0,e)：D 的凌晨段 [0,e)（起始日 = D-1，要求 D-1 有效）。
 * 供 UI/调试展示用；窗口判定以 isWithinWindow（瞬时边界比对）为准。
 */
export function windowSpansOfDate(dateOnly: string, window: ScheduleWindowConfig): WindowSpan[] {
  const spans: WindowSpan[] = []
  const ranges = window.timeRanges ?? []
  for (const range of ranges) {
    const start = parseTime(range.start)
    const end = parseTime(range.end)
    if (start === null || end === null) continue
    const crossings = end <= start
    if (!crossings) {
      if (isValidDate(dateOnly, window)) {
        spans.push({ startMin: start, endMin: end, startDate: dateOnly, crossesDays: false })
      }
      continue
    }
    // 跨天：凌晨部分 [0,end) 属于前一日的区间（起始日 = dateOnly - 1）
    const prev = addDays(parseDateOnly(dateOnly) ?? { year: 1970, month: 1, day: 1 }, -1)
    const prevDate = formatDateOnly(prev)
    if (isValidDate(prevDate, window)) {
      spans.push({ startMin: start, endMin: end, startDate: prevDate, crossesDays: true })
    }
  }
  return spans
}

/**
 * UTC 时刻是否处于执行窗口内（日期范围 + 星期 + 时间段；含跨天区间）。
 * 实现：把每个区间展开为 UTC 瞬时闭开区间 [startUtc, endUtc) 之后直接比对——
 * 跨天区间（end<=start）的 endUtc 取次日的 end 时刻，天然覆盖凌晨段；
 * 扫描覆盖时刻当天与前一天的区间（跨天区间起始于前一日傍晚）。
 */
export function isWithinWindow(utcMs: number, window: ScheduleWindowConfig, timeZone: string): boolean {
  const today = parseDateOnly(dateOnlyOf(utcMs, timeZone)) ?? { year: 1970, month: 1, day: 1 }
  const days = [today, addDays(today, -1)]
  for (const day of days) {
    for (const range of window.timeRanges ?? []) {
      const start = parseTime(range.start)
      const end = parseTime(range.end)
      if (start === null || end === null) continue
      const startDate = formatDateOnly(day)
      if (!isValidDate(startDate, window)) continue
      const startUtc = localToUtc({ ...day, hour: Math.floor(start / 60), minute: start % 60 }, timeZone)
      const endDay = end <= start ? addDays(day, 1) : day
      const endUtc = localToUtc({ ...endDay, hour: Math.floor(end / 60), minute: end % 60 }, timeZone)
      if (startUtc <= utcMs && utcMs < endUtc) return true
    }
  }
  return false
}

/**
 * 下一窗口开始时刻（严格晚于 afterUtcMs；返回 UTC 毫秒）。
 * 窗口开始 = 某有效日 D 的某区间 start（跨天区间记为 D 的 start 时刻）。
 * 扫描边界：afterUtcMs 前一日 ~ 前一日 + MAX_SCAN_DAYS。
 */
export function nextWindowStartAt(window: ScheduleWindowConfig, timeZone: string, afterUtcMs: number): number | null {
  const after = dateOnlyOf(afterUtcMs, timeZone)
  const afterParsed = parseDateOnly(after) ?? { year: 1970, month: 1, day: 1 }
  const candidates: number[] = []
  for (let offset = -1; offset <= MAX_SCAN_DAYS; offset += 1) {
    const date = addDays(afterParsed, offset)
    const dateOnly = formatDateOnly(date)
    if (!isValidDate(dateOnly, window)) continue
    for (const range of window.timeRanges ?? []) {
      const start = parseTime(range.start)
      if (start === null) continue
      const startUtc = localToUtc({ ...date, hour: Math.floor(start / 60), minute: start % 60 }, timeZone)
      if (startUtc > afterUtcMs) candidates.push(startUtc)
    }
  }
  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

// ---------------------------------------------------------------------------
// 触发点计算（第二层：触发策略）
// ---------------------------------------------------------------------------

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

/** 任务级"当前是否处于窗口外"（引擎挂起判定用）：窗口内返回 false。 */
export function isTaskWindowOpen(task: ScheduledTask, utcMs: number, timeZone: string): boolean {
  return isWithinWindow(utcMs, task.window, timeZone)
}

// ---------------------------------------------------------------------------
// 校验与规范化
// ---------------------------------------------------------------------------

/**
 * 任务配置校验（字段级中文错误消息；返回 null 表示有效）。
 * 依据：prompt/定时任务开发.md §二（intervalMinutes 1..1439、timePoints 升序等硬性规则）。
 */
export function validateScheduledTask(task: Pick<
  ScheduledTask,
  'name' | 'workflowTemplateId' | 'sessionMode' | 'ownerSessionId' | 'timezone' | 'window' | 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'
>): string | null {
  if (!String(task?.name ?? '').trim()) return '任务名称不能为空'
  if (!String(task?.workflowTemplateId ?? '').trim()) return '请选择工作流模板'
  if (task.sessionMode !== 'new-session' && task.sessionMode !== 'current-session') return '会话策略无效'
  if (!String(task?.ownerSessionId ?? '').trim()) return '缺少归属会话'
  if (!String(task?.timezone ?? '').trim()) return '时区不能为空'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: task.timezone })
  } catch {
    return '时区无效'
  }
  const window = task.window
  if (!parseDateOnly(window?.startDate)) return '起始日期无效'
  if (!parseDateOnly(window?.endDate)) return '结束日期无效'
  const start = parseDateOnly(window.startDate) as { year: number; month: number; day: number }
  const end = parseDateOnly(window.endDate) as { year: number; month: number; day: number }
  if (Date.UTC(start.year, start.month - 1, start.day) > Date.UTC(end.year, end.month - 1, end.day)) {
    return '起始日期不能晚于结束日期'
  }
  const days = window.daysOfWeek ?? []
  if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return '有效星期仅支持 0-6（0=周日）'
  }
  const ranges = window.timeRanges ?? []
  if (ranges.length === 0) return '至少需要一个可执行时间段'
  for (const range of ranges) {
    if (parseTime(range?.start) === null || parseTime(range?.end) === null) return '时间段格式应为 HH:mm'
  }
  if (task.triggerMode === 'daily_time') {
    const points = (task.dailyTimeConfig?.timePoints ?? []).map(parseTime)
    if (points.length === 0 || points.some((p) => p === null)) return '定点模式至少需要一个合法触发时刻（HH:mm）'
    const sorted = [...(points as number[])].sort((a, b) => a - b)
    if (sorted.some((v, i) => i > 0 && v <= sorted[i - 1])) return '触发时刻不可重复（请升序填写）'
  } else if (task.triggerMode === 'interval') {
    const minutes = Number(task.intervalConfig?.intervalMinutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1439) {
      return '间隔分钟数必须为 1-1439 的整数'
    }
    if (parseTime(task.intervalConfig?.startFrom) === null) return '起始时刻格式应为 HH:mm'
  } else {
    return '触发模式无效'
  }
  return null
}

/** 任务规范化（保存前补齐/清洗：名称 trim、时刻升序去重、policy 兜底）。 */
export function normalizeScheduledTask(task: ScheduledTask): ScheduledTask {
  const normalized: ScheduledTask = {
    ...task,
    name: String(task?.name ?? '').trim(),
    workflowTemplateId: String(task?.workflowTemplateId ?? ''),
    sessionMode: task?.sessionMode === 'current-session' ? 'current-session' : 'new-session',
    ownerSessionId: String(task?.ownerSessionId ?? ''),
    enabled: task?.enabled !== false,
    timezone: String(task?.timezone ?? '').trim() || 'Asia/Shanghai',
    window: {
      startDate: String(task?.window?.startDate ?? ''),
      endDate: String(task?.window?.endDate ?? ''),
      daysOfWeek: Array.isArray(task?.window?.daysOfWeek)
        ? task.window.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [],
      timeRanges: (task?.window?.timeRanges ?? [])
        .map((range) => ({ start: String(range?.start ?? ''), end: String(range?.end ?? '') }))
        .filter((range) => parseTime(range.start) !== null && parseTime(range.end) !== null),
    },
    triggerMode: task?.triggerMode === 'interval' ? 'interval' : 'daily_time',
    dailyTimeConfig: task?.dailyTimeConfig
      ? {
          timePoints: [...new Set((task.dailyTimeConfig.timePoints ?? []).map((v) => String(v).trim()).filter((v) => parseTime(v) !== null))]
            .sort((a, b) => (parseTime(a) ?? 0) - (parseTime(b) ?? 0)),
        }
      : null,
    intervalConfig: task?.intervalConfig
      ? {
          intervalMinutes: Math.floor(Number(task.intervalConfig.intervalMinutes)) || 120,
          startFrom: String(task.intervalConfig.startFrom ?? '09:00'),
        }
      : null,
    runtimePolicy: {
      missedTrigger: 'skip',
      concurrency: 'skip',
      configUpdate: 'immediate',
    },
  }
  return normalized
}

/** 常用时区候选（下拉选择；按使用频次排序，含 UTC/Asia 主要时区）。 */
export const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Taipei',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'UTC',
] as const

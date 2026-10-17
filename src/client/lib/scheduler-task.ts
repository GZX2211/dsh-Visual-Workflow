// src/client/lib/scheduler-task.ts
//
// 定时任务纯逻辑（可单测）：草稿构建 / 视图转换 / 时间与时区换算 / 轻量即时校验 / 格式化。
// 与 UI 生命周期无关，故归 lib（组件只消费，不承载业务换算）。
// 时区探测不可用（返回 null）与展示 locale 都以显式返回值/注入参数表达：lib 不持有词典，
// 也不用兜底文案掩盖「未知」，由调用方按语义提示。
// 注意：仅做表单提示层校验（格式/必填），权威校验在 host schedulerTaskPut
// （validateScheduledTask 400 中文错误，UI 经 toast 展示），避免双份校验逻辑漂移。

import type { ScheduledTask, ScheduledTaskView } from '../../host/shared/types.js'

/** 时区探测不可用时的兜底时区（宿主契约 ScheduledTask.timezone 必填；界面须同时显式提示）。 */
export const FALLBACK_TIMEZONE = 'Asia/Shanghai'

/**
 * 本地时区（浏览器/Node resolvedOptions）。探测不可用返回 null —— 不静默按上海解释：
 * 把未知时区当成已知事实会让全部触发时刻整体偏移，故由调用方提示用户手动选择
 * （SchedulerManager 的 schedulerTimezoneUnavailable；草稿落库另用 FALLBACK_TIMEZONE）。
 */
export function detectLocalTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || null
  } catch {
    return null
  }
}

/** 本地日期 "YYYY-MM-DD"（今天）。 */
export function localDateOnly(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 日期偏移（"YYYY-MM-DD"）。 */
export function shiftDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000
  const date = new Date(utc)
  return localDateOnly(date)
}

/** 任务 id 生成（`task-` 前缀；与组合 combo- 模式一致）。 */
export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 空任务草稿（默认值：今天起 30 天、每天、一个 09:00–18:00 时间段、定点触发 09:00）。 */
export function createTaskDraft(ownerSessionId: string, now = new Date()): ScheduledTask {
  const today = localDateOnly(now)
  return {
    taskId: newTaskId(),
    name: '',
    workflowTemplateId: '',
    sessionMode: 'new-session',
    ownerSessionId,
    enabled: true,
    // 探测不可用时落兜底时区：契约里 timezone 必填，空串会被 host 拒绝；
    // 「不再静默」由界面负责——SchedulerManager 打开即提示用户手动选择
    timezone: detectLocalTimezone() ?? FALLBACK_TIMEZONE,
    window: {
      startDate: today,
      endDate: shiftDateOnly(today, 30),
      daysOfWeek: [],
      timeRanges: [{ start: '09:00', end: '18:00' }],
    },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['09:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

/** 视图 → 草稿（深拷贝，避免表单编辑污染列表数据）。 */
export function taskFromView(view: ScheduledTaskView): ScheduledTask {
  return JSON.parse(JSON.stringify(view.task)) as ScheduledTask
}

/** 表单即时校验：返回第一处错误消息（null = 通过基础检查）。 */
export function validateTaskDraft(task: ScheduledTask): string | null {
  if (!String(task.name ?? '').trim()) return 'schedulerNeedName'
  if (!String(task.workflowTemplateId ?? '').trim()) return 'schedulerNeedTemplate'
  return null
}

/**
 * 显示格式化：ISO → 本地可读。
 * locale 由调用方从词典注入（lib 不持有词典）：年月日/时分顺序与 AM/PM 表达随界面
 * 语言变化，硬编码 'zh-CN' 会让英文界面一直显示中文习惯的日期格式。
 */
export function formatIso(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}


// src/client/components/scheduler/scheduler-utils.ts
//
// 定时任务表单纯函数（可单测）：草稿构建 / 视图转换 / 轻量即时校验。
// 注意：仅做表单提示层校验（格式/必填），权威校验在 host schedulerTaskPut
// （validateScheduledTask 400 中文错误，UI 经 toast 展示），避免双份校验逻辑漂移。

import type { ScheduledTask, ScheduledTaskView } from '../../../host/shared/types.js'

/** 本地时区（浏览器/Node resolvedOptions；不可用时回退 Asia/Shanghai）。 */
export function detectLocalTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
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
    timezone: detectLocalTimezone(),
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

/** 显示格式化：ISO → 本地可读（含时区标识）。 */
export function formatIso(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    return new Intl.DateTimeFormat('zh-CN', {
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

/** 星期标签（0=周日 … 6=周六）。 */
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

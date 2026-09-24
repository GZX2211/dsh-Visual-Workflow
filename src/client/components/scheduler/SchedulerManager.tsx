// src/client/components/scheduler/SchedulerManager.tsx
//
// 定时任务管理弹层（容器/装配层）：装配任务数据面（hooks/useSchedulerTasks）与
// 左右两块纯表现组件（SchedulerTaskForm / SchedulerTaskList），并持有表单草稿等
// 界面状态、把结果翻译为 toast。
// 数据流：remote(EP_SCHEDULER_*) ↔ 后端；表单草稿本地编辑，保存后整任务落盘
// （configUpdate=immediate：无需等待次日，下一 tick 生效）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import type { ScheduledTask, ScheduledTaskView, TimeRangeConfig } from '../../../host/shared/types.js'
// 常用时区建议列表：共享协议常量的唯一本体（host/client 共用，禁止在本组件再维护一份）
import { SCHEDULER_TIMEZONE_SUGGESTIONS } from '../../../host/shared/protocol.js'
import type { RemoteFace } from '../../hooks/useRemote.js'
import { useSchedulerTasks } from '../../hooks/useSchedulerTasks.js'
import type { DateRangeValue } from '../date-picker/DateRangePicker.js'
import {
  createTaskDraft, detectLocalTimezone, localDateOnly, shiftDateOnly,
  taskFromView, validateTaskDraft,
} from '../../lib/scheduler-task.js'
import { SchedulerTaskForm } from './SchedulerTaskForm.js'
import { SchedulerTaskList } from './SchedulerTaskList.js'

export interface SchedulerManagerProps {
  copy: Dict
  remote: RemoteFace
  sessionId: string
  onClose(): void
  onToast(kind: 'info' | 'success' | 'error', text: string): void
}

export function SchedulerManager({ copy, remote, sessionId, onClose, onToast }: SchedulerManagerProps) {
  const tasks = useSchedulerTasks(remote)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ScheduledTask | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const loadedRef = useRef(false)
  // 最近一次的选中任务 id（供加载后判定沿用/回退，避免在 setState updater 内产生副作用）
  const activeTaskIdRef = useRef<string | null>(null)
  activeTaskIdRef.current = activeTaskId

  /** 加载完成后确定选中项：仍存在则沿用，否则回退首个任务。 */
  const selectAfterLoad = useCallback((list: ScheduledTaskView[]) => {
    const current = activeTaskIdRef.current
    if (current && list.some((item) => item.task.taskId === current)) return
    const first = list[0]
    if (!first) return
    setActiveTaskId(first.task.taskId)
    setDraft(taskFromView(first))
  }, [])

  const { load } = tasks
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const { views } = await load()
        selectAfterLoad(views)
      } catch (error) {
        onToast('error', String((error as Error)?.message ?? error))
      }
    })()
  }, [load, onToast, selectAfterLoad])

  const activeView = useMemo(
    () => tasks.views.find((item) => item.task.taskId === activeTaskId) ?? null,
    [tasks.views, activeTaskId],
  )

  const selectTask = useCallback((id: string): void => {
    setActiveTaskId(id)
    setConfirmDelete(false)
    setCalendarOpen(false)
    const view = tasks.views.find((item) => item.task.taskId === id)
    if (view) setDraft(taskFromView(view))
  }, [tasks.views])

  const newTask = useCallback((): void => {
    const draftTask = createTaskDraft(sessionId)
    setActiveTaskId(draftTask.taskId)
    setDraft(draftTask)
    setConfirmDelete(false)
    setCalendarOpen(false)
  }, [sessionId])

  const patch = useCallback((part: Partial<ScheduledTask>): void => {
    setDraft((current) => (current ? { ...current, ...part } : current))
  }, [])

  const patchWindow = useCallback((part: Partial<ScheduledTask['window']>): void => {
    setDraft((current) => (current ? { ...current, window: { ...current.window, ...part } } : current))
  }, [])

  const saveTask = useCallback(async (): Promise<void> => {
    if (!draft) return
    const validation = validateTaskDraft(draft)
    if (validation !== null) {
      // 校验返回词典键名（唯一本体在 lib/scheduler-task），此处按词典投影文案
      onToast('error', String(copy[validation as keyof Dict] ?? validation))
      return
    }
    try {
      const saved = await tasks.saveTask(draft)
      setActiveTaskId(saved.taskId)
      onToast('success', copy.schedulerSaved)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    }
  }, [copy, draft, onToast, tasks])

  const deleteTask = useCallback(async (): Promise<void> => {
    if (!activeTaskId) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    try {
      await tasks.deleteTask(activeTaskId)
      setActiveTaskId(null)
      setDraft(null)
      onToast('success', copy.schedulerDeleted)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    }
  }, [activeTaskId, confirmDelete, copy.schedulerDeleted, onToast, tasks])

  /** 星期切换（0=周日 … 6=周六）。 */
  const toggleDay = useCallback((day: number): void => {
    setDraft((current) => {
      if (!current) return current
      const days = current.window.daysOfWeek ?? []
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b)
      return { ...current, window: { ...current.window, daysOfWeek: next } }
    })
  }, [])

  const patchRange = useCallback((index: number, part: Partial<TimeRangeConfig>): void => {
    setDraft((current) => {
      if (!current) return current
      const ranges = current.window.timeRanges.map((range, i) => (i === index ? { ...range, ...part } : range))
      return { ...current, window: { ...current.window, timeRanges: ranges } }
    })
  }, [])

  const addRange = useCallback((): void => {
    setDraft((current) => (current
      ? { ...current, window: { ...current.window, timeRanges: [...current.window.timeRanges, { start: '09:00', end: '18:00' }] } }
      : current))
  }, [])

  const removeRange = useCallback((index: number): void => {
    setDraft((current) => (current
      ? { ...current, window: { ...current.window, timeRanges: current.window.timeRanges.filter((_, i) => i !== index) } }
      : current))
  }, [])

  const patchTimePoint = useCallback((index: number, value: string): void => {
    setDraft((current) => {
      if (!current) return current
      const points = [...(current.dailyTimeConfig?.timePoints ?? [])]
      points[index] = value
      const sorted = points.sort((a, b) => a.localeCompare(b))
      return { ...current, dailyTimeConfig: { timePoints: sorted } }
    })
  }, [])

  const addTimePoint = useCallback((): void => {
    setDraft((current) => (current
      ? { ...current, dailyTimeConfig: { timePoints: [...(current.dailyTimeConfig?.timePoints ?? []), '09:00'] } }
      : current))
  }, [])

  const removeTimePoint = useCallback((index: number): void => {
    setDraft((current) => {
      if (!current) return current
      const points = (current.dailyTimeConfig?.timePoints ?? []).filter((_, i) => i !== index)
      return { ...current, dailyTimeConfig: { timePoints: points } }
    })
  }, [])

  /** 日期不限开关：true = 忽略日期范围（仅 daysOfWeek + timeRanges）；关闭时补默认范围。 */
  const unbounded = draft?.window?.unbounded === true
  const toggleUnbounded = useCallback((): void => {
    setDraft((current) => {
      if (!current) return current
      const next = !(current.window.unbounded === true)
      const window = { ...current.window, unbounded: next }
      if (!next && !window.startDate && !window.endDate) {
        const today = localDateOnly()
        window.startDate = today
        window.endDate = shiftDateOnly(today, 30)
      }
      return { ...current, window }
    })
  }, [])

  const timezones = useMemo(() => {
    const list = [...SCHEDULER_TIMEZONE_SUGGESTIONS]
    const local = detectLocalTimezone()
    if (!list.includes(local)) list.unshift(local)
    return list
  }, [])

  const timezoneOptions = useMemo(() => timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>), [timezones])

  /** 日期范围（把空串视为"未定" → null，使日历能在"仅起点"状态下继续点选终点）。 */
  const dateRange: DateRangeValue = {
    start: draft?.window.startDate || null,
    end: draft?.window.endDate || null,
  }

  return (
    <div className="wf-combo-backdrop">
      <div className="wf-combo wf-sched" role="dialog" aria-modal="true">
        <div className="wf-combo__head">
          <h3>{copy.schedulerManager}</h3>
          <span className="wf-status">{copy.schedulerHint}</span>
          <button type="button" className="wf-btn wf-combo__close" onClick={onClose}>✕</button>
        </div>
        <div className="wf-combo__body">
          <SchedulerTaskForm
            copy={copy}
            draft={draft}
            templates={tasks.templates}
            timezoneOptions={timezoneOptions}
            unbounded={unbounded}
            calendarOpen={calendarOpen}
            dateRange={dateRange}
            activeView={activeView}
            busy={tasks.busy}
            confirmDelete={confirmDelete}
            onPatch={patch}
            onPatchWindow={patchWindow}
            onToggleUnbounded={toggleUnbounded}
            onToggleCalendar={() => setCalendarOpen((open) => !open)}
            onCloseCalendar={() => setCalendarOpen(false)}
            onSetDaysAll={() => patchWindow({ daysOfWeek: [] })}
            onToggleDay={toggleDay}
            onPatchRange={patchRange}
            onAddRange={addRange}
            onRemoveRange={removeRange}
            onPatchTimePoint={patchTimePoint}
            onAddTimePoint={addTimePoint}
            onRemoveTimePoint={removeTimePoint}
            onSave={() => { void saveTask() }}
            onDelete={() => { void deleteTask() }}
          />
          <SchedulerTaskList
            copy={copy}
            views={tasks.views}
            templates={tasks.templates}
            activeTaskId={activeTaskId}
            draftEnabled={draft?.enabled === true}
            hasDraft={draft !== null}
            busy={tasks.busy}
            onSelect={selectTask}
            onNew={newTask}
            onToggleEnabled={(enabled) => patch({ enabled })}
          />
        </div>
      </div>
    </div>
  )
}

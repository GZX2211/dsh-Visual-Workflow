// src/client/components/scheduler/SchedulerManager.tsx
//
// 定时任务管理弹层（新功能本阶段；样式对齐组合管理 wf-combo 体系）：
//   - 左侧：任务属性编辑栏（顶部工作流选择器 + 会话策略 + 时区 + 执行窗口
//     （日期范围/星期/时间段）+ 触发策略（定点时刻/固定间隔）+ 运行时策略说明）；
//   - 右侧：任务列表（新建/选中/删除）+ 运行态（状态/下次触发/最近结果）。
// 数据流：remote(EP_SCHEDULER_*) ↔ 后端；表单草稿本地编辑，保存后整任务落盘
// （configUpdate=immediate：无需等待次日，下一 tick 生效）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import { EP } from '../../lib/remote.js'
import type { RemoteFace } from '../../hooks/useRemote.js'
import type { ScheduledTask, ScheduledTaskView, TimeRangeConfig } from '../../../host/shared/types.js'
import { DateRangePicker, type DateRangeValue } from '../date-picker/DateRangePicker.js'
import {
  createTaskDraft, detectLocalTimezone, formatIso, newTaskId, taskFromView, validateTaskDraft, WEEKDAY_LABELS,
} from './scheduler-utils.js'

/** 时区建议列表（UI 下拉用；权威校验在 host）。 */
const TIMEZONE_SUGGESTIONS = [
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Seoul', 'Asia/Taipei',
  'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney', 'UTC',
]

interface TemplateItem { id: string; name?: string; description?: string; mode?: string }

export interface SchedulerManagerProps {
  copy: Dict
  remote: RemoteFace
  sessionId: string
  onClose(): void
  onToast(kind: 'info' | 'success' | 'error', text: string): void
}

/** 表单行（标签 + 子元素）。 */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="wf-sched-field">
      <span className="wf-sched-field__label">{label}</span>
      {children}
      {hint ? <span className="wf-sched-field__hint">{hint}</span> : null}
    </label>
  )
}

export function SchedulerManager({ copy, remote, sessionId, onClose, onToast }: SchedulerManagerProps) {
  const [views, setViews] = useState<ScheduledTaskView[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ScheduledTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const loadedRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [viewsData, templatesData] = await Promise.all([
        remote.call(EP.EP_SCHEDULER_TASKS).catch(() => []),
        remote.call(EP.EP_LIST_FLOW_TEMPLATES).catch(() => []),
      ]) as [unknown, unknown]
      const items = Array.isArray(viewsData) ? viewsData as ScheduledTaskView[] : []
      const tpls = (Array.isArray(templatesData) ? templatesData : [])
        .filter((item) => (item as TemplateItem).mode === 'mode1') as TemplateItem[]
      setViews(items)
      setTemplates(tpls)
      setActiveTaskId((current) => {
        if (current && items.some((item) => item.task.taskId === current)) return current
        const first = items[0]
        if (first) {
          setDraft(taskFromView(first))
          return first.task.taskId
        }
        return current
      })
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    }
  }, [remote, onToast])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void load()
  }, [load])

  const activeView = useMemo(
    () => views.find((item) => item.task.taskId === activeTaskId) ?? null,
    [views, activeTaskId],
  )

  /** 任务列表项展示元信息（模板名 + 下次触发）。 */
  const itemMeta = useCallback((view: ScheduledTaskView): string => {
    const tpl = templates.find((item) => item.id === view.task.workflowTemplateId)
    const parts = [tpl?.name ?? view.task.workflowTemplateId]
    if (view.runtime.nextTriggerAt) parts.push(`${copy.schedulerNextRun} ${formatIso(view.runtime.nextTriggerAt)}`)
    return parts.join(' · ')
  }, [templates, copy.schedulerNextRun])

  const selectTask = useCallback((id: string): void => {
    setActiveTaskId(id)
    setConfirmDelete(false)
    setCalendarOpen(false)
    const view = views.find((item) => item.task.taskId === id)
    if (view) setDraft(taskFromView(view))
  }, [views])

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
      onToast('error', String(copy[validation as keyof Dict] ?? validation))
      return
    }
    setBusy(true)
    try {
      const saved = await remote.call(EP.EP_SCHEDULER_TASK_PUT, { task: draft }) as ScheduledTask
      await load()
      setActiveTaskId(saved.taskId)
      onToast('success', copy.schedulerSaved)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [copy, draft, load, onToast, remote])

  const deleteTask = useCallback(async (): Promise<void> => {
    if (!activeTaskId) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    setBusy(true)
    try {
      await remote.call(EP.EP_SCHEDULER_TASK_DELETE, { taskId: activeTaskId })
      setActiveTaskId(null)
      setDraft(null)
      await load()
      onToast('success', copy.schedulerDeleted)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [activeTaskId, confirmDelete, copy.schedulerDeleted, load, onToast, remote])

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

  const timezones = useMemo(() => {
    const list = [...TIMEZONE_SUGGESTIONS]
    const local = detectLocalTimezone()
    if (!list.includes(local)) list.unshift(local)
    return list
  }, [])

  const tzOptions = useMemo(() => timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>), [timezones])

  const dateRangeValue: DateRangeValue = {
    start: draft?.window?.startDate ?? null,
    end: draft?.window?.endDate ?? null,
  }
  const statusText = (key: string): string => String((copy.schedulerStatus as Record<string, string>)[key] ?? key ?? '')
  const resultText = (key: string | null): string => key
    ? String((copy.schedulerLastResult as Record<string, string>)[key] ?? key)
    : '—'

  return (
    <div className="wf-combo-backdrop">
      <div className="wf-combo wf-sched" role="dialog" aria-modal="true">
        <div className="wf-combo__head">
          <h3>{copy.schedulerManager}</h3>
          <span className="wf-status">{copy.schedulerHint}</span>
          <button type="button" className="wf-btn wf-combo__close" onClick={onClose}>✕</button>
        </div>
        <div className="wf-combo__body">
          {/* 左侧：任务属性编辑栏 */}
          <div className="wf-sched__form">
            <div className="wf-sched__form-scroll">
              {/* 顶部：工作流选择器（模板列表，非实例） */}
              <Field label={copy.schedulerTemplate}>
                <select
                  value={draft?.workflowTemplateId ?? ''}
                  onChange={(event) => patch({ workflowTemplateId: event.target.value })}
                  disabled={!draft}
                >
                  <option value="">{templates.length === 0 ? copy.schedulerTemplateEmpty : copy.schedulerTemplatePlaceholder}</option>
                  {templates.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
                </select>
              </Field>

              <Field label={copy.schedulerName}>
                <input
                  value={draft?.name ?? ''}
                  placeholder={copy.schedulerName}
                  onChange={(event) => patch({ name: event.target.value })}
                  disabled={!draft}
                />
              </Field>

              <Field label={copy.schedulerSessionMode} hint={draft?.sessionMode === 'current-session' ? copy.schedulerSessionCurrentHint : copy.schedulerSessionNewHint}>
                <div className="wf-sched-radios">
                  <label className="wf-sched-radio">
                    <input type="radio" name="sched-session" checked={draft?.sessionMode === 'new-session'} disabled={!draft}
                      onChange={() => patch({ sessionMode: 'new-session' })} />
                    <span>{copy.schedulerSessionNew}</span>
                  </label>
                  <label className="wf-sched-radio">
                    <input type="radio" name="sched-session" checked={draft?.sessionMode === 'current-session'} disabled={!draft}
                      onChange={() => patch({ sessionMode: 'current-session' })} />
                    <span>{copy.schedulerSessionCurrent}</span>
                  </label>
                </div>
              </Field>

              <Field label={copy.schedulerTimezone}>
                <select value={draft?.timezone ?? ''} onChange={(event) => patch({ timezone: event.target.value })} disabled={!draft}>
                  {tzOptions}
                </select>
              </Field>

              <section className="wf-sched-group">
                <h5>{copy.schedulerWindow}</h5>
                <span className="wf-sched-field__hint">{copy.schedulerWindowHint}</span>

                <Field label={`${copy.schedulerWindowDates}（${copy.schedulerWindowDateStart} ~ ${copy.schedulerWindowDateEnd}）`}>
                  <div className="wf-sched-dates">
                    <input type="text" readOnly
                      value={draft ? `${draft.window.startDate} ~ ${draft.window.endDate}` : ''}
                      placeholder={`${copy.schedulerWindowDateStart} ~ ${copy.schedulerWindowDateEnd}`} />
                    <button type="button" className="wf-btn" onClick={() => setCalendarOpen((open) => !open)} disabled={!draft}>
                      {calendarOpen ? '▾' : '📅'}
                    </button>
                  </div>
                </Field>

                {calendarOpen && draft ? (
                  <div className="wf-cal-card">
                    <DateRangePicker
                      value={dateRangeValue}
                      onChange={(value) => patchWindow({
                        startDate: value.start ?? draft.window.startDate,
                        endDate: value.end ?? draft.window.startDate,
                      })}
                    />
                    <div className="wf-cal-card__foot">
                      <button type="button" className="wf-btn is-primary" onClick={() => setCalendarOpen(false)}>{copy.inspectorSave}</button>
                    </div>
                  </div>
                ) : null}

                <Field label={copy.schedulerWindowDays}>
                  <div className="wf-sched-days">
                    {WEEKDAY_LABELS.map((label, day) => (
                      <button key={label} type="button"
                        className={`wf-sched-day${(draft?.window.daysOfWeek ?? []).includes(day) ? ' is-active' : ''}`}
                        onClick={() => toggleDay(day)} disabled={!draft}>
                        {label}
                      </button>
                    ))}
                    <button type="button" className="wf-sched-day is-all"
                      onClick={() => patchWindow({ daysOfWeek: [] })} disabled={!draft}>
                      {copy.schedulerWindowDaysAll}
                    </button>
                  </div>
                </Field>

                <Field label={copy.schedulerWindowRanges} hint={copy.schedulerRangeCrossHint}>
                  <div className="wf-sched-ranges">
                    {(draft?.window.timeRanges ?? []).map((range, index) => (
                      /* eslint-disable-next-line react/no-array-index-key -- 行级编辑按索引定位 */
                      <div key={`${index}:${range.start}-${range.end}`} className="wf-sched-range-row">
                        <input type="time" value={range.start} onChange={(event) => patchRange(index, { start: event.target.value })} />
                        <span>~</span>
                        <input type="time" value={range.end} onChange={(event) => patchRange(index, { end: event.target.value })} />
                        <button type="button" className="wf-btn wf-iconbtn" title={copy.inspectorDelete} onClick={() => removeRange(index)}>×</button>
                      </div>
                    ))}
                    <button type="button" className="wf-btn is-ghost" onClick={addRange} disabled={!draft}>{`＋ ${copy.schedulerRangeAdd}`}</button>
                  </div>
                </Field>
              </section>

              <section className="wf-sched-group">
                <h5>{copy.schedulerTrigger}</h5>
                <div className="wf-sched-radios">
                  <label className="wf-sched-radio">
                    <input type="radio" name="sched-trigger" checked={draft?.triggerMode === 'daily_time'} disabled={!draft}
                      onChange={() => patch({ triggerMode: 'daily_time' })} />
                    <span>{copy.schedulerTriggerDaily}</span>
                  </label>
                  <label className="wf-sched-radio">
                    <input type="radio" name="sched-trigger" checked={draft?.triggerMode === 'interval'} disabled={!draft}
                      onChange={() => patch({ triggerMode: 'interval' })} />
                    <span>{copy.schedulerTriggerInterval}</span>
                  </label>
                </div>

                {draft?.triggerMode === 'daily_time' ? (
                  <Field label={copy.schedulerTimePoints}>
                    <div className="wf-sched-ranges">
                      {(draft.dailyTimeConfig?.timePoints ?? []).map((point, index) => (
                        /* eslint-disable-next-line react/no-array-index-key -- 行级编辑按索引定位 */
                        <div key={`${index}:${point}`} className="wf-sched-range-row">
                          <input type="time" value={point} onChange={(event) => patchTimePoint(index, event.target.value)} />
                          <button type="button" className="wf-btn wf-iconbtn" title={copy.inspectorDelete} onClick={() => removeTimePoint(index)}>×</button>
                        </div>
                      ))}
                      <button type="button" className="wf-btn is-ghost" onClick={addTimePoint} disabled={!draft}>{`＋ ${copy.schedulerTimePointAdd}`}</button>
                    </div>
                  </Field>
                ) : (
                  <div className="wf-sched-row2">
                    <Field label={copy.schedulerInterval}>
                      <input type="number" min={1} max={1439} step={1}
                        value={draft?.intervalConfig?.intervalMinutes ?? 120}
                        onChange={(event) => patch({ intervalConfig: { ...(draft?.intervalConfig ?? { intervalMinutes: 120, startFrom: '09:00' }), intervalMinutes: Number(event.target.value) || 120 } })}
                        disabled={!draft} />
                    </Field>
                    <Field label={copy.schedulerIntervalStartFrom}>
                      <input type="time" value={draft?.intervalConfig?.startFrom ?? '09:00'}
                        onChange={(event) => patch({ intervalConfig: { ...(draft?.intervalConfig ?? { intervalMinutes: 120, startFrom: '09:00' }), startFrom: event.target.value } })}
                        disabled={!draft} />
                    </Field>
                  </div>
                )}
                <span className="wf-sched-field__hint">{copy.schedulerIntervalHint}</span>
              </section>

              <section className="wf-sched-group">
                <h5>{copy.schedulerPolicy}</h5>
                <span className="wf-sched-field__hint">{copy.schedulerPolicyText}</span>
              </section>

              {/* 运行态摘要（只读） */}
              <section className="wf-sched-group">
                <h5>{copy.schedulerCurrentRun}</h5>
                <div className="wf-sched-status-grid">
                  <span className="wf-sched-status-cell">
                    <span className={`wf-sched-dot is-${activeView?.runtime.status ?? 'idle'}`} />
                    {statusText(activeView?.runtime.status ?? 'idle')}
                  </span>
                  <span className="wf-sched-status-cell">{`${copy.schedulerNextRun}：${formatIso(activeView?.runtime.nextTriggerAt ?? null)}`}</span>
                  <span className="wf-sched-status-cell">{`${copy.schedulerLastOutcome}：${resultText(activeView?.runtime.lastResult ?? null)}`}</span>
                  {activeView?.runtime.lastError ? <span className="wf-sched-status-cell is-error">{activeView.runtime.lastError}</span> : null}
                </div>
              </section>
            </div>
            <div className="wf-sched__form-foot">
              <button type="button" className="wf-btn is-danger" onClick={() => { void deleteTask() }} disabled={!activeTaskId || busy}>
                {confirmDelete ? copy.schedulerDeleteConfirm : copy.schedulerDelete}
              </button>
              <button type="button" className="wf-btn is-primary" onClick={() => { void saveTask() }} disabled={!draft || busy}>{copy.inspectorSave}</button>
            </div>
          </div>

          {/* 右侧：任务列表（复用组合管理列表样式） */}
          <div className="wf-combo__side">
            <div className="wf-combo__side-head">
              <h4>{copy.scheduler}</h4>
              <button type="button" className="wf-btn" onClick={newTask} disabled={busy}>{`＋ ${copy.schedulerNew}`}</button>
            </div>
            <div className="wf-combo__side-list">
              {views.length === 0
                ? <div className="wf-hint">{copy.schedulerEmpty}</div>
                : views.map((view) => (
                    <button
                      key={view.task.taskId}
                      type="button"
                      className={`wf-combo-item${view.task.taskId === activeTaskId ? ' is-active' : ''}`}
                      onClick={() => selectTask(view.task.taskId)}
                    >
                      <span className="wf-combo-item__label">{view.task.name}</span>
                      <span className="wf-sched-list-meta">
                        <span className={`wf-sched-dot is-${view.runtime.status}`} title={statusText(view.runtime.status)} />
                        {itemMeta(view)}
                      </span>
                    </button>
                  ))}
            </div>
            <div className="wf-combo-hint">
              {copy.schedulerDeleteHint}
            </div>
            <label className="wf-sched-enabled">
              <input type="checkbox" checked={draft?.enabled === true} disabled={!draft}
                onChange={(event) => patch({ enabled: event.target.checked })} />
              <span>{copy.schedulerEnabled}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

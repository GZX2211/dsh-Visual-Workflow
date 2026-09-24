// src/client/components/scheduler/SchedulerTaskForm.tsx
//
// 定时任务属性编辑栏（左侧，纯表现层）：
//   顶部工作流选择器 + 会话策略 + 时区 + 执行窗口（日期范围/星期/时间段）
//   + 触发策略（定点时刻/固定间隔）+ 运行时策略说明 + 运行态摘要（只读）。
// 表单草稿与所有写回回调由容器注入（本组件不发起请求、不持有业务事实）。

import type { ScheduledTask, ScheduledTaskView, TimeRangeConfig } from '../../../host/shared/types.js'
import type { Dict } from '../../i18n.js'
import type { TemplateOption } from '../../hooks/useSchedulerTasks.js'
import { schedulerResultLabelOf, schedulerStatusLabelOf } from '../../lib/status-label.js'
import { formatIso } from '../../lib/scheduler-task.js'
import { DateRangePicker, type DateRangeValue } from '../date-picker/DateRangePicker.js'
import { TimeInput } from '../time-input/TimeInput.js'
import { Field } from '../panels/form-field.js'

export interface SchedulerTaskFormProps {
  copy: Dict
  draft: ScheduledTask | null
  templates: TemplateOption[]
  /** 时区下拉选项（容器按建议清单 + 本机时区生成）。 */
  timezoneOptions: React.ReactNode
  unbounded: boolean
  calendarOpen: boolean
  dateRange: DateRangeValue
  activeView: ScheduledTaskView | null
  busy: boolean
  confirmDelete: boolean
  onPatch(part: Partial<ScheduledTask>): void
  onPatchWindow(part: Partial<ScheduledTask['window']>): void
  onToggleUnbounded(): void
  onToggleCalendar(): void
  onCloseCalendar(): void
  onSetDaysAll(): void
  onToggleDay(day: number): void
  onPatchRange(index: number, part: Partial<TimeRangeConfig>): void
  onAddRange(): void
  onRemoveRange(index: number): void
  onPatchTimePoint(index: number, value: string): void
  onAddTimePoint(): void
  onRemoveTimePoint(index: number): void
  onSave(): void
  onDelete(): void
}

export function SchedulerTaskForm(props: SchedulerTaskFormProps) {
  const {
    copy, draft, templates, timezoneOptions, unbounded, calendarOpen, dateRange, activeView, busy, confirmDelete,
    onPatch, onPatchWindow, onToggleUnbounded, onToggleCalendar, onCloseCalendar, onSetDaysAll, onToggleDay,
    onPatchRange, onAddRange, onRemoveRange, onPatchTimePoint, onAddTimePoint, onRemoveTimePoint, onSave, onDelete,
  } = props

  return (
    <div className="wf-sched__form">
      <div className="wf-sched__form-scroll">
        {/* 顶部：工作流选择器（模板列表，非实例） */}
        <Field variant="scheduler" label={copy.schedulerTemplate}>
          <select
            value={draft?.workflowTemplateId ?? ''}
            onChange={(event) => onPatch({ workflowTemplateId: event.target.value })}
            disabled={!draft}
          >
            <option value="">{templates.length === 0 ? copy.schedulerTemplateEmpty : copy.schedulerTemplatePlaceholder}</option>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
          </select>
        </Field>

        <Field variant="scheduler" label={copy.schedulerName}>
          <input
            value={draft?.name ?? ''}
            placeholder={copy.schedulerName}
            onChange={(event) => onPatch({ name: event.target.value })}
            disabled={!draft}
          />
        </Field>

        <Field
          variant="scheduler"
          label={copy.schedulerSessionMode}
          hint={draft?.sessionMode === 'current-session' ? copy.schedulerSessionCurrentHint : copy.schedulerSessionNewHint}
        >
          <div className="wf-sched-radios">
            <label className="wf-sched-radio">
              <input type="radio" name="sched-session" checked={draft?.sessionMode === 'new-session'} disabled={!draft}
                onChange={() => onPatch({ sessionMode: 'new-session' })} />
              <span>{copy.schedulerSessionNew}</span>
            </label>
            <label className="wf-sched-radio">
              <input type="radio" name="sched-session" checked={draft?.sessionMode === 'current-session'} disabled={!draft}
                onChange={() => onPatch({ sessionMode: 'current-session' })} />
              <span>{copy.schedulerSessionCurrent}</span>
            </label>
          </div>
          {/* 选择工作区：仅「新会话」模式显示（新会话 cwd = 沙箱工作区根；保存时校验存在） */}
          {draft?.sessionMode === 'new-session'
            ? (
                <input
                  type="text"
                  className="wf-sched-workspace"
                  value={String(draft.workspacePath ?? '')}
                  placeholder={copy.workspacePlaceholder}
                  title={copy.workspaceHint}
                  onChange={(event) => onPatch({ workspacePath: event.target.value.trim() || undefined })}
                  disabled={!draft}
                />
              )
            : null}
        </Field>

        <Field variant="scheduler" label={copy.schedulerTimezone}>
          <select value={draft?.timezone ?? ''} onChange={(event) => onPatch({ timezone: event.target.value })} disabled={!draft}>
            {timezoneOptions}
          </select>
        </Field>

        <section className="wf-sched-group">
          <h5>{copy.schedulerWindow}</h5>
          <span className="wf-sched-field__hint">{copy.schedulerWindowHint}</span>

          <Field variant="scheduler" label={`${copy.schedulerWindowDates}（${copy.schedulerWindowDateStart} ~ ${copy.schedulerWindowDateEnd}）`}>
            <div className="wf-sched-dates">
              <input type="text" readOnly
                value={draft ? (unbounded ? copy.schedulerWindowUnbounded : `${draft.window.startDate || '…'} ~ ${draft.window.endDate || '…'}`) : ''}
                placeholder={copy.schedulerWindowDaysAll} />
              {/* 日期不限：左右月可独立切换、右月恒大于左月；点击后忽略日期范围 */}
              <button type="button" className={`wf-btn${unbounded ? ' is-primary' : ''}`}
                title={copy.schedulerWindowUnbounded}
                onClick={onToggleUnbounded} disabled={!draft}>
                {copy.schedulerWindowUnbounded}
              </button>
              <button type="button" className="wf-btn" onClick={onToggleCalendar} disabled={!draft || unbounded}>
                {calendarOpen ? '▾' : '📅'}
              </button>
            </div>
          </Field>

          {calendarOpen && draft && !unbounded ? (
            <div className="wf-cal-card">
              <DateRangePicker
                value={dateRange}
                onChange={(value) => onPatchWindow({
                  startDate: value.start ?? '',
                  endDate: value.end ?? '',
                })}
              />
              <div className="wf-cal-card__foot">
                <button type="button" className="wf-btn is-primary" onClick={onCloseCalendar}>{copy.inspectorSave}</button>
              </div>
            </div>
          ) : null}

          <Field variant="scheduler" label={copy.schedulerWindowDays}>
            <div className="wf-sched-days">
              {copy.schedulerWeekdays.map((label, day) => (
                <button key={label} type="button"
                  className={`wf-sched-day${(draft?.window.daysOfWeek ?? []).includes(day) ? ' is-active' : ''}`}
                  onClick={() => onToggleDay(day)} disabled={!draft}>
                  {label}
                </button>
              ))}
              {/* 「每天」= daysOfWeek 为空；与具体星期互斥（选了任一星期即取消「每天」） */}
              <button type="button"
                className={`wf-sched-day is-all${((draft?.window.daysOfWeek ?? []).length === 0) ? ' is-active' : ''}`}
                onClick={onSetDaysAll} disabled={!draft}>
                {copy.schedulerWindowDaysAll}
              </button>
            </div>
          </Field>

          <Field variant="scheduler" label={copy.schedulerWindowRanges} hint={copy.schedulerRangeCrossHint}>
            <div className="wf-sched-ranges">
              {(draft?.window.timeRanges ?? []).map((range, index) => (
                /* eslint-disable-next-line react/no-array-index-key -- 行级编辑按索引定位 */
                <div key={`${index}:${range.start}-${range.end}`} className="wf-sched-range-row">
                  <TimeInput value={range.start} onChange={(value) => onPatchRange(index, { start: value })} ariaLabel={copy.schedulerRangeStart} />
                  <span>~</span>
                  <TimeInput value={range.end} onChange={(value) => onPatchRange(index, { end: value })} ariaLabel={copy.schedulerRangeEnd} />
                  <button type="button" className="wf-btn wf-iconbtn" title={copy.inspectorDelete} onClick={() => onRemoveRange(index)}>×</button>
                </div>
              ))}
              <button type="button" className="wf-btn is-ghost" onClick={onAddRange} disabled={!draft}>{`＋ ${copy.schedulerRangeAdd}`}</button>
            </div>
          </Field>
        </section>

        <section className="wf-sched-group">
          <h5>{copy.schedulerTrigger}</h5>
          <div className="wf-sched-radios">
            <label className="wf-sched-radio">
              <input type="radio" name="sched-trigger" checked={draft?.triggerMode === 'daily_time'} disabled={!draft}
                onChange={() => onPatch({ triggerMode: 'daily_time' })} />
              <span>{copy.schedulerTriggerDaily}</span>
            </label>
            <label className="wf-sched-radio">
              <input type="radio" name="sched-trigger" checked={draft?.triggerMode === 'interval'} disabled={!draft}
                onChange={() => onPatch({ triggerMode: 'interval' })} />
              <span>{copy.schedulerTriggerInterval}</span>
            </label>
          </div>

          {draft?.triggerMode === 'daily_time' ? (
            <Field variant="scheduler" label={copy.schedulerTimePoints}>
              <div className="wf-sched-ranges">
                {(draft.dailyTimeConfig?.timePoints ?? []).map((point, index) => (
                  /* eslint-disable-next-line react/no-array-index-key -- 行级编辑按索引定位 */
                  <div key={`${index}:${point}`} className="wf-sched-range-row">
                    <TimeInput value={point} onChange={(value) => onPatchTimePoint(index, value)} ariaLabel={copy.schedulerTimePoints} />
                    <button type="button" className="wf-btn wf-iconbtn" title={copy.inspectorDelete} onClick={() => onRemoveTimePoint(index)}>×</button>
                  </div>
                ))}
                <button type="button" className="wf-btn is-ghost" onClick={onAddTimePoint} disabled={!draft}>{`＋ ${copy.schedulerTimePointAdd}`}</button>
              </div>
            </Field>
          ) : (
            <div className="wf-sched-row2">
              <Field variant="scheduler" label={copy.schedulerInterval}>
                <input type="number" min={1} max={1439} step={1}
                  value={draft?.intervalConfig?.intervalMinutes ?? 120}
                  onChange={(event) => onPatch({ intervalConfig: { ...(draft?.intervalConfig ?? { intervalMinutes: 120, startFrom: '09:00' }), intervalMinutes: Number(event.target.value) || 120 } })}
                  disabled={!draft} />
              </Field>
              <Field variant="scheduler" label={copy.schedulerIntervalStartFrom}>
                <TimeInput value={draft?.intervalConfig?.startFrom ?? '09:00'}
                  onChange={(value) => onPatch({ intervalConfig: { ...(draft?.intervalConfig ?? { intervalMinutes: 120, startFrom: '09:00' }), startFrom: value } })}
                  ariaLabel={copy.schedulerIntervalStartFrom} />
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
              {schedulerStatusLabelOf(copy, activeView?.runtime.status ?? 'idle')}
            </span>
            <span className="wf-sched-status-cell">{`${copy.schedulerNextRun}：${formatIso(activeView?.runtime.nextTriggerAt ?? null)}`}</span>
            <span className="wf-sched-status-cell">{`${copy.schedulerLastOutcome}：${schedulerResultLabelOf(copy, activeView?.runtime.lastResult ?? null)}`}</span>
            {activeView?.runtime.lastError ? <span className="wf-sched-status-cell is-error">{activeView.runtime.lastError}</span> : null}
          </div>
        </section>
      </div>
      <div className="wf-sched__form-foot">
        <button type="button" className="wf-btn is-danger" onClick={onDelete} disabled={!draft || busy}>
          {confirmDelete ? copy.schedulerDeleteConfirm : copy.schedulerDelete}
        </button>
        <button type="button" className="wf-btn is-primary" onClick={onSave} disabled={!draft || busy}>{copy.inspectorSave}</button>
      </div>
    </div>
  )
}

// src/client/components/scheduler/SchedulerTaskList.tsx
//
// 定时任务列表（右侧，纯表现层）：任务项（模板名 + 运行态点 + 下次触发）、
// 新建入口、删除影响说明与「启用」开关。

import type { ScheduledTaskView } from '../../../host/shared/types.js'
import type { Dict } from '../../i18n.js'
import type { TemplateOption } from '../../hooks/useSchedulerTasks.js'
import { schedulerStatusLabelOf } from '../../lib/status-label.js'
import { formatIso } from '../../lib/scheduler-task.js'

export interface SchedulerTaskListProps {
  copy: Dict
  views: ScheduledTaskView[]
  templates: TemplateOption[]
  activeTaskId: string | null
  /** 当前草稿的启用状态（无草稿时开关禁用）。 */
  draftEnabled: boolean
  hasDraft: boolean
  busy: boolean
  onSelect(id: string): void
  onNew(): void
  onToggleEnabled(enabled: boolean): void
}

export function SchedulerTaskList(props: SchedulerTaskListProps) {
  const { copy, views, templates, activeTaskId, draftEnabled, hasDraft, busy, onSelect, onNew, onToggleEnabled } = props

  /** 任务列表项展示元信息（模板名 + 下次触发）。 */
  const itemMeta = (view: ScheduledTaskView): string => {
    const tpl = templates.find((item) => item.id === view.task.workflowTemplateId)
    const parts = [tpl?.name ?? view.task.workflowTemplateId]
    if (view.runtime.nextTriggerAt) parts.push(`${copy.schedulerNextRun} ${formatIso(view.runtime.nextTriggerAt)}`)
    return parts.join(' · ')
  }

  return (
    <div className="wf-combo__side">
      <div className="wf-combo__side-head">
        <h4>{copy.scheduler}</h4>
        <button type="button" className="wf-btn" onClick={onNew} disabled={busy}>{`＋ ${copy.schedulerNew}`}</button>
      </div>
      <div className="wf-combo__side-list">
        {views.length === 0
          ? <div className="wf-hint">{copy.schedulerEmpty}</div>
          : views.map((view) => (
              <button
                key={view.task.taskId}
                type="button"
                className={`wf-combo-item${view.task.taskId === activeTaskId ? ' is-active' : ''}`}
                onClick={() => onSelect(view.task.taskId)}
              >
                <span className="wf-combo-item__label">{view.task.name}</span>
                <span className="wf-sched-list-meta">
                  <span className={`wf-sched-dot is-${view.runtime.status}`} title={schedulerStatusLabelOf(copy, view.runtime.status)} />
                  {itemMeta(view)}
                </span>
              </button>
            ))}
      </div>
      <div className="wf-combo-hint">
        {copy.schedulerDeleteHint}
      </div>
      <label className="wf-sched-enabled">
        <input type="checkbox" checked={draftEnabled} disabled={!hasDraft}
          onChange={(event) => onToggleEnabled(event.target.checked)} />
        <span>{copy.schedulerEnabled}</span>
      </label>
    </div>
  )
}

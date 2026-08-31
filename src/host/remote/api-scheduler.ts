// src/host/remote/api-scheduler.ts
//
// GUI API 定时任务端点（VisualWorkflowApiScheduler extends Catalog；继承链最后一层
// 之前插入）：任务列表（含运行态合并）/ 保存（校验+规范化）/ 删除（解绑运行时）。
// 单一职责：只做参数校验与存储编排，调度决策见 scheduler/engine.ts。

import { httpError } from './http.js'
import { VisualWorkflowApiRuns } from './api-runs.js'
import { normalizeScheduledTask, validateScheduledTask } from '../scheduler/planner.js'
import type { ScheduledTask } from '../shared/types.js'

/**
 * GUI API 定时任务端点（挂在继承链末端：Base ← Workflows ← Templates ← Ecosystem ←
 * Catalog ← Runs ← Scheduler ← 最终类；与既有继承链零破坏）。
 */
export class VisualWorkflowApiScheduler extends VisualWorkflowApiRuns {
  /** 定时任务列表（任务 + 引擎运行态视图）。 */
  async schedulerTasks(): Promise<unknown> {
    const scheduler = this.host.scheduler
    if (!scheduler) throw httpError(501, '定时任务引擎不可用')
    return scheduler.listViews()
  }

  /**
   * 保存定时任务（新建/更新统一）：
   *   - id 须为 task- 前缀（新建由客户端生成，保存后回传归一化结果）；
   *   - 字段校验（validateScheduledTask，中文错误消息）后规范化落盘；
   *   - configUpdate=immediate：保存后无需等待次日，下一 tick 即按新配置决策。
   */
  async schedulerTaskPut(args: { task?: unknown }): Promise<unknown> {
    const raw = args?.task as Partial<ScheduledTask> | null | undefined
    if (!raw || typeof raw !== 'object') throw httpError(400, 'requires task')
    const id = String(raw.taskId ?? '')
    if (!id || !id.startsWith('task-')) throw httpError(400, '定时任务 id 必须以 task- 前缀')
    const now = new Date().toISOString()
    const task: ScheduledTask = {
      ...(raw as ScheduledTask),
      taskId: id,
      name: String(raw.name ?? ''),
      workflowTemplateId: String(raw.workflowTemplateId ?? ''),
      sessionMode: raw.sessionMode === 'current-session' ? 'current-session' : 'new-session',
      ownerSessionId: String(raw.ownerSessionId ?? ''),
      enabled: raw.enabled !== false,
      timezone: String(raw.timezone ?? ''),
      window: {
        startDate: String(raw.window?.startDate ?? ''),
        endDate: String(raw.window?.endDate ?? ''),
        daysOfWeek: Array.isArray(raw.window?.daysOfWeek) ? raw.window.daysOfWeek.map(Number) : [],
        timeRanges: Array.isArray(raw.window?.timeRanges)
          ? raw.window.timeRanges.map((range) => ({
              start: String(range?.start ?? ''),
              end: String(range?.end ?? ''),
            }))
          : [],
        unbounded: raw.window?.unbounded === true,
      },
      triggerMode: raw.triggerMode === 'interval' ? 'interval' : 'daily_time',
      dailyTimeConfig: raw.dailyTimeConfig
        ? { timePoints: (Array.isArray(raw.dailyTimeConfig.timePoints) ? raw.dailyTimeConfig.timePoints : []).map(String) }
        : null,
      intervalConfig: raw.intervalConfig
        ? { intervalMinutes: Number(raw.intervalConfig.intervalMinutes), startFrom: String(raw.intervalConfig.startFrom ?? '') }
        : null,
      runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
      createdAt: String(raw.createdAt ?? now),
      updatedAt: now,
    }
    const validation = validateScheduledTask(task)
    if (validation !== null) throw httpError(400, validation)
    const store = this.host.schedulerTaskStore
    if (!store) throw httpError(501, '定时任务存储不可用')
    const saved = await store.save(normalizeScheduledTask(task))
    return saved
  }

  /** 删除定时任务（运行中 run 不受影响，仅解绑引擎引用）。 */
  async schedulerTaskDelete(args: { taskId?: unknown }): Promise<unknown> {
    const taskId = String(args?.taskId ?? '')
    if (!taskId) throw httpError(400, 'requires taskId')
    const store = this.host.schedulerTaskStore
    if (!store) throw httpError(501, '定时任务存储不可用')
    const deleted = await store.delete(taskId)
    if (deleted) await this.host.scheduler?.forgetTask(taskId)
    return { deleted }
  }
}

// src/client/hooks/useSchedulerTasks.ts
//
// 定时任务数据面（网络访问与远端状态归此 hook，组件不感知网络）：
// 任务视图（含运行态）+ 可调度的工作流模板列表加载、任务保存与删除。
// 失败抛出（调用方 toast）；表单草稿、日历开关等界面态留在组件。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduledTask, ScheduledTaskView } from '../../host/shared/types.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

/** 模板下拉条目（仅需要 id/name；mode 用于筛选可调度模板）。 */
export interface TemplateOption { id: string; name?: string; description?: string; mode?: string }

export interface SchedulerTasksFace {
  views: ScheduledTaskView[]
  templates: TemplateOption[]
  busy: boolean
  /** 加载任务与模板；返回本次结果供调用方初始化选择（不写组件状态）。 */
  load(): Promise<{ views: ScheduledTaskView[]; templates: TemplateOption[] }>
  saveTask(task: ScheduledTask): Promise<ScheduledTask>
  deleteTask(taskId: string): Promise<void>
}

export function useSchedulerTasks(remote: RemoteFace): SchedulerTasksFace {
  const [views, setViews] = useState<ScheduledTaskView[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [busy, setBusy] = useState(false)
  // 卸载后不得再写状态（异步返回的归属校验）：弹层关闭即卸载，而加载/保存可能仍在飞。
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async (): Promise<{ views: ScheduledTaskView[]; templates: TemplateOption[] }> => {
    const [viewsData, templatesData] = await Promise.all([
      remote.call(EP.EP_SCHEDULER_TASKS).catch(() => []),
      remote.call(EP.EP_LIST_FLOW_TEMPLATES).catch(() => []),
    ]) as [unknown, unknown]
    const items = Array.isArray(viewsData) ? viewsData as ScheduledTaskView[] : []
    // 仅模式一（流程编排）模板可被定时触发
    const tpls = (Array.isArray(templatesData) ? templatesData : [])
      .filter((item) => (item as TemplateOption).mode === 'mode1') as TemplateOption[]
    if (mountedRef.current) {
      setViews(items)
      setTemplates(tpls)
    }
    return { views: items, templates: tpls }
  }, [remote])

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try {
      return await task()
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [])

  const saveTask = useCallback(async (task: ScheduledTask): Promise<ScheduledTask> => {
    const saved = await run(async () => {
      const result = await remote.call(EP.EP_SCHEDULER_TASK_PUT, { task }) as ScheduledTask
      await load()
      return result
    })
    return saved
  }, [load, remote, run])

  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_SCHEDULER_TASK_DELETE, { taskId })
      await load()
    })
  }, [load, remote, run])

  return { views, templates, busy, load, saveTask, deleteTask }
}

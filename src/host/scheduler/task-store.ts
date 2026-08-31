// src/host/scheduler/task-store.ts
//
// 定时任务持久化（scheduler-tasks.json 单文件，与 combos.json 同模式）：
//   - 文件形态：{ tasks: ScheduledTask[], runtimes: Record<taskId, PersistedRuntime> }
//   - 全部写操作经 withJsonLock + atomicWriteJson（临时文件 + fsync + 原子发布）；
//   - 任务全局共享（跨会话可见，与工作流模板一致）；runtimes 为引擎内存态的
//     关键字段落盘（窗口暂停续跑/触发消费点跨重启保持）。
//
// 单一职责：只做 list/save/delete 与运行时字段的读写，调度决策见 engine.ts。

import { join } from 'node:path'
import { atomicWriteJson, CorruptJsonError, readJson, withJsonLock } from '../storage/atomic.js'
import type { ScheduledTask } from '../shared/types.js'

/** 引擎持久化运行时字段（内存态的跨重启保留子集；状态 status 由引擎从 run 状态派生）。 */
export interface PersistedRuntime {
  /** 本轮 run id（引擎触发的；用户接管后清空）。 */
  currentRunId: string | null
  /** 本轮实际执行会话 id。 */
  currentSessionId: string | null
  /** 本轮实际执行实例（工作流）id。 */
  currentFlowId: string | null
  /** 被窗口 end 挂起、等待下一窗口续跑的 run id（无 = 非引擎窗口暂停）。 */
  windowPausedRunId: string | null
  /** 最近消费的触发点（UTC 毫秒；触发/skip 后推进，杜绝重复触发与重复 skip 记录）。 */
  lastConsumedTriggerAt: number | null
  /** 最近一次触发时刻（ISO 字符串）。 */
  lastTriggeredAt: string | null
  /** 最近一次触发结果。 */
  lastResult: 'started' | 'resumed' | 'failed' | 'skipped' | null
  /** 最近一次错误信息。 */
  lastError: string
}

/** 任务文件形态。 */
interface TaskFileState {
  tasks: ScheduledTask[]
  runtimes: Record<string, PersistedRuntime>
}

/** 空运行时（所有 key 的缺省值）。 */
export function emptyPersistedRuntime(): PersistedRuntime {
  return {
    currentRunId: null,
    currentSessionId: null,
    currentFlowId: null,
    windowPausedRunId: null,
    lastConsumedTriggerAt: null,
    lastTriggeredAt: null,
    lastResult: null,
    lastError: '',
  }
}

/**
 * 定时任务存储：任务 CRUD + 运行时字段读写。
 * 目录归属 dataDir 根（与 combos.json 平级；init 由 FlowStore 幂等建目录）。
 */
export class SchedulerTaskStore {
  constructor(private readonly root: string) {}

  private path(): string {
    return join(this.root, 'scheduler-tasks.json')
  }

  private async readState(): Promise<TaskFileState> {
    let state: TaskFileState | null
    try {
      state = await readJson<TaskFileState | null>(this.path(), null)
    } catch (error) {
      // 损坏 JSON：按空列表处置（与 FlowStore 列表读取的损坏容忍一致，Bug 21 语义），
      // 避免一个坏文件让调度器整体瘫痪；后续保存会重写完整文件。
      if (error instanceof CorruptJsonError) return { tasks: [], runtimes: {} }
      throw error
    }
    return {
      tasks: Array.isArray(state?.tasks) ? state.tasks : [],
      runtimes: state?.runtimes && typeof state.runtimes === 'object' ? state.runtimes : {},
    }
  }

  /** 列出全部任务（按 updatedAt 倒序）。 */
  async list(): Promise<ScheduledTask[]> {
    const state = await this.readState()
    return [...state.tasks].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  }

  /** 保存任务（新建/更新统一；id 须为 task- 前缀）。 */
  async save(task: ScheduledTask): Promise<ScheduledTask> {
    if (!String(task?.taskId ?? '').startsWith('task-')) throw new Error('定时任务 id 必须以 task- 前缀')
    const path = this.path()
    return withJsonLock(path, async () => {
      const state = await this.readState()
      const tasks = [task, ...state.tasks.filter((item) => item.taskId !== task.taskId)]
      await atomicWriteJson(path, { tasks, runtimes: state.runtimes })
      return task
    })
  }

  /** 删除任务（返回是否删除成功；运行中 run 不受影响，由引擎解绑）。 */
  async delete(taskId: string): Promise<boolean> {
    const path = this.path()
    return withJsonLock(path, async () => {
      const state = await this.readState()
      const existed = state.tasks.some((item) => item.taskId === taskId)
      if (!existed) return false
      const runtimes = { ...state.runtimes }
      delete runtimes[taskId]
      await atomicWriteJson(path, { tasks: state.tasks.filter((item) => item.taskId !== taskId), runtimes })
      return true
    })
  }

  /** 读取某个任务的持久化运行时（缺省返回空运行时）。 */
  async readRuntime(taskId: string): Promise<PersistedRuntime> {
    const state = await this.readState()
    return state.runtimes[taskId] ?? emptyPersistedRuntime()
  }

  /** 写入某个任务的持久化运行时（引擎状态迁移时调用；原子合并，不影响其他任务）。 */
  async writeRuntime(taskId: string, runtime: PersistedRuntime): Promise<void> {
    const path = this.path()
    return withJsonLock(path, async () => {
      const state = await this.readState()
      await atomicWriteJson(path, {
        tasks: state.tasks,
        runtimes: { ...state.runtimes, [taskId]: runtime },
      })
    })
  }
}

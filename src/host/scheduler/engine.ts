// src/host/scheduler/engine.ts
//
// 定时任务调度引擎：周期 tick 驱动三态决策（触发 / 窗口挂起 / 窗口续跑），
// 运行锁与断点续跑全部复用现有编排运行时（OrchestratorRuntime）——
//   - 触发 = 模板态点击运行：自动创建实例（instantiate.ts）+ startRun；
//   - 窗口 end = suspendRun（run → paused + 锁保留 + 不中断在执行的子代理）；
//   - 下一窗口 start = resumeRun（现有断点续跑机制，向父代理注入继续指令）；
//   - 用户手动接管（同实例出现非引擎 run / 用户停止）→ 窗口限制自动失效
//     （rt 清空交还控制权；下一触发点恢复引擎轮次）。
//
// 语义依据（prompt/定时任务开发.md）：
//   - 触发点 ∧ 执行窗口 并集才执行；missedTrigger=skip 不补打（启动即把
//     lastConsumedTriggerAt 推进到引擎启动时刻）；
//   - concurrency=skip：活动 run 未结束时新触发点直接丢弃；
//   - configUpdate=immediate：每次 tick 重读任务配置，修改即时生效。
//
// 纯运行时层：决策与 IO 可拆（runTaskOnce 供单测 fake 驱动），tick 定时器仅调度。

import type { RunSnapshot, ScheduledTask, ScheduledTaskRuntime, ScheduledTaskView } from '../shared/types.js'
import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js'
import { isWithinWindow, nextTriggerAt } from './planner.js'
import { instantiateFromTemplate } from './instantiate.js'
import { emptyPersistedRuntime, SchedulerTaskStore, type PersistedRuntime } from './task-store.js'

/** 编排运行时的引擎视图（宿主装配；单测 fake）。 */
export interface SchedulerOrchestrator {
  startRun(input: { sessionId: string; flowId: string; mode?: 'mode1' | 'mode2' }): Promise<{ runId: string }>
  resumeRun(input: { sessionId: string; flowId: string; fromRunId?: string }): Promise<{ runId: string }>
  /** 窗口挂起：run → paused（锁保留、不中断 in-flight）；返回是否挂起成功。 */
  suspendRun(runId: string): Promise<boolean>
  /** 某工作流当前运行锁（running/paused 保留锁）。 */
  flowLockInfo(flowId: string): { runId: string; sessionId: string; status: string } | null
  /** run 快照（内存；无则 null）。 */
  runSnapshot(runId: string): { status: string } | null
}

/** 工作流数据层视图（宿主装配 = FlowStore；单测 fake）。 */
export interface SchedulerFlowStore {
  getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null>
  listWorkflows(sessionId: string): Promise<WorkflowDocument[]>
  saveWorkflow(flow: WorkflowDocument, sessionId: string): Promise<WorkflowDocument>
  getRun(runId: string): Promise<RunSnapshot | null>
}

/** 引擎日志缝（宿主装配 cordis logger；单测可选）。 */
export interface SchedulerLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export interface SchedulerEngineDeps {
  taskStore: SchedulerTaskStore
  flowStore: SchedulerFlowStore
  orchestrator: SchedulerOrchestrator
  sessionProvider: { createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string> }
  /** 解析会话工作目录（新会话继承用；不可用时省略）。 */
  sessionCwdOf?(sessionId: string): Promise<string | undefined>
  /** 时钟注入（测试可控）。 */
  now?(): number
  /** tick 间隔（缺省 30s；触发/暂停精度分钟级）。 */
  tickMs?: number
  logger?: SchedulerLogger
}

/** 默认 tick 间隔（30s：秒级恢复误差可接受，写盘/扫描开销低）。 */
export const DEFAULT_TICK_MS = 30_000

/**
 * 调度引擎：定时扫描全部启用任务并执行决策；任务运行时状态在内存缓存 +
 * 关键字段落盘（taskStore.writeRuntime），重启后从 run 磁盘状态重建游标。
 */
export class SchedulerEngine {
  /** 内存运行时缓存（taskId → 持久化运行时；启动时装载）。 */
  private readonly runtimes = new Map<string, PersistedRuntime>()
  /** 启动时刻（missedTrigger=skip 基准：错过点不补打）。 */
  private startedAtMs = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private readonly tickMs: number
  private readonly now: () => number

  constructor(private readonly deps: SchedulerEngineDeps) {
    this.tickMs = Math.max(1_000, deps.tickMs ?? DEFAULT_TICK_MS)
    this.now = deps.now ?? (() => Date.now())
  }

  /** 启动定时器（返回 disposer；幂等）。 */
  start(): () => void {
    if (this.timer) return () => {}
    this.startedAtMs = this.now()
    this.timer = setInterval(() => {
      this.sweep().catch((error) => {
        this.deps.logger?.warn?.(`[visual-workflow] scheduler sweep failed: ${String(error instanceof Error ? error.message : error)}`)
      })
    }, this.tickMs)
    return () => {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 停止定时器（对象仍可被 start 再次启动；dispose 后不可）。 */
  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 任务视图（API listSchedulerTasks）：持久化任务 + 运行态合并。
   * 运行态优先取内存缓存；未装载（引擎启动前/测试）时用磁盘运行时落盘值派生。
   */
  async listViews(): Promise<ScheduledTaskView[]> {
    const tasks = await this.deps.taskStore.list()
    return tasks.map((task) => {
      const rt = this.runtimes.get(task.taskId)
      const status = rt ? deriveStatus(rt) : 'idle'
      const base = (rt?.lastConsumedTriggerAt ?? this.startedAtMs) || this.now()
      let nextIso: string | null = null
      try {
        const next = nextTriggerAt(task, base, task.timezone)
        nextIso = next === null ? null : new Date(next).toISOString()
      } catch {
        nextIso = null
      }
      return {
        task,
        runtime: {
          status,
          nextTriggerAt: nextIso,
          currentSessionId: rt?.currentSessionId ?? null,
          currentFlowId: rt?.currentFlowId ?? null,
          currentRunId: rt?.currentRunId ?? null,
          lastTriggeredAt: rt?.lastTriggeredAt ?? null,
          lastResult: rt?.lastResult ?? null,
          lastError: rt?.lastError ?? '',
        },
      }
    })
  }

  /**
   * 单次全量扫描（定时器与测试共用入口）：逐任务执行决策。
   * 任务间相互独立：单任务失败记录 lastError 后继续下一任务。
   */
  async sweep(): Promise<void> {
    if (this.disposed) return
    const tasks = await this.deps.taskStore.list()
    for (const task of tasks) {
      try {
        await this.runTaskOnce(task)
      } catch (error) {
        this.deps.logger?.warn?.(`[visual-workflow] 定时任务 ${task.taskId} 决策失败：${String(error instanceof Error ? error.message : error)}`)
      }
    }
  }

  /** 手工删除任务后的运行时解绑（API 层调用；不中断运行中 run）。 */
  async forgetTask(taskId: string): Promise<void> {
    this.runtimes.delete(taskId)
  }

  // ---------------------------------------------------------------------------
  // 单任务决策
  // ---------------------------------------------------------------------------

  private async runtimeOf(taskId: string): Promise<PersistedRuntime> {
    let rt = this.runtimes.get(taskId)
    if (rt) return rt
    rt = await this.deps.taskStore.readRuntime(taskId)
    this.runtimes.set(taskId, rt)
    return rt
  }

  private async persist(taskId: string, rt: PersistedRuntime): Promise<void> {
    this.runtimes.set(taskId, rt)
    await this.deps.taskStore.writeRuntime(taskId, rt)
  }

  /** 清空引擎本轮引用（交还控制权：run 终态/用户接管）。 */
  private async clearRound(taskId: string, rt: PersistedRuntime): Promise<void> {
    await this.persist(taskId, {
      ...emptyPersistedRuntime(),
      lastConsumedTriggerAt: rt.lastConsumedTriggerAt,
      lastTriggeredAt: rt.lastTriggeredAt,
      lastResult: rt.lastResult,
      lastError: rt.lastError,
    })
  }

  private async runTaskOnce(task: ScheduledTask): Promise<void> {
    const rt = await this.runtimeOf(task.taskId)
    const now = this.now()

    // missedTrigger=skip：启动基准推进（错过点不补打；仅启动后的首次 tick 生效一次）
    if (rt.lastConsumedTriggerAt === null || rt.lastConsumedTriggerAt < this.startedAtMs) {
      rt.lastConsumedTriggerAt = this.startedAtMs
      await this.persist(task.taskId, rt)
    }

    if (!task.enabled) {
      // 停用只影响未来触发；运行中的轮次不受干扰
      if (rt.currentRunId) {
        this.deps.logger?.info?.(`[visual-workflow] 定时任务 ${task.taskId} 已停用，本轮运行继续不受影响`)
      }
      return
    }

    // ---- 活动 run 状态解析（内存锁 > 磁盘记录） ----
    const lock = rt.currentFlowId ? this.deps.orchestrator.flowLockInfo(rt.currentFlowId) : null
    const ownLock = lock && lock.runId === rt.currentRunId ? lock : null
    const foreignLock = lock && lock.runId !== rt.currentRunId ? lock : null
    let runState: string | null = null
    if (rt.currentRunId) {
      const snapshot = this.deps.orchestrator.runSnapshot(rt.currentRunId)
      runState = snapshot?.status ?? null
      if (!runState) {
        const record = await this.deps.flowStore.getRun(rt.currentRunId)
        runState = record?.status ?? null
      }
    }

    // ---- 用户接管检测：同实例出现非引擎 run（锁已易主）-> 窗口限制失效 ----
    if (foreignLock) {
      this.deps.logger?.info?.(`[visual-workflow] 定时任务 ${task.taskId} 的运行已被用户接管（run ${foreignLock.runId}），窗口限制失效`)
      await this.clearRound(task.taskId, rt)
      return
    }

    // ---- 窗口暂停态：等待下一窗口 start 续跑（同一会话/实例） ----
    if (rt.currentRunId && rt.windowPausedRunId === rt.currentRunId) {
      if (!runState) {
        // run 已不存在（磁盘清理）：本轮结束
        await this.clearRound(task.taskId, rt)
        return
      }
      if (runState === 'paused') {
        if (isWithinWindow(now, task.window, task.timezone)) {
          await this.resumeWindowPaused(task, rt, now)
        }
        return
      }
      // running（挂起调用后再现）或已终态：窗口介入结束
      await this.clearRound(task.taskId, rt)
      return
    }

    // ---- 活动执行中：窗口 end 挂起 + 触发点并发跳过 ----
    if (rt.currentRunId && runState === 'running') {
      if (!isWithinWindow(now, task.window, task.timezone)) {
        await this.suspendByWindow(task, rt, now)
        return
      }
      // concurrency=skip：本轮到下次触发点前未结束则丢弃触发
      await this.consumeDueTrigger(task, rt, now, 'skipped')
      return
    }

    // ---- 其他 run 状态收尾：paused（暂停节点/用户暂停）不自动续跑；终态清空 ----
    if (rt.currentRunId && runState) {
      if (runState !== 'paused') {
        await this.clearRound(task.taskId, rt)
      }
      return
    }
    if (rt.currentRunId && !runState) {
      await this.clearRound(task.taskId, rt)
      return
    }

    // ---- idle：触发点判定（触发点 ∧ 窗口并集） ----
    const nextT = nextTriggerAt(task, rt.lastConsumedTriggerAt ?? this.startedAtMs, task.timezone)
    if (nextT === null || nextT > now) return
    // 触发点已到且窗口有效（nextTriggerAt 已保证点落在窗口内）：
    await this.fire(task, rt, nextT)
  }

  /** 触发执行：模板 → 实例（会话策略分派）→ startRun。 */
  private async fire(task: ScheduledTask, rt: PersistedRuntime, triggerAt: number): Promise<void> {
    rt.lastConsumedTriggerAt = triggerAt
    try {
      const sessionId = task.sessionMode === 'current-session'
        ? task.ownerSessionId
        : await this.deps.sessionProvider.createSession({
            label: `定时任务：${task.name}`,
            // 官方 standard 预设：父代理具备官方标准工具集（用户裁决：standard 预设+可追溯）
            agentPreset: 'standard',
            ...(task.ownerSessionId && this.deps.sessionCwdOf
              ? { cwd: await this.deps.sessionCwdOf(task.ownerSessionId).catch(() => undefined) }
              : {}),
          })
      const template = await this.deps.flowStore.getFlowTemplate(task.workflowTemplateId)
      if (!template) throw new Error(`工作流模板不存在：${task.workflowTemplateId}`)
      const existing = await this.deps.flowStore.listWorkflows(sessionId)
      const instance = instantiateFromTemplate(template, sessionId, existing.map((item) => item.name))
      const saved = await this.deps.flowStore.saveWorkflow(instance, sessionId)
      const result = await this.deps.orchestrator.startRun({ sessionId, flowId: saved.id, mode: saved.mode })
      rt.currentRunId = result.runId
      rt.currentSessionId = sessionId
      rt.currentFlowId = saved.id
      rt.windowPausedRunId = null
      rt.lastTriggeredAt = new Date(triggerAt).toISOString()
      rt.lastResult = 'started'
      rt.lastError = ''
    } catch (error) {
      rt.currentRunId = null
      rt.currentSessionId = null
      rt.currentFlowId = null
      rt.windowPausedRunId = null
      rt.lastTriggeredAt = new Date(triggerAt).toISOString()
      rt.lastResult = 'failed'
      rt.lastError = String(error instanceof Error ? error.message : error)
      this.deps.logger?.warn?.(`[visual-workflow] 定时任务 ${task.taskId} 触发失败：${rt.lastError}`)
    }
    await this.persist(task.taskId, rt)
  }

  /** 窗口 end 挂起：run → paused（锁保留、不中断在执行的子代理），等待下一窗口续跑。 */
  private async suspendByWindow(task: ScheduledTask, rt: PersistedRuntime, now: number): Promise<void> {
    if (!rt.currentRunId) return
    try {
      const ok = await this.deps.orchestrator.suspendRun(rt.currentRunId)
      if (!ok) {
        await this.clearRound(task.taskId, rt)
        return
      }
      rt.windowPausedRunId = rt.currentRunId
      await this.persist(task.taskId, rt)
      this.deps.logger?.info?.(`[visual-workflow] 定时任务 ${task.taskId} 窗口结束，运行已挂起（run ${rt.currentRunId}）`)
    } catch (error) {
      this.deps.logger?.warn?.(`[visual-workflow] 定时任务 ${task.taskId} 窗口挂起失败：${String(error instanceof Error ? error.message : error)}`)
    }
  }

  /** 窗口 start 续跑：resumeRun（现有断点续跑机制；新 runId 接管锁）。 */
  private async resumeWindowPaused(task: ScheduledTask, rt: PersistedRuntime, now: number): Promise<void> {
    if (!rt.currentRunId || !rt.currentSessionId || !rt.currentFlowId) {
      await this.clearRound(task.taskId, rt)
      return
    }
    try {
      const result = await this.deps.orchestrator.resumeRun({
        sessionId: rt.currentSessionId,
        flowId: rt.currentFlowId,
        fromRunId: rt.currentRunId,
      })
      rt.currentRunId = result.runId
      rt.windowPausedRunId = null
      rt.lastTriggeredAt = new Date(now).toISOString()
      rt.lastResult = 'resumed'
      rt.lastError = ''
      await this.persist(task.taskId, rt)
      this.deps.logger?.info?.(`[visual-workflow] 定时任务 ${task.taskId} 窗口开始，运行已续跑（run ${result.runId}）`)
    } catch (error) {
      // 续跑失败（如父代理忙）：下次 tick 重试；窗口仍开放则持续尝试
      this.deps.logger?.warn?.(`[visual-workflow] 定时任务 ${task.taskId} 窗口续跑失败（将重试）：${String(error instanceof Error ? error.message : error)}`)
    }
  }

  /** 触发点消费（运行中场景：concurrency=skip 丢弃触发，仅推进游标）。 */
  private async consumeDueTrigger(task: ScheduledTask, rt: PersistedRuntime, now: number, result: 'skipped'): Promise<void> {
    const nextT = nextTriggerAt(task, rt.lastConsumedTriggerAt ?? this.startedAtMs, task.timezone)
    if (nextT === null || nextT > now) return
    rt.lastConsumedTriggerAt = nextT
    rt.lastResult = result
    rt.lastTriggeredAt = new Date(nextT).toISOString()
    await this.persist(task.taskId, rt)
  }
}

/** 由持久化运行时派生任务级状态（衍生展示；决策以 run 状态为准）。 */
function deriveStatus(rt: PersistedRuntime): ScheduledTaskRuntime['status'] {
  if (!rt.currentRunId) return rt.lastResult === 'failed' ? 'error' : 'idle'
  if (rt.windowPausedRunId === rt.currentRunId) return 'waiting'
  return 'paused'
}

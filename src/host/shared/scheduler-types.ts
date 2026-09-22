// Host + Client 共享契约：定时任务（纯类型，零运行时依赖）。
//
// 职责：定义定时任务的持久化实体与内存派生运行态的**形状**。
// 语义来源：独立功能需求（prompt/定时任务开发.md），不改写既有需求/架构文档；
// 字段语义与依据见各字段 JSDoc。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。

// ---------------------------------------------------------------------------
// 定时任务（scheduler-tasks.json；新功能：prompt/定时任务开发.md）
// ---------------------------------------------------------------------------
// 说明：本功能独立于需求文档/架构文档（用户指令：新功能需求以 prompt/定时任务开发.md
// 为准，不改写既有两份文档）。字段语义逐字对齐该文档 §一 JSON 结构 与 §二 规则说明；
// 新增字段（name/sessionMode/ownerSessionId/创建更新戳）为任务管理与会话策略所需。

/** 时段（"HH:mm"，基于任务时区解释；升序填写，可由 UI 编辑）。 */
export interface TimeRangeConfig {
  /** 区间开始（含）。 */
  start: string
  /** 区间结束（不含；若 end <= start 视为跨天区间，覆盖次日 00:00–end）。 */
  end: string
}

/** 第一层：执行窗口（错峰调用 API 的约束；需求文档实现说明见 prompt/定时任务开发.md §功能描述）。 */
export interface ScheduleWindowConfig {
  /** 起始日期（"YYYY-MM-DD"，闭区间，含当日）。 */
  startDate: string
  /** 结束日期（"YYYY-MM-DD"，闭区间，含当日）。 */
  endDate: string
  /** 有效星期（0=周日 … 6=周六）；空数组 = 每天都有效。 */
  daysOfWeek: number[]
  /** 任务可执行的时间段（可多个；当前时刻落在任一区间内才算窗口内）。 */
  timeRanges: TimeRangeConfig[]
  /** 是否不限有效日期（true = 忽略 startDate/endDate，仅按 daysOfWeek + timeRanges 判定；用户批注：日期不限按钮）。 */
  unbounded?: boolean
}

/** 触发模式：定点时刻 / 固定间隔（二选一，互斥）。 */
export type ScheduleTriggerMode = 'daily_time' | 'interval'

/** 模式A：定点时刻（triggerMode='daily_time' 时生效；每个有效日按 points 依次触发）。 */
export interface DailyTimeConfig {
  /** 每日触发时刻（"HH:mm"，升序；自动按序触发）。 */
  timePoints: string[]
}

/** 模式B：间隔模式（triggerMode='interval' 时生效；每个有效日从 startFrom 重新计时）。 */
export interface IntervalConfig {
  /** 间隔分钟数（1..1439，即小于 24 小时）。 */
  intervalMinutes: number
  /** 每日起始时刻（"HH:mm"）。 */
  startFrom: string
}

/** 运行时行为策略（本阶段固定取值；兜底约定，UI 只读展示）。 */
export interface ScheduleRuntimePolicy {
  /** 启动/恢复时已过理论触发点：直接跳过，绝不补打。 */
  missedTrigger: 'skip'
  /** 上一轮未结束时新触发点到来：直接跳过本轮。 */
  concurrency: 'skip'
  /** 修改配置后立即生效，无需等待次日。 */
  configUpdate: 'immediate'
}

/** 会话策略：每轮新建会话运行 / 复用任务创建者会话运行（用户裁决，2026）。 */
export type ScheduleSessionMode = 'new-session' | 'current-session'

/**
 * 定时任务（持久化实体）：选择工作流模板（全局共享，非实例），按窗口+触发策略
 * 自动触发。触发语义 =「模板态点击运行」（自动创建实例并运行，与画布逻辑一致）；
 * 暂停/续跑一律在当前执行会话内进行（不新建会话），停用/删除只影响未来触发。
 */
export interface ScheduledTask {
  /** 任务稳定标识（`task-` 前缀）。 */
  taskId: string
  /** 任务名称（列表展示；保存时缺省取模板名）。 */
  name: string
  /** 所选工作流模板 id（仅模式一模板；模板全局共享）。 */
  workflowTemplateId: string
  /** 会话策略：new-session 每轮新建会话；current-session 复用创建者会话。 */
  sessionMode: ScheduleSessionMode
  /** 创建者会话 id（current-session 模式复用；new-session 模式记录归属/审计）。 */
  ownerSessionId: string
  /**
   * 新会话工作区（绝对路径目录，可选；仅 new-session 模式生效）。
   * 设置后新会话 cwd = 该路径（官方会话 header.cwd 即沙箱 workspace-write 根），
   * 不继承创建者会话 cwd；保存时校验路径存在且为目录。
   */
  workspacePath?: string
  /** 是否启用（停用后不触发，配置保留）。 */
  enabled: boolean
  /** 时区（IANA 名称；所有 HH:mm 基于该时区解释，内部换算 UTC 比对）。 */
  timezone: string
  /** 第一层：执行窗口。 */
  window: ScheduleWindowConfig
  /** 第二层：触发模式（daily_time/interval 二选一，互斥）。 */
  triggerMode: ScheduleTriggerMode
  /** 定点配置（triggerMode='daily_time' 时有效；否则可为 null）。 */
  dailyTimeConfig: DailyTimeConfig | null
  /** 间隔配置（triggerMode='interval' 时有效；否则可为 null）。 */
  intervalConfig: IntervalConfig | null
  /** 运行时行为策略（兜底约定；本阶段固定 skip/skip/immediate）。 */
  runtimePolicy: ScheduleRuntimePolicy
  /** 创建时间（ISO 字符串）。 */
  createdAt: string
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt: string
}

/** 任务运行态（内存派生，不落盘；listSchedulerTasks 合并返回供 UI 展示）。 */
export interface ScheduledTaskRuntime {
  /** 任务级状态：idle 等待触发 / running 活动 run 执行中 / waiting 窗口暂停等待续跑 / paused 流程暂停（暂停节点/用户暂停，等待用户恢复） / error 最近触发失败。 */
  status: 'idle' | 'running' | 'waiting' | 'paused' | 'error'
  /** 下一触发点（ISO 字符串；窗口/策略计算，纯函数实时推算）。 */
  nextTriggerAt: string | null
  /** 本轮实际执行会话 id（new-session 模式为自动创建的新会话）。 */
  currentSessionId: string | null
  /** 本轮实际执行实例（工作流）id。 */
  currentFlowId: string | null
  /** 本轮 run id（调度器触发的；用户手动接管后为 null）。 */
  currentRunId: string | null
  /** 最近一次触发时刻（ISO 字符串或 null）。 */
  lastTriggeredAt: string | null
  /** 最近一次触发结果：started 触发运行 / resumed 窗口续跑 / failed 触发失败 / skipped 并发跳过。 */
  lastResult: 'started' | 'resumed' | 'failed' | 'skipped' | null
  /** 最近一次错误信息（无错误为空串）。 */
  lastError: string
}

/** 定时任务视图 = 持久化实体 + 运行态（listSchedulerTasks 返回类型）。 */
export interface ScheduledTaskView {
  task: ScheduledTask
  runtime: ScheduledTaskRuntime
}

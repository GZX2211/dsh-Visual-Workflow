// src/host/experience/retirement-schedule.ts
//
// 退役扫描的宿主定时编排：启动延迟后执行首轮，之后按固定周期继续。
//
// 为什么是「上一轮完成后才排下一轮」而不是 setInterval：扫描要读全部活跃经验的历史，
// 固定间隔可能与上一轮重叠，造成同一批候选被并发判定与重复日志；串行递归保证任意时刻
// 至多一轮扫描在跑，代价是长期漂移（可接受，退役不是实时任务）。
//
// 生命周期：返回的 disposer 由宿主 ctx.effect 持有；dispose 后不再排下一轮，
// 正在执行的那一轮可以自然结束，但结束后不会再写定时器。

import { messageOf } from "../orchestrator/errors.js"
import {
  EXPERIENCE_RETIREMENT_SWEEP_INITIAL_DELAY_MS,
  EXPERIENCE_RETIREMENT_SWEEP_INTERVAL_MS,
} from "./constants.js"
import type { ExperienceRetirementSweepResult } from "./retirement-sweep.js"

/** 扫描定时器所需的最小诊断面（info 只在有归档时输出摘要）。 */
export interface ExperienceRetirementScheduleLogger {
  warn(message: string): void
  info?(message: string): void
}

export interface ExperienceRetirementScheduleOptions {
  sweep: () => Promise<ExperienceRetirementSweepResult>
  logger?: ExperienceRetirementScheduleLogger
  initialDelayMs?: number
  intervalMs?: number
}

/**
 * 启动退役扫描定时器，返回释放函数（幂等）。
 *
 * 失败语义：单轮失败只告警，下一轮仍按期执行；扫描函数自身的读取失败由这里兜住，
 * 避免定时器回调抛出未捕获异常导致宿主进程告警风暴。
 */
export function scheduleExperienceRetirementSweep(
  options: ExperienceRetirementScheduleOptions,
): () => void {
  const initialDelayMs = options.initialDelayMs ?? EXPERIENCE_RETIREMENT_SWEEP_INITIAL_DELAY_MS
  const intervalMs = options.intervalMs ?? EXPERIENCE_RETIREMENT_SWEEP_INTERVAL_MS
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleNext = (delayMs: number): void => {
    if (disposed) return
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  const tick = async (): Promise<void> => {
    timer = null
    if (disposed) return
    try {
      const result = await options.sweep()
      if (result.retired.length > 0) {
        options.logger?.info?.(
          `[visual-workflow] 经验退役扫描完成：活跃 ${result.scanned} 条，归档 ${result.retired.length} 条`
            + `（${result.retired.map((item) => `${item.experienceId}:${item.reason}`).join("、")}）`,
        )
      }
    } catch (error) {
      options.logger?.warn(
        `[visual-workflow] 经验退役扫描失败：${messageOf(error)}；下一轮仍会执行。`,
      )
    }
    scheduleNext(intervalMs)
  }

  scheduleNext(initialDelayMs)

  return () => {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

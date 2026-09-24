// src/client/hooks/usePolling.ts
//
// 周期轮询的统一实现（工作台四处轮询共用）：把「挂载即跑一轮 + 定时触发 + 卸载清理」
// 的骨架收在一处，并统一两项并发保护：
//   - in-flight 互斥：上一轮未结束（含超时前）不重入，慢响应不会堆积；
//   - 序号保护：仅最新一轮的结果被消费，过期响应（切换文档/会话后返回）一律丢弃；
//   - 卸载即取消：AbortController 中止在途请求，异步回调不再写状态。
// 单轮失败静默（轮询是辅助路径，由各调用方负责用户可见提示）；下一轮自然重试。

import { useEffect, useRef } from 'react'
import { POLL_REMOTE_TIMEOUT_MS } from '../lib/remote.js'

/** 单轮任务上下文：signal/timeoutMs 供远端调用取消与超时；isCurrent() 判定结果是否仍属最新一轮。 */
export interface PollingContext {
  signal: AbortSignal
  timeoutMs: number
  isCurrent(): boolean
}

export interface PollingOptions {
  /** 轮询间隔（毫秒）。 */
  intervalMs: number
  /** 单轮远端调用超时（毫秒）；缺省 POLL_REMOTE_TIMEOUT_MS。 */
  timeoutMs?: number
  /** 是否启用（false 时立即停止并清理，不发起请求）。 */
  enabled?: boolean
}

/**
 * 周期轮询 effect。deps 变化即重建轮询（新文档/新会话/新开关）；
 * task 取最新渲染闭包（经 ref），无需调用方自行 memo。
 */
export function usePolling(
  task: (context: PollingContext) => Promise<void>,
  options: PollingOptions,
  deps: React.DependencyList,
): void {
  const taskRef = useRef(task)
  taskRef.current = task
  const timeoutMs = options.timeoutMs ?? POLL_REMOTE_TIMEOUT_MS
  const enabled = options.enabled !== false
  const intervalMs = options.intervalMs
  useEffect(() => {
    if (!enabled) return undefined
    let disposed = false
    let inflight = false
    let seq = 0
    let controller: AbortController | null = null
    const run = async (): Promise<void> => {
      if (disposed || inflight) return
      inflight = true
      const round = ++seq
      const abort = new AbortController()
      controller = abort
      try {
        await taskRef.current({
          signal: abort.signal,
          timeoutMs,
          isCurrent: () => !disposed && round === seq,
        })
      } catch {
        // 单轮失败：静默，下一轮重试（辅助路径失败不打扰用户）
      } finally {
        inflight = false
        if (controller === abort) controller = null
      }
    }
    void run()
    const timer = setInterval(() => { void run() }, intervalMs)
    return () => {
      disposed = true
      // 序号推进使在途回调的 isCurrent() 立即为 false（卸载/重建后不写状态）
      seq += 1
      clearInterval(timer)
      controller?.abort()
      controller = null
    }
  }, deps)
}

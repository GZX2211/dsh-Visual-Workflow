// src/client/hooks/useRunPolling.ts
//
// 运行状态轮询：runId 存在时按间隔拉取 runStatus；终态后停止轮询并**同轮清空快照**
// （RUN_SNAPSHOT 后紧跟 RUN_CLEARED，画布着色随运行结束一并撤掉）。并发保护
// （in-flight 互斥 / 序号丢弃过期响应 / 卸载取消）统一由 usePolling 承担。
//
// 轮询间隔由 host 经 runtimeConfig 端点下发（runPollMs）：前端不得自读 host 的配置
// 对象，只能经统一网络边界取；host 未下发 / 下发失败 / 取值非法时回退 RUN_POLL_MS。

import { useEffect, useState } from 'react'
import type { Dispatch } from 'react'
import type { RunSnapshot } from '../../host/shared/types.js'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 轮询间隔缺省（host 未下发时的回退值，即接入前的既有节奏）。 */
export const RUN_POLL_MS = 600

/** 终态集合（轮询停止判定）。 */
const TERMINAL = new Set(['completed', 'failed', 'stopped', 'paused', 'interrupted'])

/**
 * 解析 host 下发的轮询间隔。
 * 缺失 / 形态非法 / 非正数一律回退 RUN_POLL_MS：setInterval(0) 会退化成本地空转，
 * 下发值不可信时宁可持续用既有节奏（轮询是辅助路径：不停摆、也不加速）。
 */
export function resolveRunPollMs(value: unknown): number {
  const raw = (value as { runPollMs?: unknown } | null | undefined)?.runPollMs
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : RUN_POLL_MS
}

/** 运行轮询 effect：runId 变化起轮询；终态停。 */
export function useRunPolling(
  sessionId: string,
  runId: string | null,
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
): void {
  const [intervalMs, setIntervalMs] = useState(RUN_POLL_MS)

  // 下发查询与轮询并行：轮询先按缺省节奏起步，首轮请求不被配置往返压住
  // （下发端点悬挂时轮询不得跟着停摆）。清理时中止在途请求，避免卸载后写状态。
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const value = await remote.call(EP.EP_RUNTIME_CONFIG, {}, { signal: controller.signal })
        if (!controller.signal.aborted) setIntervalMs(resolveRunPollMs(value))
      } catch {
        // 下发失败 / 卸载取消：保持缺省间隔（辅助路径失败不打扰用户）
      }
    })()
    return () => controller.abort()
  }, [remote])

  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    const snapshot = await remote.call(EP.EP_RUN_STATUS, { sessionId, runId }, { signal, timeoutMs }) as RunSnapshot | null
    if (!snapshot || !isCurrent()) return
    dispatch({ type: 'RUN_SNAPSHOT', snapshot })
    if (TERMINAL.has(snapshot.status)) {
      dispatch({ type: 'RUN_CLEARED' })
    }
  // sessionId 必须入依赖数组：轮询请求携带 sessionId，若 runId 不变而会话切换
  // （实际场景极罕见），旧会话 id 会导致按错会话请求（400/数据错乱）。
  // intervalMs 入依赖数组：下发值到达后按新节奏重建定时器（usePolling 的间隔在 effect 内读取）。
  }, { intervalMs, enabled: Boolean(runId) }, [dispatch, remote, runId, sessionId, intervalMs])
}

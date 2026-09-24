// src/client/hooks/useRunPolling.ts
//
// 运行状态轮询：runId 存在时按间隔拉取 runStatus；终态后停止轮询
// （快照保留在 state 供画布高亮）。并发保护（in-flight 互斥 / 序号丢弃过期
// 响应 / 卸载取消）统一由 usePolling 承担。

import type { Dispatch } from 'react'
import type { RunSnapshot } from '../../host/shared/types.js'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 轮询间隔（旧项目 RUN_POLL_MS）。当前固定 600ms；后端 runPollMs 配置键预留未接入。 */
export const RUN_POLL_MS = 600

/** 终态集合（轮询停止判定）。 */
const TERMINAL = new Set(['completed', 'failed', 'stopped', 'paused', 'interrupted'])

/** 运行轮询 effect：runId 变化起轮询；终态停。 */
export function useRunPolling(
  sessionId: string,
  runId: string | null,
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
): void {
  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    const snapshot = await remote.call(EP.EP_RUN_STATUS, { sessionId, runId }, { signal, timeoutMs }) as RunSnapshot | null
    if (!snapshot || !isCurrent()) return
    dispatch({ type: 'RUN_SNAPSHOT', snapshot })
    if (TERMINAL.has(snapshot.status)) {
      dispatch({ type: 'RUN_CLEARED' })
    }
  // sessionId 必须入依赖数组：轮询请求携带 sessionId，若 runId 不变而会话切换
  // （实际场景极罕见），旧会话 id 会导致按错会话请求（400/数据错乱）。
  }, { intervalMs: RUN_POLL_MS, enabled: Boolean(runId) }, [dispatch, remote, runId, sessionId])
}

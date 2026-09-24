// src/client/hooks/useActiveRunsPolling.ts
//
// 全量活跃 run 轮询（工作台全局化）：工作台打开期间周期拉取**全部会话**的活跃
// run 摘要（running/paused），供实例列表状态徽标实时显示（其他会话实例的运行
// 状态也可见——全局统一操作面板）。与 useRunPolling（当前画布实例快照轮询）互补。

import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 全量活跃 run 轮询间隔（列表徽标为概要信息，2s 足够；当前实例快照仍走 600ms 快轮询）。 */
export const ACTIVE_RUNS_POLL_MS = 2_000

/** 活跃 run 摘要条目（后端 activeRuns 全量返回；running/paused 保留锁）。 */
export interface ActiveRunItem {
  flowId: string
  sessionId: string
  status: string
  runId: string
}

/** 全量活跃 run 轮询 effect：挂载即拉一次，随后每 2s 刷新。 */
export function useActiveRunsPolling(
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
): void {
  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    const items = await remote.call(EP.EP_ACTIVE_RUNS, {}, { signal, timeoutMs }) as ActiveRunItem[] | null
    if (!isCurrent()) return
    dispatch({ type: 'ACTIVE_RUNS_LOADED', items: Array.isArray(items) ? items : [] })
  }, { intervalMs: ACTIVE_RUNS_POLL_MS }, [dispatch, remote])
}

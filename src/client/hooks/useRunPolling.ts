// src/client/hooks/useRunPolling.ts
//
// 运行状态轮询：runId 存在时按间隔拉取 runStatus；终态后停止轮询
// （快照保留在 state 供画布高亮）。

import { useEffect } from 'react'
import type { Dispatch } from 'react'
import type { RunSnapshot } from '../../host/shared/types.js'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

/** 轮询间隔（旧项目 RUN_POLL_MS）。 */
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
  useEffect(() => {
    if (!runId) return undefined
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const snapshot = await remote.call(EP.EP_RUN_STATUS, { sessionId, runId }) as RunSnapshot | null
        if (cancelled || !snapshot) return
        dispatch({ type: 'RUN_SNAPSHOT', snapshot })
        if (TERMINAL.has(snapshot.status)) {
          dispatch({ type: 'RUN_CLEARED' })
        }
      } catch {
        // 轮询偶发失败下一轮重试
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, RUN_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [dispatch, remote, runId])
}

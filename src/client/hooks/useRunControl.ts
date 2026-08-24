// src/client/hooks/useRunControl.ts
//
// 运行控制：启动（run 端点，存在断点自动续跑）/ 停止（runStop）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface RunControlFace {
  startRun(sessionId: string, flowId: string): Promise<string | null>
  stopRun(runId: string): Promise<void>
}

/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): RunControlFace {
  const startRun = useCallback(async (sessionId: string, flowId: string) => {
    const result = await remote.call(EP.EP_RUN, { sessionId, flowId }) as { runId?: unknown }
    const runId = String(result?.runId ?? '')
    if (runId) dispatch({ type: 'RUN_STARTED', runId })
    return runId || null
  }, [dispatch, remote])

  const stopRun = useCallback(async (runId: string) => {
    await remote.call(EP.EP_RUN_STOP, { runId })
    dispatch({ type: 'RUN_CLEARED' })
  }, [dispatch, remote])

  return { startRun, stopRun }
}

// src/client/hooks/useRunControl.ts
//
// 运行控制：启动（run 端点，存在断点自动续跑；「启动时开启新会话」时新建会话
// 运行并返回实际会话 id）/ 停止（runStop）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface RunControlFace {
  startRun(sessionId: string, flowId: string, options?: { startNewSession?: boolean; workspacePath?: string }): Promise<string | null>
  /** 停止运行：携带实际执行会话 id 供后端归属校验（越权会话不得停止他人运行）。 */
  stopRun(sessionId: string, runId: string): Promise<void>
}

/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): RunControlFace {
  const startRun = useCallback(async (sessionId: string, flowId: string, options?: { startNewSession?: boolean; workspacePath?: string }) => {
    const result = await remote.call(EP.EP_RUN, {
      sessionId,
      flowId,
      ...(options?.startNewSession === true ? { startNewSession: true } : {}),
      ...(options?.workspacePath?.trim() ? { workspacePath: options.workspacePath.trim() } : {}),
    }) as { runId?: unknown; sessionId?: unknown }
    const runId = String(result?.runId ?? '')
    if (runId) {
      // runSessionId：新会话运行的实际执行会话（轮询/停止/恢复都按它归属）
      dispatch({ type: 'RUN_STARTED', runId, ...(result?.sessionId ? { runSessionId: String(result.sessionId) } : {}) })
    }
    return runId || null
  }, [dispatch, remote])

  const stopRun = useCallback(async (sessionId: string, runId: string) => {
    await remote.call(EP.EP_RUN_STOP, { sessionId, runId })
    dispatch({ type: 'RUN_CLEARED' })
  }, [dispatch, remote])

  return { startRun, stopRun }
}

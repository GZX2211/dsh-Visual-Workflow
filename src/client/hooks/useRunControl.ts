// src/client/hooks/useRunControl.ts
//
// 运行控制：启动（run 端点，存在断点自动续跑）/ 停止（runStop）。
// 工作台全局化改版：运行唯一逻辑 = 运行当前实例——run 会话即实例绑定的会话
// （不再支持运行期新会话；「开启新会话」只在创建实例时经 createSession 完成）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface RunControlFace {
  /** 运行当前实例（会话 = 实例绑定的会话；存在断点自动续跑）。 */
  startRun(sessionId: string, flowId: string): Promise<string | null>
  /** 停止运行：携带实例归属会话 id 供后端归属校验（越权会话不得停止他人运行）。 */
  stopRun(sessionId: string, runId: string): Promise<void>
}

/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): RunControlFace {
  const startRun = useCallback(async (sessionId: string, flowId: string) => {
    const result = await remote.call(EP.EP_RUN, { sessionId, flowId }) as { runId?: unknown; sessionId?: unknown }
    const runId = String(result?.runId ?? '')
    if (runId) {
      // runSessionId：恒等于实例绑定的会话（新逻辑 run 与实例同会话）；
      // 轮询/停止/恢复都按它归属。
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

import type { PrepareRuntimeInputs, RuntimeInputLifecycle } from "./use-runtime-inputs.js"
// src/client/hooks/useRunControl.ts
//
// 运行控制：启动（run 端点，存在断点自动续跑）/ 停止（runStop）。
// 工作台全局化改版：运行唯一逻辑 = 运行当前实例——run 会话即实例绑定的会话
// （不再支持运行期新会话；「开启新会话」只在创建实例时经 createSession 完成）。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface RunControlFace {
  prepareInputs?: PrepareRuntimeInputs
  inputLifecycle?: RuntimeInputLifecycle
  /** 运行当前实例（会话 = 实例绑定的会话；存在断点自动续跑）。 */
  startRun(sessionId: string, flowId: string, configureInputs?: boolean, freshStart?: boolean): Promise<string | null>
  /** 停止运行：携带实例归属会话 id 供后端归属校验（越权会话不得停止他人运行）。 */
  stopRun(sessionId: string, runId: string): Promise<void>
}

/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace, prepareInputs?: PrepareRuntimeInputs, inputLifecycle?: RuntimeInputLifecycle): RunControlFace {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const startRun = useCallback(async (sessionId: string, flowId: string, configureInputs = false, freshStart = false) => {
    const selection = prepareInputs ? await prepareInputs(sessionId, flowId, undefined, false, configureInputs, freshStart) : undefined
    if (!alive.current || selection === null) return null
    const ticket = selection?.requestGeneration ?? inputLifecycle?.capture()
    const result = await remote.call(EP.EP_RUN, { sessionId, flowId, ...(freshStart ? { freshStart: true } : {}), ...(selection ? { runtimeInputs: selection.runtimeInputs, handoffPolicy: selection.handoffPolicy } : {}) }) as { runId?: unknown; sessionId?: unknown }
    if (!alive.current || ticket !== undefined && inputLifecycle && !inputLifecycle.isCurrent(ticket)) return null
    const runId = String(result?.runId ?? '')
    if (runId && alive.current) {
      // runSessionId：恒等于实例绑定的会话（新逻辑 run 与实例同会话）；
      // 轮询/停止/恢复都按它归属。
      dispatch({ type: 'RUN_STARTED', runId, ...(result?.sessionId ? { runSessionId: String(result.sessionId) } : {}) })
    }
    return runId || null
  }, [dispatch, remote, prepareInputs, inputLifecycle])

  const stopRun = useCallback(async (sessionId: string, runId: string) => {
    const ticket = inputLifecycle?.capture()
    await remote.call(EP.EP_RUN_STOP, { sessionId, runId })
    if (alive.current && (ticket === undefined || inputLifecycle?.isCurrent(ticket))) dispatch({ type: "RUN_CLEARED" })
  }, [dispatch, remote, inputLifecycle])

  return { startRun, stopRun, prepareInputs, inputLifecycle }
}

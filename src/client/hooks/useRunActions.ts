// src/client/hooks/useRunActions.ts
//
// 运行与服务控制面：模式一运行启停/运行历史/断点恢复，模式二服务启停。
// 工作台全局化改版（运行唯一逻辑）：
//   - 模板态运行 = 先「创建实例」（含开启新会话/覆盖确认）再运行接续（afterCreate）；
//   - 实例态运行 = 保存后运行该实例（会话 = 实例绑定的会话，不再新建会话）；
//   - 运行/停止/历史/恢复均以实例绑定的会话（run.sessionId ?? flow.sessionId）归属。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import { currentFlowOf, currentFlowTemplateOf, currentServiceOf } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { RunControlFace } from './useRunControl.js'
import type { ServiceControlFace } from './useServiceControl.js'
import type { ToastFace } from './useToast.js'
import type { DocumentActionsFace } from './useDocumentActions.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

export interface RunActionsFace {
  startRun(): Promise<void>
  stopRun(): Promise<void>
  openHistory(): Promise<void>
  resumeRun(runId: string): Promise<void>
  startService(): Promise<void>
  stopService(): Promise<void>
}

/** 运行与服务控制面（远端失败抛错，由调用方 toast）。 */
export function useRunActions(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  remote: RemoteFace,
  runControl: RunControlFace,
  serviceControl: ServiceControlFace,
  saveCanvas: DocumentActionsFace['saveCanvas'],
  createInstanceFromCanvas: DocumentActionsFace['createInstanceFromCanvas'],
): RunActionsFace {
  // ---------- 运行（模式一） ----------
  const startRun = useCallback(async () => {
    if (state.mode !== 'mode1') return
    // 模板态：运行前自动「创建实例」（含开启新会话/覆盖确认）再运行——
    // 创建是异步的（可能弹确认框），后续启动统一经 afterCreate 回调接续。
    if (state.currentKind === 'flowTemplate') {
      void createInstanceFromCanvas((created) => {
        const flow = created as import('../../host/shared/graph-model.js').WorkflowDocument
        const hasStart = state.canvas.nodes.some((node) => node.kind === 'start')
        const hasEnd = state.canvas.nodes.some((node) => node.kind === 'end')
        if (!hasStart || !hasEnd) {
          notify('error', t.needStartAndEnd)
          return
        }
        void runControl.startRun(flow.sessionId, flow.id).then((runId) => {
          if (runId) notify('success', t.toastRunning)
        }).catch((error) => toastError(error))
      })
      return
    }
    const flow = currentFlowOf(state)
    if (!flow) return
    const hasStart = state.canvas.nodes.some((node) => node.kind === 'start')
    const hasEnd = state.canvas.nodes.some((node) => node.kind === 'end')
    if (!hasStart || !hasEnd) {
      notify('error', t.needStartAndEnd)
      return
    }
    const saved = await saveCanvas()
    if (!saved) return
    try {
      // 运行当前实例：会话 = 实例绑定的会话（不再支持运行期新建会话）
      const runId = await runControl.startRun((saved as import('../../host/shared/graph-model.js').WorkflowDocument).sessionId, saved.id)
      if (runId) notify('success', t.toastRunning)
    } catch (error) {
      toastError(error)
    }
  }, [createInstanceFromCanvas, notify, runControl, saveCanvas, state, t.needStartAndEnd, t.toastRunning, toastError])

  const stopRun = useCallback(async () => {
    if (!state.run.runId) return
    try {
      // 归属会话 = run 实际执行会话 ?? 实例绑定的会话（新逻辑二者恒一致）
      const flow = currentFlowOf(state)
      await runControl.stopRun(state.run.sessionId ?? flow?.sessionId ?? state.sessionId, state.run.runId)
      notify('info', t.toastStopped)
    } catch (error) {
      toastError(error)
    }
  }, [notify, runControl, state.run.runId, state.run.sessionId, state.sessionId, t.toastStopped, toastError])

  // ---------- 运行历史 / 断点恢复 ----------
  const openHistory = useCallback(async () => {
    dispatch({ type: 'HISTORY_OPEN', open: true })
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      // 会话隔离：历史查询必须携带实例归属会话（Bug 14；新逻辑即执行会话）
      const historySessionId = state.run.sessionId ?? flow.sessionId
      const items = await remote.call(EP.EP_RUN_HISTORY, { sessionId: historySessionId, flowId: flow.id }) as unknown[]
      dispatch({ type: 'RUN_HISTORY_LOADED', items: Array.isArray(items) ? items as [] : [] })
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, state, remote, toastError])

  const resumeRun = useCallback(async (runId: string) => {
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      // 断点续跑在实例绑定的会话内进行（新逻辑即原执行会话）
      const result = await remote.call(EP.EP_RUN_RESUME, { sessionId: state.run.sessionId ?? flow.sessionId, flowId: flow.id, runId }) as { runId?: unknown }
      const newRunId = String(result?.runId ?? '')
      if (newRunId) dispatch({ type: 'RUN_STARTED', runId: newRunId, ...(state.run.sessionId ? { runSessionId: state.run.sessionId } : {}) })
      dispatch({ type: 'HISTORY_OPEN', open: false })
      notify('success', t.toastResuming)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, state, t.toastResuming, toastError])

  // ---------- 模式二服务 ----------
  const startService = useCallback(async () => {
    // 模板态：运行前自动「创建服务实例」（含开启新会话/覆盖确认）再启动——
    // 与模式一模板运行语义一致；后续启动统一经 afterCreate 回调接续。
    if (state.currentKind === 'flowTemplate') {
      const template = currentFlowTemplateOf(state)
      if (!template) return
      const hasInput = state.canvas.nodes.some((node) => node.kind === 'start')
      const hasOutput = state.canvas.nodes.some((node) => node.kind === 'end')
      const hasParent = state.canvas.nodes.some((node) => node.kind === 'parent')
      if (!hasInput || !hasOutput) {
        notify('error', t.needStartAndEnd)
        return
      }
      if (!hasParent) {
        notify('error', t.needParentForService)
        return
      }
      void createInstanceFromCanvas((created) => {
        const service = created as import('../../host/shared/types.js').ServiceState
        void serviceControl.startService(service.id, service.sessionId).then(() => {
          notify('success', t.toastServiceStarted)
        }).catch((error) => toastError(error))
      })
      return
    }
    const service = currentServiceOf(state)
    if (!service) return
    const hasInput = state.canvas.nodes.some((node) => node.kind === 'start')
    const hasOutput = state.canvas.nodes.some((node) => node.kind === 'end')
    const hasParent = state.canvas.nodes.some((node) => node.kind === 'parent')
    if (!hasInput || !hasOutput) {
      notify('error', t.needStartAndEnd)
      return
    }
    if (!hasParent) {
      notify('error', t.needParentForService)
      return
    }
    const saved = await saveCanvas()
    if (!saved) return
    try {
      // 启动当前服务实例：会话 = 实例绑定的会话
      await serviceControl.startService((saved as import('../../host/shared/types.js').ServiceState).id, (saved as import('../../host/shared/types.js').ServiceState).sessionId)
      notify('success', t.toastServiceStarted)
    } catch (error) {
      toastError(error)
    }
  }, [createInstanceFromCanvas, notify, saveCanvas, serviceControl, state, t.needParentForService, t.needStartAndEnd, t.toastServiceStarted, toastError])

  const stopService = useCallback(async () => {
    const service = currentServiceOf(state)
    if (!service) return
    try {
      await serviceControl.stopService(service.id, service.sessionId)
      notify('info', t.toastServiceStopped)
    } catch (error) {
      toastError(error)
    }
  }, [notify, serviceControl, t.toastServiceStopped, toastError])

  return { startRun, stopRun, openHistory, resumeRun, startService, stopService }
}

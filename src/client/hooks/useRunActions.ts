// src/client/hooks/useRunActions.ts
//
// 运行与服务控制面：模式一运行启停/运行历史/断点恢复，模式二服务启停。
// 模板态运行时先「创建实例/创建服务」再启动（与保存语义一致）。

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
    // 模板态：运行前自动「创建实例」再运行（用户裁决 q4：实例名 = 模板名 + 序号，
    // 零打断；模板本身不变）。
    if (state.currentKind === 'flowTemplate') {
      const created = await createInstanceFromCanvas()
      if (!created) return
      // 创建成功后画布已切到实例态，直接运行该实例（无需再次读取 state）
      const hasStart = state.canvas.nodes.some((node) => node.kind === 'start')
      const hasEnd = state.canvas.nodes.some((node) => node.kind === 'end')
      if (!hasStart || !hasEnd) {
        notify('error', t.needStartAndEnd)
        return
      }
      try {
        const runId = await runControl.startRun(state.sessionId, created.id)
        if (runId) notify('success', t.toastRunning)
      } catch (error) {
        toastError(error)
      }
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
      const runId = await runControl.startRun(state.sessionId, saved.id)
      if (runId) notify('success', t.toastRunning)
    } catch (error) {
      toastError(error)
    }
  }, [notify, runControl, saveCanvas, createInstanceFromCanvas, state.canvas.nodes, state.mode, state.sessionId, t.needStartAndEnd, t.toastRunning, toastError])

  const stopRun = useCallback(async () => {
    if (!state.run.runId) return
    try {
      await runControl.stopRun(state.sessionId, state.run.runId)
      notify('info', t.toastStopped)
    } catch (error) {
      toastError(error)
    }
  }, [notify, runControl, state.run.runId, state.sessionId, t.toastStopped, toastError])

  // ---------- 运行历史 / 断点恢复 ----------
  const openHistory = useCallback(async () => {
    dispatch({ type: 'HISTORY_OPEN', open: true })
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      // 会话隔离：历史查询必须携带当前会话（Bug 14）
      const items = await remote.call(EP.EP_RUN_HISTORY, { sessionId: state.sessionId, flowId: flow.id }) as unknown[]
      dispatch({ type: 'RUN_HISTORY_LOADED', items: Array.isArray(items) ? items as [] : [] })
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, state, remote, toastError])

  const resumeRun = useCallback(async (runId: string) => {
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      const result = await remote.call(EP.EP_RUN_RESUME, { sessionId: state.sessionId, flowId: flow.id, runId }) as { runId?: unknown }
      const newRunId = String(result?.runId ?? '')
      if (newRunId) dispatch({ type: 'RUN_STARTED', runId: newRunId })
      dispatch({ type: 'HISTORY_OPEN', open: false })
      notify('success', t.toastResuming)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, state, t.toastResuming, toastError])

  // ---------- 模式二服务 ----------
  const startService = useCallback(async () => {
    // 模板态：运行前自动「创建服务实例」再启动（与模式一模板运行语义一致）
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
      const draft = serviceControl.instantiateFromTemplate(template, state.sessionId)
      const saved = await serviceControl.saveService(draft, state.canvas.nodes, state.canvas.edges)
      if (!saved) return
      try {
        await serviceControl.startService(saved.id, saved.sessionId)
        notify('success', t.toastServiceStarted)
      } catch (error) {
        toastError(error)
      }
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
      await serviceControl.startService(service.id, service.sessionId)
      notify('success', t.toastServiceStarted)
    } catch (error) {
      toastError(error)
    }
  }, [notify, saveCanvas, serviceControl, state.canvas.nodes, state.mode, t.needParentForService, t.needStartAndEnd, t.toastServiceStarted, toastError])

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

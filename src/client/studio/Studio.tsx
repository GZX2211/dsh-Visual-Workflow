// src/client/studio/Studio.tsx
//
// 工作台主组件（照搬旧项目 studio.js 的布局与交互流程，TSX 化 + 新模型装配）：
//   窗口内完整工作台 = 标题顶栏（工作流设计器 + 导入/导出/模式/组合 + 关闭）
//   + 画布控制栏 + 三栏（左侧库 / 画布 / 右侧属性面板）。
//   本文件负责组件装配、派生数据与初始化编排；交互逻辑拆至 hooks/ 下的
//   controller hooks（useDocumentActions / useCanvasActions / useEditorActions /
//   useRunActions / useStudioTransfer / useLibraryDrag / useStudioBoot /
//   useKeyShortcuts），渲染 JSX 在 StudioLayout（纯展示，props 注入）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../i18n.js'
import { useStudioState } from '../hooks/useStudioState.js'
import { useRemote, type RemoteFace } from '../hooks/useRemote.js'
import { useToast } from '../hooks/useToast.js'
import { useWorkflows } from '../hooks/useWorkflows.js'
import { useFlowTemplates } from '../hooks/useFlowTemplates.js'
import { useTemplates } from '../hooks/useTemplates.js'
import { useSelection } from '../hooks/useSelection.js'
import { useGraphHistory } from '../hooks/useGraphHistory.js'
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js'
import { useRunControl } from '../hooks/useRunControl.js'
import { useRunPolling } from '../hooks/useRunPolling.js'
import { useFlowFileSync } from '../hooks/useFlowFileSync.js'
import { useServiceControl } from '../hooks/useServiceControl.js'
import { useModeSwitch } from '../hooks/useModeSwitch.js'
import { usePanelLayout } from '../hooks/usePanelLayout.js'
import { useDocumentActions } from '../hooks/useDocumentActions.js'
import { useCanvasActions } from '../hooks/useCanvasActions.js'
import { useEditorActions } from '../hooks/useEditorActions.js'
import { useRunActions } from '../hooks/useRunActions.js'
import { useStudioTransfer } from '../hooks/useStudioTransfer.js'
import { useLibraryDrag } from '../hooks/useLibraryDrag.js'
import { useStudioBoot } from '../hooks/useStudioBoot.js'
import { useKeyShortcuts } from '../hooks/useKeyShortcuts.js'
import {
  currentFlowOf, currentServiceOf, currentFlowTemplateOf, editorDataOf, isRunningOf,
} from './studio-state.js'
import { StudioLayout } from './StudioLayout.js'
import type { CanvasApi } from '../components/canvas/GraphCanvas.js'
import { flowToCanvasLines, runStatusMap, runningNodeIds, stageTemplateKinds } from '../lib/graph-model.js'

export interface StudioProps {
  /** 文案词典。 */
  t: Dict
  /** 绑定的会话 id。 */
  sessionId: string
  /** 远端调用面（测试注入；缺省 useRemote）。 */
  remote?: RemoteFace
  /** 窗口关闭回调（标题栏 ×；浮窗宿主注入；对话视图挂载无关闭）。 */
  onClose?: () => void
  /** 窗口拖动把手回调（浮窗注入；工作台标题顶栏兼任窗口标题栏拖动）。 */
  onTitlebarDrag?: (event: React.PointerEvent) => void
  /** 视图模式（浮窗/分栏）；分栏时工作台初始折叠自身左右栏。 */
  viewMode?: 'float' | 'split'
  /** 标题栏窗口切换按钮回调（float↔split，宿主持久化）。 */
  onToggleView?: () => void
  /** 运行联动：进入分栏模式（宿主持久化；配合运行触发）。 */
  onEnterSplit?: () => void
}

export function Studio({ t, sessionId, remote: remoteProp, onClose, onTitlebarDrag, viewMode, onToggleView, onEnterSplit }: StudioProps) {
  const remote = remoteProp ?? useRemote()
  const { state, dispatch } = useStudioState(sessionId)
  const { toast, toastError } = useToast(dispatch)
  const workflows = useWorkflows(dispatch, remote, state.sessionId)
  const flowTemplates = useFlowTemplates(dispatch, remote)
  const templates = useTemplates(dispatch, remote)
  const selection = useSelection(dispatch)
  const history = useGraphHistory(state, dispatch)
  const guard = useUnsavedGuard(state, dispatch)
  const runControl = useRunControl(dispatch, remote)
  const serviceControl = useServiceControl(dispatch, remote)
  const modeSwitch = useModeSwitch(dispatch)
  const panels = usePanelLayout(state, dispatch)
  useRunPolling(state.sessionId, state.run.runId, dispatch, remote)

  const canvasApiRef = useRef<CanvasApi | null>(null)
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const libraryImportRef = useRef<HTMLInputElement | null>(null)
  const personaInputRef = useRef<HTMLInputElement | null>(null)
  const groupMdInputRef = useRef<HTMLInputElement | null>(null)

  const currentFlow = currentFlowOf(state)
  const currentService = currentServiceOf(state)
  const currentFlowTemplate = currentFlowTemplateOf(state)
  const editorData = editorDataOf(state)
  const running = isRunningOf(state)
  // 画布左上角工作流名称角标（用户批注：显示方式「模板/实例（工作流名称）」；采用「模板：名」「实例：名」）
  const canvasCaption = currentFlowTemplate
    ? `模板：${currentFlowTemplate.name ?? ''}`
    : currentService
      ? `实例：${currentService.name ?? ''}`
      : currentFlow
        ? `实例：${currentFlow.name ?? ''}`
        : ''
  // 运行中双向同步（需求 §4.5.8）：当前运行节点高亮 = 快照中 status=running 的节点
  // id 列表（GraphCanvas 渲染 is-highlighted；防回环：只写视图，不进保存/撤销历史）。
  const highlightedNodeIds = useMemo(() => runningNodeIds(state.run.snapshot), [state.run.snapshot])
  const runStatusByNode = useMemo(() => runStatusMap(state.run.snapshot), [state.run.snapshot])

  useEffect(() => {
    dispatch({ type: 'SET_SESSION', sessionId })
  }, [dispatch, sessionId])

  // ---------- 轻提示 ----------
  const notify = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
    toast(kind, text)
  }, [toast])

  // 双向同步②「流程文件→画布」：外部修改实例文件后轮询检测并响应（自动刷新/提示）
  useFlowFileSync(state, dispatch, remote, useCallback((message: string) => notify('error', message), [notify]))

  // ---------- 模式名映射 ----------
  const modeName = useCallback((presetId: string | null | undefined): string => {
    const value = String(presetId ?? '')
    if (!value) return '—'
    const names = t.modeNames as Record<string, string>
    if (names[value]) return names[value]
    const preset = state.presets.find((item) => item.id === value)
    if (preset) return preset.name ?? value
    const combo = state.combos.find((item) => item.id === value)
    if (combo) return combo.name
    return value
  }, [state.combos, state.presets, t.modeNames])

  // ---------- 交互编排面（拆分至 hooks/ 的 controller hooks） ----------
  const doc = useDocumentActions(state, dispatch, guard, notify, toastError, workflows, flowTemplates, templates, selection, serviceControl, t)
  const canvas = useCanvasActions(state, dispatch, notify, history, t)
  const editor = useEditorActions(state, dispatch, notify, toastError, t, workflows, flowTemplates, templates, selection, remote, doc.saveCanvas, canvas.removeSelected, canvas.removeLine, doc.selectWorkflow, doc.selectFlowTemplate)
  const run = useRunActions(state, dispatch, notify, toastError, t, remote, runControl, serviceControl, doc.saveCanvas, doc.createInstanceFromCanvas)
  const transfer = useStudioTransfer(state, dispatch, notify, toastError, t, remote, templates, flowTemplates, workflows, editor.patchEditor, editorData, personaInputRef, groupMdInputRef)
  const { beginLibraryDrag, dragPreview, dropGroupId } = useLibraryDrag(canvasShellRef, canvasApiRef)
  useKeyShortcuts(state, dispatch, selection, history, canvas.removeLine, canvas.removeSelected)

  // ---------- 初始化加载 ----------
  useStudioBoot(
    state, dispatch, notify, toastError, t, remote, workflows, flowTemplates, templates, serviceControl,
    doc.openFlowById, doc.openServiceById, pickInitialInstance,
  )

  // ---------- 模式切换（未保存守卫；需求 §4.1.1） ----------
  const switchMode = useCallback((mode: 'mode1' | 'mode2') => {
    if (mode === state.mode) return
    guard.guard(() => {
      modeSwitch.setMode(mode)
      dispatch({ type: 'CLEAR_CANVAS' })
      if (mode === 'mode1') {
        void workflows.loadWorkflows()
      } else {
        void serviceControl.loadServices(state.sessionId)
      }
    })
  }, [dispatch, guard, modeSwitch, serviceControl, state.mode, state.sessionId, workflows])

  const [modeMenuOpen, setModeMenuOpen] = useState(false)

  // ---------- 关闭守卫（§4.5.9：关闭工作台前未保存修改需确认） ----------
  const requestClose = useCallback(() => {
    if (!onClose) return
    guard.guard(() => onClose())
  }, [guard, onClose])

  // ---------- 运行联动（图2：点击「运行」→ 自动切分栏 + 折叠工作台自身左右栏） ----------
  const handleRun = useCallback(() => {
    // 1) 宿主切到分栏模式（持久化）
    onEnterSplit?.()
    // 2) 折叠工作台自身左右栏（左侧模板栏 + 右侧属性栏，中间保留画布栏）
    dispatch({ type: 'PANELS_SET', panels: { leftOpen: false, rightOpen: false } })
    // 3) 触发真正运行
    void (state.mode === 'mode2' ? run.startService() : run.startRun())
  }, [dispatch, onEnterSplit, run, state.mode])

  // 分栏模式下工作台初始折叠自身左右栏（沉浸式；用户可再拖动展开）
  useEffect(() => {
    if (viewMode === 'split') {
      dispatch({ type: 'PANELS_SET', panels: { leftOpen: false, rightOpen: false } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 派生 ----------
  const stageKinds = useMemo(() => stageTemplateKinds(state.mode), [state.mode])
  const parentTemplate = useMemo(() => (state.templates.role as import('../../host/shared/types.js').RoleTemplate[]).find((item) => item.kind === 'parent') ?? null, [state.templates.role])
  const roleTemplates = useMemo(() => (state.templates.role as import('../../host/shared/types.js').RoleTemplate[]).filter((item) => item.kind !== 'parent'), [state.templates.role])
  const edgeList = useMemo(() => flowToCanvasLines(state.canvas.edges), [state.canvas.edges])
  const toolbarRunning = state.mode === 'mode2' ? currentService?.status === 'running' : running

  // ---------- 渲染（委托 StudioLayout 纯展示层） ----------
  return (
    <StudioLayout
      t={t}
      state={state}
      sessionId={state.sessionId}
      remote={remote}
      onClose={onClose}
      onTitlebarDrag={onTitlebarDrag}
      currentFlow={currentFlow}
      currentService={currentService}
      editorData={editorData}
      edgeList={edgeList}
      stageKinds={stageKinds}
      parentTemplate={parentTemplate}
      roleTemplates={roleTemplates}
      groupTemplates={state.templates.group as import('../../host/shared/types.js').GroupTemplate[]}
      toolbarRunning={toolbarRunning}
      runStatusByNode={runStatusByNode}
      highlightedNodeIds={highlightedNodeIds}
      modeName={modeName}
      canvasCaption={canvasCaption}
      canvasApiRef={canvasApiRef}
      canvasShellRef={canvasShellRef}
      libraryImportRef={libraryImportRef}
      personaInputRef={personaInputRef}
      groupMdInputRef={groupMdInputRef}
      dispatch={dispatch}
      doc={doc}
      canvas={canvas}
      editor={editor}
      run={run}
      transfer={transfer}
      selection={selection}
      history={history}
      guard={guard}
      panels={panels}
      toast={toast}
      beginLibraryDrag={beginLibraryDrag}
      dragPreview={dragPreview}
      dropGroupId={dropGroupId}
      modeMenuOpen={modeMenuOpen}
      setModeMenuOpen={setModeMenuOpen}
      switchMode={switchMode}
      requestClose={requestClose}
      viewMode={viewMode}
      onToggleView={onToggleView}
      handleRun={handleRun}
    />
  )
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

/**
 * 进入工作台自动选中实例（用户新增需求）：从实例列表中选出默认打开的实例 id。
 * 规则（优先级）：
 *   1. 正在运行的实例——activeRuns 中 status='running' 的 flowId 对应实例；
 *   2. 已暂停的实例——activeRuns 中 status='paused' 的 flowId 对应实例；
 *   3. 实例列表第一个；
 * 校验：activeRuns 的 flowId 必须在实例列表中（否则忽略该条目，防止引用不存在实例）；
 * 实例列表为空时返回 null（保持空白画布，当前状态）。
 */
export function pickInitialInstance(
  instances: Array<{ id: string; name?: string }>,
  activeRuns: Array<{ flowId: string; status: string }>,
): string | null {
  if (!instances || instances.length === 0) return null
  const idSet = new Set(instances.map((item) => item.id))
  const running = activeRuns.find((run) => run.status === 'running' && idSet.has(run.flowId))
  if (running) return running.flowId
  const paused = activeRuns.find((run) => run.status === 'paused' && idSet.has(run.flowId))
  if (paused) return paused.flowId
  return instances[0].id
}

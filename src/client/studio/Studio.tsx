// src/client/studio/Studio.tsx
//
// 工作台主组件（T-042）：三栏布局 + 状态机装配。
// 会话绑定：sessionId 由入口注入（无会话下拉）；列表/模板/服务/运行全部经
// hooks 与后端 /visual-workflow/* 对接。画布/面板/工具栏组件在后续任务
// 填充，本阶段提供布局骨架与数据加载链路。

import { useCallback, useEffect, useMemo } from 'react'
import type { Dict } from '../i18n.js'
import { useStudioState } from '../hooks/useStudioState.js'
import { useRemote, type RemoteFace } from '../hooks/useRemote.js'
import { useToast } from '../hooks/useToast.js'
import { useWorkflows } from '../hooks/useWorkflows.js'
import { useTemplates } from '../hooks/useTemplates.js'
import { useSelection } from '../hooks/useSelection.js'
import { useGraphHistory } from '../hooks/useGraphHistory.js'
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js'
import { useRunControl } from '../hooks/useRunControl.js'
import { useRunPolling } from '../hooks/useRunPolling.js'
import { useServiceControl } from '../hooks/useServiceControl.js'
import { useModeSwitch } from '../hooks/useModeSwitch.js'
import { usePanelLayout } from '../hooks/usePanelLayout.js'
import { currentFlowOf, editorDataOf, isRunningOf, type LibTab } from './studio-state.js'
import { EP } from '../lib/remote.js'

export interface StudioProps {
  /** 文案词典。 */
  t: Dict
  /** 绑定的会话 id。 */
  sessionId: string
  /** 远端调用面（测试注入；缺省 useRemote）。 */
  remote?: RemoteFace
}

/** 左侧栏四 Tab（workflow/role/file/database）。 */
export const LIB_TABS: Array<{ key: LibTab; label: string }> = [
  { key: 'workflow', label: '' },
  { key: 'role', label: '' },
  { key: 'file', label: '' },
  { key: 'database', label: '' },
]

export function Studio({ t, sessionId, remote: remoteProp }: StudioProps) {
  const remote = remoteProp ?? useRemote()
  const { state, dispatch } = useStudioState(sessionId)
  const { toast, toastError } = useToast(dispatch)
  const workflows = useWorkflows(dispatch, remote, state.sessionId)
  const templates = useTemplates(dispatch, remote)
  const selection = useSelection(dispatch)
  const history = useGraphHistory(state, dispatch)
  const guard = useUnsavedGuard(state, dispatch)
  const runControl = useRunControl(dispatch, remote)
  const serviceControl = useServiceControl(dispatch, remote)
  const modeSwitch = useModeSwitch(dispatch)
  const panels = usePanelLayout(state, dispatch)
  useRunPolling(state.run.runId, dispatch, remote)

  const currentFlow = currentFlowOf(state)
  const editorData = editorDataOf(state)
  const running = isRunningOf(state)

  // 初始数据加载（工作流/模板/服务/生态枚举/组合）
  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      try {
        await Promise.all([
          workflows.loadWorkflows(),
          templates.loadTemplates(),
          serviceControl.loadServices(state.sessionId),
        ])
      } catch (error) {
        if (!cancelled) toastError(error)
      }
      const enums = async (): Promise<void> => {
        const [presets, tools, models, combos] = await Promise.all([
          remote.call(EP.EP_PRESETS).catch(() => []),
          remote.call(EP.EP_TOOLS).catch(() => []),
          remote.call(EP.EP_MODELS).catch(() => []),
          remote.call(EP.EP_TOOL_COMBOS).catch(() => []),
        ])
        if (cancelled) return
        dispatch({ type: 'PRESETS_LOADED', items: Array.isArray(presets) ? presets : [] })
        dispatch({ type: 'TOOLS_LOADED', items: Array.isArray(tools) ? tools : [] })
        dispatch({ type: 'MODELS_LOADED', items: Array.isArray(models) ? models : [] })
        dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(combos) ? combos : [] })
      }
      await enums()
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId])

  // 会话绑定更新（入口 sessionId 变化时同步状态机）
  useEffect(() => {
    dispatch({ type: 'SET_SESSION', sessionId })
  }, [dispatch, sessionId])

  /** 新建：工作流草稿 / 三类模板草稿（列表空态 + 入口按钮共用）。 */
  const createNew = useCallback((tab: LibTab) => {
    if (tab === 'workflow') {
      const draft = workflows.createWorkflowDraft(t.newWorkflow)
      workflows.openFlow(draft)
      toast('info', t.newWorkflow)
      return
    }
    const template = templates.createTemplateDraft(tab)
    selection.selectEditor({ source: 'template', kind: tab, id: template.id })
    toast('info', t.newTemplate)
  }, [selection, t, templates, toast, workflows])

  /** 打开工作流（未保存守卫后切换）。 */
  const openWorkflow = useCallback((id: string) => {
    const flow = state.workflows.find((item) => item.id === id)
    if (!flow) return
    guard.guard(() => workflows.openFlow(flow))
  }, [guard, state.workflows, workflows])

  /** 保存当前画布（工具栏/确认框共用）。 */
  const saveCanvas = useCallback(async () => {
    const flow = currentFlowOf(state)
    if (!flow) return null
    try {
      const saved = await workflows.saveWorkflow(flow, state.canvas.nodes, state.canvas.edges)
      if (saved) {
        dispatch({ type: 'SET_DIRTY', dirty: false })
        toast('success', t.toastSaved)
      }
      return saved
    } catch (error) {
      toastError(error)
      return null
    }
  }, [dispatch, state, t, toast, toastError, workflows])

  const tabList = useMemo(() => LIB_TABS.map((tab) => ({ ...tab, label: t.libTab[tab.key] })), [t])

  /** 当前 Tab 的列表数据（P11 只读列表；拖拽/模板编辑由后续任务填充）。 */
  const currentList: Array<{ id: string; name: string; status?: string }> = (() => {
    if (state.libTab === 'workflow') {
      return state.workflows.map((flow) => ({ id: flow.id, name: flow.name, status: flow.mode }))
    }
    const items = state.templates[state.libTab]
    return items.map((item) => ({ id: item.id, name: String((item as { name?: unknown }).name ?? '') }))
  })()

  const emptyHint: Record<LibTab, string> = {
    workflow: t.libWorkflowEmpty,
    role: t.libRoleEmpty,
    file: t.libFileEmpty,
    database: t.libDatabaseEmpty,
  }

  return (
    <div className="wf-root" data-wf-root="">
      {/* 标题栏（窗口内工作台顶栏） */}
      <nav className="wf-tabs" data-wf-titlebar="">
        <span className="wf-titlebar__title">{t.studio}</span>
        <span className="wf-titlebar__badge">{t.badge}</span>
        <span className="wf-titlebar__note">{t.note}</span>
        <span className="wf-titlebar__spacer" />
        <span className="wf-titlebar__session" title={state.sessionId}>{t.currentSession}</span>
      </nav>

      <main className="wf-main" data-wf-main="">
        {/* 左侧栏：四 Tab 头 + 列表（只读；完整交互 T-044） */}
        <aside className="wf-left" data-wf-left="" style={{ width: state.panels.leftOpen ? state.panels.leftWidth : 0, display: state.panels.leftOpen ? undefined : 'none' }}>
          <div className="wf-lib-tabs" role="tablist">
            {tabList.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                className={`wf-lib-tab${state.libTab === tab.key ? ' is-active' : ''}`}
                onClick={() => dispatch({ type: 'SET_LIB_TAB', tab: tab.key })}
              >
                {tab.label}
              </button>
            ))}
            <button type="button" className="wf-lib-tab wf-lib-tab__add" title={t.newTemplate} onClick={() => createNew(state.libTab)}>+</button>
          </div>
          <div className="wf-lib-list">
            {currentList.length === 0 ? (
              <div className="wf-lib-empty">{emptyHint[state.libTab]}</div>
            ) : (
              <ul>
                {currentList.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`wf-lib-item${state.currentId === item.id ? ' is-active' : ''}`}
                      onClick={() => { if (state.libTab === 'workflow') openWorkflow(item.id) }}
                    >
                      <span className="wf-lib-item__name">{item.name}</span>
                      {item.status ? <span className="wf-lib-item__status">{item.status === 'mode2' ? t.mode2 : t.mode1}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* 左分隔条 */}
        <div className="wf-splitter" role="separator" aria-orientation="vertical" onPointerDown={(event) => panels.beginResize('left', event)} />

        {/* 画布区（骨架占位；画布组件 T-043） */}
        <div className="wf-canvas-shell" data-wf-canvas="">
          <div className="wf-canvas-toolbar">
            <span className="wf-canvas-toolbar__mode">{state.mode === 'mode2' ? t.mode2 : t.mode1}</span>
            <span className="wf-canvas-toolbar__flow">{currentFlow?.name ?? ''}</span>
            <span className="wf-canvas-toolbar__spacer" />
            <button type="button" className="wf-btn" disabled={!currentFlow || running} onClick={() => { void runFlow() }}>{t.run}</button>
            <button type="button" className="wf-btn" disabled={!running} onClick={() => { if (state.run.runId) void runControl.stopRun(state.run.runId) }}>{t.stop}</button>
            <button type="button" className="wf-btn" disabled={!currentFlow} onClick={() => { void saveCanvas() }}>{t.save}</button>
          </div>
          <div className="wf-canvas-empty">
            <p>{t.canvasEmpty}</p>
            {running ? <p className="wf-canvas-empty__running">{t.statusRunning}</p> : null}
          </div>
        </div>

        {/* 右分隔条 */}
        <div className="wf-splitter" role="separator" aria-orientation="vertical" onPointerDown={(event) => panels.beginResize('right', event)} />

        {/* 右侧属性面板（骨架占位；面板组件 T-045） */}
        <aside className="wf-inspector" data-wf-inspector="" style={{ width: state.panels.rightOpen ? state.panels.rightWidth : 0, display: state.panels.rightOpen ? undefined : 'none' }}>
          <div className="wf-inspector__empty">{t.inspectorEmpty}</div>
          {editorData ? <div className="wf-inspector__current">{editorData.name || editorData.kind}</div> : null}
        </aside>
      </main>

      {/* 状态消息条 */}
      {state.message ? <div className="wf-message">{state.message}</div> : null}

      {/* 轻提示 */}
      <div className="wf-toast-host">
        {state.toasts.map((item) => (
          <div key={item.id} className={`wf-toast is-${item.kind}`}>
            <span className="wf-toast__dot" />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )

  /** 运行当前工作流：先保存（草稿入库），再 run 端点（断点自动续跑）。 */
  async function runFlow(): Promise<void> {
    const flow = currentFlowOf(state)
    if (!flow || running) return
    try {
      const saved = await saveCanvas()
      if (!saved) return
      await runControl.startRun(state.sessionId, saved.id)
      toast('success', t.toastRunning)
    } catch (error) {
      toastError(error)
    }
  }
}

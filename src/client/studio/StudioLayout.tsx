// src/client/studio/StudioLayout.tsx
//
// 工作台渲染层（纯展示，无状态/无副作用）：标题顶栏 + 三栏工作区 + 浮层
// （确认弹窗/运行历史/组合管理/拖拽预览/轻提示）。所有数据与回调由
// Studio 主组件经 props 注入（各 controller hook 的 face + 派生数据），
// 本组件只负责 JSX 组合，不承载任何业务逻辑。

import type { Dispatch } from 'react'
import type { Dict } from '../i18n.js'
import type { StudioAction, StudioState, EditorData } from './studio-state.js'
import type { DocumentActionsFace } from '../hooks/useDocumentActions.js'
import type { CanvasActionsFace } from '../hooks/useCanvasActions.js'
import type { EditorActionsFace } from '../hooks/useEditorActions.js'
import type { RunActionsFace } from '../hooks/useRunActions.js'
import type { StudioTransferFace } from '../hooks/useStudioTransfer.js'
import type { LibraryDragFace } from '../hooks/useLibraryDrag.js'
import type { SelectionFace } from '../hooks/useSelection.js'
import type { GraphHistoryFace } from '../hooks/useGraphHistory.js'
import type { UnsavedGuardFace } from '../hooks/useUnsavedGuard.js'
import type { PanelLayoutFace } from '../hooks/usePanelLayout.js'
import type { RemoteFace } from '../hooks/useRemote.js'
import type { ToastFace } from '../hooks/useToast.js'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { RoleTemplate, ServiceState } from '../../host/shared/types.js'
import type { flowToCanvasLines, runStatusMap, runningNodeIds, stageTemplateKinds } from '../lib/graph-model.js'
import { EP } from '../lib/remote.js'
import type { CanvasApi } from '../components/canvas/GraphCanvas.js'
import { GraphCanvas } from '../components/canvas/GraphCanvas.js'
import { LeftPanel } from '../components/sidebar/LeftPanel.js'
import { Toolbar } from '../components/toolbar/Toolbar.js'
import { Inspector } from '../components/panels/inspector/Inspector.js'
import { ConfirmDialog } from '../components/confirm-dialog/ConfirmDialog.js'
import { RunHistory } from '../components/run-history/RunHistory.js'
import { ServiceConsole } from '../components/service-console/ServiceConsole.js'
import { ComboManager } from '../components/combo-manager/ComboManager.js'

export interface StudioLayoutProps {
  t: Dict
  state: StudioState
  sessionId: string
  remote: RemoteFace
  /** 窗口关闭回调（标题栏 ×；浮窗宿主注入；对话视图挂载无关闭）。 */
  onClose?: () => void
  /** 窗口拖动把手回调（浮窗注入；工作台标题顶栏兼任窗口标题栏拖动）。 */
  onTitlebarDrag?: (event: React.PointerEvent) => void
  // ---- 派生数据 ----
  currentFlow: WorkflowDocument | null
  currentService: ServiceState | null
  editorData: EditorData | null
  edgeList: ReturnType<typeof flowToCanvasLines>
  stageKinds: ReturnType<typeof stageTemplateKinds>
  parentTemplate: RoleTemplate | null
  roleTemplates: RoleTemplate[]
  toolbarRunning: boolean
  runStatusByNode: ReturnType<typeof runStatusMap>
  highlightedNodeIds: ReturnType<typeof runningNodeIds>
  modeName: (presetId: string | null | undefined) => string
  // ---- DOM 引用 ----
  canvasApiRef: React.RefObject<CanvasApi | null>
  canvasShellRef: React.RefObject<HTMLDivElement | null>
  libraryImportRef: React.RefObject<HTMLInputElement | null>
  personaInputRef: React.RefObject<HTMLInputElement | null>
  groupMdInputRef: React.RefObject<HTMLInputElement | null>
  // ---- 交互面（controller hook faces） ----
  dispatch: Dispatch<StudioAction>
  doc: DocumentActionsFace
  canvas: CanvasActionsFace
  editor: EditorActionsFace
  run: RunActionsFace
  transfer: StudioTransferFace
  selection: SelectionFace
  history: GraphHistoryFace
  guard: UnsavedGuardFace
  panels: PanelLayoutFace
  toast: ToastFace['toast']
  // ---- 拖拽 UI 状态 ----
  beginLibraryDrag: LibraryDragFace['beginLibraryDrag']
  dragPreview: LibraryDragFace['dragPreview']
  dropGroupId: LibraryDragFace['dropGroupId']
  // ---- 模式菜单 / 模式与关闭 ----
  modeMenuOpen: boolean
  setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  switchMode: (mode: 'mode1' | 'mode2') => void
  requestClose: () => void
}

/** 工作台渲染层（纯 JSX 组合；回调/数据全部来自 props）。 */
export function StudioLayout(props: StudioLayoutProps) {
  const {
    t, state, sessionId, remote, onClose, onTitlebarDrag,
    currentFlow, currentService, editorData, edgeList, stageKinds, parentTemplate, roleTemplates,
    toolbarRunning, runStatusByNode, highlightedNodeIds, modeName,
    canvasApiRef, canvasShellRef, libraryImportRef, personaInputRef, groupMdInputRef,
    dispatch, doc, canvas, editor, run, transfer, selection, history, guard, panels, toast,
    beginLibraryDrag, dragPreview, dropGroupId,
    modeMenuOpen, setModeMenuOpen, switchMode, requestClose,
  } = props

  return (
    <div className="wf-root" data-wf-immersive="true">
      {/* 标题顶栏 = 窗口标题栏（工作流设计器一行；可拖动；组合按钮右侧为关闭按钮） */}
      <nav className="wf-tabs" data-wf-titlebar="" onPointerDown={onTitlebarDrag}>
        <span className="wf-titlebar__title">{t.studio}</span>
        <span className="wf-titlebar__badge">{t.badge}</span>
        <span className="wf-titlebar__note">{t.note}</span>
        <span className="wf-titlebar__spacer" />
        <input
          ref={libraryImportRef}
          type="file"
          accept=".json,application/json"
          className="wf-import-hidden"
          onChange={(event) => { void transfer.handleImportFile(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <input
          ref={personaInputRef}
          type="file"
          accept=".md,.markdown"
          className="wf-import-hidden"
          onChange={(event) => { void transfer.onPersonaMdSelected(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <input
          ref={groupMdInputRef}
          type="file"
          accept=".md,.markdown"
          className="wf-import-hidden"
          onChange={(event) => { void transfer.onGroupMdSelected(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <button type="button" className="wf-btn is-ghost" onClick={() => libraryImportRef.current?.click()}>{t.importWorkflow}</button>
        <button type="button" className="wf-btn is-ghost" onClick={() => { void transfer.exportCurrent() }}>{t.exportWorkflow}</button>
        <div className="wf-titlebar__mode">
          <button type="button" className="wf-btn" onClick={() => setModeMenuOpen((open) => !open)}>
            {state.mode === 'mode2' ? t.mode2 : t.mode1}
            <span className="wf-titlebar__caret">▾</span>
          </button>
          {modeMenuOpen
            ? (
                <div className="wf-mode-menu">
                  <button type="button" className="wf-mode-menu__item" onClick={() => { setModeMenuOpen(false); switchMode('mode1') }}>{t.mode1}</button>
                  <button type="button" className="wf-mode-menu__item" onClick={() => { setModeMenuOpen(false); switchMode('mode2') }}>{t.mode2}</button>
                </div>
              )
            : null}
        </div>
        <button type="button" className="wf-btn" title={t.combos} onClick={() => dispatch({ type: 'COMBO_OPEN', open: true })}>{t.combos}</button>
        {onClose
          ? <button type="button" className="wf-btn wf-iconbtn wf-titlebar__close" title={t.windowClose} aria-label={t.windowClose} onClick={requestClose}>✕</button>
          : null}
      </nav>

      <main className="wf-main" data-wf-main="">
        <LeftPanel
          copy={t}
          libTab={state.libTab}
          onSetTab={(tab) => dispatch({ type: 'SET_LIB_TAB', tab })}
          open={state.panels.leftOpen}
          width={state.panels.leftWidth}
          mode={state.mode}
          workflows={(state.mode === 'mode2' ? state.services : state.workflows).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            nodes: item.nodes,
            // 运行状态徽标：当前 run 的快照归属该实例且未终态时显示「运行中」
            running: state.run.runId !== null && state.run.snapshot?.flowId === item.id && state.run.snapshot?.status === 'running',
          }))}
          flowTemplates={(state.flowTemplates ?? []).filter((item) => item.mode === state.mode)}
          parentTemplate={parentTemplate}
          roleTemplates={roleTemplates}
          fileTemplates={state.templates.file as import('../../host/shared/types.js').FileTemplate[]}
          databaseTemplates={state.templates.database as import('../../host/shared/types.js').DatabaseTemplate[]}
          stageKinds={stageKinds}
          libSelection={state.selection.lib}
          modeName={modeName}
          onSelectWorkflow={doc.selectWorkflow}
          onSelectFlowTemplate={doc.selectFlowTemplate}
          onSelectLib={editor.selectLibraryCard}
          onPlaceTemplate={canvas.placeTemplateNode}
          onPlaceTemplateIntoGroup={canvas.placeTemplateIntoGroup}
          onPlaceStage={canvas.placeStageNode}
          onPlaceGroup={canvas.placeGroupNode}
          onPlaceParent={canvas.placeParentNode}
          onCreateNew={doc.createNew}
          onBeginDrag={beginLibraryDrag}
        />

        <div
          className="wf-splitter"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(event) => panels.beginResize('left', event)}
        />

        <div className="wf-canvas-shell" ref={canvasShellRef}>
          <Toolbar
            copy={t}
            mode={state.mode}
            // 图2 交互改造：保存按钮按当前对象态动态命名——模板态「创建实例/创建服务」
            // （画布内容保存为新实例，模板不变）；实例态「保存实例/保存服务」（保存到当前实例）。
            saveLabel={state.currentKind === 'flowTemplate'
              ? (state.mode === 'mode2' ? t.createService : t.createInstance)
              : (state.mode === 'mode2' ? t.saveServiceInstance : t.saveInstance)}
            onUndo={history.undo}
            onRedo={history.redo}
            onClear={canvas.clearGraph}
            canClear={state.canvas.nodes.length > 0}
            onTidy={canvas.tidyGraph}
            canTidy={state.canvas.nodes.length > 0}
            onSave={() => { void (state.currentKind === 'flowTemplate' ? doc.createInstanceFromCanvas() : doc.saveCanvas()) }}
            canSave={Boolean(state.currentId)}
            running={toolbarRunning}
            onStop={() => { void (state.mode === 'mode2' ? run.stopService() : run.stopRun()) }}
            onRun={() => { void (state.mode === 'mode2' ? run.startService() : run.startRun()) }}
            onOpenHistory={() => { void run.openHistory() }}
            canHistory={state.mode === 'mode1' && Boolean(currentFlow)}
            serviceStatus={state.mode === 'mode2' ? { port: currentService?.port, status: currentService?.status } : null}
          />
          {state.mode === 'mode2'
            ? <ServiceConsole
                copy={t}
                service={currentService}
                sessionId={sessionId}
                busy={state.run.runId !== null}
              />
            : null}
          <GraphCanvas
            nodes={state.canvas.nodes}
            edges={edgeList}
            copy={{ ...t, modeName }}
            mode={state.mode}
            selectedNode={state.selection.nodeId}
            selectedEdge={state.selection.edgeId}
            runStatusByNode={runStatusByNode}
            highlightedNodeIds={highlightedNodeIds}
            onInit={(api) => { canvasApiRef.current = api }}
            onNodeDragStart={canvas.onNodeDragStart}
            onNodeMove={canvas.moveNode}
            onNodeDropToGroup={canvas.addNodeToGroup}
            onNodeSelect={(id) => selection.selectNode(id)}
            onEdgeSelect={(id) => selection.selectEdge(id)}
            onPaneClick={() => selection.clearSelection()}
            onConnect={canvas.onConnect}
            onConnectionRejected={canvas.onConnectionRejected}
            onGroupResize={canvas.onGroupResize}
            dropTargetGroupId={dropGroupId}
            fitLabel={t.fitView}
            zoomInLabel={t.zoomIn}
            zoomOutLabel={t.zoomOut}
            emptyHint={t.emptyHint}
          />
        </div>

        <div
          className="wf-splitter"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(event) => panels.beginResize('right', event)}
        />

        <Inspector
          copy={t}
          open={state.panels.rightOpen}
          width={state.panels.rightWidth}
          editorData={editorData}
          presets={state.presets}
          tools={state.tools}
          models={state.models}
          combos={state.combos as Array<{ id: string; name: string; tools?: string[]; mcpServers?: string[] }>}
          flowMeta={{ nodeCount: state.canvas.nodes.length, revision: Number((currentFlow ?? currentService)?.revision ?? 0) }}
          onPatch={editor.patchEditor}
          onDelete={() => { void editor.deleteEditor() }}
          onSave={() => { void editor.saveEditor() }}
          onSaveAsTemplate={() => { void doc.saveCurrentAsFlowTemplate() }}
          onCopyProxy={canvas.copyToProxy}
          onRemoveMember={canvas.removeGroupMember}
          onFileSelect={(files) => { void transfer.onFileSelect(files) }}
          onLoadMd={() => { void transfer.loadPersonaMd() }}
          onLoadGroupMd={() => { void transfer.loadGroupMd() }}
          onTestDb={() => { void transfer.testDbConnection() }}
          saveDisabled={toolbarRunning}
          importBusy={false}
        />
      </main>

      {state.message ? <div className="wf-message">{state.message}</div> : null}

      <ConfirmDialog
        confirm={state.confirm}
        copy={t}
        onClose={() => dispatch({ type: 'CONFIRM_SET', confirm: null })}
        onSaveAndProceed={() => { void guard.saveAndProceed(() => doc.saveCanvas()) }}
        onDiscardAndProceed={guard.discardAndProceed}
        onResolveImport={(mode) => { void transfer.resolveImportConflict(mode as 'rename' | 'overwrite') }}
      />

      {state.historyOpen
        ? <RunHistory
            history={state.runHistory}
            selectedRunId={state.selectedRunId}
            copy={t}
            onSelect={(id) => dispatch({ type: 'RUN_HISTORY_SELECT', id })}
            onClose={() => dispatch({ type: 'HISTORY_OPEN', open: false })}
            onResume={(runId) => { void run.resumeRun(runId) }}
            canResume={state.mode === 'mode1'}
          />
        : null}

      {state.comboOpen
        ? <ComboManager
            copy={t}
            remote={remote}
            sessionId={sessionId}
            onClose={() => dispatch({ type: 'COMBO_OPEN', open: false })}
            onToast={(kind, text) => toast(kind, text)}
            onChanged={() => { void remote.call(EP.EP_TOOL_COMBOS).then((items) => dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(items) ? items : [] })).catch(() => {}) }}
          />
        : null}

      {dragPreview
        ? <div className="wf-drag-preview" style={{ left: dragPreview.x + 12, top: dragPreview.y + 14 }}>{dragPreview.label}</div>
        : null}

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
}

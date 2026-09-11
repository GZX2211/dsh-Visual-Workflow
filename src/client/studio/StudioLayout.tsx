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
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { GroupTemplate, RoleTemplate, ServiceState } from '../../host/shared/types.js'
import type { flowToCanvasLines, runStatusMap, runningNodeIds, stageTemplateKinds } from '../lib/graph-model.js'
import { EP } from '../lib/remote.js'
import type { CanvasApi } from '../components/canvas/GraphCanvas.js'
import { GraphCanvas } from '../components/canvas/GraphCanvas.js'
import { LeftPanel } from '../components/sidebar/LeftPanel.js'
import { BottomPanel } from '../components/sidebar/BottomPanel.js'
import { Toolbar } from '../components/toolbar/Toolbar.js'
import { Inspector } from '../components/panels/inspector/Inspector.js'
import { ConfirmDialog } from '../components/confirm-dialog/ConfirmDialog.js'
import { RunHistory } from '../components/run-history/RunHistory.js'
import { ServiceConsole } from '../components/service-console/ServiceConsole.js'
import { ComboManager } from '../components/combo-manager/ComboManager.js'
import { SchedulerManager } from '../components/scheduler/SchedulerManager.js'

export interface StudioLayoutProps {
  t: Dict
  state: StudioState
  sessionId: string
  remote: RemoteFace
  // ---- 派生数据 ----
  currentFlow: WorkflowDocument | null
  currentService: ServiceState | null
  currentFlowTemplate: WorkflowTemplate | null
  editorData: EditorData | null
  edgeList: ReturnType<typeof flowToCanvasLines>
  stageKinds: ReturnType<typeof stageTemplateKinds>
  parentTemplate: RoleTemplate | null
  roleTemplates: RoleTemplate[]
  groupTemplates: GroupTemplate[]
  toolbarRunning: boolean
  runStatusByNode: ReturnType<typeof runStatusMap>
  highlightedNodeIds: ReturnType<typeof runningNodeIds>
  /** 运行中锁定项（已完成/执行中流程）：节点锁角标、连线灰化虚线、连线点击不选中。 */
  lockedNodeIds: ReadonlySet<string>
  lockedEdgeIds: ReadonlySet<string>
  /** 当前实例是否运行中（模式一）：决定「清空」是否禁用等运行态交互。 */
  instanceRunning: boolean
  modeName: (presetId: string | null | undefined) => string
  /** 画布左上角工作流名称角标（实例/模板 + 名称）。 */
  canvasCaption: string
  // ---- 面板显隐（由 Studio 从状态推导：左栏/底栏来自折叠循环，右侧属性栏来自选中） ----
  leftOpen: boolean
  bottomOpen: boolean
  inspectorOpen: boolean
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
  // ---- 模式菜单 ----
  modeMenuOpen: boolean
  setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  switchMode: (mode: 'mode1' | 'mode2') => void
  /** 运行联动：宿主让出空间（官方右侧 Sidebar 全屏时缩回）+ 折叠自身左右栏 + 触发运行。 */
  handleRun: () => void
  /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用）。 */
  panelsCollapsed: boolean
  /** 顶部一键折叠/展开左右侧栏回调。 */
  onTogglePanels: () => void
}

/** 工作台渲染层（纯 JSX 组合；回调/数据全部来自 props）。 */
export function StudioLayout(props: StudioLayoutProps) {
  const {
    t, state, sessionId, remote,
    currentFlow, currentService, currentFlowTemplate, editorData, edgeList, stageKinds, parentTemplate, roleTemplates, groupTemplates,
    toolbarRunning, runStatusByNode, highlightedNodeIds, modeName,
    lockedNodeIds, lockedEdgeIds, instanceRunning,
    canvasApiRef, canvasShellRef, libraryImportRef, personaInputRef, groupMdInputRef,
    dispatch, doc, canvas, editor, run, transfer, selection, history, guard, panels, toast,
    beginLibraryDrag, dragPreview, dropGroupId,
    modeMenuOpen, setModeMenuOpen, switchMode, canvasCaption,
    leftOpen, bottomOpen, inspectorOpen,
    handleRun, panelsCollapsed, onTogglePanels,
  } = props

  // 左栏（LeftPanel）与底栏（BottomPanel）共用同一份库内容 props（内容/选中/拖拽逻辑一致，
  // 本次仅显示布局不同）。仅 open/width 或 open/height 两处按各自布局传入。
  const libraryProps = {
    libTab: state.libTab,
    onSetTab: (tab: import('../studio/studio-state.js').LibTab) => dispatch({ type: 'SET_LIB_TAB', tab }),
    mode: state.mode,
    // 工作台全局化：实例列表 = 全部会话实例（带各自 sessionId 供「当前」标签/状态徽标归属）。
    // 状态徽标：当前实例快照优先（600ms 快轮询），否则全量活跃 run 摘要（2s 轮询）。
    currentSessionId: state.sessionId,
    workflows: (state.mode === 'mode2' ? state.services : state.workflows).map((item) => {
      const active = state.activeRuns.find((a) => a.flowId === item.id && a.sessionId === item.sessionId)
      const currentSnapshot = state.run.runId !== null && state.run.snapshot?.flowId === item.id
        ? state.run.snapshot.status
        : null
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        nodes: item.nodes,
        sessionId: item.sessionId,
        runStatus: currentSnapshot ?? active?.status ?? null,
      }
    }),
    flowTemplates: (state.flowTemplates ?? []).filter((item) => item.mode === state.mode),
    parentTemplate,
    roleTemplates,
    fileTemplates: state.templates.file as import('../../host/shared/types.js').FileTemplate[],
    databaseTemplates: state.templates.database as import('../../host/shared/types.js').DatabaseTemplate[],
    groupTemplates,
    stageKinds,
    libSelection: state.selection.lib,
    modeName,
    onSelectWorkflow: doc.selectWorkflow,
    onSelectFlowTemplate: doc.selectFlowTemplate,
    onSelectLib: editor.selectLibraryCard,
    onPlaceTemplate: canvas.placeTemplateNode,
    onPlaceTemplateIntoGroup: canvas.placeTemplateIntoGroup,
    onPlaceStage: canvas.placeStageNode,
    onPlaceGroup: canvas.placeGroupNode,
    onPlaceGroupFromTemplate: canvas.placeGroupFromTemplate,
    onPlaceParent: canvas.placeParentNode,
    onCreateNew: doc.createNew,
    onBeginDrag: beginLibraryDrag,
  }

  return (
    <div className="wf-root" data-wf-immersive="true">
      {/* 标题顶栏（工作流设计器一行；不再是窗口标题栏——工作台已迁到官方右侧 Sidebar 标签页，
          chip 由官方渲染，故此处不再有拖动手柄、窗口切换按钮与关闭按钮） */}
      <nav className="wf-tabs" data-wf-titlebar="">
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
        {/* 定时任务：模式下拉右侧、「组合」左侧（新功能本阶段入口） */}
        <button type="button" className="wf-btn" title={t.scheduler} onClick={() => dispatch({ type: 'SCHEDULER_OPEN', open: true })}>{t.scheduler}</button>
        <button type="button" className="wf-btn" title={t.combos} onClick={() => dispatch({ type: 'COMBO_OPEN', open: true })}>{t.combos}</button>
      </nav>

      <main className="wf-main" data-wf-main="">
        <LeftPanel
          copy={t}
          {...libraryProps}
          open={leftOpen}
          width={state.panels.leftWidth}
        />

        {/* 批注：折叠时隐藏「拖动线」（splitter）。仅当左侧栏展开时才渲染，折叠态无法拖出 */}
        {leftOpen
          ? (
              <div
                className="wf-splitter"
                role="separator"
                aria-orientation="vertical"
                onPointerDown={(event) => panels.beginResize('left', event)}
              />
            )
          : null}

        <div className="wf-canvas-shell" ref={canvasShellRef}>
          <Toolbar
            copy={t}
            mode={state.mode}
            panelsCollapsed={panelsCollapsed}
            onTogglePanels={onTogglePanels}
            // 图2 交互改造：保存按钮按当前对象态动态命名——模板态「创建实例/创建服务」
            // （画布内容保存为新实例，模板不变）；实例态「保存实例/保存服务」（保存到当前实例）。
            saveLabel={state.currentKind === 'flowTemplate'
              ? (state.mode === 'mode2' ? t.createService : t.createInstance)
              : (state.mode === 'mode2' ? t.saveServiceInstance : t.saveInstance)}
            onUndo={history.undo}
            onRedo={history.redo}
            onClear={canvas.clearGraph}
            // 运行中实例禁止清空（用户裁决：工具栏按钮直接禁用；无弹窗/无 toast）
            canClear={state.canvas.nodes.length > 0 && !instanceRunning}
            clearTitle={instanceRunning ? t.clearRunningHint : t.clearCanvas}
            onTidy={canvas.tidyGraph}
            canTidy={state.canvas.nodes.length > 0}
            onSave={() => { void (state.currentKind === 'flowTemplate' ? doc.createInstanceFromCanvas() : doc.saveCanvas()) }}
            canSave={Boolean(state.currentId)}
            running={toolbarRunning}
            onStop={() => { void (state.mode === 'mode2' ? run.stopService() : run.stopRun()) }}
            onRun={() => { handleRun() }}
            onOpenHistory={() => { void run.openHistory() }}
            canHistory={state.mode === 'mode1' && Boolean(currentFlow)}
            serviceStatus={state.mode === 'mode2' ? { port: currentService?.port, status: currentService?.status } : null}
            // 「开启新会话」仅模板态显示（一次性临时选项；实例态不显示——实例只认绑定会话）
            showNewSession={state.currentKind === 'flowTemplate'}
            instanceOptions={state.instanceOptions}
            onInstanceOptionsChange={(patch) => dispatch({ type: 'INSTANCE_OPTIONS_SET', options: patch })}
          />
          {state.mode === 'mode2'
            ? <ServiceConsole
                copy={t}
                service={currentService}
                // 服务调试身份用实例绑定的会话（工作台全局化：实例会话可能不是当前主会话）
                sessionId={currentService?.sessionId ?? sessionId}
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
            lockedNodeIds={lockedNodeIds}
            lockedEdgeIds={lockedEdgeIds}
            onInit={(api) => { canvasApiRef.current = api }}
            onNodeDragStart={canvas.onNodeDragStart}
            onNodeMove={canvas.moveNode}
            onNodeDropToGroup={canvas.addNodeToGroup}
            onNodeSelect={(id) => selection.selectNode(id)}
            // 被锁连线（已完成流程 / 执行中节点左入口）点击不选中：属性栏因此不展开，
            // 从根上杜绝编辑（用户裁决：锁定内容不展开属性面板，也就无需 toast 报错）
            onEdgeSelect={(id) => { if (!lockedEdgeIds.has(id)) selection.selectEdge(id) }}
            onPaneClick={() => selection.clearSelection()}
            onConnect={canvas.onConnect}
            onConnectionRejected={canvas.onConnectionRejected}
            onGroupResize={canvas.onGroupResize}
            onSwapPorts={canvas.swapNodePorts}
            dropTargetGroupId={dropGroupId}
            fitLabel={t.fitView}
            zoomInLabel={t.zoomIn}
            zoomOutLabel={t.zoomOut}
            emptyHint={t.emptyHint}
            workflowCaption={canvasCaption}
          />
        </div>

        {/* 批注：折叠时隐藏「拖动线」（splitter）。仅当右侧栏展开时才渲染 */}
        {inspectorOpen
          ? (
              <div
                className="wf-splitter"
                role="separator"
                aria-orientation="vertical"
                onPointerDown={(event) => panels.beginResize('right', event)}
              />
            )
          : null}

        <Inspector
          copy={t}
          open={inspectorOpen}
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
          // 属性栏「保存」：模式一运行中改为「保存 + 二次确认（会改写父代理后续编排）」，
          // 故不再随运行禁用；模式二（服务常驻）维持原行为（运行中禁用）。
          saveDisabled={state.mode === 'mode2' && toolbarRunning}
          importBusy={false}
        />
      </main>

      {/* 底栏：与左栏相互切换（图片批注新增）。上方为可拖动边界线（横向，上下调整大小）；
          卡片横向 flex-wrap 动态追加排；Tag 区为横向文字（工作流/角色/数据/其他）。 */}
      {bottomOpen
        ? (
            <div className="wf-bottom-area">
              <div
                className="wf-splitter wf-splitter--horizontal"
                role="separator"
                aria-orientation="horizontal"
                onPointerDown={(event) => panels.beginResize('bottom', event)}
              />
              <BottomPanel
                copy={t}
                {...libraryProps}
                open={bottomOpen}
                height={state.panels.bottomHeight}
              />
            </div>
          )
        : null}

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

      {state.schedulerOpen
        ? <SchedulerManager
            copy={t}
            remote={remote}
            sessionId={sessionId}
            onClose={() => dispatch({ type: 'SCHEDULER_OPEN', open: false })}
            onToast={(kind, text) => toast(kind, text)}
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

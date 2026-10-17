// src/client/studio/StudioLayout.tsx
//
// 工作台渲染层：标题顶栏 + 三栏工作区 + 浮层（确认弹窗/运行历史/组合管理/
// 拖拽预览/轻提示）。所有数据与回调由 Studio 主组件经 props 注入（各 controller
// hook 的 face + 派生数据），本组件不拥有业务状态、不写状态机。
//
// 除 JSX 组合外，本层还承载两处装配职责（均作用于展示，不构成业务事实）：
//   - 自动布局接线：useAutoLayout 挂在这里（打开文档后重排坐标并由调用方落盘）；
//   - 弹层装配：由 props 注入的运行历史/组合/定时任务等弹层，其内部自带远端调用。

import type { Dispatch } from 'react'
import type { Dict } from '../i18n.js'
import type { StudioAction, StudioState, EditorData, CanvasEdge } from './studio-state.js'
import { isInstanceSourceKind } from './studio-selectors.js'
import type { DocumentActionsFace } from '../hooks/useDocumentActions.js'
import type { AssetsFace } from '../hooks/useAssets.js'
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
import type { runStatusMap, runningNodeIds } from '../lib/run-status-map.js'
import type { stageTemplateKinds } from '../lib/graph-handles.js'
import { EP } from '../lib/remote.js'
import type { CanvasApi } from '../components/canvas/GraphCanvas.js'
import { GraphCanvas } from '../components/canvas/GraphCanvas.js'
import { LeftPanel } from '../components/sidebar/LeftPanel.js'
import type { LeftPanelProps } from '../components/sidebar/LeftPanel.js'
import { BottomPanel } from '../components/sidebar/BottomPanel.js'
import { Toolbar } from '../components/toolbar/Toolbar.js'
import { Inspector } from '../components/panels/inspector/Inspector.js'
import { ConfirmDialog } from '../components/confirm-dialog/ConfirmDialog.js'
import { RunHistory } from '../components/run-history/RunHistory.js'
import { ServiceConsole } from '../components/service-console/ServiceConsole.js'
import { ComboManager } from '../components/combo-manager/ComboManager.js'
import { SchedulerManager } from '../components/scheduler/SchedulerManager.js'
import { useAutoLayout } from '../hooks/useAutoLayout.js'
import { useServiceDebugStream } from '../hooks/useServiceDebugStream.js'

/**
 * 左栏/底栏共用的库内容 props：即左栏 props 去掉「显示布局」相关字段
 * （open/width 与底栏的 open/height 各自由所在布局传入）与词典。
 * 词典不并入的原因：t 的引用不必跨渲染稳定，并入会让整份库 props 随词典重建，
 * 下游记忆化边界反而失效；两个面板各自显式取本布局持有的 t。
 */
export type StudioLibraryProps = Omit<LeftPanelProps, 'open' | 'width' | 'copy'>

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
  edgeList: CanvasEdge[]
  stageKinds: ReturnType<typeof stageTemplateKinds>
  parentTemplate: RoleTemplate | null
  roleTemplates: RoleTemplate[]
  groupTemplates: GroupTemplate[]
  toolbarRunning: boolean
  runStatusByNode: ReturnType<typeof runStatusMap>
  highlightedNodeIds: ReturnType<typeof runningNodeIds>
  /** P4 父代理补丁角标：由装配层按 state 记忆化，同一 state 下重渲染保持引用恒等。 */
  agentPatchedNodeIds: string[]
  /** 左栏/底栏共用的库内容 props（装配层已记忆化：同一 state 下引用恒等）。 */
  libraryProps: StudioLibraryProps
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
  /** 资产面（左栏资产列表/资产态画布打开；入库/版本/回滚/退役由 T6 在属性栏接线）。 */
  assets: AssetsFace
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
  /** 「开启新会话」选项（模板态来自模板持久化字段；资产态为临时选项，路径恒空）。 */
  instanceOptions: { newSession: boolean; workspacePath: string }
  /** 选项变更回调（模板态由装配层立即保存模板；资产态写临时状态）。 */
  onInstanceOptionsChange(patch: { newSession?: boolean; workspacePath?: string }): void
  /** 是否显示「选择工作区…」按钮（仅模板态；资产态无持久化归属）。 */
  showWorkspacePicker: boolean
  /** 官方目录选择器是否可用（不可用时按钮禁用并提示）。 */
  workspacePickerAvailable: boolean
  /** 目录选择器是否正在打开（防重复打开）。 */
  workspacePicking: boolean
  /** 打开官方目录选择器并保存所选路径。 */
  onPickWorkspace(): void
}

/** 工作台渲染层（JSX 组合 + 自动布局接线与弹层装配；数据/回调全部来自 props）。 */
export function StudioLayout(props: StudioLayoutProps) {
  const {
    t, state, sessionId, remote,
    currentFlow, currentService, editorData, edgeList,
    toolbarRunning, runStatusByNode, highlightedNodeIds, modeName,
    agentPatchedNodeIds, libraryProps,
    lockedNodeIds, lockedEdgeIds, instanceRunning,
    canvasApiRef, canvasShellRef, libraryImportRef, personaInputRef, groupMdInputRef,
    dispatch, doc, assets, canvas, editor, run, transfer, selection, history, guard, panels, toast,
    dragPreview, dropGroupId,
    modeMenuOpen, setModeMenuOpen, switchMode, canvasCaption,
    leftOpen, bottomOpen, inspectorOpen,
    handleRun, panelsCollapsed, onTogglePanels,
    instanceOptions, onInstanceOptionsChange, showWorkspacePicker,
    workspacePickerAvailable, workspacePicking, onPickWorkspace,
  } = props

  // 自动布局：打开/接收文档时若节点缺坐标（哨兵 {0,0}）
  // → 自动重排一次并静默落盘；已布局过的文档只检测重叠并提示，绝不覆盖用户手动调整。
  useAutoLayout(state, dispatch, {
    saveCanvas: doc.saveCanvas,
    notify: toast,
    tips: { overlap: t.canvasOverlapHint },
    onApplied: () => canvasApiRef.current?.fitView(),
  })

  // 服务调试流（模式二）：网络访问与生命周期集中在 hook，组件只消费其面。
  // 调试身份用实例绑定的会话（工作台全局化：实例会话可能不是当前主会话）。
  const serviceDebug = useServiceDebugStream(remote, {
    serviceId: currentService?.id ?? '',
    sessionId: currentService?.sessionId ?? sessionId,
    enabled: state.mode === 'mode2' && currentService?.status === 'running',
    errorPrefix: t.serviceDebugErrorPrefix,
    omittedLabel: t.serviceDebugOmitted,
  })

  // 左栏（LeftPanel）与底栏（BottomPanel）共用同一份库内容 props：由装配层记忆化后经
  // props 传入（同一 state 下引用恒等），本层不再在渲染期重建。
  // 「实例来源态」= 模版态或资产态：二者都以「画布内容 → 新实例」为保存/运行前置（同口径）。
  const isInstanceSource = isInstanceSourceKind(state.currentKind)

  return (
    <div className="wf-root">
      {/* 标题顶栏（工作流设计器一行；不再是窗口标题栏——工作台已迁到官方右侧 Sidebar 标签页，
          chip 由官方渲染，故此处不再有拖动手柄、窗口切换按钮与关闭按钮） */}
      <nav className="wf-tabs">
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

      <main className="wf-main">
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
            // 保存按钮按当前对象态动态命名——模板态/资产态「创建实例/创建服务」
            // （画布内容保存为新实例，模板/资产不变）；实例态「保存实例/保存服务」（保存到当前实例）。
            saveLabel={isInstanceSource ? (state.mode === 'mode2' ? t.createService : t.createInstance) : (state.mode === 'mode2' ? t.saveServiceInstance : t.saveInstance)}
            onUndo={history.undo}
            onRedo={history.redo}
            onClear={canvas.clearGraph}
            // 运行中实例禁止清空（用户裁决：工具栏按钮直接禁用；无弹窗/无 toast）
            canClear={state.canvas.nodes.length > 0 && !instanceRunning}
            clearTitle={instanceRunning ? t.clearRunningHint : t.clearCanvas}
            onTidy={canvas.tidyGraph}
            canTidy={state.canvas.nodes.length > 0}
            // 资产态「保存」= 登记资产新版本，由 T6 在属性栏资产区接线（assets.saveVersion）；
            // 工具栏此处对资产态走「创建实例」，与模版态一致（先转实例再运行）。
            onSave={() => { void (isInstanceSource ? doc.createInstanceFromCanvas() : doc.saveCanvas()) }}
            canSave={Boolean(state.currentId)}
            running={toolbarRunning}
            onStop={() => { void (state.mode === 'mode2' ? run.stopService() : run.stopRun()) }}
            onRun={() => { handleRun() }}
            onOpenHistory={() => { void run.openHistory() }}
            canHistory={state.mode === 'mode1' && Boolean(currentFlow)}
            serviceStatus={state.mode === 'mode2' ? { port: currentService?.port, status: currentService?.status } : null}
            // 「开启新会话」仅实例来源态（模版 / 资产）显示；模板态勾选与路径为模板级
            // 持久化配置（变更即保存模板），资产态为一次性临时选项（无路径归属）。
            showNewSession={isInstanceSource}
            instanceOptions={instanceOptions}
            onInstanceOptionsChange={onInstanceOptionsChange}
            showWorkspacePicker={showWorkspacePicker}
            workspacePickerAvailable={workspacePickerAvailable}
            workspacePicking={workspacePicking}
            onPickWorkspace={onPickWorkspace}
          />
          {state.mode === 'mode2'
            ? <ServiceConsole
                copy={t}
                service={currentService}
                busy={state.run.runId !== null}
                debug={serviceDebug}
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
            agentPatchedNodeIds={agentPatchedNodeIds}
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
          models={state.models}
          combos={state.combos as Array<{ id: string; name: string; tools?: string[]; mcpServers?: string[] }>}
          flowMeta={{ nodeCount: state.canvas.nodes.length, revision: Number((currentFlow ?? currentService)?.revision ?? 0) }}
          onPatch={editor.patchEditor}
          onDelete={() => { void editor.deleteEditor() }}
          // 属性栏「保存」调用点：实例/模版态 = 落库（useDocumentActions.saveCanvas）；
          // 资产态（flowAsset/roleAsset）= 登记资产新版本（useEditorActions 内按 source 分流）。
          onSave={() => { void editor.saveEditor() }}
          // 模版态「入库」：先保存模版再 promote（保存未落库即中止）；锁定判定由
          // useEditorActions 的纯函数给出（已入库且模版内容未再修改 → 按钮禁用）
          onPromote={() => { void editor.promoteEditor() }}
          promoteLocked={editor.promoteLocked}
          // 资产态「回滚」：打开版本上拉列表 → 点击某项回滚 Active 指针
          onOpenVersions={() => { void editor.openAssetVersions() }}
          onRollbackVersion={(versionId) => { void editor.rollbackAssetVersion(versionId) }}
          onCloseVersions={assets.closeVersions}
          assetVersions={state.assetVersions}
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

      {/* 确认弹窗：「保存并继续」在真实保存完成后才继续原操作——需要二次确认的路径
          （运行中实例保存）本次返回 null，落库发生在用户确认之后，经 onSaved 接续。
          保存统一经 editor.saveEditor：实例/模版态转 saveCanvas（同上），资产态走
          「登记资产新版本」分支（此前直连 saveCanvas 对资产态返回 null，只能放弃修改）。 */}
      <ConfirmDialog
        confirm={state.confirm}
        copy={t}
        onClose={() => dispatch({ type: 'CONFIRM_SET', confirm: null })}
        onSaveAndProceed={() => { void guard.saveAndProceed((onSaved) => editor.saveEditor({ onSaved })) }}
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
            onChanged={() => remote.call(EP.EP_TOOL_COMBOS).then((items) => dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(items) ? items : [] }))}
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

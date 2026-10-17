// src/client/components/toolbar/Toolbar.tsx
//
// 画布控制栏：
// 撤销 / 重做 / 清空 / 整理布局 / 保存 / 运行·停止（模式二 = 启动·停止服务 + 状态指示）/ 运行历史。
//
// 画布上方「保存」按钮按当前对象态动态命名——模板态 = 「创建实例/创建服务」
// （将画布内容保存为新实例，模板不变），实例态 = 「保存实例/保存服务」（保存到当前实例）。
//
// 工作台全局化改版：「开启新会话」（+ 工作区）仅实例来源态显示。模板态的勾选与工作区
// 路径是**模板级持久化配置**（随模板保存/删除）；资产态勾选是一次性临时选项（无路径归属）。
// 工作区路径改为**官方目录选择器选择**（不提供手填），已选路径显示在按钮右方用于确认。

import type { Dict } from '../../i18n.js'

export interface ToolbarProps {
  copy: Dict
  mode: 'mode1' | 'mode2'
  /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用；批注：折叠时不显示拖动线）。 */
  panelsCollapsed: boolean
  /** 顶部一键折叠/展开左右侧栏回调。 */
  onTogglePanels(): void
  /** 当前画布对象态（模板态显示「创建实例/创建服务」；实例态显示「保存实例/保存服务」）。 */
  saveLabel: string
  onUndo(): void
  onRedo(): void
  onClear(): void
  canClear: boolean
  /** 「清空」按钮悬停说明（运行中禁用时提示先停止运行）。 */
  clearTitle: string
  onTidy(): void
  canTidy: boolean
  onSave(): void
  canSave: boolean
  running: boolean
  onStop(): void
  onRun(): void
  onOpenHistory(): void
  canHistory: boolean
  serviceStatus: { port?: number; status?: string } | null
  /** 「开启新会话」是否显示（仅实例来源态；实例态不显示——实例只认绑定会话运行）。 */
  showNewSession: boolean
  /** 「开启新会话」选项：模板态来自模板持久化字段；资产态为一次性临时选项（路径恒空）。 */
  instanceOptions: { newSession: boolean; workspacePath?: string }
  /** 临时选项/模板配置变更回调（模板态由上层立即保存模板，资产态写临时状态）。 */
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

export function Toolbar(props: ToolbarProps) {
  const {
    copy: t, mode, panelsCollapsed, onTogglePanels, saveLabel, onUndo, onRedo, onClear, canClear, clearTitle, onTidy, canTidy,
    onSave, canSave, running, onStop, onRun, onOpenHistory, canHistory, serviceStatus,
    showNewSession, instanceOptions, onInstanceOptionsChange,
    showWorkspacePicker, workspacePickerAvailable, workspacePicking, onPickWorkspace,
  } = props
  const isMode2 = mode === 'mode2'
  // 运行状态指示（控制栏最右侧）：模式二含服务状态（停止/启动中/运行中·端口/崩溃）
  const statusText = isMode2 && serviceStatus
    ? serviceStatus.status === 'running'
      ? (serviceStatus.port ? `${t.serviceRunning} · ${serviceStatus.port}` : t.serviceStarting)
      : serviceStatus.status === 'crashed'
        ? t.serviceCrashed
        : t.serviceStopped
    : null
  const statusRunning = serviceStatus?.status === 'running'

  return (
    <div className="wf-toolbar">
      {/* 批注：顶部一键折叠/展开左右侧栏（两侧联动；折叠时隐藏拖动线、不能拖出，展开后才可拖宽） */}
      <button
        type="button"
        className={`wf-btn wf-iconbtn is-ghost wf-toolbar__panels${panelsCollapsed ? ' is-collapsed' : ''}`}
        title={t.togglePanels}
        aria-label={t.togglePanels}
        onClick={onTogglePanels}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ color: 'currentColor' }}>
          <path fill="none" stroke="currentColor" strokeWidth="2" d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <path fill="none" stroke="currentColor" strokeWidth="2" d="M9 5v14M15 5v14" />
        </svg>
      </button>
      <button type="button" className="wf-btn wf-iconbtn is-ghost" title={`${t.undo} · Ctrl/Cmd+Z`} aria-label={t.undo} onClick={onUndo}>↶</button>
      <button type="button" className="wf-btn wf-iconbtn is-ghost" title={`${t.redo} · Ctrl/Cmd+Shift+Z`} aria-label={t.redo} onClick={onRedo}>↷</button>
      <button type="button" className="wf-btn is-ghost" title={clearTitle} onClick={onClear} disabled={!canClear}>{t.clear}</button>
      <button type="button" className="wf-btn is-ghost" title={t.tidy} onClick={onTidy} disabled={!canTidy}>{t.tidy}</button>
      <button type="button" className="wf-btn" onClick={onSave} disabled={!canSave}>{saveLabel}</button>
      {running
        ? <button type="button" className="wf-btn is-danger" onClick={onStop}>{t.stop}</button>
        : <button type="button" className="wf-btn is-primary" onClick={onRun} disabled={!canSave}>{isMode2 ? t.startService : t.run}</button>}
      <button type="button" className="wf-btn is-ghost" onClick={onOpenHistory} disabled={!canHistory}>{t.history}</button>
      {statusText ? <span className={`wf-status${statusRunning ? ' is-running' : ''}`}>{statusText}</span> : null}
      {/* 开启新会话（仅实例来源态显示）：模板态 = 模板级持久化配置（随模板保存/删除）；
          资产态 = 一次性临时选项（资产无持久化归属，无路径选择）。实例态不显示：
          实例运行只认实例绑定的会话，无「新会话」概念 */}
      {showNewSession
        ? (
            <label className="wf-toolbar__switch" title={t.newSessionHint}>
              <input
                type="checkbox"
                checked={instanceOptions.newSession}
                onChange={(event) => onInstanceOptionsChange({ newSession: event.target.checked })}
              />
              <span>{t.newSession}</span>
            </label>
          )
        : null}
      {/* 工作区路径（需求：改为选择而非填写）：仅模板态且已勾选时出现，复用官方目录选择器；
          已选择路径显示在按钮右方（用于 UI 显示与确认）。 */}
      {showNewSession && showWorkspacePicker && instanceOptions.newSession
        ? (
            <>
              <button
                type="button"
                className="wf-btn is-ghost wf-toolbar__workspace-pick"
                title={workspacePickerAvailable ? t.workspaceHint : t.workspacePickerUnavailable}
                disabled={!workspacePickerAvailable || workspacePicking}
                onClick={onPickWorkspace}
              >
                {t.pickWorkspace}
              </button>
              {instanceOptions.workspacePath
                ? (
                    <span className="wf-toolbar__workspace-path" title={instanceOptions.workspacePath}>
                      {instanceOptions.workspacePath}
                    </span>
                  )
                : null}
            </>
          )
        : null}
    </div>
  )
}

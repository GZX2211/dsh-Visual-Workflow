// src/client/components/toolbar/Toolbar.tsx
//
// 画布控制栏（照搬旧项目 toolbar.js 布局，TSX 化，按需求 §4.5.3 顺序）：
// 撤销 / 重做 / 清空 / 整理布局 / 保存 / 运行·停止（模式二 = 启动·停止服务 + 状态指示）/ 运行历史。
//
// 图2 交互改造：画布上方「保存」按钮按当前对象态动态命名——模板态 = 「创建实例/创建服务」
// （将画布内容保存为新实例，模板不变），实例态 = 「保存实例/保存服务」（保存到当前实例）。
//
// 工作台全局化改版：「开启新会话」（+ 工作区）复选框**仅在模板态显示**——
// 它是「从模板创建实例」时的一次性临时选项（创建实例时新建主会话并绑定；
// 不持久化到模板/实例文档）；实例态不显示（实例运行只认实例绑定的会话）。

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
  /** 「开启新会话」是否显示（仅模板态；实例态不显示——实例只认绑定会话运行）。 */
  showNewSession: boolean
  /** 「开启新会话」一次性临时选项（模板态编辑；不持久化到模板/实例文档）。 */
  instanceOptions: { newSession: boolean; workspacePath: string }
  /** 临时选项变更回调（写回 StudioState.instanceOptions）。 */
  onInstanceOptionsChange(patch: { newSession?: boolean; workspacePath?: string }): void
}

export function Toolbar(props: ToolbarProps) {
  const {
    copy: t, mode, panelsCollapsed, onTogglePanels, saveLabel, onUndo, onRedo, onClear, canClear, clearTitle, onTidy, canTidy,
    onSave, canSave, running, onStop, onRun, onOpenHistory, canHistory, serviceStatus,
    showNewSession, instanceOptions, onInstanceOptionsChange,
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
      {/* 开启新会话（仅模板态显示；「从模板创建实例」的一次性临时选项——勾选后
          创建实例时新建主会话并绑定；不持久化到模板/实例文档。实例态不显示：
          实例运行只认实例绑定的会话，无「新会话」概念） */}
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
      {showNewSession && instanceOptions.newSession
        ? (
            <input
              type="text"
              className="wf-toolbar__workspace"
              value={instanceOptions.workspacePath}
              placeholder={t.workspacePlaceholder}
              title={t.workspaceHint}
              onChange={(event) => onInstanceOptionsChange({ workspacePath: event.target.value })}
            />
          )
        : null}
    </div>
  )
}

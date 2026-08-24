// src/client/components/toolbar/Toolbar.tsx
//
// 画布控制栏（照搬旧项目 toolbar.js 布局，TSX 化，按需求 §4.5.3 顺序）：
// 撤销 / 重做 / 清空 / 整理布局 / 保存 / 运行·停止（模式二 = 启动·停止服务 + 状态指示）/ 运行历史。

import type { Dict } from '../../i18n.js'

export interface ToolbarProps {
  copy: Dict
  mode: 'mode1' | 'mode2'
  onUndo(): void
  onRedo(): void
  onClear(): void
  canClear: boolean
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
}

export function Toolbar(props: ToolbarProps) {
  const {
    copy: t, mode, onUndo, onRedo, onClear, canClear, onTidy, canTidy,
    onSave, canSave, running, onStop, onRun, onOpenHistory, canHistory, serviceStatus,
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
      <button type="button" className="wf-btn wf-iconbtn is-ghost" title={`${t.undo} · Ctrl/Cmd+Z`} aria-label={t.undo} onClick={onUndo}>↶</button>
      <button type="button" className="wf-btn wf-iconbtn is-ghost" title={`${t.redo} · Ctrl/Cmd+Shift+Z`} aria-label={t.redo} onClick={onRedo}>↷</button>
      <button type="button" className="wf-btn is-ghost" title={t.clearCanvas} onClick={onClear} disabled={!canClear}>{t.clear}</button>
      <button type="button" className="wf-btn is-ghost" title={t.tidy} onClick={onTidy} disabled={!canTidy}>{t.tidy}</button>
      <button type="button" className="wf-btn" onClick={onSave} disabled={!canSave}>{t.save}</button>
      {running
        ? <button type="button" className="wf-btn is-danger" onClick={onStop}>{t.stop}</button>
        : <button type="button" className="wf-btn is-primary" onClick={onRun} disabled={!canSave}>{isMode2 ? t.startService : t.run}</button>}
      <button type="button" className="wf-btn is-ghost" onClick={onOpenHistory} disabled={!canHistory}>{t.history}</button>
      {statusText ? <span className={`wf-status${statusRunning ? ' is-running' : ''}`}>{statusText}</span> : null}
    </div>
  )
}

// src/client/components/confirm-dialog/ConfirmDialog.tsx
//
// 确认弹层（照搬旧项目 components/confirm-dialog.js，TSX 化）：
// 三种形态：unsaved（保存/放弃/取消）/ importConflict（覆盖/改名/取消）/ confirmText（通用确认）。

import type { ConfirmState } from '../../studio/studio-state.js'
import type { Dict } from '../../i18n.js'

interface ConfirmDialogProps {
  confirm: ConfirmState | null
  copy: Dict
  onClose(): void
  onSaveAndProceed(): void
  onDiscardAndProceed(): void
  onResolveImport(mode: string): void
}

export function ConfirmDialog({ confirm, copy, onClose, onSaveAndProceed, onDiscardAndProceed, onResolveImport }: ConfirmDialogProps) {
  if (!confirm) return null
  const title = confirm.kind === 'unsaved'
    ? copy.unsavedTitle
    : confirm.kind === 'importConflict'
      ? copy.importConflictTitle
      : confirm.title ?? copy.confirmDelete
  const message = confirm.kind === 'unsaved' ? copy.unsavedMessage : confirm.message ?? ''
  const actions = confirm.kind === 'unsaved'
    ? [
        <button key="save" type="button" className="wf-btn is-primary" onClick={onSaveAndProceed}>{copy.unsavedSave}</button>,
        <button key="discard" type="button" className="wf-btn is-danger" onClick={onDiscardAndProceed}>{copy.unsavedDiscard}</button>,
        <button key="cancel" type="button" className="wf-btn" onClick={onClose}>{copy.unsavedCancel}</button>,
      ]
    : confirm.kind === 'importConflict'
      ? [
          <button key="overwrite" type="button" className="wf-btn is-danger" onClick={() => onResolveImport('overwrite')}>{copy.importOverwrite}</button>,
          <button key="rename" type="button" className="wf-btn" onClick={() => onResolveImport('rename')}>{copy.importRename}</button>,
          <button key="cancel" type="button" className="wf-btn" onClick={onClose}>{copy.importCancel}</button>,
        ]
      : [
          <button key="ok" type="button" className="wf-btn is-danger" onClick={() => { const handler = confirm.onConfirm; onClose(); handler?.() }}>{confirm.confirmLabel ?? copy.inspectorDelete}</button>,
          <button key="cancel" type="button" className="wf-btn" onClick={onClose}>{copy.unsavedCancel}</button>,
        ]

  return (
    <div className="wf-confirm-backdrop">
      <div className="wf-confirm" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="wf-confirm__actions">{actions}</div>
      </div>
    </div>
  )
}

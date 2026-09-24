// src/client/components/combo-manager/ComboSidePanel.tsx
//
// 组合管理右侧面板：组合列表（新建/选中/删除二次确认）+ 命名 + 已选 chip + 保存/删除。
// 纯表现层：数据与动作经 props 注入。

import type { Dict } from '../../i18n.js'
import type { ComboEntry } from '../../hooks/useToolCombos.js'

export interface ComboSidePanelProps {
  copy: Dict
  combos: ComboEntry[]
  activeComboId: string | null
  comboDraft: { name: string; tools: string[]; mcpServers: string[] }
  busy: boolean
  /** 删除已进入二次确认态（按钮文案切换）。 */
  confirmDelete: boolean
  onSelect(id: string): void
  onNew(): void
  onDraftNameChange(name: string): void
  onRemoveTool(name: string): void
  onRemoveMcp(name: string): void
  onSave(): void
  onDelete(): void
}

export function ComboSidePanel(props: ComboSidePanelProps) {
  const {
    copy, combos, activeComboId, comboDraft, busy, confirmDelete,
    onSelect, onNew, onDraftNameChange, onRemoveTool, onRemoveMcp, onSave, onDelete,
  } = props

  const selectedChips = [
    ...comboDraft.tools.map((name) => ({ key: `t:${name}`, label: name, remove: () => onRemoveTool(name) })),
    ...comboDraft.mcpServers.map((name) => ({ key: `m:${name}`, label: name, remove: () => onRemoveMcp(name) })),
  ]

  return (
    <div className="wf-combo__side">
      <div className="wf-combo__side-head">
        <h4>{copy.combos}</h4>
        <button type="button" className="wf-btn" onClick={onNew} disabled={busy}>{`＋ ${copy.comboNew}`}</button>
      </div>
      <div className="wf-combo__side-list">
        {combos.length === 0
          ? <div className="wf-hint">{copy.comboEmpty}</div>
          : combos.map((combo) => (
              <button
                key={combo.id}
                type="button"
                className={`wf-combo-item${combo.id === activeComboId ? ' is-active' : ''}`}
                onClick={() => onSelect(combo.id)}
              >
                <span className="wf-combo-item__label">{combo.name}</span>
                <span className="wf-combo-item__meta">
                  {`${(combo.tools?.length ?? 0)} ${copy.comboTabTool} · ${combo.mcpServers?.length ?? 0} MCP`}
                </span>
              </button>
            ))}
      </div>
      <div className="wf-combo__edit">
        <label>
          <span className="wf-hint">{copy.comboName}</span>
          <input value={comboDraft.name} placeholder={copy.comboName} onChange={(event) => onDraftNameChange(event.target.value)} />
        </label>
      </div>
      <div className="wf-combo__selection">
        {selectedChips.length === 0
          ? <span className="wf-hint">{copy.comboEmptySelection}</span>
          : selectedChips.map((chip) => (
              <span key={chip.key} className="wf-combo-chip">
                <span>{chip.label}</span>
                <button type="button" onClick={chip.remove} title={copy.inspectorDelete}>×</button>
              </span>
            ))}
      </div>
      <div className="wf-combo__side-foot">
        <button type="button" className="wf-btn is-danger" onClick={onDelete} disabled={!activeComboId || busy}>{confirmDelete ? copy.comboDeleteConfirm : copy.comboDelete}</button>
        <button type="button" className="wf-btn is-primary" onClick={onSave} disabled={busy}>{copy.inspectorSave}</button>
      </div>
      <div className="wf-combo-hint">{copy.comboHint}</div>
    </div>
  )
}

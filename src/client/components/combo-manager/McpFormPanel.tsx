// src/client/components/combo-manager/McpFormPanel.tsx
//
// MCP 服务器编辑区与「从 mcp.json 导入」弹层（纯表现层）：
// 表单草稿与解析结果由容器提供，本组件只负责渲染与回调。

import type { Dict } from '../../i18n.js'
import type { McpFormState } from '../../lib/mcp-form.js'

export interface McpFormPanelProps {
  copy: Dict
  /** 当前 tab（仅 mcp tab 渲染本面板）。 */
  tab: 'plugins' | 'mcp'
  /** 编辑中的表单草稿（null = 未在编辑）。 */
  form: McpFormState | null
  busy: boolean
  importOpen: boolean
  importText: string
  onFormChange(form: McpFormState | null): void
  onSave(): void
  onImportOpenChange(open: boolean): void
  onImportTextChange(text: string): void
  onImportApply(): void
}

export function McpFormPanel(props: McpFormPanelProps) {
  const { copy, tab, form, busy, importOpen, importText, onFormChange, onSave, onImportOpenChange, onImportTextChange, onImportApply } = props
  if (tab !== 'mcp') return null
  const editing = form !== null
  const stdio = (form?.transport ?? 'stdio') === 'stdio'

  return (
    <>
      {editing ? (
        <div className="wf-mcp-form">
          <div className="wf-combo__head wf-combo__head--sub">
            <h4>{form.id ? copy.mcpEdit : copy.mcpNew}</h4>
          </div>
          <div className="wf-mcp-form__inline">
            <label className="wf-mcp-form__grow">
              <span className="wf-hint">{copy.mcpName}</span>
              <input value={form.serverName ?? ''} onChange={(event) => onFormChange({ ...form, serverName: event.target.value })} />
            </label>
            <label className="wf-mcp-form__grow">
              <span className="wf-hint">{copy.mcpTransport}</span>
              <select value={form.transport ?? 'stdio'} onChange={(event) => onFormChange({ ...form, transport: event.target.value })}>
                <option value="stdio">{copy.mcpTransportStdio}</option>
                <option value="streamable-http">{copy.mcpTransportHttp}</option>
              </select>
            </label>
          </div>
          {stdio
            ? (
                <div className="wf-mcp-form__stack">
                  <label>
                    <span className="wf-hint">{copy.mcpCommand}</span>
                    <input value={form.commandLine ?? ''} placeholder="npx -y @playwright/mcp@latest --headless" onChange={(event) => onFormChange({ ...form, commandLine: event.target.value })} />
                  </label>
                  <label>
                    <span className="wf-hint">{copy.mcpEnv}</span>
                    <input value={form.env ?? ''} placeholder={'{"API_KEY":"..."}'} onChange={(event) => onFormChange({ ...form, env: event.target.value })} />
                  </label>
                  {copy.mcpCommandHint
                    ? <span className="wf-hint wf-hint--block">{copy.mcpCommandHint}</span>
                    : null}
                </div>
              )
            : (
                <div className="wf-mcp-form__stack">
                  <label>
                    <span className="wf-hint">{copy.mcpUrl}</span>
                    <input value={form.url ?? ''} placeholder="https://example.com/mcp" onChange={(event) => onFormChange({ ...form, url: event.target.value })} />
                  </label>
                  <label>
                    <span className="wf-hint">{copy.mcpHeaders}</span>
                    <input value={form.headers ?? ''} placeholder={'{"Authorization":"Bearer ..."}'} onChange={(event) => onFormChange({ ...form, headers: event.target.value })} />
                  </label>
                </div>
              )}
          <div className="wf-mcp-form__inline">
            <button type="button" className="wf-btn is-primary" onClick={onSave} disabled={busy}>{copy.mcpSave}</button>
            <button type="button" className="wf-btn" onClick={() => onFormChange(null)} disabled={busy}>{copy.importCancel}</button>
          </div>
        </div>
      ) : (
        <div className="wf-mcp-form">
          <div className="wf-mcp-form__row">
            <button type="button" className="wf-btn" onClick={() => onFormChange({ serverName: '', transport: 'stdio', commandLine: '', env: '', headers: '', url: '' })} disabled={busy}>{`＋ ${copy.mcpNew}`}</button>
            <button type="button" className="wf-btn" onClick={() => onImportOpenChange(true)} disabled={busy}>{copy.mcpImport}</button>
            <span className="wf-hint wf-mcp-form__note">{copy.mcpRestartHint}</span>
          </div>
        </div>
      )}
      {importOpen ? (
        <div className="wf-combo-backdrop">
          <div className="wf-combo wf-combo--dialog">
            <div className="wf-combo__head">
              <h4>{copy.mcpImport}</h4>
              <button type="button" className="wf-btn wf-combo__close" onClick={() => onImportOpenChange(false)}>✕</button>
            </div>
            <div className="wf-mcp-import__body">
              <span className="wf-hint wf-hint--block">{copy.mcpImportHint}</span>
              <textarea
                className="wf-mcp-import__text"
                value={importText}
                onChange={(event) => onImportTextChange(event.target.value)}
                placeholder={'{"mcpServers":{"codegraph":{"command":"npx","args":["-y","@colbymchenry/codegraph"]}}}'}
              />
              <div className="wf-mcp-form__row">
                <button type="button" className="wf-btn is-primary" onClick={onImportApply} disabled={busy}>{copy.mcpImportApply}</button>
                <button type="button" className="wf-btn" onClick={() => onImportOpenChange(false)} disabled={busy}>{copy.importCancel}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// src/client/components/combo-manager/ComboManager.tsx
//
// 组合管理弹层（照搬旧项目 combo-manager.js，TSX 化，按需求 §4.6 适配）：
// 左侧目录：工具（tool call）/ MCP 服务器两个 tab，网格卡片点击勾选；
// 右侧：组合列表（新建/选中/删除）+ 已选 chip + 命名保存；MCP tab 附增删改表单。
// 组合 = 工具清单 + MCP 服务器清单，保存后成为角色卡片「模式」下拉中的自定义模式。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import { EP } from '../../lib/remote.js'
import type { RemoteFace } from '../../hooks/useRemote.js'

interface CatalogItem { key: string; name: string; description?: string; disabled?: boolean; badge?: string; checked: boolean; onToggle(): void; onEdit?(): void; onToggleDisabled?(): void; onDelete?(): void }
interface McpEntry { id: string; serverName: string; transport?: string; command?: string; args?: string[]; url?: string; disabled?: boolean; description?: string }
interface ComboEntry { id: string; name: string; tools?: string[]; mcpServers?: string[] }
interface McpFormState { id?: string; serverName: string; transport: string; command: string; args: string; url: string }

export interface ComboManagerProps {
  copy: Dict
  remote: RemoteFace
  sessionId: string
  onClose(): void
  onToast(kind: 'info' | 'success' | 'error', text: string): void
  onChanged(): void
}

export function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }: ComboManagerProps) {
  const [catalog, setCatalog] = useState<{ items: Array<{ key: string; name: string; description: string }>; mcp: McpEntry[]; loadedPlugins: string[] }>({ items: [], mcp: [], loadedPlugins: [] })
  const [combos, setCombos] = useState<ComboEntry[]>([])
  const [tab, setTab] = useState<'plugins' | 'mcp'>('plugins')
  const [search, setSearch] = useState('')
  const [activeComboId, setActiveComboId] = useState<string | null>(null)
  const [comboDraft, setComboDraft] = useState<{ name: string; tools: string[]; mcpServers: string[] }>({ name: '', tools: [], mcpServers: [] })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mcpForm, setMcpForm] = useState<McpFormState | null>(null)
  const loadedRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [catalogData, combosData] = await Promise.all([
        remote.call(EP.EP_PLUGIN_CATALOG, { sessionId }).catch(() => ({ items: [], mcp: [], loadedPlugins: [] })),
        remote.call(EP.EP_TOOL_COMBOS).catch(() => []),
      ]) as [unknown, unknown]
      const cat = (catalogData ?? {}) as { items?: Array<{ key: string; name: string; description: string }>; mcp?: McpEntry[]; loadedPlugins?: string[] }
      setCatalog({
        items: Array.isArray(cat.items) ? cat.items : [],
        mcp: Array.isArray(cat.mcp) ? cat.mcp : [],
        loadedPlugins: Array.isArray(cat.loadedPlugins) ? cat.loadedPlugins : [],
      })
      const comboItems = Array.isArray(combosData) ? combosData as ComboEntry[] : []
      setCombos(comboItems)
      setActiveComboId((current) => {
        if (current && comboItems.some((item) => item.id === current)) return current
        const first = comboItems[0]
        if (first) {
          // 剔除官方保留传输名 run_code（子代理自带，且官方 restrict 禁止其进入名单）——
          // 旧数据清理展示；保存走后端 toolComboPut 时同样剔除
          setComboDraft({
            name: first.name,
            tools: (first.tools ?? []).filter((name) => name !== 'run_code'),
            mcpServers: [...(first.mcpServers ?? [])],
          })
          return first.id
        }
        return current
      })
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    }
  }, [remote, sessionId, onToast])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void load()
  }, [load])

  const selectCombo = useCallback((id: string): void => {
    setActiveComboId(id)
    setConfirmDelete(false)
    const combo = combos.find((item) => item.id === id)
    setComboDraft({
      name: combo?.name ?? '',
      tools: (combo?.tools ?? []).filter((name) => name !== 'run_code'),
      mcpServers: [...(combo?.mcpServers ?? [])],
    })
  }, [combos])

  const newCombo = useCallback((): void => {
    setActiveComboId(`combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
    setConfirmDelete(false)
    setComboDraft({ name: '', tools: [], mcpServers: [] })
  }, [])

  const saveCombo = useCallback(async (): Promise<void> => {
    if (!comboDraft.name.trim()) {
      onToast('error', copy.comboSaveFirst)
      return
    }
    setBusy(true)
    try {
      await remote.call(EP.EP_TOOL_COMBO_PUT, {
        combo: {
          id: activeComboId ?? `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: comboDraft.name.trim(),
          tools: [...comboDraft.tools],
          mcpServers: [...comboDraft.mcpServers],
        },
      })
      await load()
      onChanged?.()
      onToast('success', copy.comboSaved)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [activeComboId, comboDraft, copy.comboSaveFirst, copy.comboSaved, load, onChanged, onToast, remote])

  const deleteCombo = useCallback(async (): Promise<void> => {
    if (!activeComboId) return
    // 需求 §4.6 规则 5：删除组合二次确认（组合可能被节点引用，删除后节点回落为未选模式）
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    setBusy(true)
    try {
      await remote.call(EP.EP_TOOL_COMBO_DELETE, { id: activeComboId })
      setActiveComboId(null)
      setComboDraft({ name: '', tools: [], mcpServers: [] })
      await load()
      onChanged?.()
      onToast('success', copy.comboDeleted)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [activeComboId, confirmDelete, copy.comboDeleted, load, onChanged, onToast, remote])

  const toggleTool = useCallback((name: string): void => {
    setComboDraft((draft) => ({
      ...draft,
      tools: draft.tools.includes(name) ? draft.tools.filter((item) => item !== name) : [...draft.tools, name],
    }))
  }, [])

  const toggleMcp = useCallback((serverName: string): void => {
    setComboDraft((draft) => ({
      ...draft,
      mcpServers: draft.mcpServers.includes(serverName) ? draft.mcpServers.filter((item) => item !== serverName) : [...draft.mcpServers, serverName],
    }))
  }, [])

  const deleteMcp = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await remote.call(EP.EP_MCP_DELETE, { id })
      await load()
      onToast('success', copy.mcpDeleted)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [copy.mcpDeleted, load, onToast, remote])

  /** MCP 服务器启用/停用切换（停用后该服务器工具不再进入组合工具集）。 */
  const toggleMcpDisabled = useCallback(async (id: string, disabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      await remote.call(EP.EP_MCP_TOGGLE, { id, disabled })
      await load()
      onToast('success', disabled ? copy.mcpDisabled : copy.mcpEnabled)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [copy.mcpDisabled, copy.mcpEnabled, load, onToast, remote])

  const saveMcp = useCallback(async (): Promise<void> => {
    if (!mcpForm) return
    setBusy(true)
    try {
      const server = {
        id: mcpForm.id ?? null,
        serverName: mcpForm.serverName,
        transport: mcpForm.transport,
        command: mcpForm.transport === 'stdio' ? mcpForm.command : undefined,
        args: mcpForm.transport === 'stdio'
          ? String(mcpForm.args ?? '').split(/[,，]/).map((part) => part.trim()).filter(Boolean)
          : undefined,
        url: mcpForm.transport === 'streamable-http' ? mcpForm.url : undefined,
      }
      await remote.call(EP.EP_MCP_PUT, { server })
      setMcpForm(null)
      await load()
      onToast('success', copy.mcpSaved)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [copy.mcpSaved, load, mcpForm, onToast, remote])

  const tabs = [
    { key: 'plugins' as const, label: copy.comboTabDsh, count: catalog.items.length },
    { key: 'mcp' as const, label: copy.comboTabMcp, count: catalog.mcp.length },
  ]

  const gridItems: CatalogItem[] = useMemo(() => {
    try {
      const keyword = String(search ?? '').trim().toLowerCase()
      if (tab === 'plugins') {
        return (catalog.items ?? [])
          .filter((item) => !keyword
            || String(item.name ?? '').toLowerCase().includes(keyword)
            || String(item.description ?? '').toLowerCase().includes(keyword))
          .map((item) => ({
            key: item.key ?? `item:${item.name}`,
            name: item.name,
            description: item.description,
            checked: (comboDraft.tools ?? []).includes(item.name),
            onToggle: () => toggleTool(item.name),
          }))
      }
      return (catalog.mcp ?? [])
        .filter((server) => !keyword
          || String(server.serverName ?? '').toLowerCase().includes(keyword)
          || String(server.description ?? '').toLowerCase().includes(keyword))
        .map((server) => {
          const name = String(server.serverName ?? '').trim() || String(server.id ?? '')
          return {
            key: `mcp:${server.id}`,
            name,
            description: server.description,
            disabled: server.disabled === true,
            badge: server.disabled ? '已停用' : (server.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
            checked: (comboDraft.mcpServers ?? []).includes(name),
            onToggle: () => toggleMcp(name),
            onEdit: () => setMcpForm({
              id: server.id,
              serverName: name,
              transport: server.transport ?? 'stdio',
              command: server.command ?? '',
              args: Array.isArray(server.args) ? server.args.join(', ') : '',
              url: server.url ?? '',
            }),
            onToggleDisabled: server.disabled === true
              ? () => { void toggleMcpDisabled(server.id, false) }
              : () => { void toggleMcpDisabled(server.id, true) },
            onDelete: () => { void deleteMcp(server.id) },
          }
        })
    } catch {
      return []
    }
  }, [catalog, comboDraft, search, tab, toggleMcp, toggleTool, deleteMcp, toggleMcpDisabled])

  const selectedChips = useMemo(() => [
    ...comboDraft.tools.map((name) => ({ key: `t:${name}`, label: name, remove: () => toggleTool(name) })),
    ...comboDraft.mcpServers.map((name) => ({ key: `m:${name}`, label: name, remove: () => toggleMcp(name) })),
  ], [comboDraft, toggleMcp, toggleTool])

  const editingMcp = tab === 'mcp' && mcpForm !== null

  return (
    <div className="wf-combo-backdrop">
      <div className="wf-combo" role="dialog" aria-modal="true">
        <div className="wf-combo__head">
          <h3>{copy.comboManager}</h3>
          <span className="wf-status">{copy.comboHint}</span>
          <button type="button" className="wf-btn wf-combo__close" onClick={onClose}>✕</button>
        </div>
        <div className="wf-combo__body">
          <div className="wf-combo__catalog">
            <div className="wf-combo__tabs">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`wf-combo__tab${tab === item.key ? ' is-active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <span>{item.label}</span>
                  <span className="wf-combo__tab-count">{String(item.count)}</span>
                </button>
              ))}
            </div>
            <div className="wf-combo__search">
              <input type="text" value={search} placeholder={copy.comboSearch} onChange={(event) => setSearch(event.target.value)} />
            </div>
            {catalog.loadedPlugins.length > 0 && tab === 'plugins'
              ? <div className="wf-hint" style={{ padding: '4px 12px 0', fontSize: 10, lineHeight: 1.5, color: 'var(--wf-ink-2)' }}>
                  {String(copy.loadedPluginsLabel).replace('{count}', String(catalog.loadedPlugins.length))}
                </div>
              : null}
            <div className="wf-combo__grid">
              {gridItems.length === 0
                ? <div className="wf-hint" style={{ gridColumn: '1 / -1', padding: 14 }}>
                    {String(search ?? '').trim() ? copy.comboSearchEmpty : copy.comboEmpty}
                  </div>
                : gridItems.map((item) => (
                    <div key={item.key} className={`wf-combo-card${(item as { checked: boolean }).checked ? ' is-checked' : ''}`} style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="wf-combo-card__main"
                        style={{ display: 'flex', gap: 9, alignItems: 'flex-start', textAlign: 'left', border: 0, background: 'transparent', padding: 0, paddingRight: 88, paddingBottom: 30, flex: 1, cursor: 'pointer' }}
                        onClick={item.onToggle}
                        title={item.name}
                      >
                        <input type="checkbox" readOnly checked={(item as { checked: boolean }).checked === true} />
                        <span className="wf-combo-card__body">
                          <span className="wf-combo-card__name">{item.name}</span>
                          <span className="wf-combo-card__desc">{item.description}</span>
                          {item.badge ? <span className="wf-combo-card__badge">{item.badge}</span> : null}
                        </span>
                      </button>
                      {(item.onEdit || item.onDelete || item.onToggleDisabled)
                        ? (
                            <span style={{ display: 'flex', gap: 4, position: 'absolute', right: 8, bottom: 8 }}>
                              {item.onEdit
                                ? <button type="button" className="wf-btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={(event) => { event.stopPropagation(); item.onEdit?.() }}>{copy.mcpEdit}</button>
                                : null}
                              {item.onToggleDisabled
                                ? <button type="button" className="wf-btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={(event) => { event.stopPropagation(); item.onToggleDisabled?.() }}>{item.disabled ? copy.mcpEnable : copy.mcpDisable}</button>
                                : null}
                              {item.onDelete
                                ? <button type="button" className="wf-btn is-danger" style={{ fontSize: 9, padding: '2px 6px' }} onClick={(event) => { event.stopPropagation(); item.onDelete?.() }}>{copy.mcpDelete}</button>
                                : null}
                            </span>
                          )
                        : null}
                    </div>
                  ))}
            </div>
          </div>
          <div className="wf-combo__side">
            <div className="wf-combo__side-head">
              <h4>{copy.combos}</h4>
              <button type="button" className="wf-btn" onClick={newCombo} disabled={busy}>{`＋ ${copy.comboNew}`}</button>
            </div>
            <div className="wf-combo__side-list">
              {combos.length === 0
                ? <div className="wf-hint">{copy.comboEmpty}</div>
                : combos.map((combo) => (
                    <button
                      key={combo.id}
                      type="button"
                      className={`wf-combo-item${combo.id === activeComboId ? ' is-active' : ''}`}
                      onClick={() => selectCombo(combo.id)}
                    >
                      <span className="wf-combo-item__label">{combo.name}</span>
                      <span className="wf-combo-item__meta">
                        {`${(combo.tools?.length ?? 0)} ${copy.comboTabTool ?? ''} · ${combo.mcpServers?.length ?? 0} MCP`}
                      </span>
                    </button>
                  ))}
            </div>
            <div className="wf-combo__edit">
              <label>
                <span className="wf-hint">{copy.comboName}</span>
                <input value={comboDraft.name} placeholder={copy.comboName} onChange={(event) => setComboDraft((draft) => ({ ...draft, name: event.target.value }))} />
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
              <button type="button" className="wf-btn is-danger" onClick={() => { void deleteCombo() }} disabled={!activeComboId || busy}>{confirmDelete ? copy.comboDeleteConfirm : copy.comboDelete}</button>
              <button type="button" className="wf-btn is-primary" onClick={() => { void saveCombo() }} disabled={busy}>{copy.inspectorSave}</button>
            </div>
            <div className="wf-combo-hint">{copy.comboHint}</div>
          </div>
        </div>
        {editingMcp ? (
          <div className="wf-mcp-form">
            <div className="wf-combo__head" style={{ borderTop: '1px solid var(--wf-border)', padding: '8px 14px' }}>
              <h4>{mcpForm.id ? copy.mcpEdit : copy.mcpNew}</h4>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>
              <label style={{ flex: 1 }}>
                <span className="wf-hint">{copy.mcpName}</span>
                <input value={mcpForm.serverName ?? ''} onChange={(event) => setMcpForm((form) => ({ ...form!, serverName: event.target.value }))} />
              </label>
              <label style={{ flex: 1 }}>
                <span className="wf-hint">{copy.mcpTransport}</span>
                <select value={mcpForm.transport ?? 'stdio'} onChange={(event) => setMcpForm((form) => ({ ...form!, transport: event.target.value }))}>
                  <option value="stdio">{copy.mcpTransportStdio}</option>
                  <option value="streamable-http">{copy.mcpTransportHttp}</option>
                </select>
              </label>
            </div>
            {(mcpForm.transport ?? 'stdio') === 'stdio'
              ? (
                  <div style={{ display: 'grid', gap: 8, padding: '0 14px 12px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ flex: 1 }}>
                        <span className="wf-hint">{copy.mcpCommand}</span>
                        <input value={mcpForm.command ?? ''} placeholder="npx -y some-mcp-server" onChange={(event) => setMcpForm((form) => ({ ...form!, command: event.target.value }))} />
                      </label>
                      <label style={{ flex: 1 }}>
                        <span className="wf-hint">{copy.mcpArgs}</span>
                        <input value={mcpForm.args ?? ''} placeholder="--browser, msedge" onChange={(event) => setMcpForm((form) => ({ ...form!, args: event.target.value }))} />
                      </label>
                    </div>
                    {copy.mcpCommandHint
                      ? <span className="wf-hint" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--wf-ink-2)' }}>{copy.mcpCommandHint}</span>
                      : null}
                  </div>
                )
              : (
                  <label style={{ display: 'grid', gap: 4, padding: '0 14px 12px' }}>
                    <span className="wf-hint">{copy.mcpUrl}</span>
                    <input value={mcpForm.url ?? ''} placeholder="https://example.com/mcp" onChange={(event) => setMcpForm((form) => ({ ...form!, url: event.target.value }))} />
                  </label>
                )}
            <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>
              <button type="button" className="wf-btn is-primary" onClick={() => { void saveMcp() }} disabled={busy}>{copy.mcpSave}</button>
              <button type="button" className="wf-btn" onClick={() => setMcpForm(null)} disabled={busy}>{copy.importCancel ?? '取消'}</button>
            </div>
          </div>
        ) : null}
        {tab === 'mcp' && !editingMcp ? (
          <div className="wf-mcp-form">
            <div className="wf-mcp-form__row">
              <button type="button" className="wf-btn" onClick={() => setMcpForm({ serverName: '', transport: 'stdio', command: '', args: '', url: '' })} disabled={busy}>{`＋ ${copy.mcpNew}`}</button>
              <span className="wf-hint" style={{ alignSelf: 'center', flex: 1 }}>{copy.mcpRestartHint}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

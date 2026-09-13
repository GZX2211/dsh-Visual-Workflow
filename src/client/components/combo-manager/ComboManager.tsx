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
import { buildToolTags, filterToolNamesByTag, TAG_ALL, type ToolTag } from '../../lib/tool-tags.js'

interface CatalogItem { key: string; name: string; description?: string; disabled?: boolean; badge?: string; checked: boolean; onToggle(): void; onEdit?(): void; onToggleDisabled?(): void; onDelete?(): void }
interface McpEntry { id: string; serverName: string; transport?: string; command?: string; args?: string[]; commandLine?: string; env?: Record<string, string>; headers?: Record<string, string>; url?: string; disabled?: boolean; description?: string }
interface ComboEntry { id: string; name: string; tools?: string[]; mcpServers?: string[] }
interface McpFormState { id?: string; serverName: string; transport: string; commandLine: string; env: string; headers: string; url: string }

/** 把 {command, args} 拼回一整行（含空格的 token 加引号），供导入时回填 commandLine。 */
function joinCommandLine(command: string, args: string[]): string {
  return [String(command ?? ''), ...(Array.isArray(args) ? args : []).map((arg) => String(arg))]
    .filter((token) => token !== '')
    .map((token) => {
      if (/^[A-Za-z0-9_./\\:=@%+,\[\]{}#-]+$/.test(token) && !/["']/.test(token)) return token
      if (!token.includes('"')) return `"${token}"`
      if (!token.includes("'")) return `'${token}'`
      return `"${token.replace(/"/g, '\\"')}"`
    })
    .join(' ')
}

/** 解析 env / headers 的 JSON 字符串为对象（空串 → {}）。 */
function parseJsonObject(text: string): Record<string, string> {
  const value = String(text ?? '').trim()
  if (!value) return {}
  const obj = JSON.parse(value)
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, string>
  throw new Error('环境变量/请求头需为 JSON 对象')
}

export interface ComboManagerProps {
  copy: Dict
  remote: RemoteFace
  sessionId: string
  onClose(): void
  onToast(kind: 'info' | 'success' | 'error', text: string): void
  onChanged(): void
}

export function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }: ComboManagerProps) {
  const [catalog, setCatalog] = useState<{ items: Array<{ key: string; name: string; description: string }>; mcp: McpEntry[]; loadedPlugins: string[]; disabledTools: string[] }>({ items: [], mcp: [], loadedPlugins: [], disabledTools: [] })
  const [combos, setCombos] = useState<ComboEntry[]>([])
  const [tab, setTab] = useState<'plugins' | 'mcp'>('plugins')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string>(TAG_ALL)
  const [disabledTools, setDisabledTools] = useState<ReadonlySet<string>>(new Set())
  const [activeComboId, setActiveComboId] = useState<string | null>(null)
  const [comboDraft, setComboDraft] = useState<{ name: string; tools: string[]; mcpServers: string[] }>({ name: '', tools: [], mcpServers: [] })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mcpForm, setMcpForm] = useState<McpFormState | null>(null)
  const [mcpImportOpen, setMcpImportOpen] = useState(false)
  const [mcpImportText, setMcpImportText] = useState('')
  const loadedRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [catalogData, combosData] = await Promise.all([
        remote.call(EP.EP_PLUGIN_CATALOG, { sessionId }).catch(() => ({ items: [], mcp: [], loadedPlugins: [], disabledTools: [] })),
        remote.call(EP.EP_TOOL_COMBOS).catch(() => []),
      ]) as [unknown, unknown]
      const cat = (catalogData ?? {}) as { items?: Array<{ key: string; name: string; description: string }>; mcp?: McpEntry[]; loadedPlugins?: string[]; disabledTools?: string[] }
      setCatalog({
        items: Array.isArray(cat.items) ? cat.items : [],
        mcp: Array.isArray(cat.mcp) ? cat.mcp : [],
        loadedPlugins: Array.isArray(cat.loadedPlugins) ? cat.loadedPlugins : [],
        disabledTools: Array.isArray(cat.disabledTools) ? cat.disabledTools : [],
      })
      // 全局工具开关快照（关闭 = 父代理上下文不可见，列表置灰且无法勾选）
      setDisabledTools(new Set(Array.isArray(cat.disabledTools) ? cat.disabledTools : []))
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

  /**
   * 单个工具的全局开关（父代理白名单「关闭」侧）：
   *   - 关闭后该工具在所有会话的代理上下文中不可见（system-prompt/assemble 瀑布剔除）；
   *   - 关闭的工具不得留在组合草稿（父代理不可用 → 子代理无法传入），自动去除勾选；
   *   - 状态更新即全局即时生效（无需运行工作流）。
   */
  const toggleToolDisabled = useCallback(async (name: string, disabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await remote.call(EP.EP_TOOL_SWITCH_PUT, { name, disabled }) as { disabled?: unknown }
      const next = new Set<string>(Array.isArray(result?.disabled) ? (result.disabled as string[]).map((item) => String(item)) : [])
      setDisabledTools(next)
      if (disabled) {
        setComboDraft((draft) => ({ ...draft, tools: draft.tools.filter((item) => item !== name) }))
      }
      onToast('success', disabled ? copy.toolSwitchDisabled : copy.toolSwitchEnabled)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [copy.toolSwitchDisabled, copy.toolSwitchEnabled, onToast, remote])

  /**
   * 一键开关当前标签下全部工具（组合管理「标签」胶囊栏右侧按钮）：
   *   - 仅作用于当前激活标签（官方工具 / MCP 服务器标签）命中的工具集合，
   *     不影响其他标签或官方工具——filterToolNamesByTag 按标签语义收窄；
   *   - 关闭状态目标 = 标签下所有工具是否已全部关闭：全部关闭则一键开启，
   *     否则一键关闭（幂等；空标签或「全部」标签下无明确工具集合时禁用）；
   *   - 关闭成功后将标签下工具从组合草稿移除（父代理不可用 → 子代理无法传入）。
   */
  const toggleTagBulkToolDisabled = useCallback(async (disabled: boolean): Promise<void> => {
    const toolNames = filterToolNamesByTag((catalog.items ?? []).map((item) => item.name), activeTag)
    if (toolNames.length === 0) return
    setBusy(true)
    try {
      const result = await remote.call(EP.EP_TOOL_SWITCH_PUT_MANY, { names: toolNames, disabled }) as { disabled?: unknown }
      const next = new Set<string>(Array.isArray(result?.disabled) ? (result.disabled as string[]).map((item) => String(item)) : [])
      setDisabledTools(next)
      if (disabled) {
        setComboDraft((draft) => ({ ...draft, tools: draft.tools.filter((item) => !toolNames.includes(item)) }))
      }
      onToast('success', disabled ? copy.toolSwitchBatchDisabled : copy.toolSwitchBatchEnabled)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    } finally {
      setBusy(false)
    }
  }, [activeTag, catalog.items, copy.toolSwitchBatchDisabled, copy.toolSwitchBatchEnabled, onToast, remote])

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
      // env / headers 为可选 JSON；空串或非法由 parseJsonObject 处理
      let env: Record<string, string> = {}
      let headers: Record<string, string> = {}
      try {
        env = parseJsonObject(mcpForm.env)
        headers = parseJsonObject(mcpForm.headers)
      } catch (error) {
        onToast('error', String((error as Error)?.message ?? error))
        setBusy(false)
        return
      }
      const server = {
        id: mcpForm.id ?? null,
        serverName: mcpForm.serverName,
        transport: mcpForm.transport,
        commandLine: mcpForm.transport === 'stdio' ? mcpForm.commandLine : undefined,
        env: mcpForm.transport === 'stdio' && Object.keys(env).length > 0 ? env : undefined,
        headers: mcpForm.transport === 'streamable-http' && Object.keys(headers).length > 0 ? headers : undefined,
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

  /** 从 mcp.json 粘贴导入：支持 {mcpServers:{name:{...}}} 或单个 server 对象。 */
  const importMcpJson = useCallback((): void => {
    try {
      const raw = String(mcpImportText ?? '').trim()
      if (!raw) throw new Error('请先粘贴 mcp.json 配置')
      let data = JSON.parse(raw) as Record<string, unknown>
      if (data && typeof data === 'object' && data.mcpServers && typeof data.mcpServers === 'object') {
        const entries = Object.entries(data.mcpServers as Record<string, unknown>)
        if (entries.length === 0) throw new Error('mcpServers 配置为空')
        const [name, server] = entries[0]
        data = { ...(server as Record<string, unknown>), serverName: (server as Record<string, unknown>)?.serverName ?? name } as Record<string, unknown>
      }
      const transport = data.transport === 'streamable-http' || data.url ? 'streamable-http' : 'stdio'
      const command = String(data.command ?? '')
      const args = Array.isArray(data.args) ? (data.args as unknown[]).map((item) => String(item)) : []
      setMcpForm({
        id: undefined,
        serverName: String((data.serverName as string) ?? (data.name as string) ?? ''),
        transport,
        commandLine: transport === 'stdio' ? joinCommandLine(command, args) : '',
        env: data.env && typeof data.env === 'object' && Object.keys(data.env as object).length > 0 ? JSON.stringify(data.env) : '',
        headers: data.headers && typeof data.headers === 'object' && Object.keys(data.headers as object).length > 0 ? JSON.stringify(data.headers) : '',
        url: String(data.url ?? ''),
      })
      setMcpImportOpen(false)
      onToast('success', copy.mcpImported)
    } catch (error) {
      onToast('error', String((error as Error)?.message ?? error))
    }
  }, [copy.mcpImported, mcpImportText, onToast])

  const tabs = [
    { key: 'plugins' as const, label: copy.comboTabDsh, count: catalog.items.length },
    { key: 'mcp' as const, label: copy.comboTabMcp, count: catalog.mcp.length },
  ]

  /** 筛选标签（动态构建）：[全部] + [官方工具] + MCP 服务器 Tag（按目录首次出现顺序） */
  const toolTags: ToolTag[] = useMemo(
    () => buildToolTags((catalog.items ?? []).map((item) => item.name), catalog.mcp),
    [catalog.items, catalog.mcp],
  )

  /**
   * 当前激活标签命中的工具集合（一键开关目标；MCP 服务器标签 / 官方工具标签）。
   * 「全部」标签回退为空集（无明确批量语义，按钮禁用）。
   */
  const tagToolNames: string[] = useMemo(
    () => (activeTag === TAG_ALL ? [] : filterToolNamesByTag((catalog.items ?? []).map((item) => item.name), activeTag)),
    [activeTag, catalog.items],
  )

  /** 当前标签下工具是否已全部关闭（一键开关按钮目标态：全部关闭 → 显示「一键开启」）。 */
  const tagToolsAllDisabled = useMemo(
    () => tagToolNames.length > 0 && tagToolNames.every((name) => disabledTools.has(name)),
    [tagToolNames, disabledTools],
  )

  const gridItems: CatalogItem[] = useMemo(() => {
    try {
      const keyword = String(search ?? '').trim().toLowerCase()
      if (tab === 'plugins') {
        return (catalog.items ?? [])
          // 先按激活 Tag 过滤（全部/官方工具/MCP 服务器），再按关键词过滤
          .filter((item) => {
            if (activeTag === TAG_ALL) return true
            const isMcp = item.name.startsWith('mcp__')
            if (activeTag === 'builtin') return !isMcp
            if (activeTag.startsWith('mcp:')) return isMcp && item.name.startsWith(`mcp__${activeTag.slice(4)}__`)
            return true
          })
          .filter((item) => !keyword
            || String(item.name ?? '').toLowerCase().includes(keyword)
            || String(item.description ?? '').toLowerCase().includes(keyword))
          .map((item) => {
            // 被全局关闭的工具：置灰且无法勾选（父代理不可用 → 子代理无法传入）
            const disabledTool = disabledTools.has(item.name)
            return {
              key: item.key ?? `item:${item.name}`,
              name: item.name,
              description: item.description,
              disabled: disabledTool,
              checked: !disabledTool && (comboDraft.tools ?? []).includes(item.name),
              onToggle: disabledTool ? () => {} : () => toggleTool(item.name),
              onToggleDisabled: () => { void toggleToolDisabled(item.name, !disabledTool) },
            }
          })
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
              commandLine: String(server.commandLine ?? server.command ?? ''),
              env: server.env && Object.keys(server.env).length > 0 ? JSON.stringify(server.env) : '',
              headers: server.headers && Object.keys(server.headers).length > 0 ? JSON.stringify(server.headers) : '',
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
  }, [catalog, comboDraft, search, tab, activeTag, disabledTools, toggleMcp, toggleTool, toggleToolDisabled, deleteMcp, toggleMcpDisabled])

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
            {/* 筛选标签：胶囊样式；[全部] + [官方工具] + 动态 MCP 服务器 Tag（单选；再点当前 Tag 回「全部」）
                右侧一键开关：仅当前激活标签（官方工具 / MCP 服务器）命中工具集合生效，
                点击统一关闭/开启该标签下全部工具（不影响其他标签或官方工具）。 */}
            {tab === 'plugins' && toolTags.length > 1
              ? (
                  <div className="wf-combo__tags">
                    {toolTags.map((tag) => (
                      <button
                        key={tag.key}
                        type="button"
                        className={`wf-combo-tag${activeTag === tag.key ? ' is-active' : ''}`}
                        onClick={() => setActiveTag((current) => (current === tag.key ? TAG_ALL : tag.key))}
                      >
                        {tag.label}
                      </button>
                    ))}
                    {tagToolNames.length > 0
                      ? (
                          <button
                            type="button"
                            className="wf-combo-tag wf-combo-tag__bulk"
                            onClick={() => { void toggleTagBulkToolDisabled(!tagToolsAllDisabled) }}
                            disabled={busy}
                            title={copy.comboTagBulkHint}
                          >
                            {tagToolsAllDisabled ? copy.comboTagEnableAll : copy.comboTagDisableAll}
                          </button>
                        )
                      : null}
                  </div>
                )
              : null}
            <div className="wf-combo__grid">
              {gridItems.length === 0
                ? <div className="wf-hint" style={{ gridColumn: '1 / -1', padding: 14 }}>
                    {String(search ?? '').trim() ? copy.comboSearchEmpty : copy.comboEmpty}
                  </div>
                : gridItems.map((item) => (
                    <div key={item.key} className={`wf-combo-card${(item as { checked: boolean }).checked ? ' is-checked' : ''}${item.disabled ? ' is-disabled' : ''}`} style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="wf-combo-card__main"
                        style={{ display: 'flex', gap: 9, alignItems: 'flex-start', textAlign: 'left', border: 0, background: 'transparent', padding: 0, paddingRight: 88, paddingBottom: 30, flex: 1, cursor: item.disabled ? 'default' : 'pointer' }}
                        onClick={item.onToggle}
                        title={item.name}
                        disabled={item.disabled}
                      >
                        <input type="checkbox" readOnly checked={(item as { checked: boolean }).checked === true} disabled={item.disabled} />
                        <span className="wf-combo-card__body">
                          <span className="wf-combo-card__name">{item.name}</span>
                          <span className="wf-combo-card__desc">{item.description}</span>
                          {item.badge ? <span className="wf-combo-card__badge">{item.badge}</span> : null}
                        </span>
                      </button>
                      {/* 右侧操作：工具卡片 = 开启/关闭（全局开关，无编辑/删除）；MCP 卡片 = 编辑/启停/删除 */}
                      {(item.onEdit || item.onDelete || item.onToggleDisabled)
                        ? (
                            <span style={{ display: 'flex', gap: 4, position: 'absolute', right: 8, bottom: 8 }}>
                              {item.onEdit
                                ? <button type="button" className="wf-btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={(event) => { event.stopPropagation(); item.onEdit?.() }}>{copy.mcpEdit}</button>
                                : null}
                              {item.onToggleDisabled
                                ? <button type="button" className="wf-btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={(event) => { event.stopPropagation(); item.onToggleDisabled?.() }}>{item.disabled ? copy.toolEnable : copy.toolDisable}</button>
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
                    <label>
                      <span className="wf-hint">{copy.mcpCommand}</span>
                      <input value={mcpForm.commandLine ?? ''} placeholder="npx -y @playwright/mcp@latest --headless" onChange={(event) => setMcpForm((form) => ({ ...form!, commandLine: event.target.value }))} />
                    </label>
                    <label>
                      <span className="wf-hint">{copy.mcpEnv}</span>
                      <input value={mcpForm.env ?? ''} placeholder={'{"API_KEY":"..."}'} onChange={(event) => setMcpForm((form) => ({ ...form!, env: event.target.value }))} />
                    </label>
                    {copy.mcpCommandHint
                      ? <span className="wf-hint" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--wf-ink-2)' }}>{copy.mcpCommandHint}</span>
                      : null}
                  </div>
                )
              : (
                  <div style={{ display: 'grid', gap: 8, padding: '0 14px 12px' }}>
                    <label>
                      <span className="wf-hint">{copy.mcpUrl}</span>
                      <input value={mcpForm.url ?? ''} placeholder="https://example.com/mcp" onChange={(event) => setMcpForm((form) => ({ ...form!, url: event.target.value }))} />
                    </label>
                    <label>
                      <span className="wf-hint">{copy.mcpHeaders}</span>
                      <input value={mcpForm.headers ?? ''} placeholder={'{"Authorization":"Bearer ..."}'} onChange={(event) => setMcpForm((form) => ({ ...form!, headers: event.target.value }))} />
                    </label>
                  </div>
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
              <button type="button" className="wf-btn" onClick={() => setMcpForm({ serverName: '', transport: 'stdio', commandLine: '', env: '', headers: '', url: '' })} disabled={busy}>{`＋ ${copy.mcpNew}`}</button>
              <button type="button" className="wf-btn" onClick={() => setMcpImportOpen(true)} disabled={busy}>{copy.mcpImport}</button>
              <span className="wf-hint" style={{ alignSelf: 'center', flex: 1 }}>{copy.mcpRestartHint}</span>
            </div>
          </div>
        ) : null}
        {mcpImportOpen ? (
          <div className="wf-combo-backdrop">
            <div className="wf-combo" style={{ maxWidth: 560, height: 'auto', maxHeight: '82%' }}>
              <div className="wf-combo__head">
                <h4>{copy.mcpImport}</h4>
                <button type="button" className="wf-btn wf-combo__close" onClick={() => setMcpImportOpen(false)}>✕</button>
              </div>
              <div style={{ padding: '0 14px 12px', display: 'grid', gap: 8 }}>
                <span className="wf-hint" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--wf-ink-2)' }}>{copy.mcpImportHint}</span>
                <textarea
                  value={mcpImportText}
                  onChange={(event) => setMcpImportText(event.target.value)}
                  placeholder={'{"mcpServers":{"codegraph":{"command":"npx","args":["-y","@colbymchenry/codegraph"]}}}'}
                  style={{ minHeight: 150, padding: 8, borderRadius: 8, border: '1px solid var(--wf-border-strong)', background: 'var(--wf-layer-2)', color: 'var(--wf-ink)', fontFamily: 'monospace', fontSize: 12 }}
                />
                <div className="wf-mcp-form__row">
                  <button type="button" className="wf-btn is-primary" onClick={() => { void importMcpJson() }} disabled={busy}>{copy.mcpImportApply}</button>
                  <button type="button" className="wf-btn" onClick={() => setMcpImportOpen(false)} disabled={busy}>{copy.importCancel ?? '取消'}</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

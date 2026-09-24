// src/client/components/combo-manager/ComboCatalog.tsx
//
// 组合管理左侧目录：工具（tool call）/ MCP 服务器两个 tab，标签胶囊筛选、搜索、
// 网格卡片勾选与逐卡片操作（工具全局开关 / MCP 编辑·启停·删除）。
// 纯表现层：目录数据与动作全部经 props 注入，本组件不发起请求。

import { useMemo } from 'react'
import type { Dict } from '../../i18n.js'
import type { ToolCatalog } from '../../hooks/useToolCombos.js'
import type { McpServerEntry } from '../../lib/mcp-form.js'
import { buildToolTags, filterToolNamesByTag, TAG_ALL, type ToolTag } from '../../lib/tool-tags.js'

export interface ComboCatalogProps {
  copy: Dict
  catalog: ToolCatalog
  tab: 'plugins' | 'mcp'
  onTabChange(tab: 'plugins' | 'mcp'): void
  search: string
  onSearchChange(value: string): void
  activeTag: string
  onTagChange(tag: string): void
  disabledTools: ReadonlySet<string>
  comboDraft: { tools: string[]; mcpServers: string[] }
  busy: boolean
  onToggleTool(name: string): void
  onToggleMcp(name: string): void
  onToggleToolDisabled(name: string, disabled: boolean): void
  onToggleMcpDisabled(id: string, disabled: boolean): void
  onEditMcp(server: McpServerEntry): void
  onDeleteMcp(id: string): void
  /** 一键开关当前标签下工具（names 由本组件按标签语义给出）。 */
  onBulkToolDisabled(disabled: boolean, toolNames: string[]): void
}

/** 网格卡片（工具 / MCP 服务器共用的展示模型）。 */
interface CatalogCard {
  key: string
  name: string
  description?: string
  disabled?: boolean
  checked: boolean
  badge?: string
  onToggle(): void
  onEdit?(): void
  onToggleDisabled?(): void
  onDelete?(): void
}

export function ComboCatalog(props: ComboCatalogProps) {
  const {
    copy, catalog, tab, onTabChange, search, onSearchChange, activeTag, onTagChange,
    disabledTools, comboDraft, busy, onToggleTool, onToggleMcp, onToggleToolDisabled,
    onToggleMcpDisabled, onEditMcp, onDeleteMcp, onBulkToolDisabled,
  } = props

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

  const cards: CatalogCard[] = useMemo(() => {
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
              onToggle: disabledTool ? () => {} : () => onToggleTool(item.name),
              onToggleDisabled: () => onToggleToolDisabled(item.name, !disabledTool),
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
            badge: server.disabled ? copy.mcpDisabledBadge : (server.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
            checked: (comboDraft.mcpServers ?? []).includes(name),
            onToggle: () => onToggleMcp(name),
            onEdit: () => onEditMcp(server),
            onToggleDisabled: () => onToggleMcpDisabled(server.id, server.disabled !== true),
            onDelete: () => onDeleteMcp(server.id),
          }
        })
    } catch {
      return []
    }
  }, [activeTag, catalog.items, catalog.mcp, comboDraft.mcpServers, comboDraft.tools, copy.mcpDisabledBadge, disabledTools, onDeleteMcp, onEditMcp, onToggleMcp, onToggleMcpDisabled, onToggleTool, onToggleToolDisabled, search, tab])

  return (
    <div className="wf-combo__catalog">
      <div className="wf-combo__tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`wf-combo__tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => onTabChange(item.key)}
          >
            <span>{item.label}</span>
            <span className="wf-combo__tab-count">{String(item.count)}</span>
          </button>
        ))}
      </div>
      <div className="wf-combo__search">
        <input type="text" value={search} placeholder={copy.comboSearch} onChange={(event) => onSearchChange(event.target.value)} />
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
                  onClick={() => onTagChange(activeTag === tag.key ? TAG_ALL : tag.key)}
                >
                  {tag.label}
                </button>
              ))}
              {tagToolNames.length > 0
                ? (
                    <button
                      type="button"
                      className="wf-combo-tag wf-combo-tag__bulk"
                      onClick={() => onBulkToolDisabled(!tagToolsAllDisabled, tagToolNames)}
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
        {cards.length === 0
          ? <div className="wf-hint wf-combo__grid-empty">{String(search ?? '').trim() ? copy.comboSearchEmpty : copy.comboEmpty}</div>
          : cards.map((item) => (
              <div key={item.key} className={`wf-combo-card${item.checked ? ' is-checked' : ''}${item.disabled ? ' is-disabled' : ''}`}>
                <button
                  type="button"
                  className="wf-combo-card__main"
                  onClick={item.onToggle}
                  title={item.name}
                  disabled={item.disabled}
                >
                  <input type="checkbox" readOnly checked={item.checked === true} disabled={item.disabled} />
                  <span className="wf-combo-card__body">
                    <span className="wf-combo-card__name">{item.name}</span>
                    <span className="wf-combo-card__desc">{item.description}</span>
                    {item.badge ? <span className="wf-combo-card__badge">{item.badge}</span> : null}
                  </span>
                </button>
                {/* 右侧操作：工具卡片 = 开启/关闭（全局开关，无编辑/删除）；MCP 卡片 = 编辑/启停/删除 */}
                {(item.onEdit || item.onDelete || item.onToggleDisabled)
                  ? (
                      <span className="wf-combo-card__actions">
                        {item.onEdit
                          ? <button type="button" className="wf-btn wf-btn--xs" onClick={(event) => { event.stopPropagation(); item.onEdit?.() }}>{copy.mcpEdit}</button>
                          : null}
                        {item.onToggleDisabled
                          ? <button type="button" className="wf-btn wf-btn--xs" onClick={(event) => { event.stopPropagation(); item.onToggleDisabled?.() }}>{item.disabled ? copy.toolEnable : copy.toolDisable}</button>
                          : null}
                        {item.onDelete
                          ? <button type="button" className="wf-btn is-danger wf-btn--xs" onClick={(event) => { event.stopPropagation(); item.onDelete?.() }}>{copy.mcpDelete}</button>
                          : null}
                      </span>
                    )
                  : null}
              </div>
            ))}
      </div>
    </div>
  )
}

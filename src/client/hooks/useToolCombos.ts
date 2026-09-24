// src/client/hooks/useToolCombos.ts
//
// 组合管理的数据面（网络访问与远端状态归此 hook，组件不感知网络）：
//   - 工具目录（官方工具 + MCP 服务器 + 已装载插件 + 全局已关闭工具）；
//   - 工具组合列表与增删改；
//   - 工具全局开关（单个 / 批量）与 MCP 服务器增删改/启停。
// 失败一律抛出（调用方 toast 并决定文案）；本地草稿、搜索与标签等界面态留在组件。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import type { McpServerEntry } from '../lib/mcp-form.js'

/** 工具目录条目（后端 pluginCatalog 返回形状）。 */
export interface CatalogItem { key?: string; name: string; description: string; disabled?: boolean }
/** 工具组合条目。 */
export interface ComboEntry { id: string; name: string; tools?: string[]; mcpServers?: string[] }

/** 工具目录快照。 */
export interface ToolCatalog {
  items: CatalogItem[]
  mcp: McpServerEntry[]
  loadedPlugins: string[]
  disabledTools: string[]
}

const EMPTY_CATALOG: ToolCatalog = { items: [], mcp: [], loadedPlugins: [], disabledTools: [] }

export interface ToolCombosFace {
  catalog: ToolCatalog
  combos: ComboEntry[]
  /** 全局已关闭工具（父代理上下文不可见；列表置灰且不可勾选）。 */
  disabledTools: ReadonlySet<string>
  /** 是否有请求在飞（按钮禁用用）。 */
  busy: boolean
  /** 加载目录与组合列表；返回本次结果供调用方初始化选择（不写组件状态）。 */
  load(): Promise<{ catalog: ToolCatalog; combos: ComboEntry[] }>
  saveCombo(combo: { id: string; name: string; tools: string[]; mcpServers: string[] }): Promise<void>
  deleteCombo(id: string): Promise<void>
  /** 单个工具全局开关；返回开启后的完整已关闭清单。 */
  setToolDisabled(name: string, disabled: boolean): Promise<string[]>
  /** 按标签批量开关；返回开启后的完整已关闭清单。 */
  setToolsDisabled(names: string[], disabled: boolean): Promise<string[]>
  saveMcp(server: Record<string, unknown>): Promise<void>
  deleteMcp(id: string): Promise<void>
  setMcpDisabled(id: string, disabled: boolean): Promise<void>
}

export function useToolCombos(remote: RemoteFace, sessionId: string): ToolCombosFace {
  const [catalog, setCatalog] = useState<ToolCatalog>(EMPTY_CATALOG)
  const [combos, setCombos] = useState<ComboEntry[]>([])
  const [disabledTools, setDisabledTools] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // 卸载后不得再写状态（异步返回的归属校验）：弹层关闭即卸载，而加载/保存可能仍在飞。
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /** 单次请求的统一 busy 与挂载校验包装。 */
  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    try {
      const result = await task()
      return mountedRef.current ? result : null
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [])

  const load = useCallback(async (): Promise<{ catalog: ToolCatalog; combos: ComboEntry[] }> => {
    const [catalogData, combosData] = await Promise.all([
      remote.call(EP.EP_PLUGIN_CATALOG, { sessionId }).catch(() => EMPTY_CATALOG),
      remote.call(EP.EP_TOOL_COMBOS).catch(() => []),
    ]) as [unknown, unknown]
    const cat = (catalogData ?? {}) as Partial<ToolCatalog>
    const nextCatalog: ToolCatalog = {
      items: Array.isArray(cat.items) ? cat.items as CatalogItem[] : [],
      mcp: Array.isArray(cat.mcp) ? cat.mcp : [],
      loadedPlugins: Array.isArray(cat.loadedPlugins) ? cat.loadedPlugins : [],
      disabledTools: Array.isArray(cat.disabledTools) ? cat.disabledTools : [],
    }
    const nextCombos = Array.isArray(combosData) ? combosData as ComboEntry[] : []
    if (mountedRef.current) {
      setCatalog(nextCatalog)
      // 全局工具开关快照（关闭 = 父代理上下文不可见，列表置灰且无法勾选）
      setDisabledTools(new Set(nextCatalog.disabledTools))
      setCombos(nextCombos)
    }
    return { catalog: nextCatalog, combos: nextCombos }
  }, [remote, sessionId])

  const saveCombo = useCallback(async (combo: { id: string; name: string; tools: string[]; mcpServers: string[] }): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_TOOL_COMBO_PUT, { combo })
      await load()
    })
  }, [load, remote, run])

  const deleteCombo = useCallback(async (id: string): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_TOOL_COMBO_DELETE, { id })
      await load()
    })
  }, [load, remote, run])

  const setToolDisabled = useCallback(async (name: string, disabled: boolean): Promise<string[]> => {
    const result = await run(async () => {
      const response = await remote.call(EP.EP_TOOL_SWITCH_PUT, { name, disabled }) as { disabled?: unknown }
      return Array.isArray(response?.disabled) ? (response.disabled as unknown[]).map((item) => String(item)) : []
    })
    const list = result ?? []
    if (mountedRef.current) setDisabledTools(new Set(list))
    return list
  }, [remote, run])

  const setToolsDisabled = useCallback(async (names: string[], disabled: boolean): Promise<string[]> => {
    const result = await run(async () => {
      const response = await remote.call(EP.EP_TOOL_SWITCH_PUT_MANY, { names, disabled }) as { disabled?: unknown }
      return Array.isArray(response?.disabled) ? (response.disabled as unknown[]).map((item) => String(item)) : []
    })
    const list = result ?? []
    if (mountedRef.current) setDisabledTools(new Set(list))
    return list
  }, [remote, run])

  const saveMcp = useCallback(async (server: Record<string, unknown>): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_MCP_PUT, { server })
      await load()
    })
  }, [load, remote, run])

  const deleteMcp = useCallback(async (id: string): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_MCP_DELETE, { id })
      await load()
    })
  }, [load, remote, run])

  const setMcpDisabled = useCallback(async (id: string, disabled: boolean): Promise<void> => {
    await run(async () => {
      await remote.call(EP.EP_MCP_TOGGLE, { id, disabled })
      await load()
    })
  }, [load, remote, run])

  return { catalog, combos, disabledTools, busy, load, saveCombo, deleteCombo, setToolDisabled, setToolsDisabled, saveMcp, deleteMcp, setMcpDisabled }
}

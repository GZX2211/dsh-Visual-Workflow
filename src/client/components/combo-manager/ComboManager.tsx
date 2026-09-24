// src/client/components/combo-manager/ComboManager.tsx
//
// 组合管理弹层（容器/装配层）：
//   左侧目录（ComboCatalog）：工具 / MCP 服务器 tab、筛选标签、勾选与卡片操作；
//   右侧面板（ComboSidePanel）：组合列表（新建/选中/删除）+ 已选 chip + 命名保存；
//   MCP 编辑区（McpFormPanel）：增删改表单与「从 mcp.json 导入」弹层。
// 数据获取与远端状态归 hooks/useToolCombos（含 busy 与卸载校验），纯解析归 lib/mcp-form；
// 本组件只持有「界面如何呈现、用户正在编辑什么」的本地状态，并按语义把结果翻译为 toast。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import { RESERVED_TRANSPORT_TOOL } from '../../../host/shared/protocol.js'
import type { RemoteFace } from '../../hooks/useRemote.js'
import { useToolCombos, type ComboEntry } from '../../hooks/useToolCombos.js'
import { mcpFormFromJson, mcpFormFromServer, mcpServerPayload, parseJsonObject, type McpFormState } from '../../lib/mcp-form.js'
import { TAG_ALL } from '../../lib/tool-tags.js'
import { ComboCatalog } from './ComboCatalog.js'
import { ComboSidePanel } from './ComboSidePanel.js'
import { McpFormPanel } from './McpFormPanel.js'

export interface ComboManagerProps {
  copy: Dict
  remote: RemoteFace
  sessionId: string
  onClose(): void
  onToast(kind: 'info' | 'success' | 'error', text: string): void
  onChanged(): void
}

/** 空组合草稿。 */
const EMPTY_DRAFT = { name: '', tools: [] as string[], mcpServers: [] as string[] }

/** 组合 id 生成（combo- 前缀；与定时任务 task- 口径一致）。 */
function newComboId(): string {
  return `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 组合条目 → 编辑草稿（剔除官方保留传输名：子代理自带，且官方 restrict 禁止其进入名单）。 */
function draftOf(combo: ComboEntry | undefined): { name: string; tools: string[]; mcpServers: string[] } {
  return {
    name: combo?.name ?? '',
    tools: (combo?.tools ?? []).filter((name) => name !== RESERVED_TRANSPORT_TOOL),
    mcpServers: [...(combo?.mcpServers ?? [])],
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }: ComboManagerProps) {
  const combosFace = useToolCombos(remote, sessionId)
  const [tab, setTab] = useState<'plugins' | 'mcp'>('plugins')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string>(TAG_ALL)
  const [activeComboId, setActiveComboId] = useState<string | null>(null)
  const [comboDraft, setComboDraft] = useState(EMPTY_DRAFT)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mcpForm, setMcpForm] = useState<McpFormState | null>(null)
  const [mcpImportOpen, setMcpImportOpen] = useState(false)
  const [mcpImportText, setMcpImportText] = useState('')
  const loadedRef = useRef(false)
  // 最近一次选中的组合 id（供加载后判定沿用/回退，避免在 setState updater 内产生副作用）
  const activeComboIdRef = useRef<string | null>(null)
  activeComboIdRef.current = activeComboId

  /** 加载完成后确定选中项：仍存在则沿用，否则回退首个组合。 */
  const selectAfterLoad = useCallback((list: ComboEntry[]) => {
    const current = activeComboIdRef.current
    if (current && list.some((item) => item.id === current)) return
    const first = list[0]
    if (!first) return
    setActiveComboId(first.id)
    setComboDraft(draftOf(first))
  }, [])

  const { load } = combosFace
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const { combos } = await load()
        selectAfterLoad(combos)
      } catch (error) {
        onToast('error', messageOf(error))
      }
    })()
  }, [load, onToast, selectAfterLoad])

  /** 动作执行统一收口：成功 toast（按需通知宿主刷新组合列表），失败 toast 错误语义。 */
  const runAction = useCallback(async (
    action: () => Promise<void>,
    successText: string,
    options?: { changed?: boolean },
  ): Promise<boolean> => {
    try {
      await action()
      if (options?.changed) onChanged?.()
      onToast('success', successText)
      return true
    } catch (error) {
      onToast('error', messageOf(error))
      return false
    }
  }, [onChanged, onToast])

  const selectCombo = useCallback((id: string): void => {
    setActiveComboId(id)
    setConfirmDelete(false)
    const combo = combosFace.combos.find((item) => item.id === id)
    setComboDraft(draftOf(combo))
  }, [combosFace.combos])

  const newCombo = useCallback((): void => {
    setActiveComboId(newComboId())
    setConfirmDelete(false)
    setComboDraft(EMPTY_DRAFT)
  }, [])

  const saveCombo = useCallback(async (): Promise<void> => {
    if (!comboDraft.name.trim()) {
      onToast('error', copy.comboSaveFirst)
      return
    }
    await runAction(
      () => combosFace.saveCombo({
        id: activeComboId ?? newComboId(),
        name: comboDraft.name.trim(),
        tools: [...comboDraft.tools],
        mcpServers: [...comboDraft.mcpServers],
      }),
      copy.comboSaved,
      { changed: true },
    )
  }, [activeComboId, comboDraft, combosFace, copy.comboSaveFirst, copy.comboSaved, onToast, runAction])

  const deleteCombo = useCallback(async (): Promise<void> => {
    if (!activeComboId) return
    // 需求 §4.6 规则 5：删除组合二次确认（组合可能被节点引用，删除后节点回落为未选模式）
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    const ok = await runAction(() => combosFace.deleteCombo(activeComboId), copy.comboDeleted, { changed: true })
    if (ok) {
      setActiveComboId(null)
      setComboDraft(EMPTY_DRAFT)
    }
  }, [activeComboId, combosFace, confirmDelete, copy.comboDeleted, runAction])

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
    await runAction(async () => {
      await combosFace.setToolDisabled(name, disabled)
      if (disabled) setComboDraft((draft) => ({ ...draft, tools: draft.tools.filter((item) => item !== name) }))
    }, disabled ? copy.toolSwitchDisabled : copy.toolSwitchEnabled)
  }, [combosFace, copy.toolSwitchDisabled, copy.toolSwitchEnabled, runAction])

  /**
   * 一键开关当前标签下全部工具（组合管理「标签」胶囊栏右侧按钮）：
   *   - 仅作用于当前激活标签（官方工具 / MCP 服务器标签）命中的工具集合；
   *   - 关闭成功后将标签下工具从组合草稿移除（父代理不可用 → 子代理无法传入）。
   */
  const bulkToolDisabled = useCallback(async (disabled: boolean, toolNames: string[]): Promise<void> => {
    if (toolNames.length === 0) return
    await runAction(async () => {
      await combosFace.setToolsDisabled(toolNames, disabled)
      if (disabled) setComboDraft((draft) => ({ ...draft, tools: draft.tools.filter((item) => !toolNames.includes(item)) }))
    }, disabled ? copy.toolSwitchBatchDisabled : copy.toolSwitchBatchEnabled)
  }, [combosFace, copy.toolSwitchBatchDisabled, copy.toolSwitchBatchEnabled, runAction])

  const saveMcp = useCallback(async (): Promise<void> => {
    if (!mcpForm) return
    // env / headers 为可选 JSON；空串合法，非法则按词典文案提示且不发起请求
    const env = parseJsonObject(mcpForm.env)
    const headers = parseJsonObject(mcpForm.headers)
    if (!env.ok || !headers.ok) {
      onToast('error', copy.mcpEnvInvalid)
      return
    }
    const ok = await runAction(
      () => combosFace.saveMcp(mcpServerPayload(mcpForm, { env: env.value, headers: headers.value })),
      copy.mcpSaved,
    )
    if (ok) setMcpForm(null)
  }, [combosFace, copy.mcpEnvInvalid, copy.mcpSaved, mcpForm, onToast, runAction])

  /** 从 mcp.json 粘贴导入：支持 {mcpServers:{name:{...}}} 或单个 server 对象。 */
  const importMcpJson = useCallback((): void => {
    const result = mcpFormFromJson(mcpImportText)
    if (!result.ok) {
      const message = result.reason === 'emptyInput'
        ? copy.mcpImportEmptyInput
        : result.reason === 'serversEmpty'
          ? copy.mcpImportServersEmpty
          : String(result.detail ?? copy.mcpImportEmptyInput)
      onToast('error', message)
      return
    }
    setMcpForm(result.form)
    setMcpImportOpen(false)
    onToast('success', copy.mcpImported)
  }, [copy.mcpImportEmptyInput, copy.mcpImported, copy.mcpImportServersEmpty, mcpImportText, onToast])

  return (
    <div className="wf-combo-backdrop">
      <div className="wf-combo" role="dialog" aria-modal="true">
        <div className="wf-combo__head">
          <h3>{copy.comboManager}</h3>
          <span className="wf-status">{copy.comboHint}</span>
          <button type="button" className="wf-btn wf-combo__close" onClick={onClose}>✕</button>
        </div>
        <div className="wf-combo__body">
          <ComboCatalog
            copy={copy}
            catalog={combosFace.catalog}
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            activeTag={activeTag}
            onTagChange={setActiveTag}
            disabledTools={combosFace.disabledTools}
            comboDraft={comboDraft}
            busy={combosFace.busy}
            onToggleTool={toggleTool}
            onToggleMcp={toggleMcp}
            onToggleToolDisabled={(name, disabled) => { void toggleToolDisabled(name, disabled) }}
            onToggleMcpDisabled={(id, disabled) => { void runAction(() => combosFace.setMcpDisabled(id, disabled), disabled ? copy.mcpDisabled : copy.mcpEnabled) }}
            onEditMcp={(server) => setMcpForm(mcpFormFromServer(server))}
            onDeleteMcp={(id) => { void runAction(() => combosFace.deleteMcp(id), copy.mcpDeleted) }}
            onBulkToolDisabled={(disabled, names) => { void bulkToolDisabled(disabled, names) }}
          />
          <ComboSidePanel
            copy={copy}
            combos={combosFace.combos}
            activeComboId={activeComboId}
            comboDraft={comboDraft}
            busy={combosFace.busy}
            confirmDelete={confirmDelete}
            onSelect={selectCombo}
            onNew={newCombo}
            onDraftNameChange={(name) => setComboDraft((draft) => ({ ...draft, name }))}
            onRemoveTool={toggleTool}
            onRemoveMcp={toggleMcp}
            onSave={() => { void saveCombo() }}
            onDelete={() => { void deleteCombo() }}
          />
        </div>
        <McpFormPanel
          copy={copy}
          tab={tab}
          form={mcpForm}
          busy={combosFace.busy}
          importOpen={mcpImportOpen}
          importText={mcpImportText}
          onFormChange={setMcpForm}
          onSave={() => { void saveMcp() }}
          onImportOpenChange={setMcpImportOpen}
          onImportTextChange={setMcpImportText}
          onImportApply={importMcpJson}
        />
      </div>
    </div>
  )
}

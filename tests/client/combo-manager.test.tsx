// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/combo-manager.test.tsx
//
// 组合管理（T-048）：目录加载（工具 tab / MCP tab）；组合列表选中；
// 勾选工具与 MCP → 保存 → toolComboPut 参数正确；新建组合；
// 删除需二次确认（确认后调用 toolComboDelete）；MCP 增删走 mcpPut/mcpDelete。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ComboManager } from '../../src/client/components/combo-manager/ComboManager.js'
import { zh } from '../../src/client/i18n.js'
import { EP } from '../../src/client/lib/remote.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
})

interface RemoteState {
  combos: Array<{ id: string; name: string; tools: string[]; mcpServers: string[] }>
  catalog: { items: Array<{ key: string; name: string; description: string }>; mcp: Array<Record<string, unknown>>; loadedPlugins: string[] }
  calls: Array<{ endpoint: string; args: Record<string, unknown> }>
}

function makeRemote(initial: Partial<RemoteState> = {}): { remote: RemoteFace; state: RemoteState } {
  const state: RemoteState = {
    combos: initial.combos ?? [{ id: 'combo-1', name: '团队组合', tools: ['wf_ask'], mcpServers: [] }],
    catalog: initial.catalog ?? {
      items: [
        { key: 'tool:read_file', name: 'read_file', description: '读取文件' },
        { key: 'tool:builtin:web_search', name: 'web_search', description: '搜索' },
      ],
      mcp: [
        { id: 'mcp-1', serverName: 'files', transport: 'stdio', command: 'npx files', args: [], url: '' },
      ],
      loadedPlugins: ['@deepseek-ai/dsh-fs'],
    },
    calls: [],
  }
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      state.calls.push({ endpoint, args: args ?? {} })
      if (endpoint === EP.EP_PLUGIN_CATALOG) return state.catalog
      if (endpoint === EP.EP_TOOL_COMBOS) return state.combos
      return {}
    }),
  }
  return { remote, state }
}

async function openComboManager(remote: RemoteFace, onToast = vi.fn(), onChanged = vi.fn()): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(
      React.createElement(ComboManager, {
        copy: zh,
        remote,
        sessionId: 's-1',
        onClose: vi.fn(),
        onToast,
        onChanged,
      }),
    )
  })
}

async function clickButton(text: string, exact = false): Promise<void> {
  await act(async () => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    const target = buttons.find((item) => (exact ? item.textContent === text : item.textContent?.includes(text) ?? false))
    target?.click()
  })
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('组合管理', () => {
  it('加载：目录工具 tab 与组合列表渲染；MCP 服务器显示于 MCP tab', async () => {
    const { remote } = makeRemote()
    await openComboManager(remote)
    expect(container!.textContent).toContain('read_file')
    expect(container!.textContent).toContain('web_search')
    expect(container!.textContent).toContain('团队组合')
    expect(container!.textContent).toContain('wf_ask')
    await clickButton(zh.comboTabMcp)
    expect(Array.from(document.querySelectorAll('.wf-combo-card')).some((item) => item.textContent?.includes('files'))).toBe(true)
  })

  it('目录描述：str_replace_editor 标注「简单模式专用，非该模式禁止勾选」且保留展示', async () => {
    const { remote } = makeRemote({
      catalog: {
        items: [
          { key: 'tool:str_replace_editor', name: 'str_replace_editor', description: '代码/文本编辑器（简单模式专用，非该模式禁止勾选）' },
          { key: 'tool:read', name: 'read', description: '读取文件' },
        ],
        mcp: [],
        loadedPlugins: [],
      },
    })
    await openComboManager(remote)
    expect(container!.textContent).toContain('str_replace_editor')
    expect(container!.textContent).toContain('简单模式专用，非该模式禁止勾选')
  })

  it('勾选工具与 MCP → 保存：toolComboPut 参数正确（tools + mcpServers）', async () => {
    const { remote, state } = makeRemote()
    await openComboManager(remote)
    // 勾选 web_search（追加到已勾选的 wf_ask）
    await act(async () => {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-combo-card__main')).find((item) => item.textContent?.includes('web_search'))
      card?.click()
    })
    // 切到 MCP tab 勾选 files
    await clickButton(zh.comboTabMcp)
    await act(async () => {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-combo-card__main')).find((item) => item.textContent?.includes('files'))
      card?.click()
    })
    await clickButton(zh.inspectorSave)
    const put = state.calls.find((call) => call.endpoint === EP.EP_TOOL_COMBO_PUT)
    expect(put).toBeTruthy()
    expect(put!.args.combo).toMatchObject({
      id: 'combo-1',
      name: '团队组合',
      tools: expect.arrayContaining(['wf_ask', 'web_search']),
      mcpServers: ['files'],
    })
  })

  it('新建组合：名称必填；保存后向 toolComboPut 提交 combo- 前缀新 id', async () => {
    const { remote, state } = makeRemote()
    await openComboManager(remote)
    await clickButton(`＋ ${zh.comboNew}`)
    await clickButton(zh.inspectorSave)
    // 名称为空：不提交
    expect(state.calls.find((call) => call.endpoint === EP.EP_TOOL_COMBO_PUT)).toBeUndefined()
    const nameInput = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((item) => item.placeholder === zh.comboName)
    await act(async () => {
      if (nameInput) setInput(nameInput, '新组合')
    })
    await clickButton(zh.inspectorSave)
    const put = state.calls.find((call) => call.endpoint === EP.EP_TOOL_COMBO_PUT)
    expect(put).toBeTruthy()
    const combo = put?.args.combo as { name?: string; id?: string } | undefined
    expect(combo?.name).toBe('新组合')
    expect(String(combo?.id ?? '')).toMatch(/^combo-/)
  })

  it('删除组合：需要二次确认；确认后调用 toolComboDelete', async () => {
    const { remote, state } = makeRemote()
    await openComboManager(remote)
    await clickButton(zh.comboDelete)
    expect(state.calls.find((call) => call.endpoint === EP.EP_TOOL_COMBO_DELETE)).toBeUndefined()
    expect(container!.textContent).toContain(zh.comboDeleteConfirm)
    await clickButton(zh.comboDeleteConfirm)
    const del = state.calls.find((call) => call.endpoint === EP.EP_TOOL_COMBO_DELETE)
    expect(del?.args).toEqual({ id: 'combo-1' })
  })

  it('MCP 增删：mcpPut 提交服务表单；mcpDelete 提交 id', async () => {
    const { remote, state } = makeRemote()
    await openComboManager(remote)
    await clickButton(zh.comboTabMcp)
    await clickButton(`＋ ${zh.mcpNew}`, true)
    await clickButton(zh.mcpSave)
    const put = state.calls.find((call) => call.endpoint === EP.EP_MCP_PUT)
    expect(put).toBeTruthy()
    expect(put?.args.server).toMatchObject({ serverName: '' })
    // MCP 卡片网格内的删除按钮（避免误匹配侧栏"删除组合"）
    await act(async () => {
      (container!.querySelector('.wf-combo-card .wf-btn.is-danger') as HTMLButtonElement | null)?.click()
    })
    const del = state.calls.find((call) => call.endpoint === EP.EP_MCP_DELETE)
    expect(del?.args).toEqual({ id: 'mcp-1' })
  })
})

// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/combo-manager/McpFormPanel.test.tsx
//
// MCP 编辑区与导入弹层（components/combo-manager/McpFormPanel.tsx）：
//   用户可见的示例占位文案必须来自词典（随语言切换），不得内联在组件里；
//   其中的命令/JSON 示例必须是可解析的示例值（导入弹层示例须能被 mcp.json 解析）。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { McpFormPanel, type McpFormPanelProps } from '../../../../src/client/components/combo-manager/McpFormPanel.js'
import { en } from '../../../../src/client/i18n.js'
import type { McpFormState } from '../../../../src/client/lib/mcp-form.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function formOf(transport: string): McpFormState {
  return { serverName: 'demo', transport, commandLine: '', env: '', headers: '', url: '' }
}

function propsOf(form: McpFormState | null, importOpen = false): McpFormPanelProps {
  return {
    copy: en,
    tab: 'mcp',
    form,
    busy: false,
    importOpen,
    importText: '',
    onFormChange: vi.fn(),
    onSave: vi.fn(),
    onImportOpenChange: vi.fn(),
    onImportTextChange: vi.fn(),
    onImportApply: vi.fn(),
  }
}

async function renderPanel(props: McpFormPanelProps): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(McpFormPanel, props))
  })
}

function placeholderOf(selector: string): string | null | undefined {
  return container!.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.placeholder
}

describe('MCP 表单示例文案', () => {
  it('stdio 表单的示例占位来自词典', async () => {
    await renderPanel(propsOf(formOf('stdio')))
    const inputs = Array.from(container!.querySelectorAll<HTMLInputElement>('input'))
    const placeholders = inputs.map((item) => item.placeholder)
    expect(placeholders).toContain(en.mcpCommandPlaceholder)
    expect(placeholders).toContain(en.mcpEnvPlaceholder)
  })

  it('streamable-http 表单的示例占位来自词典', async () => {
    await renderPanel(propsOf(formOf('streamable-http')))
    const placeholders = Array.from(container!.querySelectorAll<HTMLInputElement>('input')).map((item) => item.placeholder)
    expect(placeholders).toContain(en.mcpUrlPlaceholder)
    expect(placeholders).toContain(en.mcpHeadersPlaceholder)
  })

  it('导入弹层的示例占位来自词典，且是合法 mcp.json 片段', async () => {
    await renderPanel(propsOf(null, true))
    expect(placeholderOf('.wf-mcp-import__text')).toBe(en.mcpImportPlaceholder)
    const parsed = JSON.parse(en.mcpImportPlaceholder) as { mcpServers?: Record<string, unknown> }
    expect(Object.keys(parsed.mcpServers ?? {})).toHaveLength(1)
  })
})

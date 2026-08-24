// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/forms.test.tsx
//
// 角色表单（T-048 验收 2）：子代理「模式」下拉 = preset + 自定义组合（组合分组）；
// 父代理仅 preset（allowCombos=false 无组合分组）；选中组合显示工具数摘要。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { RoleForm } from '../../src/client/components/panels/inspector/forms.js'
import { zh } from '../../src/client/i18n.js'

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

const presets = [
  { id: 'standard', name: '标准' },
  { id: 'minimal', name: '极简' },
]
const combos = [
  { id: 'combo-a', name: '团队模式', tools: ['wf_ask', 'wf_ask_agent'], mcpServers: ['files'] },
  { id: 'combo-b', name: '纯工具', tools: ['read_file'], mcpServers: [] },
]
const models = [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: 'High' }] }]

async function renderRoleForm(props: Partial<Parameters<typeof RoleForm>[0]> = {}): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(RoleForm, {
      data: { presetId: 'standard' },
      copy: zh,
      presets,
      models,
      combos,
      onPatch: () => {},
      onLoadMd: () => {},
      ...props,
    } as Parameters<typeof RoleForm>[0]))
  })
}

describe('角色表单模式下拉', () => {
  it('子代理：preset + 自定义组合（optgroup 分组）都在下拉中', async () => {
    await renderRoleForm()
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((item) => item.value === 'standard')
    expect(select).toBeTruthy()
    const options = Array.from(select!.querySelectorAll('option')).map((item) => item.textContent)
    expect(options).toEqual(expect.arrayContaining(['标准', '极简', '团队模式', '纯工具']))
    const groups = Array.from(select!.querySelectorAll('optgroup')).map((item) => item.label)
    expect(groups).toEqual([zh.combos])
  })

  it('父代理：仅 preset，无自定义组合分组', async () => {
    await renderRoleForm({ isParent: true, allowCombos: false })
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((item) => item.value === 'standard')
    expect(select?.querySelectorAll('optgroup').length).toBe(0)
    const options = Array.from(select!.querySelectorAll('option')).map((item) => item.textContent)
    expect(options).toEqual(['标准', '极简'])
  })

  it('选中组合：显示工具 + MCP 数量摘要', async () => {
    await renderRoleForm({ data: { presetId: 'combo-a' } })
    expect(container!.textContent).toContain('3')
  })
})

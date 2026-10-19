// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/role-form.test.tsx
//
// 角色表单（T-048 验收 2 / B10）：子代理「模式」下拉 = preset + 自定义组合（组合分组）；
// 父代理仅官方 preset（showCombos 默认随 isParent=false）；选中组合显示工具数摘要。
// B10 语义：presetId 下拉对父/子代理都可编辑（运行前选择才生效），
// 「谁可见 combo」与「谁可编辑 presetId」是两件独立的事（前者由 showCombos 控制）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { RoleForm } from '../../../../../src/client/components/panels/inspector/role-form.js'
import { en, zh } from '../../../../../src/client/i18n.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../../../src/host/shared/protocol.js'

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
  it("test_schema_placeholders_follow_the_supplied_dictionary", async () => {
    await renderRoleForm({ copy: en })
    const placeholders = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).map((field) => field.placeholder)
    expect(placeholders.slice(-2)).toEqual([en.inputSchemaExample, en.outputSchemaExample])
  })

  it('子代理：preset + 自定义组合（optgroup 分组）都在下拉中，且下拉可编辑', async () => {
    await renderRoleForm()
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((item) => item.value === 'standard')
    expect(select).toBeTruthy()
    expect(select!.disabled).toBe(false)
    const options = Array.from(select!.querySelectorAll('option')).map((item) => item.textContent)
    expect(options).toEqual(expect.arrayContaining(['标准', '极简', '团队模式', '纯工具']))
    const groups = Array.from(select!.querySelectorAll('optgroup')).map((item) => item.label)
    expect(groups).toEqual([zh.combos])
  })

  it('父代理：仅官方 preset（无自定义组合分组），但 presetId 下拉可编辑', async () => {
    await renderRoleForm({ isParent: true })
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((item) => item.value === 'standard')
    expect(select?.querySelectorAll('optgroup').length).toBe(0)
    const options = Array.from(select!.querySelectorAll('option')).map((item) => item.textContent)
    expect(options).toEqual(['标准', '极简'])
    // 用户裁决：运行中改 preset 不影响行为、运行前选择才生效 → 不再锁死下拉
    expect(select!.disabled).toBe(false)
  })

  it('组合可见性由 showCombos 决定，与 presetId 是否可编辑无关（子代理也可隐藏组合）', async () => {
    await renderRoleForm({ showCombos: false })
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((item) => item.value === 'standard')
    expect(select!.querySelectorAll('optgroup').length).toBe(0)
    expect(select!.disabled).toBe(false)
  })

  it('选中组合：显示工具 + MCP 数量摘要', async () => {
    await renderRoleForm({ data: { presetId: 'combo-a' } })
    expect(container!.textContent).toContain('3')
  })

  it('不再显示 .md 来源文件名预览（右侧属性栏只保留加载按钮）', async () => {
    await renderRoleForm({ data: { presetId: 'standard', systemPrompt: '正文', systemPromptSource: 'persona.md' } })
    expect(container!.textContent).not.toContain('persona.md')
    const button = Array.from(container!.querySelectorAll('button')).find((item) => item.textContent === zh.loadMd)
    expect(button).toBeTruthy()
  })

  it('输出契约：提供「恢复默认」操作，点击写回默认契约文本（清空后的一键恢复）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await renderRoleForm({ data: { presetId: 'standard', outputSchema: '' }, onPatch: (patch) => patches.push(patch) })
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === zh.contractRestoreDefault)
    expect(button).toBeTruthy()
    await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(patches).toEqual([{ outputSchema: DEFAULT_OUTPUT_CONTRACT_TEXT }])
  })
})

// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/panels.test.tsx
//
// Inspector 模块（components/panels/inspector/）组件单测（P4 体验与沉淀）：
//   ① ProxyForm（闸门可视化）：默认角色为「普通执行入口」→ 勾选写 role=milestone；
//      已是闸门时勾选态为真，取消勾选写 role=null 退回 executor；显示名输入写 label；
//   ② Inspector（D-20 父模板可编辑）：模板来源的父代理渲染属性表单（含 preset 下拉），
//      不再显示「父代理模板无独立属性」空态；画布父代理节点同样可编辑。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后按
// 源文件归属拆分——inspector/ 下组件（field-forms.tsx、Inspector.tsx）用例归入本文件。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ProxyForm } from '../../../../../src/client/components/panels/inspector/field-forms.js'
import { Inspector } from '../../../../../src/client/components/panels/inspector/Inspector.js'
import { zh } from '../../../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
})

const copy = { ...zh, modeName: () => '标准' }
const presets = [{ id: 'standard', name: '标准' }, { id: 'minimal', name: '极简' }]
const models = [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: 'High' }] }]
const combos = [{ id: 'combo-a', name: '团队模式', tools: ['wf_ask'], mcpServers: [] }]

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

describe('P4 虚拟节点表单（ProxyForm，闸门可视化）', () => {
  it('默认角色为「普通执行入口」；勾选后补丁 role=milestone', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleExecutor)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: 'milestone' }])
  })

  it('已是闸门时勾选态为真；取消勾选写 role=null（退回 executor）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleMilestone)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: null }])
  })

  it('显示名输入写入 label（画布显示名）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    const input = container!.querySelector('input[type="text"]') as HTMLInputElement
    await act(async () => {
      // React 受控输入必须走原型上的 value setter 再派发 input 事件，直接赋 value 不触发 onChange
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '里程碑①：方案评审')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(patches.at(-1)).toEqual({ label: '里程碑①：方案评审' })
  })
})

describe('P4 父代理模板可编辑（Inspector，D-20）', () => {
  const common = {
    copy: zh,
    open: true,
    width: 320,
    presets,
    tools: [],
    models,
    combos,
    flowMeta: { nodeCount: 0, revision: 0 },
    onPatch: () => {},
    onDelete: () => {},
    onSave: () => {},
    onCopyProxy: () => {},
    onRemoveMember: () => {},
    onFileSelect: () => {},
    onLoadMd: () => {},
    onLoadGroupMd: () => {},
    onTestDb: () => {},
    saveDisabled: false,
    importBusy: false,
  }

  it('模板来源的父代理：渲染属性表单（含 preset 下拉），不再显示「无独立属性」空态', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, template: true } as never,
    } as never))
    const text = container!.textContent ?? ''
    expect(text).not.toContain('父代理模板无独立属性')
    expect(text).toContain(zh.nodeKinds.parent)
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })

  it('画布父代理节点同样可编辑（isParent 且非模板）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, nodeId: 'n-p1' } as never,
    } as never))
    expect(container!.textContent).not.toContain('父代理模板无独立属性')
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })
})

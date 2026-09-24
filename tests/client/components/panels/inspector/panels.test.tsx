// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/panels.test.tsx
//
// Inspector 装配层单测（D-20）：模板来源的父代理渲染属性表单（含 preset 下拉），
// 不再显示「父代理模板无独立属性」空态；画布父代理节点同样可编辑。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
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

const presets = [{ id: 'standard', name: '标准' }, { id: 'minimal', name: '极简' }]
const models = [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: 'High' }] }]
const combos = [{ id: 'combo-a', name: '团队模式', tools: ['wf_ask'], mcpServers: [] }]

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

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

  it('阶段节点：不渲染保存按钮（只读属性）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'stage', data: { label: '启动' }, name: '启动', nodeId: 's-1' } as never,
    } as never))
    const labels = Array.from(container!.querySelectorAll('button')).map((item) => item.textContent)
    expect(labels).not.toContain(zh.inspectorSave)
    expect(labels).toContain(zh.inspectorDelete)
  })
})

// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/FlowNode.test.tsx
//
// FlowNode 角标渲染（P4 体验与沉淀 · 闸门可视化与补丁来源标注）：
//   ① 闸门虚拟节点（data.role='milestone'）→ 里程碑角标 + is-gate 样式 + 显示名；
//   ② 普通虚拟节点仍是「↻ 引用」，不带 is-gate；
//   ③ 显示名为空时回退节点种类名（不渲染空白卡片）；
//   ④ agentPatched=true → 「AI 调整」角标；缺省不显示。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——FlowNode 用例归入本文件，其余用例分别归入
// components/panels/inspector/panels.test.tsx、components/sidebar/library-model.test.ts、
// studio/studio-selectors.test.ts、hooks/useEditorActions.test.tsx。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { FlowNode } from '../../../../src/client/components/canvas/FlowNode.js'
import { zh } from '../../../../src/client/i18n.js'

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

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

function proxyNode(data: Record<string, unknown>): unknown {
  return { id: 'n-m1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-p1', data }
}

function renderFlowNode(node: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  return render(React.createElement(FlowNode, {
    node, copy, mode: 'mode1', selected: false, highlighted: false, dragging: false,
    runStatus: null, onPointerDown: () => {}, onHandlePointerDown: () => {}, onToggleSwap: () => {},
    ...extra,
  } as never))
}

describe('P4 画布角标（FlowNode）', () => {
  it('闸门虚拟节点：里程碑角标 + is-gate 样式 + 显示名', async () => {
    await renderFlowNode(proxyNode({ role: 'milestone', label: '里程碑①' }))
    const html = container!.innerHTML
    expect(html).toContain('is-gate')
    expect(container!.textContent).toContain(zh.proxyGateBadge)
    expect(container!.textContent).toContain('里程碑①')
  })

  it('普通虚拟节点：仍是「↻ 引用」，不带 is-gate', async () => {
    await renderFlowNode(proxyNode({}))
    expect(container!.innerHTML).not.toContain('is-gate')
    expect(container!.textContent).toContain('↻ 引用')
  })

  it('显示名为空时回退节点种类名（不渲染空白卡片）', async () => {
    await renderFlowNode(proxyNode({ role: 'milestone', label: '   ' }))
    expect(container!.textContent).toContain(String(zh.nodeKinds.agent))
  })

  it('agentPatched=true 时显示「AI 调整」角标', async () => {
    await renderFlowNode(proxyNode({}), { agentPatched: true })
    expect(container!.textContent).toContain(zh.agentPatchedBadge)
  })

  it('agentPatched 缺省时不显示该角标', async () => {
    await renderFlowNode(proxyNode({}))
    expect(container!.textContent).not.toContain(zh.agentPatchedBadge)
  })
})

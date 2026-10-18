// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/FlowNode.test.tsx
//
// FlowNode 角标渲染（P4 体验与沉淀）：
//   ① 虚拟节点沿用「↻ 引用」角标（闸门退役后无里程碑角标 / 无 is-gate）；
//   ② 显示名为空时回退节点种类名（不渲染空白卡片）；
//   ③ agentPatched=true → 「AI 调整」角标；缺省不显示。
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
import { en, zh } from '../../../../src/client/i18n.js'

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
  it('闸门退役：遗留 data.role=milestone 按普通虚拟节点渲染（无 is-gate / 无里程碑角标）', async () => {
    await renderFlowNode(proxyNode({ role: 'milestone', label: '遗留节点' }))
    const html = container!.innerHTML
    expect(html).not.toContain('is-gate')
    expect(container!.textContent).not.toContain('🚩')
    expect(container!.textContent).toContain('遗留节点')
    expect(container!.textContent).toContain('↻ 引用')
  })

  it('显示名为空时回退节点种类名（不渲染空白卡片）', async () => {
    await renderFlowNode(proxyNode({ label: '   ' }))
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

  it('任务节点：卡片显示种类名与任务描述（不显示文件类型）', async () => {
    await renderFlowNode({ id: 't-1', kind: 'task', position: { x: 0, y: 0 }, data: { label: '任务一', content: '任务描述正文' } })
    expect(container!.querySelector('.wf-node__kind')!.textContent).toContain(String(zh.nodeKinds.task))
    expect(container!.querySelector('.wf-node__label')!.textContent).toBe('任务一')
    expect(container!.querySelector('.wf-node__prompt')!.textContent).toBe('任务描述正文')
  })
})

describe('角色卡连接点（任务 3：右上下文出退役）', () => {
  it.each(['agent', 'parent', 'proxy'] as const)('%s 卡片不渲染 ctx-out，但保留 flow-out', async (kind) => {
    await renderFlowNode({
      id: `n-${kind}`,
      kind,
      position: { x: 0, y: 0 },
      data: { label: kind },
      ...(kind === 'proxy' ? { proxySourceId: 'n-agent' } : {}),
    })

    expect(container!.querySelector('[data-handle="ctx-out"]')).toBeNull()
    expect(container!.querySelector('[data-handle="flow-out"]')).not.toBeNull()
    expect(container!.querySelector('[data-handle="ctx-in"]')).not.toBeNull()
  })

  it('任务节点仍保留 ctx-out（上下文来源不受角色卡退役影响）', async () => {
    await renderFlowNode({ id: 't-1', kind: 'task', position: { x: 0, y: 0 }, data: { label: '任务一' } })
    expect(container!.querySelector('[data-handle="ctx-out"]')).not.toBeNull()
  })
})

describe('stage names follow the active language', () => {
  it.each([
    ['mode1', 'start', '启动', 'Start'],
    ['mode1', 'end', '结束', 'End'],
    ['mode1', 'pause', '暂停', 'Pause'],
    ['mode2', 'start', '输入', 'Input'],
    ['mode2', 'end', '输出', 'Output'],
  ] as const)('%s %s displays English for a canonical stored label', async (mode, kind, stored, label) => {
    await renderFlowNode({ id: 'stage', kind, position: { x: 0, y: 0 }, data: { label: stored } }, {
      mode, copy: { ...en, modeName: () => '' },
    })
    expect(container!.querySelector('.wf-node__label')!.textContent).toBe(label)
    expect(container!.querySelector('.wf-node__kind > span')!.textContent).toBe(label)
  })

  it('updates stage names when the language changes without changing stored data', async () => {
    const node = { id: 'stage', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }
    await renderFlowNode(node, { copy: { ...en, modeName: () => '' } })
    expect(container!.querySelector('.wf-node__label')!.textContent).toBe('Start')
    await act(async () => {
      root!.render(React.createElement(FlowNode, {
        node, copy, mode: 'mode1', selected: false, highlighted: false, dragging: false,
        runStatus: null, onPointerDown: () => {}, onHandlePointerDown: () => {}, onToggleSwap: () => {},
      } as never))
    })
    expect(container!.querySelector('.wf-node__label')!.textContent).toBe('启动')
    expect(node.data.label).toBe('启动')
  })
})

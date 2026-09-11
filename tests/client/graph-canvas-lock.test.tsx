// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/graph-canvas-lock.test.tsx
//
// GraphCanvas 运行中锁定渲染与交互（需求 c 视觉/交互裁决）：
//   - 锁定节点显示 🔒 角标 + 悬停提示（节点仍可拖动移动）；
//   - 被锁连线渲染 is-locked（灰化虚线）且点击不选中（属性栏因此不展开）；
//   - 非锁连线点击照常选中。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { GraphCanvas, type GraphCanvasProps } from '../../src/client/components/canvas/GraphCanvas.js'
import { zh } from '../../src/client/i18n.js'
import type { CanvasEdge, CanvasNode } from '../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
})

const nodes: CanvasNode[] = [
  { id: 'n-done', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '已完成' } },
  { id: 'n-free', kind: 'agent', position: { x: 260, y: 0 }, data: { label: '待执行' } },
]
const edges: CanvasEdge[] = [
  { id: 'e-locked', source: 'n-done', target: 'n-free', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
  { id: 'e-free', source: 'n-free', target: 'n-free', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
]

function renderCanvas(overrides: Partial<GraphCanvasProps> = {}): void {
  const props: GraphCanvasProps = {
    nodes,
    edges,
    copy: { ...zh, modeName: () => '' },
    mode: 'mode1',
    selectedNode: null,
    selectedEdge: null,
    runStatusByNode: { 'n-done': { status: 'ok', attempts: 1, outputSummary: '' } },
    highlightedNodeIds: [],
    lockedNodeIds: new Set(['n-done']),
    lockedEdgeIds: new Set(['e-locked']),
    onInit: () => {},
    onNodeDragStart: () => {},
    onNodeMove: () => {},
    onNodeDropToGroup: () => {},
    onNodeSelect: () => {},
    onEdgeSelect: () => {},
    onPaneClick: () => {},
    onConnect: () => {},
    onConnectionRejected: () => {},
    onGroupResize: () => {},
    onSwapPorts: () => {},
    fitLabel: '',
    zoomInLabel: '',
    zoomOutLabel: '',
    emptyHint: '',
    ...overrides,
  }
  act(() => {
    root = createRoot(container!)
    root.render(<GraphCanvas {...props} />)
  })
}

describe('GraphCanvas 运行中锁定渲染与交互', () => {
  it('锁定节点：渲染锁角标与悬停提示（已完成文案）', () => {
    renderCanvas()
    const lockedCard = container!.querySelector('[data-wf-node-id="n-done"] .wf-node')
    expect(lockedCard?.classList.contains('is-locked')).toBe(true)
    expect(lockedCard?.querySelector('.wf-node__lock-badge')?.textContent).toContain('🔒')
    expect(lockedCard?.getAttribute('title')).toBe(zh.lockedCompletedNodeHint)
    // 未锁节点不显示角标
    const freeCard = container!.querySelector('[data-wf-node-id="n-free"] .wf-node')
    expect(freeCard?.querySelector('.wf-node__lock-badge')).toBeNull()
  })

  it('被锁连线：渲染 is-locked 且点击不触发选中（属性栏不展开）', () => {
    const onEdgeSelect = vi.fn()
    renderCanvas({ onEdgeSelect })
    const lockedPath = container!.querySelector('path.wf-graph__edge.is-locked')
    expect(lockedPath).not.toBeNull()
    // 命中层与被锁连线同组；点击该组内的命中路径不应选中
    const lockedHit = lockedPath!.parentElement!.querySelector('path.wf-graph__edge-hit')!
    act(() => {
      lockedHit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(onEdgeSelect).not.toHaveBeenCalled()
  })

  it('非锁连线：点击正常触发选中', () => {
    const onEdgeSelect = vi.fn()
    renderCanvas({ onEdgeSelect })
    const hits = Array.from(container!.querySelectorAll('path.wf-graph__edge-hit'))
    const freeHit = hits.find((item) => item.parentElement?.querySelector('path.wf-graph__edge:not(.is-locked)'))!
    act(() => {
      freeHit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(onEdgeSelect).toHaveBeenCalledWith('e-free')
  })

  it('锁定节点仍可拖动移动（用户裁决：可拖动，不可修改/删除）', () => {
    const onNodeMove = vi.fn()
    renderCanvas({ onNodeMove })
    const card = container!.querySelector<HTMLElement>('[data-wf-node-id="n-done"] .wf-node')!
    act(() => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 40 }))
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 60, clientY: 40 }))
    })
    expect(onNodeMove).toHaveBeenCalled()
  })
})

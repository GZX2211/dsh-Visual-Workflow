// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/graph-canvas.test.tsx
//
// GraphCanvas 画布组件回归测试（Bug 14 修正定位）：
//   - 协作组拉伸（beginGroupResize）的 window 监听改由 useEffect 管理后，
//     组件卸载时监听随清理函数移除——卸载后指针移动不再触发 onGroupResize；
//   - pointercancel / blur 兜底清理（Bug 7 同款）：取消拖拽后监听移除，
//     后续移动不再触发（旧实现直接在 callback 里注册、仅 onUp 移除，两者均泄漏）。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { GraphCanvas, type GraphCanvasProps } from '../../src/client/components/canvas/GraphCanvas.js'
import { zh } from '../../src/client/i18n.js'
import type { CanvasNode } from '../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
})

const groupNode: CanvasNode = {
  id: 'g1',
  kind: 'group',
  position: { x: 0, y: 0 },
  data: { label: '组', memberIds: [], size: { w: 300, h: 220 } },
}

function pointer(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { clientX, clientY, button: 0, bubbles: true })
}

function renderCanvas(onGroupResize: (id: string, size: { w: number; h: number }) => void): void {
  const props: GraphCanvasProps = {
    nodes: [groupNode],
    edges: [],
    copy: { ...zh, modeName: () => '' },
    mode: 'mode1',
    selectedNode: null,
    selectedEdge: null,
    runStatusByNode: {},
    highlightedNodeIds: [],
    onInit: () => {},
    onNodeDragStart: () => {},
    onNodeMove: () => {},
    onNodeDropToGroup: () => {},
    onNodeSelect: () => {},
    onEdgeSelect: () => {},
    onPaneClick: () => {},
    onConnect: () => {},
    onConnectionRejected: () => {},
    onGroupResize,
    onSwapPorts: () => {},
    fitLabel: '',
    zoomInLabel: '',
    zoomOutLabel: '',
    emptyHint: '',
  }
  act(() => {
    root = createRoot(container!)
    root.render(<GraphCanvas {...props} />)
  })
}

describe('GraphCanvas 协作组拉伸监听清理（Bug 14 修正定位）', () => {
  it('拖拽中卸载组件：window 监听随之移除，指针移动不再触发 onGroupResize', () => {
    const onGroupResize = vi.fn()
    renderCanvas(onGroupResize)
    const handle = container!.querySelector<HTMLElement>('.wf-group__resize')
    expect(handle).not.toBeNull()

    // 按下拉伸把手 → 进入拖拽（useEffect 注册 window 监听）
    act(() => {
      handle!.dispatchEvent(pointer('pointerdown', 60, 80))
    })
    // 拖拽中卸载组件（如快速切换工作流）→ useEffect 清理监听
    act(() => {
      root?.unmount()
    })
    root = null
    // 卸载后指针移动不应再触发回调（旧实现监听残留在已卸载组件上持续回调）
    act(() => {
      window.dispatchEvent(pointer('pointermove', 200, 200))
    })
    expect(onGroupResize).not.toHaveBeenCalled()
  })

  it('pointercancel 兜底清理：取消拖拽后监听移除，后续移动不再触发', () => {
    const onGroupResize = vi.fn()
    renderCanvas(onGroupResize)
    const handle = container!.querySelector<HTMLElement>('.wf-group__resize')!
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', 60, 80))
    })
    // 鼠标移出浏览器窗口等场景：pointerup 可能不触发，必须用 pointercancel/blur 兜底
    act(() => {
      window.dispatchEvent(new Event('pointercancel'))
    })
    act(() => {
      window.dispatchEvent(pointer('pointermove', 200, 200))
    })
    expect(onGroupResize).not.toHaveBeenCalled()
  })
})

describe('FlowNode 交换按钮（阶段节点不渲染，审查 BUG-1 修复防回归）', () => {
  it('start 阶段节点无 .wf-node__swap；角色节点有且点击触发 onSwapPorts', () => {
    const onSwapPorts = vi.fn()
    const startNode: CanvasNode = { id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }
    const agentNode: CanvasNode = { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '子代理' } }
    const props: GraphCanvasProps = {
      nodes: [startNode, agentNode],
      edges: [],
      copy: { ...zh, modeName: () => '' },
      mode: 'mode1',
      selectedNode: null,
      selectedEdge: null,
      runStatusByNode: {},
      highlightedNodeIds: [],
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
      onSwapPorts,
      fitLabel: '',
      zoomInLabel: '',
      zoomOutLabel: '',
      emptyHint: '',
    }
    act(() => {
      root = createRoot(container!)
      root.render(<GraphCanvas {...props} />)
    })

    const startCard = container!.querySelector('.wf-graph__node[data-wf-node-id="s1"]')
    const agentCard = container!.querySelector('.wf-graph__node[data-wf-node-id="a1"]')
    // 阶段节点（start/end/pause）不渲染交换按钮（审查 BUG-1：交换无意义 + 防死数据）
    expect(startCard?.querySelector('.wf-node__swap')).toBeNull()
    // 角色节点渲染交换按钮；点击触发 onSwapPorts
    const agentSwap = agentCard?.querySelector('.wf-node__swap') as HTMLButtonElement | null
    expect(agentSwap).toBeTruthy()
    act(() => {
      agentSwap!.click()
    })
    expect(onSwapPorts).toHaveBeenCalledWith('a1')
  })
})
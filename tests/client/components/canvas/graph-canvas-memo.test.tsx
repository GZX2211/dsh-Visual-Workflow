// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/graph-canvas-memo.test.tsx
//
// GraphCanvas 渲染边界（D07-03）：派生容器与逐边连线几何只在输入变化时重算。
// 判别口径是可观察的调用计数——旧实现每次渲染都重建全部派生结构（并在拖拽每帧执行），
// 因此「本地渲染态重渲染」「同输入重渲染」两类场景下计数必须不变，而输入变化时必须重算
// （后半条防「把计数冻住」的假绿）：
//   - 派生容器重建次数：节点数组上的 map/filter 调用（渲染期派生的唯一入口）；
//   - 逐边几何计算次数：geometry.edgeGeometry 调用（每条边一次，含两次所属组反查）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { GraphCanvas, type GraphCanvasProps } from '../../../../src/client/components/canvas/GraphCanvas.js'
import { zh } from '../../../../src/client/i18n.js'
import type { CanvasEdge, CanvasNode } from '../../../../src/client/studio/studio-state.js'

/** 逐边几何计算计数（hoisted：vi.mock 工厂在模块求值前执行）。 */
const edgeGeometryCalls = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../../../src/client/components/canvas/geometry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/client/components/canvas/geometry.js')>()
  return {
    ...actual,
    edgeGeometry: (...args: Parameters<typeof actual.edgeGeometry>) => {
      edgeGeometryCalls.count += 1
      return actual.edgeGeometry(...args)
    },
  }
})

/** 记录派生读取次数的节点数组：渲染期重建派生容器必然经过 map/filter。 */
class DerivedCountingNodes extends Array<CanvasNode> {
  derivedReads = 0
  override map<U>(callback: (value: CanvasNode, index: number, array: CanvasNode[]) => U): U[] {
    this.derivedReads += 1
    return super.map(callback)
  }

  override filter(predicate: (value: CanvasNode, index: number, array: CanvasNode[]) => unknown): CanvasNode[] {
    this.derivedReads += 1
    return super.filter(predicate)
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  edgeGeometryCalls.count = 0
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
})

const groupNode: CanvasNode = {
  id: 'g1',
  kind: 'group',
  position: { x: 0, y: 0 },
  data: { label: '组', memberIds: ['a1'], size: { w: 300, h: 220 } },
}
const memberNode: CanvasNode = { id: 'a1', kind: 'agent', position: { x: 340, y: 40 }, data: { label: '子代理' } }
const tailNode: CanvasNode = { id: 'n2', kind: 'agent', position: { x: 680, y: 40 }, data: { label: '下游' } }

function nodesOf(): DerivedCountingNodes {
  const nodes = new DerivedCountingNodes()
  nodes.push(groupNode, memberNode, tailNode)
  return nodes
}

function propsOf(nodes: CanvasNode[], edges: CanvasEdge[]): GraphCanvasProps {
  return {
    nodes,
    edges,
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
    onSwapPorts: () => {},
    fitLabel: '',
    zoomInLabel: '',
    zoomOutLabel: '',
    emptyHint: '',
  }
}

/** 组内成员 → 下游（含两次所属组反查的连线）。 */
function edgesOf(): CanvasEdge[] {
  return [{ id: 'e1', source: 'a1', target: 'n2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }]
}

function render(props: GraphCanvasProps): void {
  act(() => {
    root = createRoot(container!)
    root.render(<GraphCanvas {...props} />)
  })
}

describe('GraphCanvas 渲染边界（D07-03）', () => {
  it('本地渲染态重渲染（缩放）：不重建派生容器、不重跑连线几何', () => {
    const nodes = nodesOf()
    const props = propsOf(nodes, edgesOf())
    render(props)

    const readsAfterMount = nodes.derivedReads
    const geometryAfterMount = edgeGeometryCalls.count
    // 防计数空转：挂载期必须真的发生过派生与逐边几何计算
    expect(readsAfterMount).toBeGreaterThan(0)
    expect(geometryAfterMount).toBe(1)

    const zoomIn = container!.querySelector<HTMLButtonElement>('.wf-graph__controls button')!
    act(() => { zoomIn.click() })
    act(() => { zoomIn.click() })

    expect(nodes.derivedReads).toBe(readsAfterMount)
    expect(edgeGeometryCalls.count).toBe(geometryAfterMount)
  })

  it('同输入重渲染：派生结构与连线几何的输入引用保持稳定，不重算', () => {
    const nodes = nodesOf()
    const props = propsOf(nodes, edgesOf())
    render(props)

    const readsAfterMount = nodes.derivedReads
    const geometryAfterMount = edgeGeometryCalls.count

    // 同一 props 对象再渲染一次（如父级因无关状态重渲染）：输入引用未变
    act(() => {
      root!.render(<GraphCanvas {...props} />)
    })

    expect(nodes.derivedReads).toBe(readsAfterMount)
    expect(edgeGeometryCalls.count).toBe(geometryAfterMount)
  })

  it('输入变化（连线集合变化）：逐边几何与派生容器照常重算（防把计数冻住的假绿）', () => {
    const nodes = nodesOf()
    const props = propsOf(nodes, edgesOf())
    render(props)

    const readsAfterMount = nodes.derivedReads
    const geometryAfterMount = edgeGeometryCalls.count

    act(() => {
      root!.render(<GraphCanvas {...props} edges={[...props.edges, { id: 'e2', source: 'g1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]} />)
    })

    expect(edgeGeometryCalls.count).toBeGreaterThan(geometryAfterMount)
    expect(nodes.derivedReads).toBe(readsAfterMount)
  })
})

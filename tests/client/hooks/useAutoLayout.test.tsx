// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useAutoLayout.test.tsx
//
// useAutoLayout（hooks/useAutoLayout.ts）单测：打开带哨兵坐标（{0,0}）的文档时自动重排
// 一次**并落盘**——
//   ① 缺坐标/哨兵坐标 → GRAPH_REPLACED 写入新布局，且 saveCanvas 收到本次重排后的新坐标
//      （闭包里的 canvas 仍是重排前的旧画布，不显式传 nodes 会把旧坐标写回后端）；
//   ② 已布局（无哨兵坐标）→ 不重排、不落盘。
// 断言可观察行为（dispatch 动作 + 落盘入参），不断言具体坐标数值（布局参数可调）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useAutoLayout } from '../../../src/client/hooks/useAutoLayout.js'
import type { SaveCanvasOptions } from '../../../src/client/hooks/useDocumentActions.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { CanvasNode, StudioAction, StudioState } from '../../../src/client/studio/studio-state.js'

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
  vi.restoreAllMocks()
})

/** 画布节点夹具（位置显式给，便于构造哨兵坐标）。 */
function node(id: string, position: { x: number; y: number }): CanvasNode {
  return { id, kind: 'agent', position, data: { label: id } } as CanvasNode
}

/** 带当前文档的状态（currentId/currentKind 齐备才会触发自动布局判定）。 */
function docState(nodes: CanvasNode[]): StudioState {
  return {
    ...createInitialState('s-1'),
    currentKind: 'workflow',
    currentId: 'wf-1',
    workflows: [{ id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '流程', description: '', revision: 1, nodes: [], lines: [] }],
    canvas: { nodes, edges: [] },
  }
}

/** 渲染自动布局 hook（saveCanvas 注入为收集器）。 */
async function renderAutoLayout(state: StudioState): Promise<{
  saveCanvas: ReturnType<typeof vi.fn>
  dispatched: StudioAction[]
}> {
  const saveCanvas = vi.fn()
  const dispatched: StudioAction[] = []
  function Probe({ current }: { current: StudioState }): null {
    useAutoLayout(current, ((action: StudioAction) => { dispatched.push(action) }) as never, { saveCanvas })
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe, { current: state }))
  })
  return { saveCanvas, dispatched }
}

describe('useAutoLayout：哨兵坐标文档自动重排并落盘', () => {
  it('哨兵坐标 → GRAPH_REPLACED 写入新布局，且落盘带本次重排后的新坐标', async () => {
    const sentinel = [node('a', { x: 0, y: 0 }), node('b', { x: 0, y: 0 })]
    const { saveCanvas, dispatched } = await renderAutoLayout(docState(sentinel))

    const replaced = dispatched.find((action) => action.type === 'GRAPH_REPLACED') as
      | { type: 'GRAPH_REPLACED'; nodes: CanvasNode[] }
      | undefined
    expect(replaced).toBeDefined()
    expect(replaced!.nodes).not.toEqual(sentinel)

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    const options = saveCanvas.mock.calls[0]![0] as SaveCanvasOptions
    expect(options.auto).toBe(true)
    // 关键契约：落盘载荷 = 本次重排后的新坐标（不是重排前的哨兵坐标）
    expect(options.nodes).toEqual(replaced!.nodes)
    expect(options.nodes!.some((item) => item.position.x !== 0 || item.position.y !== 0)).toBe(true)
  })

  it('已布局文档（无哨兵坐标）→ 不重排、不落盘', async () => {
    const laidOut = [node('a', { x: 40, y: 40 }), node('b', { x: 320, y: 40 })]
    const { saveCanvas, dispatched } = await renderAutoLayout(docState(laidOut))

    expect(dispatched.some((action) => action.type === 'GRAPH_REPLACED')).toBe(false)
    expect(saveCanvas).not.toHaveBeenCalled()
  })
})

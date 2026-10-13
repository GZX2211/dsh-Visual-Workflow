// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useGraphHistory.test.tsx
//
// 图历史面：remember/undo/redo 的 dispatch 语义、**face 身份稳定**（D08-07），
// 以及「remember 入栈的是调用时刻的最新画布」（回调身份固定后仍不得退化为旧快照）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useGraphHistory, type GraphHistoryFace } from '../../../src/client/hooks/useGraphHistory.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { CanvasNode, StudioState } from '../../../src/client/studio/studio-types.js'
import type { StudioAction } from '../../../src/client/studio/studio-actions.js'

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

function node(id: string): CanvasNode {
  return { id, kind: 'agent', position: { x: 1, y: 2 }, data: { label: id } }
}

function stateWith(nodes: CanvasNode[], history?: Partial<StudioState['history']>): StudioState {
  const base = createInitialState('s-1')
  return { ...base, canvas: { nodes, edges: [] }, ...(history ? { history: { ...base.history, ...history } } : {}) }
}

interface HistoryHarness {
  face: GraphHistoryFace
  actions: StudioAction[]
  rerender(next: StudioState): Promise<void>
}

async function renderHistory(state: StudioState): Promise<HistoryHarness> {
  const actions: StudioAction[] = []
  const dispatch = ((action: StudioAction) => { actions.push(action) }) as never
  let face: GraphHistoryFace | null = null
  function Harness({ state }: { state: StudioState }): null {
    face = useGraphHistory(state, dispatch)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { state }))
  })
  return {
    face: face!,
    actions,
    rerender: async (next: StudioState): Promise<void> => {
      await act(async () => { root!.render(React.createElement(Harness, { state: next })) })
    },
  }
}

describe('useGraphHistory：dispatch 语义', () => {
  it('undo/redo 提交对应 action；canUndo/canRedo 反映历史栈', async () => {
    const h = await renderHistory(stateWith([node('n-1')], { past: [null as never], future: [] }))

    expect(h.face.canUndo).toBe(true)
    expect(h.face.canRedo).toBe(false)

    h.face.undo()
    h.face.redo()

    expect(h.actions).toEqual([{ type: 'UNDO' }, { type: 'REDO' }])
  })
})

describe('useGraphHistory：face 身份稳定与最新画布语义（D08-07）', () => {
  it('无关状态变化：face 与 remember 身份不变', async () => {
    const state = stateWith([node('n-1')])
    const h = await renderHistory(state)
    const first = h.face
    const firstRemember = h.face.remember

    await h.rerender({ ...state, toasts: [{ id: 't-1', kind: 'info', text: 'x' }] })

    expect(h.face).toBe(first)
    expect(h.face.remember).toBe(firstRemember)
  })

  it('持有旧回调时 remember 仍入栈**调用时刻**的最新画布（不退化为旧快照）', async () => {
    const h = await renderHistory(stateWith([node('n-1')]))
    const staleRemember = h.face.remember

    await h.rerender(stateWith([node('n-1'), node('n-2')]))
    staleRemember()

    const pushed = h.actions.find((action) => action.type === 'HISTORY_PUSH') as { snapshot: { nodes: CanvasNode[] } } | undefined
    expect(pushed?.snapshot.nodes.map((item) => item.id)).toEqual(['n-1', 'n-2'])
  })
})

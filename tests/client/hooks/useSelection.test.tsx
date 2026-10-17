// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useSelection.test.tsx
//
// 选中与编辑器面：dispatch 直通语义 + **face 身份稳定**（D08-07）。
// 身份稳定是被判别性锁定的行为：以 face 为依赖的 effect（键盘监听等）
// 若每次渲染都拿到新字面量，会反复重挂。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useSelection, type SelectionFace } from '../../../src/client/hooks/useSelection.js'
import type { StudioAction } from '../../../src/client/studio/studio-state.js'

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

/** 渲染选中面并返回面与 dispatch 记录。 */
async function renderSelection(dispatch: (action: StudioAction) => void): Promise<{ face: SelectionFace; rerender(): Promise<void> }> {
  let face: SelectionFace | null = null
  function Harness(): null {
    face = useSelection(dispatch as never)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return {
    face: face!,
    rerender: async (): Promise<void> => {
      await act(async () => { root!.render(React.createElement(Harness)) })
    },
  }
}

describe('useSelection：dispatch 直通', () => {
  it('五个操作各自 dispatch 对应的语义化 action', async () => {
    const actions: StudioAction[] = []
    const { face } = await renderSelection((action) => { actions.push(action) })

    face.selectNode('n-1')
    face.selectEdge('e-1')
    face.selectLib('role', 'r-1')
    face.selectEditor({ source: 'workflow', id: 'wf-1' })
    face.clearSelection()

    expect(actions).toEqual([
      { type: 'SELECT_NODE', id: 'n-1' },
      { type: 'SELECT_EDGE', id: 'e-1' },
      { type: 'SELECT_LIB', kind: 'role', id: 'r-1' },
      { type: 'SELECT_EDITOR', editor: { source: 'workflow', id: 'wf-1' } },
      { type: 'CLEAR_SELECTION' },
    ])
  })
})

describe('useSelection：face 身份稳定（D08-07）', () => {
  it('重渲染后 face 与各操作身份不变（依赖它的 effect 不会重挂）', async () => {
    const { face, rerender } = await renderSelection(() => {})
    const first = face
    const firstClear = face.clearSelection

    await rerender()

    expect(face).toBe(first)
    expect(face.clearSelection).toBe(firstClear)
    expect(face.selectNode).toBe(first.selectNode)
  })
})

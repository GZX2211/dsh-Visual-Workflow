// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/usePanelLayout.test.tsx
//
// usePanelLayout（hooks/usePanelLayout.ts）单测：几何与折叠态的 localStorage 记忆落点——
//   ① mode 变化时写一次 LAYOUT_KEYS.mode；初始渲染（恢复值）不回写；
//   ② 拖拽结束（pointerup）写对应方向的几何键；拖拽期间是 dispatch、不写存储。
// 断言可观察结果（存储键值），不断言内部实现。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { usePanelLayout, type PanelLayoutFace } from '../../../src/client/hooks/usePanelLayout.js'
import { LAYOUT_KEYS } from '../../../src/client/studio/panel-layout.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { StudioState } from '../../../src/client/studio/studio-types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
  localStorage.clear()
  vi.restoreAllMocks()
})

/** 渲染面板几何 hook；可通过 rerender 换入新状态（模拟 mode 变化）。 */
async function renderFace(state: StudioState): Promise<{
  face: PanelLayoutFace
  dispatch: ReturnType<typeof vi.fn>
  rerender: (next: StudioState) => Promise<void>
}> {
  let face: PanelLayoutFace | null = null
  const dispatch = vi.fn()
  function Probe({ current }: { current: StudioState }): null {
    face = usePanelLayout(current, dispatch as never)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe, { current: state }))
  })
  return {
    face: face!,
    dispatch,
    rerender: async (next: StudioState) => {
      await act(async () => {
        root!.render(React.createElement(Probe, { current: next }))
      })
    },
  }
}

/** 合成 pointer 事件（jsdom 无真实指针）。 */
function pointer(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY })
}

describe('usePanelLayout 折叠态持久化', () => {
  it('初始渲染不回写 mode（恢复值不产生无谓写入）', async () => {
    await renderFace(createInitialState('s-1'))
    expect(localStorage.getItem(LAYOUT_KEYS.mode)).toBeNull()
  })

  it('mode 变化 → 写一次对应键（值按当前 mode）', async () => {
    const base = createInitialState('s-1')
    const { rerender } = await renderFace(base)

    await rerender({ ...base, panels: { ...base.panels, mode: 2 } })

    expect(localStorage.getItem(LAYOUT_KEYS.mode)).toBe('2')
  })
})

describe('usePanelLayout 几何持久化（拖拽结束写对应键）', () => {
  it('左栏拖宽：拖拽期间只 dispatch PANELS_SET，pointerup 才写 leftWidth', async () => {
    const base = createInitialState('s-1')
    const { face, dispatch } = await renderFace(base)

    act(() => {
      face.beginResize('left', { button: 0, clientX: 0, clientY: 0 })
      window.dispatchEvent(pointer('pointermove', 60, 0))
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'PANELS_SET', panels: { leftWidth: base.panels.leftWidth + 60 } })
    // 拖拽未结束 → 不落存储（避免拖拽过程刷写）
    expect(localStorage.getItem(LAYOUT_KEYS.leftWidth)).toBeNull()

    act(() => {
      window.dispatchEvent(pointer('pointerup', 60, 0))
    })
    expect(localStorage.getItem(LAYOUT_KEYS.leftWidth)).toBe(String(base.panels.leftWidth + 60))
  })

  it('底栏拖高：pointerup 写 bottomHeight', async () => {
    const base = createInitialState('s-1')
    const { face } = await renderFace(base)

    act(() => {
      face.beginResize('bottom', { button: 0, clientX: 0, clientY: 300 })
      window.dispatchEvent(pointer('pointermove', 0, 260))
      window.dispatchEvent(pointer('pointerup', 0, 260))
    })

    expect(localStorage.getItem(LAYOUT_KEYS.bottomHeight)).toBe(String(base.panels.bottomHeight + 40))
  })
})

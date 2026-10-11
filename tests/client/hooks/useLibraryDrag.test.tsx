// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useLibraryDrag.test.tsx
//
// useLibraryDrag（hooks/useLibraryDrag.ts）单测：拖拽手势的 window 监听归属——
// 手势未收尾时组件卸载，残留监听不得继续消费后续指针事件（卸载后的 pointerup
// 会被当成点击落点误触发 payload.onClick）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useLibraryDrag, type LibraryDragFace } from '../../../src/client/hooks/useLibraryDrag.js'
import type { DragPayload } from '../../../src/client/components/sidebar/LeftPanel.js'
import type { CanvasApi } from '../../../src/client/components/canvas/GraphCanvas.js'

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

/** 渲染 useLibraryDrag（canvasShellRef/canvasApiRef 为空引用，本组用例不走落点换算）。 */
async function renderDrag(): Promise<{ face: LibraryDragFace }> {
  let face: LibraryDragFace | null = null
  function Harness(): null {
    const shellRef = useRef<HTMLDivElement | null>(null)
    const apiRef = useRef<CanvasApi | null>(null)
    const f = useLibraryDrag(shellRef, apiRef)
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face! }
}

/** 合成 pointerdown（jsdom 无真实指针；beginLibraryDrag 只读 button/clientX/clientY）。 */
function beginEvent(clientX: number, clientY: number): React.PointerEvent {
  return { button: 0, clientX, clientY } as unknown as React.PointerEvent
}

/** 合成 window 上的指针事件（jsdom 无真实指针）。 */
function pointer(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY })
}

describe('useLibraryDrag：拖拽中卸载的监听清理', () => {
  it('拖拽中卸载：随后的 pointerup 不得被当成点击落点误触发 onClick', async () => {
    const onClick = vi.fn()
    const payload = { kind: 'role', label: '研究', onClick } as unknown as DragPayload
    const { face } = await renderDrag()

    act(() => { face.beginLibraryDrag(beginEvent(10, 10), payload) })
    act(() => { root!.unmount(); root = null })
    act(() => { window.dispatchEvent(pointer('pointerup', 200, 200)) })

    expect(onClick).not.toHaveBeenCalled()
  })

  it('正常拖拽（未移动即抬起）：仍按点击语义触发 onClick', async () => {
    const onClick = vi.fn()
    const payload = { kind: 'role', label: '研究', onClick } as unknown as DragPayload
    const { face } = await renderDrag()

    act(() => { face.beginLibraryDrag(beginEvent(10, 10), payload) })
    act(() => { window.dispatchEvent(pointer('pointerup', 10, 10)) })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('重复 pointerdown（新手势接管）：只有一组监听生效，抬指不得触发两次点击', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { face } = await renderDrag()

    act(() => {
      face.beginLibraryDrag(beginEvent(10, 10), { kind: 'role', label: '甲', onClick: first } as unknown as DragPayload)
      face.beginLibraryDrag(beginEvent(20, 20), { kind: 'role', label: '乙', onClick: second } as unknown as DragPayload)
      window.dispatchEvent(pointer('pointerup', 20, 20))
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

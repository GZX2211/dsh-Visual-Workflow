// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useToast.test.tsx
//
// useToast（hooks/useToast.ts）单测：自动移除定时器的生命周期归属——
// 卸载后未到期的定时器不得再 dispatch TOAST_DROP（组件已不存在，写状态无归属）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { TOAST_DURATION_MS, useToast, type ToastFace } from '../../../src/client/hooks/useToast.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 渲染 useToast（dispatch 记录；返回面与派发序列）。 */
async function renderToast(): Promise<{ face: ToastFace; dispatched: Array<{ type: string; id?: string }> }> {
  const dispatched: Array<{ type: string; id?: string }> = []
  let face: ToastFace | null = null
  const dispatch = ((action: { type: string; id?: string }) => { dispatched.push(action) }) as never
  function Harness(): null {
    const f = useToast(dispatch)
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face!, dispatched }
}

describe('useToast：自动移除定时器的卸载清理', () => {
  it('卸载后定时器到期，不得再 dispatch TOAST_DROP', async () => {
    vi.useFakeTimers()
    const { face, dispatched } = await renderToast()

    act(() => { face.toast('info', '已保存') })
    expect(dispatched.map((item) => item.type)).toEqual(['TOAST_PUSH'])

    act(() => { root!.unmount(); root = null })
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS * 2) })

    expect(dispatched.map((item) => item.type)).toEqual(['TOAST_PUSH'])
  })

  it('卸载前到期：提示仍被正常移除（清理不误伤未卸载路径）', async () => {
    vi.useFakeTimers()
    const { face, dispatched } = await renderToast()

    act(() => { face.toast('success', '完成') })
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS) })

    expect(dispatched.map((item) => item.type)).toEqual(['TOAST_PUSH', 'TOAST_DROP'])
  })
})

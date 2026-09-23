// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useUnsavedGuard.test.tsx
//
// useUnsavedGuard（hooks/useUnsavedGuard.ts）单测：dirty 时守卫弹确认；「保存并继续」
// 只在**真实落库成功**后接续原操作——
//   ① save 直接返回文档 → 继续一次；
//   ② save 返回 null（运行中保存需二次确认）→ 本次不继续；其后 save 经 onSaved 转达
//      真实落库 → 继续且仅一次（即时路径与确认路径不得重复执行原操作）；
//   ③ save 抛错 / 未落库且无 onSaved → 不继续（原操作不执行，dirty 保留）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useUnsavedGuard, type UnsavedGuardFace } from '../../../src/client/hooks/useUnsavedGuard.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { StudioState } from '../../../src/client/studio/studio-types.js'

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

/** 渲染守卫并暴露 face（dispatch 为收集器）。 */
async function renderGuard(state: StudioState): Promise<{ face: UnsavedGuardFace; dispatched: string[] }> {
  let face: UnsavedGuardFace | null = null
  const dispatched: string[] = []
  function Probe(): null {
    face = useUnsavedGuard(state, ((action: { type: string }) => { dispatched.push(action.type) }) as never)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe))
  })
  return { face: face!, dispatched }
}

/** 未保存确认中的状态（dirty + confirm.kind='unsaved'）。 */
function dirtyPendingState(proceed: () => void): StudioState {
  return {
    ...createInitialState('s-1'),
    dirty: true,
    confirm: { kind: 'unsaved', proceed },
  }
}

describe('useUnsavedGuard.saveAndProceed：真实落库后才继续', () => {
  it('save 返回文档 → 关闭确认并继续一次', async () => {
    let continued = 0
    const { face, dispatched } = await renderGuard(dirtyPendingState(() => { continued += 1 }))

    await act(async () => {
      await face.saveAndProceed(async () => ({ id: 'wf-1' }))
    })

    expect(continued).toBe(1)
    expect(dispatched).toEqual(['CONFIRM_SET'])
  })

  it('save 返回 null（需二次确认）→ 本次不继续；其后 onSaved 转达落库 → 继续且仅一次', async () => {
    let continued = 0
    const { face } = await renderGuard(dirtyPendingState(() => { continued += 1 }))

    let deliverOnSaved: (() => void) | null = null
    await act(async () => {
      await face.saveAndProceed(async (onSaved) => {
        deliverOnSaved = onSaved
        return null
      })
    })
    // 待确认路径：本次调用没落库 → 原操作不得提前执行
    expect(deliverOnSaved).not.toBeNull()
    expect(continued).toBe(0)

    // 用户确认且真实落库成功 → save 内部经 onSaved 接续原操作
    act(() => { deliverOnSaved!() })
    expect(continued).toBe(1)

    // 同一批再次报到（即时路径与确认路径先后都到）也不得重复执行
    act(() => { deliverOnSaved!() })
    expect(continued).toBe(1)
  })

  it('save 抛错 → 不继续（dirty 未被原操作覆盖）', async () => {
    let continued = 0
    const { face } = await renderGuard(dirtyPendingState(() => { continued += 1 }))

    await act(async () => {
      await face.saveAndProceed(async () => {
        throw new Error('put failed')
      })
    })

    expect(continued).toBe(0)
  })

  it('save 未落库且不调用 onSaved（取消/失败）→ 不继续', async () => {
    let continued = 0
    const { face } = await renderGuard(dirtyPendingState(() => { continued += 1 }))

    await act(async () => {
      await face.saveAndProceed(async () => null)
    })

    expect(continued).toBe(0)
  })
})

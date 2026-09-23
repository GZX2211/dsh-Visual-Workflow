// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useStudioState.test.tsx
//
// useStudioState（hooks/useStudioState.ts）单测：主状态机初始化时恢复界面的「用户记忆」
// 缓存（刷新恢复语义）——
//   ① 面板几何与折叠态从 localStorage 恢复（mode/左右宽度/底高）；
//   ② 空缓存回退默认；
//   ③ 会话切换（SET_SESSION）不改动已恢复的面板几何。
// 断言的是刷新后用户看到的初始状态，不涉及内部实现。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useStudioState, type StudioStateFace } from '../../../src/client/hooks/useStudioState.js'
import { LAYOUT_KEYS } from '../../../src/client/studio/panel-layout.js'
import { defaultPanels } from '../../../src/client/studio/studio-initial.js'

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
})

/** 渲染主状态机并暴露 face（模拟应用挂载）。 */
async function renderState(sessionId: string): Promise<{
  face: StudioStateFace
  rerender: (nextSessionId: string) => Promise<void>
}> {
  let face: StudioStateFace | null = null
  function Probe({ sessionId: sid }: { sessionId: string }): null {
    face = useStudioState(sid)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe, { sessionId }))
  })
  return {
    face: face!,
    rerender: async (nextSessionId: string) => {
      await act(async () => {
        root!.render(React.createElement(Probe, { sessionId: nextSessionId }))
      })
    },
  }
}

describe('useStudioState 初始化恢复面板几何与折叠态', () => {
  it('缓存合法值 → 首帧即为上次布局（刷新恢复）', async () => {
    localStorage.setItem(LAYOUT_KEYS.mode, '2')
    localStorage.setItem(LAYOUT_KEYS.leftWidth, '300')
    localStorage.setItem(LAYOUT_KEYS.rightWidth, '410')
    localStorage.setItem(LAYOUT_KEYS.bottomHeight, '260')

    const { face } = await renderState('s-1')

    expect(face.state.panels).toEqual({ mode: 2, leftWidth: 300, rightWidth: 410, bottomHeight: 260 })
  })

  it('缓存缺失/损坏 → 回退默认面板几何', async () => {
    localStorage.setItem(LAYOUT_KEYS.mode, 'abc')
    localStorage.setItem(LAYOUT_KEYS.leftWidth, '0')

    const { face } = await renderState('s-1')

    expect(face.state.panels).toEqual(defaultPanels())
  })

  it('后续渲染不重读缓存（用户记忆只在初始化读一次）', async () => {
    localStorage.setItem(LAYOUT_KEYS.leftWidth, '300')
    const { face, rerender } = await renderState('s-1')
    expect(face.state.panels.leftWidth).toBe(300)

    // 之后即使存储被改写，已挂载的状态机也不重新读取（避免运行期布局漂移）
    localStorage.setItem(LAYOUT_KEYS.leftWidth, '999')
    await rerender('s-2')

    expect(face.state.panels.leftWidth).toBe(300)
  })
})

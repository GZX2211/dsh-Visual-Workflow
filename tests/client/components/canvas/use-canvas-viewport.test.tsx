// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/use-canvas-viewport.test.tsx
//
// 画布视口（components/canvas/use-canvas-viewport.ts）：
//   zoomBy 连续调用必须逐次累积（同一批次内两次也如此），且 viewportRef 与已提交视口
//   必须同值——视口 ref 是 screenToWorld（拖拽落点/连线草稿坐标）的唯一读取口径，
//   它与状态分叉会让后续交互按过期视口计算。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useCanvasViewport, type CanvasViewportFace } from '../../../../src/client/components/canvas/use-canvas-viewport.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

/** 渲染画布视口 hook，返回可读最新一次渲染结果的持有者。 */
async function renderViewport(): Promise<{ current: CanvasViewportFace }> {
  const holder: { current: CanvasViewportFace | null } = { current: null }
  function Harness() {
    const api = useCanvasViewport([], () => {})
    holder.current = api
    return React.createElement('div', { ref: api.rootRef })
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return holder as { current: CanvasViewportFace }
}

describe('画布视口', () => {
  it('同一批次内连续 zoomBy 逐次累积，且 viewportRef 与已提交视口同值', async () => {
    const face = await renderViewport()
    const base = face.current.viewport.zoom
    await act(async () => {
      face.current.zoomBy(1.25)
      face.current.zoomBy(1.25)
    })
    expect(face.current.viewport.zoom).toBeCloseTo(base * 1.25 * 1.25, 5)
    expect(face.current.viewportRef.current.zoom).toBeCloseTo(face.current.viewport.zoom, 5)
    expect(face.current.viewportRef.current).toEqual(face.current.viewport)
  })
})

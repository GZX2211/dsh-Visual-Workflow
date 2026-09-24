// @vitest-environment jsdom

// tests/client/lib/dom-hit-test.test.ts
//
// 画布 DOM 命中检测（入组落点、连线目标）纯函数单测：
// 仅协作组表面可入组，连接点不具入组功能，被拖拽本体节点被排除。

import { describe, expect, it } from 'vitest'
import { groupSurfaceFromElements, groupSurfaceUnderPoint, connectionTargetAt } from '../../../src/client/lib/dom-hit-test.js'

function groupEl(id: string): HTMLDivElement {
  const g = document.createElement('div')
  g.className = 'wf-graph__node wf-group-node'
  g.setAttribute('data-wf-node-id', id)
  return g
}

describe('groupSurfaceFromElements（入组落点：仅协作组表面，连接点不具入组功能）', () => {
  it('组卡片表面命中 → 返回组 id', () => {
    expect(groupSurfaceFromElements([groupEl('g')])).toBe('g')
  })

  it('连接点（把手）为本体首个元素 → 拒绝入组（返回 null）', () => {
    const g = groupEl('g')
    const handle = document.createElement('span')
    handle.className = 'wf-graph__handle'
    g.appendChild(handle)
    expect(groupSurfaceFromElements([handle, g])).toBeNull()
  })

  it('排除被拖拽本体节点（非组内元素被跳过）→ 命中组表面', () => {
    const node = document.createElement('div')
    node.className = 'wf-graph__node'
    node.setAttribute('data-wf-node-id', 'a')
    const g = groupEl('g')
    expect(groupSurfaceFromElements([node, g], 'a')).toBe('g')
  })

  it('非协作组表面 → 返回 null', () => {
    const node = document.createElement('div')
    node.className = 'wf-graph__node'
    node.setAttribute('data-wf-node-id', 'a')
    expect(groupSurfaceFromElements([node])).toBeNull()
  })
})

describe('DOM 命中 API 缺失时的降级', () => {
  // jsdom 不实现元素坐标命中（无布局），故此处显式模拟「环境不提供该 API」，
  // 断言两个封装都降级为 null 而不是抛错（宿主能力缺失即降级）。
  it('elementFromPoint / elementsFromPoint 不可用 → 返回 null', () => {
    const doc = document as unknown as { elementFromPoint?: unknown; elementsFromPoint?: unknown }
    const savedFromPoint = doc.elementFromPoint
    const savedElements = doc.elementsFromPoint
    delete doc.elementFromPoint
    delete doc.elementsFromPoint
    try {
      expect(connectionTargetAt(10, 10)).toBeNull()
      expect(groupSurfaceUnderPoint(10, 10)).toBeNull()
    } finally {
      if (savedFromPoint !== undefined) doc.elementFromPoint = savedFromPoint
      if (savedElements !== undefined) doc.elementsFromPoint = savedElements
    }
  })
})

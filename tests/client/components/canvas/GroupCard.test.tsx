// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/GroupCard.test.tsx
//
// Team 卡片渲染：
//   - Team 卡片自身**永无**运行状态徽标（包裹层不是执行主体，不进入运行事实）；
//   - 联动高亮（highlighted）加高亮类；
//   - 成员迷你卡照常渲染成员名与成员状态点（状态事实来源不变）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { GroupCard } from '../../../../src/client/components/canvas/GroupCard.js'
import { GROUP_CTX_IN_TOP, MEMBER_HANDLE_TOP } from '../../../../src/client/components/canvas/geometry.js'
import { zh } from '../../../../src/client/i18n.js'
import { GROUP_MEMBER_ROW_GAP, GROUP_MEMBER_ROW_H, GROUP_MEMBER_ROW_HEIGHT } from '../../../../src/client/lib/card-geometry.js'
import { canvasStyles } from '../../../../src/client/styles/canvas.js'
import type { CanvasNode } from '../../../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
})

const groupNode: CanvasNode = {
  id: 'n-g1',
  kind: 'group',
  position: { x: 0, y: 0 },
  data: { label: '后端开发组', collabPrompt: '组内并行', memberIds: ['n-dev', 'n-rev'], size: { w: 300, h: 220 } },
}

const members = [
  { id: 'n-dev', label: '后端开发工程师', status: 'running' },
  { id: 'n-rev', label: '后端代码审查专家', status: null },
]

function renderCard(overrides: Partial<React.ComponentProps<typeof GroupCard>> = {}): HTMLElement {
  const props: React.ComponentProps<typeof GroupCard> = {
    node: groupNode,
    copy: zh,
    members,
    selected: false,
    highlighted: false,
    dropTarget: false,
    onPointerDown: () => {},
    onHandlePointerDown: () => {},
    onMemberSelect: () => {},
    onResizeStart: () => {},
    ...overrides,
  }
  act(() => {
    root = createRoot(container!)
    root.render(<GroupCard {...props} />)
  })
  return container!.querySelector('.wf-node') as HTMLElement
}

describe('GroupCard 状态与高亮', () => {
  it('Team 卡片永不渲染运行状态徽标（包裹层不是执行主体，不进入运行事实）', () => {
    const card = renderCard()

    expect(card.querySelector('.wf-node__kind .wf-status-dot')).toBeNull()
    expect(card.className).not.toContain('is-running')
  })

  it('联动高亮：加 is-highlighted 类（与角色节点同款语义）', () => {
    const card = renderCard({ highlighted: true })
    expect(card.className).toContain('is-highlighted')
  })

  it('成员状态照常渲染：成员名与成员状态点按各自快照状态显示', () => {
    const card = renderCard()

    const memberCards = card.querySelectorAll('.wf-group__member')
    expect(memberCards).toHaveLength(2)
    expect(memberCards[0].textContent).toContain('后端开发工程师')
    expect(memberCards[1].textContent).toContain('后端代码审查专家')
    // 成员自身状态点（非 Team 卡片徽标）按成员状态渲染
    expect(memberCards[0].querySelector('.wf-status-dot')?.className).toContain('is-running')
    expect(memberCards[1].querySelector('.wf-status-dot')).toBeNull()
  })
})

describe('GroupCard 接点（任务 2/3）', () => {
  it('Team 卡片提供 ctx-in（团队整体任务入点），flow 入/出保持不变', () => {
    const card = renderCard()

    const groupCtxIn = card.querySelector('.wf-graph__handle--group-ctx')
    expect(groupCtxIn?.getAttribute('data-handle')).toBe('ctx-in')
    const flowHandles = [...card.querySelectorAll('.wf-graph__handle--group-flow')]
      .map((handle) => handle.getAttribute('data-handle'))
    expect(flowHandles.sort()).toEqual(['flow-in', 'flow-out'])
  })

  it('成员迷你卡只保留 db-in / ctx-in，不再渲染 ctx-out', () => {
    const card = renderCard()

    const memberCards = [...card.querySelectorAll('.wf-group__member')]
    expect(memberCards).toHaveLength(2)
    for (const member of memberCards) {
      expect(member.querySelector('[data-handle="db-in"]')).not.toBeNull()
      expect(member.querySelector('[data-handle="ctx-in"]')).not.toBeNull()
      expect(member.querySelector('[data-handle="ctx-out"]')).toBeNull()
    }
  })

  it('接点纵向比例与连线几何常量同口径（样式/几何不得各自漂移）', () => {
    expect(percentOf(canvasStyles, '.wf-graph__handle--member-db-in', 'top')).toBe(MEMBER_HANDLE_TOP['db-in'] * 100)
    expect(percentOf(canvasStyles, '.wf-graph__handle--member-ctx-in', 'top')).toBe(MEMBER_HANDLE_TOP['ctx-in'] * 100)
    expect(percentOf(canvasStyles, '.wf-graph__handle--group-ctx', 'top')).toBe(GROUP_CTX_IN_TOP * 100)
  })
})

/** 取某选择器首个规则块内的 px 声明值（样式片段是纯 CSS 字符串，直接解析文本）。 */
function pxOf(css: string, selector: string, property: string): number {
  const start = css.indexOf(`${selector} `)
  const block = css.slice(start, css.indexOf('}', start) + 1)
  const match = new RegExp(`${property}:\\s*(-?[\\d.]+)px`).exec(block)
  return Number(match?.[1])
}

/** 取某选择器首个规则块内的百分比声明值。 */
function percentOf(css: string, selector: string, property: string): number {
  const start = css.indexOf(`${selector} `)
  const block = css.slice(start, css.indexOf('}', start) + 1)
  const match = new RegExp(`${property}:\\s*([\\d.]+)%`).exec(block)
  return Number(match?.[1])
}

describe('组内成员行节距与连线锚点同口径（D07-04）', () => {
  it('渲染行节距（min-height + gap）等于连线锚点使用的 GROUP_MEMBER_ROW_H', () => {
    const rowMinHeight = pxOf(canvasStyles, '.wf-group__member', 'min-height')
    const rowGap = pxOf(canvasStyles, '.wf-group__members', 'gap')
    expect(rowMinHeight).toBe(GROUP_MEMBER_ROW_HEIGHT)
    expect(rowGap).toBe(GROUP_MEMBER_ROW_GAP)
    // 锚点按行节距推进；两者分叉会让成员连线端点逐行偏离实际接点
    expect(rowMinHeight + rowGap).toBe(GROUP_MEMBER_ROW_H)
  })
})

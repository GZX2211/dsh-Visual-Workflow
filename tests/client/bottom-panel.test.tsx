// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/bottom-panel.test.tsx
//
// 新功能测试（图片批注改造）：
//  1) 折叠/切换按钮 6 态循环（左展→切底→底收→底展→切左→左收→左展）；
//  2) 底栏渲染：Tag 区 4 图标（工作流/角色/数据/其他），卡片仅显示名称，切换 Tag 内容随动；
//  3) 右侧属性栏默认隐藏，仅当选中「具备属性」对象时弹出；点画布空白收起；
//  4) 父代理模板也具备属性（点击弹出属性栏）；阶段节点不弹（用选择器纯逻辑覆盖）。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio } from '../../src/client/studio/Studio.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import { EP } from '../../src/client/lib/remote.js'
import {
  createInitialState, nextPanelMode, leftPanelOpenOf, bottomPanelOpenOf, inspectorOpenOf,
  type StudioState,
} from '../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
})

function remoteStub(): RemoteFace {
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      if (endpoint === EP.EP_LIST_TEMPLATES && String(args?.kind ?? '') === 'role') {
        return [
          { id: 'parent', kind: 'parent', name: '父代理', systemPrompt: '' },
          { id: 'r-1', kind: 'agent', name: '研究员', systemPrompt: '' },
          { id: 'r-2', kind: 'agent', name: '测试工程师', systemPrompt: '' },
        ]
      }
      if (endpoint === EP.EP_LIST_TEMPLATES && String(args?.kind ?? '') === 'group') {
        return [{ id: 'g-1', name: '协作组', collabPrompt: '' }]
      }
      if (endpoint === EP.EP_PRESETS) return [{ id: 'standard', name: '标准' }]
      if (endpoint === EP.EP_MODELS) return [{ provider: 'deepseek', model: 'deepseek-chat' }]
      if (endpoint === EP.EP_ACTIVE_RUNS) return []
      if (endpoint === EP.EP_LIST_WORKFLOWS) return []
      if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return []
      return []
    }),
  }
  return remote
}

async function renderStudio(): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Studio, { t: zh, sessionId: 's-1', remote: remoteStub() }))
  })
}

function textOf(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((item) => item.textContent ?? '')
}

function pointerClick(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
}

function libTab(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.getAttribute('aria-label') === label)
}

/** 把底栏卡片（.wf-hcard）拖到画布指定坐标（模拟真实拖拽路径）。 */
async function dragHcardTo(cardText: string, clientX: number, clientY: number): Promise<void> {
  const shell = document.querySelector('.wf-canvas-shell') as HTMLElement | null
  if (shell) {
    Object.defineProperty(shell, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
  }
  const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-hcard')).find((item) => item.textContent?.includes(cardText))
  expect(card).toBeTruthy()
  await act(async () => {
    card!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  })
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }))
  })
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX, clientY }))
  })
}

// ---------------------------------------------------------------------------
// 纯选择器/循环逻辑（无需 DOM）
// ---------------------------------------------------------------------------

describe('面板折叠/切换循环（纯逻辑）', () => {
  it('nextPanelMode：0 → 1 → 2 → 0 循环（左展→切换底栏→收起底栏→左展）', () => {
    expect(nextPanelMode(0)).toBe(1)
    expect(nextPanelMode(1)).toBe(2)
    expect(nextPanelMode(2)).toBe(0)
  })

  it('leftPanelOpenOf / bottomPanelOpenOf 按循环位置推导（3 态）', () => {
    // 0:左展开 1:切换底栏(底展开) 2:收起底栏(全隐)
    const mk = (mode: number): StudioState => ({ ...createInitialState('s-1'), panels: { ...createInitialState('s-1').panels, mode } })
    expect(leftPanelOpenOf(mk(0))).toBe(true)
    expect(bottomPanelOpenOf(mk(0))).toBe(false)
    expect(leftPanelOpenOf(mk(1))).toBe(false)
    expect(bottomPanelOpenOf(mk(1))).toBe(true)
    expect(leftPanelOpenOf(mk(2))).toBe(false)
    expect(bottomPanelOpenOf(mk(2))).toBe(false)
  })
})

describe('属性栏显隐判定（纯逻辑）', () => {
  it('无选择 / 阶段节点 → 不弹；角色/父代理模板/连线 → 弹', () => {
    const base = createInitialState('s-1')
    // 无选择
    expect(inspectorOpenOf(base)).toBe(false)
    // 角色模板（具备属性）
    const roleState: StudioState = {
      ...base,
      templates: { ...base.templates, role: [{ id: 'r-1', kind: 'agent', name: '研究员', systemPrompt: '', provider: '', model: '', retryLimit: 3 }] },
      editor: { source: 'template', kind: 'role', id: 'r-1' },
    }
    expect(inspectorOpenOf(roleState)).toBe(true)
    // 父代理模板（也具备属性——经用户裁决修正）
    const parentState: StudioState = {
      ...base,
      templates: { ...base.templates, role: [{ id: 'p-1', kind: 'parent', name: '父代理', systemPrompt: '', provider: '', model: '', retryLimit: 3 }] },
      editor: { source: 'template', kind: 'role', id: 'p-1' },
    }
    expect(inspectorOpenOf(parentState)).toBe(true)
    // 画布阶段节点（不具备属性 → 不弹）
    const stageState: StudioState = {
      ...base,
      canvas: { nodes: [{ id: 'n-1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }], edges: [] },
      editor: { source: 'node', id: 'n-1' },
    }
    expect(inspectorOpenOf(stageState)).toBe(false)
    // 连线（具备属性 → 弹）
    const edgeState: StudioState = {
      ...base,
      canvas: { nodes: [], edges: [{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }] },
      editor: { source: 'edge', id: 'e-1' },
    }
    expect(inspectorOpenOf(edgeState)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DOM 行为（底栏渲染 / 折叠循环 / 属性栏显隐）
// ---------------------------------------------------------------------------

describe('底栏与折叠循环（DOM）', () => {
  it('折叠/切换按钮：左展→切换底栏→收起底栏→左展（3 态循环）', async () => {
    await renderStudio()
    const btn = document.querySelector('.wf-toolbar__panels') as HTMLButtonElement
    expect(btn).toBeTruthy()
    const docrailCollapsed = () => document.querySelector('.wf-docrail')?.classList.contains('is-collapsed')
    // 初始 = 左栏展开（mode 0）
    expect(docrailCollapsed()).toBe(false)
    expect(document.querySelector('.wf-bottombar')).toBeNull()
    // click → mode1 切换底栏（底展，左隐）
    await act(async () => { btn.click() })
    expect(docrailCollapsed()).toBe(true)
    expect(document.querySelector('.wf-bottombar')).toBeTruthy()
    // click → mode2 收起底栏（全隐）
    await act(async () => { btn.click() })
    expect(docrailCollapsed()).toBe(true)
    expect(document.querySelector('.wf-bottombar')).toBeNull()
    // click → mode0 左展（回起点）
    await act(async () => { btn.click() })
    expect(docrailCollapsed()).toBe(false)
    expect(document.querySelector('.wf-bottombar')).toBeNull()
  })

  it('底栏：Tag 区【左侧竖排、文字横向】+ 默认工作流分区 + 切换随动 + 水平边界线可拖', async () => {
    await renderStudio()
    const btn = document.querySelector('.wf-toolbar__panels') as HTMLButtonElement
    await act(async () => { btn.click() }) // mode1 切换底栏
    // Tag 区位于底栏左侧（tags 是 bottombar 第一个子元素，列排布）
    const tags = document.querySelector('.wf-bottombar__tags') as HTMLElement
    expect(tags).toBeTruthy()
    expect(tags.parentElement?.classList.contains('wf-bottombar')).toBe(true)
    // Tag 文字为横向（非图标）；aria-label 亦保留
    expect(textOf('.wf-bottombar__tag')).toEqual(['工作流', '角色', '数据', '其他'])
    expect(Array.from(document.querySelectorAll('.wf-bottombar__tag')).map((item) => item.getAttribute('aria-label'))).toEqual(['工作流', '角色', '数据', '其他'])
    // 默认工作流 Tag：实例 / 工作流模板 两分区
    const workflowGroups = textOf('.wf-bottombar__group-title')
    expect(workflowGroups).toContain('实例')
    expect(workflowGroups).toContain('工作流模板')
    // 切到角色 Tag：分区变为 父代理 / 角色模板
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-bottombar__tag')).find((item) => item.getAttribute('aria-label') === '角色')?.click()
    })
    const roleGroups = textOf('.wf-bottombar__group-title')
    expect(roleGroups).toContain('角色模板')
    // 底栏卡片只显示名称（无描述/图标）；研究员出现
    expect(textOf('.wf-hcard__name')).toContain('研究员')
    // 水平边界线（底栏顶部、横向）存在；拖动后 bottomHeight 变化
    const splitter = document.querySelector('.wf-splitter--horizontal') as HTMLElement
    expect(splitter).toBeTruthy()
    const barBefore = (document.querySelector('.wf-bottombar') as HTMLElement)?.style.height
    await act(async () => {
      splitter!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 300, button: 0 }))
    })
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 200 }))
    })
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 0, clientY: 200 }))
    })
    const barAfter = (document.querySelector('.wf-bottombar') as HTMLElement)?.style.height
    expect(barAfter).not.toBe(barBefore)
  })
})

describe('属性栏显隐（DOM）', () => {
  it('默认隐藏；选中角色模板弹出；点画布空白收起', async () => {
    await renderStudio()
    const inspector = () => document.querySelector('.wf-inspector')
    expect(inspector()?.classList.contains('is-collapsed')).toBe(true)
    // 切到角色 Tag，点击研究员卡片
    await act(async () => { libTab('角色')?.click() })
    const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem')).find((item) => item.textContent?.includes('研究员'))
    expect(card).toBeTruthy()
    await act(async () => { pointerClick(card!) })
    expect(inspector()?.classList.contains('is-collapsed')).toBe(false)
    expect(Array.from(document.querySelectorAll('.wf-inspector input')).some((i) => (i as HTMLInputElement).value === '研究员')).toBe(true)
    // 点画布空白 → 属性栏收起
    await act(async () => {
      const pane = document.querySelector('.wf-canvas') as HTMLElement
      pane?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(inspector()?.classList.contains('is-collapsed')).toBe(true)
  })

  it('父代理模板具备属性：点击父代理卡片弹出属性栏', async () => {
    await renderStudio()
    await act(async () => { libTab('角色')?.click() })
    const parentCard = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem')).find((item) => item.textContent?.includes('父代理'))
    expect(parentCard).toBeTruthy()
    await act(async () => { pointerClick(parentCard!) })
    const inspector = document.querySelector('.wf-inspector')
    expect(inspector?.classList.contains('is-collapsed')).toBe(false)
  })

  it('底栏卡片可拖拽入画布（与左栏一致）', async () => {
    await renderStudio()
    // 先创建空白模板草稿（向画布放节点需有当前文档）
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
    })
    const btn = document.querySelector('.wf-toolbar__panels') as HTMLButtonElement
    await act(async () => { btn.click() }) // mode1 底展
    // 底栏默认工作流 Tag 无实例/模板可作为拖拽源；切到角色 Tag 拖「研究员」
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-bottombar__tag')).find((item) => item.getAttribute('aria-label') === '角色')?.click()
    })
    expect(document.querySelectorAll('.wf-hcard').length).toBeGreaterThan(0)
    await dragHcardTo('研究员', 260, 260)
    expect(document.querySelectorAll('.wf-node').length).toBe(1)
  })
})

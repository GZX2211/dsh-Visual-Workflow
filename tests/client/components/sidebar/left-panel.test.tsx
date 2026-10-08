// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/sidebar/left-panel.test.tsx
//
// 左侧库改造（模版 / 资产来源 + 搜索栏）：
//   ① 搜索栏常驻四个 Tag 之下、列表之上；输入经 onSetLibSearch 上报（受控）；
//   ② 左栏底部「模版 / 资产」切换标签：渲染、选中态（is-active / aria-selected）、点击上报；
//   ③ 资产态数据 Tab 与搜索无结果走词典空态文案（不硬编码）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { LeftPanel, type DragPayload, type LeftPanelProps } from '../../../../src/client/components/sidebar/LeftPanel.js'
import { zh } from '../../../../src/client/i18n.js'

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
})

/** 左栏资产列表（活跃 + 历史；用例只给关心的那一段）。 */
function assetLists(
  active: Partial<Pick<LeftPanelProps['assets'], 'workflows' | 'roles'>> = {},
  retired: Partial<Pick<LeftPanelProps['assets'], 'retiredWorkflows' | 'retiredRoles'>> = {},
): LeftPanelProps['assets'] {
  return {
    workflows: active.workflows ?? [],
    roles: active.roles ?? [],
    retiredWorkflows: retired.retiredWorkflows ?? [],
    retiredRoles: retired.retiredRoles ?? [],
  }
}

/** 左栏 props 工厂（只覆盖被测字段，其余为最小缺省）。 */
function makeProps(partial: Partial<LeftPanelProps> = {}): LeftPanelProps {
  return {
    copy: zh,
    libTab: 'workflow',
    onSetTab: () => {},
    librarySource: 'template',
    onSetLibrarySource: () => {},
    libSearch: '',
    onSetLibSearch: () => {},
    open: true,
    width: 230,
    mode: 'mode1',
    workflows: [],
    currentSessionId: 's-1',
    flowTemplates: [],
    assets: assetLists(),
    experiences: [],
    parentTemplate: null,
    roleTemplates: [],
    fileTemplates: [],
    databaseTemplates: [],
    groupTemplates: [],
    stageKinds: [],
    libSelection: null,
    modeName: () => '标准',
    onSelectWorkflow: () => {},
    onSelectFlowTemplate: () => {},
    onSelectFlowAsset: () => {},
    onOpenRoleAsset: () => {},
    onPlaceRoleAsset: () => {},
    onOpenExperience: () => {},
    onSelectLib: () => {},
    onPlaceTemplate: () => {},
    onPlaceTemplateIntoGroup: () => {},
    onPlaceStage: () => {},
    onPlaceGroup: () => {},
    onPlaceGroupFromTemplate: () => {},
    onPlaceParent: () => {},
    onCreateNew: () => {},
    onBeginDrag: () => {},
    ...partial,
  }
}

async function renderPanel(props: LeftPanelProps): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(LeftPanel, props))
  })
}

function searchInput(): HTMLInputElement {
  return document.querySelector('.wf-lib-search__input') as HTMLInputElement
}

/** 受控输入赋值（绕过 React 的 value tracker，使 input 事件被判定为「有变化」）。 */
function typeInto(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function sourceTabs(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-source__tab'))
}

describe('左栏搜索栏（常驻两态）', () => {
  it('渲染在四个 Tag 之下、列表之上；受控值来自 props', async () => {
    await renderPanel(makeProps({ libSearch: '关键词' }))
    const input = searchInput()
    expect(input).toBeTruthy()
    expect(input.value).toBe('关键词')
    expect(input.getAttribute('placeholder')).toBe(zh.libSearchPlaceholder)
    const rail = document.querySelector('.wf-docrail')!
    const order = Array.from(rail.children).map((child) => child.className)
    expect(order.indexOf('wf-lib-tabs')).toBeLessThan(order.indexOf('wf-lib-search'))
    expect(order.indexOf('wf-lib-search')).toBeLessThan(order.indexOf('wf-docrail__list'))
  })

  it('输入上报关键词（不自行持有状态）', async () => {
    const onSetLibSearch = vi.fn()
    await renderPanel(makeProps({ onSetLibSearch }))
    await act(async () => {
      typeInto(searchInput(), 'abc')
    })
    expect(onSetLibSearch).toHaveBeenCalledWith('abc')
  })
})

describe('左栏底部「模版 / 资产」切换', () => {
  it('两个标签渲染在列表之后（左栏底部），文案取自词典', async () => {
    await renderPanel(makeProps())
    const rail = document.querySelector('.wf-docrail')!
    const order = Array.from(rail.children).map((child) => child.className)
    expect(order.indexOf('wf-docrail__list')).toBeLessThan(order.indexOf('wf-lib-source'))
    expect(sourceTabs().map((tab) => tab.textContent)).toEqual([zh.libSourceTemplate, zh.libSourceAsset])
  })

  it('模版态：模版标签选中（is-active + aria-selected）', async () => {
    await renderPanel(makeProps({ librarySource: 'template' }))
    const [templateTab, assetTab] = sourceTabs()
    expect(templateTab.classList.contains('is-active')).toBe(true)
    expect(templateTab.getAttribute('aria-selected')).toBe('true')
    expect(assetTab.classList.contains('is-active')).toBe(false)
    expect(assetTab.getAttribute('aria-selected')).toBe('false')
  })

  it('资产态：资产标签选中', async () => {
    await renderPanel(makeProps({ librarySource: 'asset' }))
    const [templateTab, assetTab] = sourceTabs()
    expect(assetTab.classList.contains('is-active')).toBe(true)
    expect(templateTab.classList.contains('is-active')).toBe(false)
  })

  it('点击标签上报目标来源', async () => {
    const onSetLibrarySource = vi.fn()
    await renderPanel(makeProps({ onSetLibrarySource }))
    await act(async () => { sourceTabs()[1].click() })
    expect(onSetLibrarySource).toHaveBeenCalledWith('asset')
    await act(async () => { sourceTabs()[0].click() })
    expect(onSetLibrarySource).toHaveBeenLastCalledWith('template')
  })
})

describe('资产态与搜索空态（词典文案）', () => {
  it('资产态「数据」Tag：标签显示为「经验」，列表为空时给出经验专属空态', async () => {
    await renderPanel(makeProps({ librarySource: 'asset', libTab: 'data' }))
    // 第四个 Tag 的位置与 key 不变，只有文案随库来源切换（模版态仍是「数据」）
    expect(Array.from(document.querySelectorAll('.wf-lib-tab')).map((tab) => tab.textContent))
      .toEqual(['工作流', '角色', zh.libTabExperience, '其他'])
    expect(document.querySelector('.wf-docgroup')?.textContent).toContain(zh.experienceActiveSection)
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.experienceEmptyHint)
  })

  it('搜索无结果：整页空态提示，且不渲染任何分区标题', async () => {
    await renderPanel(makeProps({ libSearch: '无命中', workflows: [{ id: 'flow-1', name: '甲方' }] }))
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.searchNoResult)
    expect(document.querySelectorAll('.wf-docgroup')).toHaveLength(0)
  })

  it('资产态工作流 Tab 为空：活跃分区空态为「资产只能由模版入库晋升」', async () => {
    await renderPanel(makeProps({ librarySource: 'asset', libTab: 'workflow' }))
    expect(document.querySelector('.wf-docgroup')?.textContent).toContain(zh.assetActiveSection)
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.assetEmptyHint)
  })
})

describe('资产态「经验」列表（左栏）', () => {
  /** 经验条目（只给被测字段，其余为契约最小缺省）。 */
  function experienceEntry(id: string, responsibility: string, principle: string, active = true): LeftPanelProps['experiences'][number] {
    return {
      id, active, experienceType: 'agent', responsibility,
      taskType: '软件开发', decisionDomain: '实现取舍', situation: `情境：${id}`,
      trigger: `信号：${id}`, principle, recommendedAction: `行动：${id}`,
      exclusions: [], evidence: [], taskRetrievalText: `任务投影：${id}`,
      decisionRetrievalText: `决策投影：${id}`, sourceRunId: 'run-1',
      generationPromptId: 'prompt-1', generationPromptVersion: 'v1', createdAt: 1, updatedAt: 1,
    }
  }

  it('活跃 / 历史两栏；卡片主行为责任范围、副行为原则', async () => {
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'data',
      experiences: [
        experienceEntry('ex-1', '重构旧模块', '先补测试再重构'),
        experienceEntry('ex-2', '归档的责任', '已归档的原则', false),
      ],
    }))
    const groups = Array.from(document.querySelectorAll('.wf-docgroup')).map((group) => group.textContent)
    expect(groups[0]).toContain(zh.experienceActiveSection)
    expect(groups[1]).toContain(zh.experienceHistorySection)
    const card = document.querySelector('.wf-docitem')!
    expect(card.querySelector('.wf-docitem__label')?.textContent).toBe('重构旧模块')
    expect(card.querySelector('.wf-docitem__path')?.textContent).toBe('先补测试再重构')
  })

  it('经验卡片：pointerdown 挂载的 payload 无拖入回调，点击只打开属性栏', async () => {
    const onOpenExperience = vi.fn()
    const onBeginDrag = vi.fn()
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'data',
      experiences: [experienceEntry('ex-1', '责任一', '原则一')],
      onOpenExperience,
      onBeginDrag,
    }))
    const card = document.querySelector('.wf-docitem') as HTMLButtonElement
    await act(async () => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, button: 0 }))
    })
    expect(onBeginDrag).toHaveBeenCalledTimes(1)
    const payload = onBeginDrag.mock.calls[0]![1] as DragPayload
    expect(payload.label).toBe('责任一')
    // 经验没有画布形态：payload 不提供任何落点回调（点击才是唯一入口）
    expect(payload.onDrop).toBeUndefined()
    await act(async () => { payload.onClick() })
    expect(onOpenExperience).toHaveBeenCalledWith('ex-1')
  })
})

describe('分栏标题排版（折叠箭头右置，用户批注）', () => {
  it('历史分栏：标题在前、箭头在后（标题左边缘与不可折叠分栏对齐）', async () => {
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists(
        { workflows: [{ assetId: 'a-1', versionId: 1, name: '活跃资产', description: '', updatedAt: 1 }] },
        { retiredWorkflows: [{ assetId: 'a-old', versionId: 1, name: '归档资产', description: '', updatedAt: 1 }] },
      ),
    }))
    const group = document.querySelectorAll('.wf-docgroup')[1]
    const toggle = group.querySelector('.wf-docgroup__toggle')!
    // DOM 顺序即视觉顺序：标题是首个元素、箭头是末个元素（CSS 再把箭头推到最右）
    expect(toggle.firstElementChild?.className).toBe('wf-docgroup__title')
    expect(toggle.lastElementChild?.className).toBe('wf-docgroup__caret')
    expect(toggle.firstElementChild?.textContent).toBe(zh.assetHistorySection)
  })
})

describe('历史资产分栏折叠（左栏）', () => {
  it('默认折叠：标题可点、卡片不渲染、标题旁显示命中数', async () => {
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists({}, { retiredWorkflows: [{ assetId: 'a-old', versionId: 1, name: '归档资产', description: '', updatedAt: 1 }] }),
    }))

    const toggle = document.querySelector('.wf-docgroup__toggle') as HTMLButtonElement
    expect(toggle.textContent).toContain(zh.assetHistorySection)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.wf-docgroup__count')?.textContent).toBe('1')
    // 折叠 = 卡片隐藏（资产本身仍被搜索/列表持有，只是当前不渲染）
    expect(Array.from(document.querySelectorAll('.wf-docitem')).map((item) => item.textContent)).not.toContain('归档资产')
  })

  it('点击标题展开：渲染历史资产卡片，再次点击收起', async () => {
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists({}, { retiredWorkflows: [{ assetId: 'a-old', versionId: 1, name: '归档资产', description: '', updatedAt: 1 }] }),
    }))
    const toggle = document.querySelector('.wf-docgroup__toggle') as HTMLButtonElement

    await act(async () => { toggle.click() })
    expect(document.querySelector('.wf-docgroup__toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(Array.from(document.querySelectorAll('.wf-docitem')).map((item) => item.textContent?.includes('归档资产'))).toContain(true)

    await act(async () => { (document.querySelector('.wf-docgroup__toggle') as HTMLButtonElement).click() })
    expect(document.querySelector('.wf-docgroup__toggle')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('活跃资产卡片仍在历史分栏之上渲染（归档只是转移，不是消失）', async () => {
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists(
        { workflows: [{ assetId: 'a-1', versionId: 2, name: '活跃资产', description: '', updatedAt: 2 }] },
        { retiredWorkflows: [{ assetId: 'a-old', versionId: 1, name: '归档资产', description: '', updatedAt: 1 }] },
      ),
    }))
    const labels = Array.from(document.querySelectorAll('.wf-docgroup')).map((group) => group.textContent)
    expect(labels[0]).toContain(zh.assetActiveSection)
    expect(labels[1]).toContain(zh.assetHistorySection)
    expect(document.querySelector('.wf-docitem')?.textContent).toContain('活跃资产')
  })
})

describe('资产卡片交互（左栏）', () => {
  it('工作流资产卡片：pointerdown 挂载拖拽 payload（label = 资产名）', async () => {
    const onBeginDrag = vi.fn()
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists({ workflows: [{ assetId: 'a-1', versionId: 1, name: '资产一', description: '', updatedAt: 1 }] }),
      onBeginDrag,
    }))
    const card = document.querySelector('.wf-docitem') as HTMLButtonElement
    expect(card.textContent).toContain('资产一')
    await act(async () => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, button: 0 }))
    })
    expect(onBeginDrag).toHaveBeenCalledTimes(1)
    expect((onBeginDrag.mock.calls[0]![1] as { label: string }).label).toBe('资产一')
  })
})

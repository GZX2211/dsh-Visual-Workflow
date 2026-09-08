// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/useWorkbenchView.test.ts
//
// 工作台视图模式状态机（图1/图2 交互改造）：
//   纯函数（视图模式/分栏宽度 读写与钳制）；DOM 注入（分栏窗格进入/退出、侧边栏入口构建）；
//   hook 层（open 默认 float、toggle 持久化 split、openWorkbench 按持久化模式展开）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  readViewMode,
  writeViewMode,
  readSplitWidth,
  writeSplitWidth,
  clampSplitWidth,
  buildSidebarEntryButton,
  enterSplit,
  exitSplit,
  useWorkbenchView,
  VIEW_MODE_KEY,
  SPLIT_WIDTH_KEY,
  SPLIT_WIDTH_DEFAULT,
  SPLIT_WIDTH_MIN,
  SPLIT_WIDTH_MAX,
  type WorkbenchViewMode,
} from '../../src/client/studio/useWorkbenchView.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
})

function memStorage(initial: Record<string, string> = {}): { store: Record<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const store = { ...initial }
  return {
    store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
  }
}

describe('视图模式读写', () => {
  it('空/损坏/未知 → float；split → split', () => {
    expect(readViewMode(memStorage())).toBe('float')
    expect(readViewMode(memStorage({ [VIEW_MODE_KEY]: 'whatever' }))).toBe('float')
    expect(readViewMode(memStorage({ [VIEW_MODE_KEY]: 'split' }))).toBe('split')
  })

  it('写入后可读回', () => {
    const s = memStorage()
    writeViewMode(s, 'split')
    expect(s.store[VIEW_MODE_KEY]).toBe('split')
    expect(readViewMode(s)).toBe('split')
  })
})

describe('分栏宽度读写与钳制', () => {
  it('空/损坏 → 默认值', () => {
    expect(readSplitWidth(memStorage())).toBe(SPLIT_WIDTH_DEFAULT)
    expect(readSplitWidth(memStorage({ [SPLIT_WIDTH_KEY]: 'abc' }))).toBe(SPLIT_WIDTH_DEFAULT)
    expect(readSplitWidth(memStorage({ [SPLIT_WIDTH_KEY]: '0' }))).toBe(SPLIT_WIDTH_DEFAULT)
  })

  it('合法值读取（四舍五入）', () => {
    const s = memStorage({ [SPLIT_WIDTH_KEY]: '700' })
    expect(readSplitWidth(s)).toBe(700)
  })

  it('钳制到 [MIN, MAX]', () => {
    expect(clampSplitWidth(SPLIT_WIDTH_MIN - 50)).toBe(SPLIT_WIDTH_MIN)
    expect(clampSplitWidth(SPLIT_WIDTH_MAX + 50)).toBe(SPLIT_WIDTH_MAX)
    expect(clampSplitWidth(640)).toBe(640)
    expect(writeSplitWidth(memStorage(), SPLIT_WIDTH_MAX + 999)).toBeUndefined()
  })
})

describe('侧边栏入口按钮构建', () => {
  it('结构：class/data/aria + 图标 + 文本（三横线SVG）', () => {
    const btn = buildSidebarEntryButton('工作流')
    expect(btn.className).toContain('wf-sidebar-entry')
    expect(btn.dataset.wfEntry).toBe('workflow')
    expect(btn.getAttribute('aria-label')).toBe('工作流')
    expect(btn.textContent).toContain('工作流')
    expect(btn.querySelector('svg')).toBeTruthy()
    expect(btn.querySelectorAll('svg path').length).toBe(1)
  })

  it('样式自持：不再复制官方 className，入口仅 wf-sidebar-entry（样式由 button.wf-sidebar-entry 复刻官方 trigger，避免外圈边框/发光）', () => {
    const official = document.createElement('button')
    official.className = 'VOzbGW_trigger ds-x'
    const btn = buildSidebarEntryButton('工作流', official)
    expect(btn.className).toBe('wf-sidebar-entry')
  })

  it('未传官方按钮时仅保留 wf-sidebar-entry 标记', () => {
    const btn = buildSidebarEntryButton('工作流')
    expect(btn.className).toBe('wf-sidebar-entry')
  })
})

describe('分栏 DOM 注入（不修改官方 frame 网格）', () => {
  function makeCenterCol(): HTMLDivElement {
    const cc = document.createElement('div')
    cc.className = 'pI_x6G_centerCol'
    document.body.append(cc)
    return cc
  }

  it('enterSplit 给官方对话主列设右内边距并写入 :root 分栏宽度变量', () => {
    const cc = makeCenterCol()
    enterSplit(cc, 640)
    expect(cc.style.paddingRight).toBe('640px')
    expect(document.documentElement.style.getPropertyValue('--wf-split-w')).toBe('640px')
  })

  it('exitSplit 还原对话主列右内边距与 :root 变量', () => {
    const cc = makeCenterCol()
    enterSplit(cc, 500)
    exitSplit()
    expect(cc.style.paddingRight).toBe('')
    expect(document.documentElement.style.getPropertyValue('--wf-split-w')).toBe('')
  })
})

describe('入口文案跟随语言', () => {
  /** 构造官方侧边栏「设置」按钮锚点结构（footArea > settingsArea > button）。 */
  function seedSettingsArea(): void {
    const foot = document.createElement('div')
    foot.className = 'footArea'
    const area = document.createElement('div')
    area.className = 'settingsArea'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'trigger'
    btn.innerText = '设置'
    area.append(btn)
    foot.append(area)
    document.body.append(foot)
  }

  /** 用 label 驱动 useWorkbenchView（模拟语言切换传入不同入口文案）。 */
  function LabelProbe({ label }: { label: string }) {
    useWorkbenchView(label)
    return null
  }

  it('label 变化时更新已注入按钮的文本与 aria（入口文案不因语言切换残留中文）', async () => {
    seedSettingsArea()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    cleanups.push(() => { root.unmount() })
    await act(async () => { root.render(<LabelProbe label="工作流" />) })
    const entry = document.querySelector('.wf-sidebar-entry') as HTMLButtonElement
    expect(entry).toBeTruthy()
    expect(entry.querySelector('.wf-sidebar-entry__label')?.textContent).toBe('工作流')
    expect(entry.getAttribute('aria-label')).toBe('工作流')
    // 语言切到 en → label 变化 → effect 就地更新按钮文案
    await act(async () => { root.render(<LabelProbe label="Workflows" />) })
    expect(entry.querySelector('.wf-sidebar-entry__label')?.textContent).toBe('Workflows')
    expect(entry.getAttribute('aria-label')).toBe('Workflows')
  })
})

describe('hook：open/toggle/openWorkbench', () => {
  function Probe() {
    const v = useWorkbenchView()
    return (
      <div>
        <button className="probe-open" onClick={v.openWorkbench}>open</button>
        <button className="probe-toggle" onClick={v.toggleView}>toggle</button>
        <span className="probe-mode">{v.viewMode}</span>
        <span className="probe-split">{v.splitWidth}</span>
      </div>
    )
  }

  function mountProbe(): Root {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    cleanups.push(() => { root.unmount() })
    return root
  }

  it('默认 float；open 不改变模式；toggle 切 split 并持久化', async () => {
    const root = mountProbe()
    await act(async () => { root.render(<Probe />) })
    // 默认 float
    expect(document.querySelector('.probe-mode')?.textContent).toBe('float')
    // open 后模式仍 float（持久化默认 float）
    await act(async () => { (document.querySelector('.probe-open') as HTMLButtonElement).click() })
    expect(document.querySelector('.probe-mode')?.textContent).toBe('float')
    // toggle → split
    await act(async () => { (document.querySelector('.probe-toggle') as HTMLButtonElement).click() })
    expect(document.querySelector('.probe-mode')?.textContent).toBe('split')
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe('split')
  })

  it('持久化为 split 后，openWorkbench 按记忆模式展开为 split', async () => {
    localStorage.setItem(VIEW_MODE_KEY, 'split')
    const root = mountProbe()
    await act(async () => { root.render(<Probe />) })
    await act(async () => { (document.querySelector('.probe-open') as HTMLButtonElement).click() })
    expect(document.querySelector('.probe-mode')?.textContent).toBe('split')
  })
})

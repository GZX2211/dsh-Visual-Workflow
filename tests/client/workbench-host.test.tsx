// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/workbench-host.test.tsx
//
// 工作台入口「退出后重进」状态保留回归测试（用户裁决，与「切换窗口」同根因）：
//   - BUG 背景：WorkbenchHost 旧实现 `if (!view.open) return null`，关闭工作台
//     即卸载整个 WorkbenchFrame + Studio 子树；再次点击入口进入时重挂载，
//     画布内容/布局/未保存修改/运行回显/「开启新会话」选项等全部内存状态丢失。
//   - 修复：首次打开前不挂载（everOpened 延迟挂载，首进即默认状态），打开过后
//     工作台常驻挂载，关闭仅向 WorkbenchFrame 传 hidden（外壳 display:none）。
//   - 本测试断言：① 开→关→开 往返中 Studio 内容 DOM 节点恒等（未卸载重建）；
//     ② 「开启新会话」复选框 + 工作区路径在关闭重开后原样保留（并已落盘
//     localStorage，instanceOptions 缓存双保险）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply } from '../../src/client/entry.js'
import { zh } from '../../src/client/i18n.js'
import { INSTANCE_OPTIONS_KEY } from '../../src/client/studio/instance-options.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** 入口 fake ctx（仿 entry.test：effect 立即执行收集 disposer；sessions 可注入）。 */
function makeCtx(options: { currentSession?: string } = {}) {
  const disposers: Array<() => void> = []
  const locale = { register: vi.fn(), language: 'zh-CN' }
  const sessions = {
    list: {
      get: () => ({ current: options.currentSession ?? 'session-1' }),
      subscribe: vi.fn(() => () => {}),
    },
  }
  const ctx = {
    get: (name: string) => (name === 'locale' ? locale : name === 'sessions' ? sessions : null),
    effect: (fn: () => void | (() => void)) => {
      const result = fn()
      if (typeof result === 'function') disposers.push(result)
      return undefined
    },
    slots: {
      inject: vi.fn(),
      register: vi.fn(() => () => {}),
    },
  }
  return { ctx, disposers }
}

/** 模拟官方侧边栏底部「设置」按钮（useWorkbenchView 在其上方注入插件入口）。 */
function seedSettingButton(): void {
  const wrap = document.createElement('div')
  wrap.className = 'ds-x-settingsArea'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ds-x-trigger'
  btn.innerText = '设置'
  wrap.append(btn)
  document.body.append(wrap)
}

/** 挂载插件并返回侧边栏入口按钮。 */
async function mountPlugin(): Promise<HTMLButtonElement> {
  seedSettingButton()
  const { ctx, disposers } = makeCtx()
  cleanups.push(() => { while (disposers.length > 0) disposers.pop()!() })
  await act(async () => { apply(ctx as never) })
  const entry = document.querySelector('.wf-sidebar-entry') as HTMLButtonElement
  expect(entry).toBeTruthy()
  return entry
}

/** 点击侧边栏入口（开/关切换）。 */
async function clickEntry(entry: HTMLButtonElement): Promise<void> {
  await act(async () => { entry.click() })
}

/** 新建工作流模板草稿（点击工作流 tab 分区 ＋ 按钮；进入模板态）。 */
async function createDraft(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
  })
}

describe('工作台入口「退出后重进」：关闭隐藏不卸载（状态全保留）', () => {
  it('未打开不挂载（延迟）；开→关→开 往返：Studio 内容节点恒等、关闭仅 display:none', async () => {
    const entry = await mountPlugin()
    // 从未打开：宿主零工作台 DOM（首进前不挂载，保持旧行为）
    expect(document.querySelector('.wf-window')).toBeNull()

    // 首次打开：工作台挂载（默认状态装配）
    await clickEntry(entry)
    const shell = document.querySelector('.wf-window') as HTMLElement
    expect(shell).toBeTruthy()
    expect(shell.style.display).not.toBe('none')
    const content1 = document.querySelector('.wf-frame-content')
    const toolbar1 = document.querySelector('.wf-toolbar')
    expect(content1).toBeTruthy()
    expect(toolbar1).toBeTruthy()

    // 关闭（侧边栏入口再次点击）：外壳 display:none，**内容不卸载**（节点仍挂载于 DOM）
    await clickEntry(entry)
    expect(shell.style.display).toBe('none')
    expect(document.querySelector('.wf-frame-content')).toBe(content1)
    expect(document.querySelector('.wf-toolbar')).toBe(toolbar1)

    // 重进：同一节点恢复显示（未重建 → 一切状态原样保留）
    await clickEntry(entry)
    expect(shell.style.display).not.toBe('none')
    expect(document.querySelector('.wf-frame-content')).toBe(content1)
    expect(document.querySelector('.wf-toolbar')).toBe(toolbar1)
    // Studio 标题顶栏仍在（工作台完整可用）
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
  })

  it('「开启新会话」复选框 + 工作区路径：模板态勾选与输入 → 关闭重开原样保留（含 localStorage 落盘）', async () => {
    const entry = await mountPlugin()
    await clickEntry(entry)

    // 进入模板态（新建空白工作流模板草稿）→ 「开启新会话」复选框出现（仅模板态显示）
    await createDraft()
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox).toBeTruthy()

    // 勾选「开启新会话」→ 工作区输入框出现；输入路径（受控 input 用原生 value setter）
    await act(async () => { checkbox!.click() })
    const workspace = document.querySelector<HTMLInputElement>('.wf-toolbar__workspace')
    expect(workspace).toBeTruthy()
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(workspace, 'C:/work/ws')
      workspace!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 已落盘 localStorage（instanceOptions 缓存）
    const cached = JSON.parse(localStorage.getItem(INSTANCE_OPTIONS_KEY) ?? '{}') as { newSession?: boolean; workspacePath?: string }
    expect(cached.newSession).toBe(true)
    expect(cached.workspacePath).toBe('C:/work/ws')

    // 关闭 → 重开：复选框勾选 + 路径原样保留（内存状态未丢失）
    await clickEntry(entry)
    expect((document.querySelector('.wf-window') as HTMLElement).style.display).toBe('none')
    await clickEntry(entry)
    const checkbox2 = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox2).toBeTruthy()
    expect(checkbox2!.checked).toBe(true)
    const workspace2 = document.querySelector<HTMLInputElement>('.wf-toolbar__workspace')
    expect(workspace2?.value).toBe('C:/work/ws')
  })

  it('宿主重建模拟（重挂载 + 缓存预置）：初始状态恢复缓存，不被初始默认值覆盖', async () => {
    // 预置缓存（模拟此前用户已勾选/输入并落盘，随后宿主被重建）
    localStorage.setItem(INSTANCE_OPTIONS_KEY, JSON.stringify({ newSession: true, workspacePath: '/tmp/ws' }))
    const entry = await mountPlugin()
    await clickEntry(entry)
    // Studio 重挂载：useStudioState 初始化工厂恢复缓存 → 落盘 effect 写回同一值；
    // 若恢复失效（state 为默认），落盘 effect 会把预置缓存覆盖为默认值 → 断言失败。
    expect(localStorage.getItem(INSTANCE_OPTIONS_KEY)).toContain('"newSession":true')
    expect(localStorage.getItem(INSTANCE_OPTIONS_KEY)).toContain('/tmp/ws')
    // 注：进入模板态（打开/新建模板）会按既有业务语义（OPEN_FLOW_TEMPLATE）重置
    // instanceOptions 为默认——「每次从模板创建实例默认不新开会话」，本用例不进入模板态。
  })
})
// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/workbench-host.test.tsx
//
// 工作台「退出后重进」状态保留回归测试（用户裁决，DSH 0.1.5-rc.1 迁移后新机制）：
//   - 迁移后官方右侧 Sidebar **只渲染激活标签页的 body**：切标签页 / 切全局面板 / 分栏 /
//     浮动都会 unmount body，close→reopen 更是全新 TabRecord。
//   - 因此 Studio 不再直接作为 body 组件，而是挂在插件自持的**常驻容器**里：
//     body 组件只负责在激活时把容器搬进自己的 DOM，卸载时交还（见 sidebar/workbench-tab.tsx）。
//   - 本测试断言：① 标签页 body 挂载/卸载往返中 Studio 内容 DOM 节点恒等（容器与子树未重建）；
//     ② 「开启新会话」复选框 + 工作区路径跨往返原样保留（并已落盘 localStorage）；
//     ③ 宿主重建模拟：instanceOptions 初始状态从缓存恢复，不被默认值覆盖。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply } from '../../src/client/entry.js'
import { zh } from '../../src/client/i18n.js'
import { INSTANCE_OPTIONS_KEY } from '../../src/client/studio/instance-options.js'
import { attachWorkbenchHost, setWorkbenchMountHost } from '../../src/client/sidebar/workbench-tab.js'
import { resetWorkbenchDictForTest } from '../../src/client/sidebar/locale-bridge.js'
import { setWorkbenchOpenHandler } from '../../src/client/sidebar/footer-entry.js'

const cleanups: Array<() => void> = []

afterEach(async () => {
  // 卸载常驻 React root 必须在 act 内（否则 React 报「update not wrapped in act」噪音）
  await act(async () => {
    while (cleanups.length > 0) cleanups.pop()!()
  })
  resetWorkbenchDictForTest()
  setWorkbenchOpenHandler(null)
  setWorkbenchMountHost(null)
  localStorage.clear()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** 入口 fake ctx（effect 立即执行收集 disposer；inject 立即运行回调；sessions/slots 可注入）。 */
function makeCtx(options: { currentSession?: string } = {}) {
  const disposers: Array<() => void> = []
  const locale = { register: vi.fn(), language: 'zh-CN' }
  const sessions = {
    list: {
      getSnapshot: () => ({ current: options.currentSession ?? 'session-1', byId: {} }),
      subscribe: vi.fn(() => () => {}),
    },
  }
  const slots = {
    inject: (_key: string, callback: () => unknown) => {
      const produced = callback()
      return typeof produced === 'function' ? (produced as () => void) : () => {}
    },
    register: () => () => {},
  }
  const services: Record<string, unknown> = {
    locale,
    sessions,
    slots,
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: vi.fn(), active: () => undefined },
    layout: { selectPanel: vi.fn() },
  }
  const ctx = {
    get: (name: string) => services[name] ?? null,
    effect: (fn: () => void | (() => void)) => {
      const result = fn()
      if (typeof result === 'function') disposers.push(result)
      return undefined
    },
    inject: (_deps: string[], callback: (scoped: unknown) => void) => {
      callback(ctx)
      return undefined
    },
  }
  return { ctx, disposers }
}

/** 装配插件并返回「标签页 body 挂载点（模拟官方 body 内的 .wf-tab-mount）」。 */
async function mountPlugin(): Promise<{ host: HTMLDivElement; attach: () => () => void }> {
  const { ctx, disposers } = makeCtx()
  cleanups.push(() => { while (disposers.length > 0) disposers.pop()!() })
  await act(async () => { apply(ctx as never) })
  const host = document.createElement('div')
  host.className = 'wf-tab-mount'
  document.body.append(host)
  return { host, attach: () => attachWorkbenchHost(host) }
}

/** 新建工作流模板草稿（点击工作流 tab 分区 ＋ 按钮；进入模板态）。 */
async function createDraft(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
  })
}

describe('标签页 body 挂载/卸载往返：常驻容器不重建（状态全保留）', () => {
  it('body 挂载 → 容器移入；卸载 → 交还 holder；Studio 内容节点恒等', async () => {
    const { host, attach } = await mountPlugin()
    const container = document.getElementById('visual-workflow-workbench-host') as HTMLElement
    const holder = document.getElementById('visual-workflow-workbench-holder') as HTMLElement
    expect(container).toBeTruthy()
    expect(container.parentElement).toBe(holder)
    // Studio 已装配（插件 apply 即就绪，不依赖标签页是否打开）
    expect(document.querySelector('.wf-titlebar__title')?.textContent).toBe(zh.studio)
    const toolbar = document.querySelector('.wf-toolbar')
    const titlebar = document.querySelector('.wf-tabs')
    expect(toolbar).toBeTruthy()
    expect(titlebar).toBeTruthy()

    // 标签页激活：body 挂载 → 容器搬入
    const detach = attach()
    expect(container.parentElement).toBe(host)
    expect(host.dataset.wfMount).toBe('held')
    expect(document.querySelector('.wf-toolbar')).toBe(toolbar)
    expect(document.querySelector('.wf-tabs')).toBe(titlebar)

    // 切到别的标签页 / 收起面板 / 关闭标签页：body 卸载 → 容器交还，但**内容不卸载**
    detach()
    expect(container.parentElement).toBe(holder)
    expect(document.querySelector('.wf-toolbar')).toBe(toolbar)
    expect(document.querySelector('.wf-tabs')).toBe(titlebar)

    // 重新激活（新建 body，模拟 close→reopen）：仍是同一容器与同一子树
    const host2 = document.createElement('div')
    host2.className = 'wf-tab-mount'
    document.body.append(host2)
    const detach2 = attachWorkbenchHost(host2)
    expect(container.parentElement).toBe(host2)
    expect(document.querySelector('.wf-toolbar')).toBe(toolbar)
    expect(document.querySelector('.wf-tabs')).toBe(titlebar)
    detach2()
  })

  it('「开启新会话」复选框 + 工作区路径：body 卸载/重载往返后原样保留（含 localStorage 落盘）', async () => {
    const { host, attach } = await mountPlugin()
    const detach = attach()

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

    // 切标签页（body 卸载）→ 切回（body 重新挂载）：选项与路径原样保留
    detach()
    expect(document.getElementById('visual-workflow-workbench-host')?.parentElement?.id).toBe('visual-workflow-workbench-holder')
    const detach2 = attachWorkbenchHost(host)
    const checkbox2 = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox2).toBeTruthy()
    expect(checkbox2!.checked).toBe(true)
    const workspace2 = document.querySelector<HTMLInputElement>('.wf-toolbar__workspace')
    expect(workspace2?.value).toBe('C:/work/ws')
    detach2()
  })

  it('宿主重建模拟（重挂载 + 缓存预置）：初始状态恢复缓存，不被初始默认值覆盖', async () => {
    // 预置缓存（模拟此前用户已勾选/输入并落盘，随后宿主被重建）
    localStorage.setItem(INSTANCE_OPTIONS_KEY, JSON.stringify({ newSession: true, workspacePath: '/tmp/ws' }))
    const { attach } = await mountPlugin()
    const detach = attach()
    // 常驻容器随之重建：useStudioState 初始化工厂恢复缓存 → 落盘 effect 写回同一值；
    // 若恢复失效（state 为默认），落盘 effect 会把预置缓存覆盖为默认值 → 断言失败。
    expect(localStorage.getItem(INSTANCE_OPTIONS_KEY)).toContain('"newSession":true')
    expect(localStorage.getItem(INSTANCE_OPTIONS_KEY)).toContain('/tmp/ws')
    detach()
  })

  it('多标签页 body 并存：容器归最新者，先前 body 标记 empty（渲染占位）', async () => {
    const { host, attach } = await mountPlugin()
    const detachA = attach()
    expect(host.dataset.wfMount).toBe('held')

    const hostB = document.createElement('div')
    hostB.className = 'wf-tab-mount'
    document.body.append(hostB)
    const detachB = attachWorkbenchHost(hostB)
    expect(hostB.dataset.wfMount).toBe('held')
    expect(host.dataset.wfMount).toBe('empty')
    expect(hostB.querySelector('#visual-workflow-workbench-host')).toBeTruthy()

    detachB()
    expect(host.dataset.wfMount).toBe('held')
    detachA()
  })
})

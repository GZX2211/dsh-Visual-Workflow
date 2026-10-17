// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/WorkbenchHost.test.tsx
//
// 工作台「退出后重进」状态保留回归测试（用户裁决，DSH 0.1.5-rc.1 迁移后新机制）：
//   - 迁移后官方右侧 Sidebar **只渲染激活标签页的 body**：切标签页 / 切全局面板 / 分栏 /
//     浮动都会 unmount body，close→reopen 更是全新 TabRecord。
//   - 因此 Studio 不再直接作为 body 组件，而是挂在插件自持的**常驻容器**里：
//     body 组件只负责在激活时把容器搬进自己的 DOM，卸载时交还（见 sidebar/workbench-tab.tsx）。
//   - 本测试断言：① 标签页 body 挂载/卸载往返中 Studio 内容 DOM 节点恒等（容器与子树未重建）；
//     ② 模板态「开启新会话」勾选后出现官方目录选择按钮（宿主无官方选择器时禁用并提示）；
//     ③ Electron preload 通道存在时按钮可用（复用官方原生目录选择器）。
//   （模板级配置持久化与选择路径链路在 workbench-global.test / useNewSessionOptions.test 覆盖。）

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { apply } from '../../../src/client/entry.js'
import { zh } from '../../../src/client/i18n.js'
import { EP } from '../../../src/client/lib/remote.js'
import { attachWorkbenchHost, setWorkbenchMountHost } from '../../../src/client/sidebar/workbench-tab.js'
import { resetWorkbenchDictForTest } from '../../../src/client/sidebar/locale-bridge.js'
import { setWorkbenchOpenHandler } from '../../../src/client/sidebar/footer-entry.js'

const cleanups: Array<() => void> = []

afterEach(async () => {
  // 卸载常驻 React root 必须在 act 内（否则 React 报「update not wrapped in act」噪音）
  await act(async () => {
    while (cleanups.length > 0) cleanups.pop()!()
  })
  vi.unstubAllGlobals()
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

/**
 * 模板保存 fetch 桩：勾选「开启新会话」会立即保存模板（真实环境走同一远端通道）。
 * 其余端点保持「网络不可用」——本文件只关心工作台 DOM 装配，不依赖列表数据。
 */
function stubTemplateSave(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === `/visual-workflow/${EP.EP_PUT_FLOW_TEMPLATE}`) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { args?: { template?: Record<string, unknown> } }
      const template = body.args?.template ?? {}
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { ...template, revision: 1 } }) }
    }
    throw new TypeError('network unavailable (test stub)')
  }))
}

/** 装配插件并返回「标签页 body 挂载点（模拟官方 body 内的 .wf-tab-mount）」。 */
async function mountPlugin(): Promise<{ host: HTMLDivElement; attach: () => () => void }> {
  stubTemplateSave()
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

  it('模板态勾选「开启新会话」→ 出现官方目录选择按钮；官方选择器缺失时禁用并提示', async () => {
    const { host, attach } = await mountPlugin()
    const detach = attach()

    // 进入模板态（新建空白工作流模板草稿）→ 「开启新会话」复选框出现（仅实例来源态显示）
    await createDraft()
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox).toBeTruthy()

    await act(async () => { checkbox!.click() })
    const pick = document.querySelector<HTMLButtonElement>('.wf-toolbar__workspace-pick')
    expect(pick).toBeTruthy()
    expect(pick!.textContent).toBe(zh.pickWorkspace)
    // 当前装配的 fake ctx 没有 uiWorkspace、jsdom 也没有 Electron preload → 不可用降级
    expect(pick!.disabled).toBe(true)
    expect(pick!.getAttribute('title')).toBe(zh.workspacePickerUnavailable)

    // 切标签页（body 卸载）→ 切回（body 重新挂载）：勾选状态仍在（常驻容器未重建）
    detach()
    expect(document.getElementById('visual-workflow-workbench-host')?.parentElement?.id).toBe('visual-workflow-workbench-holder')
    const detach2 = attachWorkbenchHost(host)
    const checkbox2 = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox2).toBeTruthy()
    expect(checkbox2!.checked).toBe(true)
    expect(document.querySelector('.wf-toolbar__workspace-pick')).toBeTruthy()
    detach2()
  })

  it('Electron preload 通道存在 → 选择按钮可用（复用官方原生目录选择器）', async () => {
    // Electron 桌面注入的窄接口（与官方 directory-picker-native 客户端同一来源）
    const holder = globalThis as Record<string, unknown>
    holder.__DSH_DIRECTORY_PICKER__ = { pick: vi.fn(async () => null) }
    try {
      const { attach } = await mountPlugin()
      const detach = attach()
      await createDraft()
      const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
      await act(async () => { checkbox!.click() })

      const pick = document.querySelector<HTMLButtonElement>('.wf-toolbar__workspace-pick')
      expect(pick).toBeTruthy()
      expect(pick!.disabled).toBe(false)
      detach()
    } finally {
      delete holder.__DSH_DIRECTORY_PICKER__
    }
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

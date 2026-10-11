// tests/client/fixtures/studio-harness.ts
//
// Studio 装配级用例的共享夹具：远端桩、挂载器、DOM 查询与指针交互原语。
//
// 为什么收敛到一处：同一套夹具此前在 studio/ 下多个文件各自复制一份，且**已经发生漂移**
// （同名 remoteStub 的端点集合 10 vs 6），导致同一组件在不同文件里处于不同的假远端环境：
// 涉及保存/运行历史的交互在子集桩里落到兜底分支而静默走另一条路径，断言却仍可能通过。
// 本文件是唯一本体，端点集合以「全集 + 用例内覆盖」表达，新增端点只需改这里一处。
//
// 使用约定：
//   - mountStudio 不自动冲刷 boot 异步链，由用例按需等待（waitForCondition / flushAsync）；
//   - deferred 用于构造「在途」场景（删除中/切换中）以验证竞态分支。

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { expect, vi } from 'vitest'
import { Studio } from '../../../src/client/studio/Studio.js'
import { zh } from '../../../src/client/i18n.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import { flushAsync, waitForCondition } from './async-flush.js'

/** 远端调用记录。 */
export interface RemoteCall {
  readonly endpoint: string
  readonly args: Record<string, unknown>
}

/** 带调用记录的远端桩（与 RemoteFace 同形）。 */
export type RemoteStub = RemoteFace & { readonly calls: RemoteCall[] }

/** 单个端点的自定义响应；返回 undefined 表示「不接管，落回默认桩」。 */
export type RemoteHandler = (args: Record<string, unknown>) => unknown

export interface RemoteStubOptions {
  readonly workflows?: readonly unknown[]
  readonly flowTemplates?: readonly unknown[]
  readonly services?: readonly unknown[]
  readonly activeRuns?: readonly unknown[]
  readonly runHistory?: readonly unknown[]
  readonly newSessionId?: string
  readonly roleTemplates?: readonly unknown[]
  readonly groupTemplates?: readonly unknown[]
  readonly presets?: readonly unknown[]
  readonly models?: readonly unknown[]
  /** 按端点覆盖（优先于上述选项与默认值）。 */
  readonly handlers?: Readonly<Record<string, RemoteHandler>>
}

/** 默认角色模板（多数用例的左侧栏基线）。 */
const DEFAULT_ROLE_TEMPLATES = [
  { id: 'r-1', kind: 'agent', name: '研究员', systemPrompt: '' },
  { id: 'r-2', kind: 'agent', name: '测试工程师', systemPrompt: '' },
  { id: 'r-3', kind: 'agent', name: '全栈开发工程师', systemPrompt: '' },
]

/** 默认协作组模板（拖入「协作组」卡建组节点）。 */
const DEFAULT_GROUP_TEMPLATES = [{ id: 'g-1', name: '协作组', collabPrompt: '' }]

/**
 * 构造远端桩：端点集合为全集（唯一本体），取值由 options 决定；
 * 未命中的端点一律返回空数组（与各用例原先的兜底一致）。
 */
export function remoteStub(options: RemoteStubOptions = {}): RemoteStub {
  const calls: RemoteCall[] = []
  const call = vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
    const safe = args ?? {}
    calls.push({ endpoint, args: safe })
    const override = options.handlers?.[endpoint]
    if (override) {
      const value = override(safe)
      if (value !== undefined) return value
    }
    if (endpoint === EP.EP_LIST_TEMPLATES) {
      const kind = String(safe.kind ?? '')
      if (kind === 'role') return options.roleTemplates ?? DEFAULT_ROLE_TEMPLATES
      if (kind === 'group') return options.groupTemplates ?? DEFAULT_GROUP_TEMPLATES
      return []
    }
    if (endpoint === EP.EP_PRESETS) return options.presets ?? [{ id: 'standard', name: '标准' }]
    if (endpoint === EP.EP_MODELS) return options.models ?? [{ provider: 'deepseek', model: 'deepseek-chat' }]
    if (endpoint === EP.EP_RUN_HISTORY) {
      return options.runHistory ?? [{ id: 'run-9', flowId: 'x', status: 'interrupted', startedAt: '2026-08-23T10:00:00.000Z', summary: '中断于节点' }]
    }
    if (endpoint === EP.EP_RUN_RESUME) return { runId: 'run-10' }
    if (endpoint === EP.EP_CREATE_SESSION) return { sessionId: options.newSessionId ?? 'session-new-1' }
    if (endpoint === EP.EP_LIST_WORKFLOWS) return options.workflows ?? []
    if (endpoint === EP.EP_LIST_SERVICES) return options.services ?? []
    if (endpoint === EP.EP_ACTIVE_RUNS) return options.activeRuns ?? []
    if (endpoint === EP.EP_PUT_WORKFLOW || endpoint === EP.EP_PUT_FLOW_TEMPLATE) {
      // 保存端点须回传完整文档（含 id/revision），否则调用方后续 openFlow 拿到缺失 id 的
      // 假对象、画布无法绑定实例（模板→实例链路依赖此回传）。
      const doc = safe.flow ?? safe.template
      return { ...(doc as object), revision: 1 }
    }
    if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return options.flowTemplates ?? []
    return []
  })
  const remote: RemoteFace = { stream: vi.fn(async () => undefined), call }
  return Object.assign(remote, { calls })
}

export interface StudioMountOptions {
  readonly sessionId?: string
  /** 挂载后冲刷 boot 异步链（列表加载 → 自动选中等多级 dispatch）。 */
  readonly flushBoot?: boolean
}

/** 在容器内挂载 Studio（container/root 由用例持有，便于 afterEach 卸载）。 */
export async function mountStudio(
  container: HTMLElement,
  setRoot: (root: Root) => void,
  remote: RemoteFace,
  options: StudioMountOptions = {},
): Promise<void> {
  await act(async () => {
    const root = createRoot(container)
    setRoot(root)
    root.render(React.createElement(Studio, { t: zh, sessionId: options.sessionId ?? 's-1', remote }))
  })
  if (options.flushBoot) {
    await waitForCondition(() => { expect(remote.call).toHaveBeenCalled() })
    await flushAsync(4)
  }
}

/** 选择器命中的元素文本列表。 */
export function textOf(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((item) => item.textContent ?? '')
}

/** pointer 点击（模拟卡片/按钮的真实点击路径）。 */
export function pointerClick(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
}

/** 按 aria-label 定位左侧栏 Tab（已图标化，文字不显示）。 */
export function libTab(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.getAttribute('aria-label') === label)
}

/**
 * 把左侧卡片拖到画布指定屏幕坐标（模拟真实拖拽路径：pointerdown → pointermove → pointerup）。
 * 画布外壳的 getBoundingClientRect 固定为 1000×1000，使坐标换算确定。
 */
export async function dragCardTo(cardText: string, clientX: number, clientY: number, cardSelector = '.wf-docitem'): Promise<void> {
  const shell = document.querySelector('.wf-canvas-shell') as HTMLElement | null
  if (shell) {
    Object.defineProperty(shell, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
  }
  const card = Array.from(document.querySelectorAll<HTMLButtonElement>(cardSelector)).find((item) => item.textContent?.includes(cardText))
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

/** 可外部落定的 Promise（构造「在途」场景）。 */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

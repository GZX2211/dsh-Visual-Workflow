// src/client/entry.ts
//
// Client 半区插件入口（DSH 0.1.5-rc.1 迁移版）：
//   1. 官方右侧 Sidebar **标签页**注册（阶段一类型 + 阶段二 body，见 sidebar/workbench-tab.tsx）；
//   2. 官方左侧边栏底部 `sidebar.footer.action` 插槽的「工作流」入口按钮（见 sidebar/footer-entry.tsx）；
//      —— 点击即展开官方右侧 Sidebar 并显示工作台（幂等聚焦，不切换收起）；
//   3. 常驻容器 + 独立 React root：Studio 永不卸载（官方只渲染激活标签页的 body，
//      直接把它作为 body 组件会在切标签页时被卸载、状态全丢）；
//   4. 样式注入（style[data-plugin]）+ i18n 注册（官方 locale 服务命名空间 visualWorkflow）。
// 卸载：样式移除、常驻容器与 root 卸载、插槽注册释放（全部经 ctx.effect）。
//
// 变更史（用户验收批注）：
//   - 2026.08.25：不再注册 conversation.view 会话页 tab，仅保留入口 + 工作台；
//   - 2026.09（本次 v0.1.5-rc.1 迁移）：删除浮窗/分栏视图模式与运行时 DOM 侧边栏注入，
//     工作台完全改为官方右侧 Sidebar 标签页；入口按钮改为官方 sidebar.footer.action 插槽。

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkbenchHost } from './studio/WorkbenchHost.js'
import { zh, en, text, detectLanguage, type Dict } from './i18n.js'
import { styles } from './styles.js'
import {
  WORKBENCH_CONTAINER_ID,
  WORKBENCH_HOLDER_ID,
  injectWorkbenchTabBody,
  registerWorkbenchTabType,
  setWorkbenchMountHost,
  workbenchTabDefinition,
  type SidebarRightTabsServiceLike,
  type SlotsServiceLike,
} from './sidebar/workbench-tab.js'
import {
  createWorkbenchOpener,
  injectWorkbenchEntry,
  setWorkbenchOpenHandler,
} from './sidebar/footer-entry.js'
import { setWorkbenchDict } from './sidebar/locale-bridge.js'
import {
  currentSessionOf,
  rootSessionIdOf,
  type SessionsServiceLike,
} from './sidebar/session-root.js'
// 全局样式占位（触发 client 构建链路的 CSS 注入机制 style[data-plugin]；真实主题样式在 styles.ts）
import './entry.css'

/** i18n 命名空间（注册进官方 locale 服务）。 */
export const I18N_NS = 'visualWorkflow'

// 会话解析缝从 entry 继续 re-export（历史导入路径不变；实现已迁至 sidebar/session-root.ts）。
export { currentSessionOf, rootSessionIdOf }
export type { SessionsServiceLike }

/** 插件 apply 上下文的最小形状（官方 client 注入的 ctx；运行时守卫）。 */
export interface ClientPluginContext {
  get?(name: string): unknown
  effect?(fn: () => (() => void) | void, label?: string): unknown
  /** cordis 子 fiber 悬挂：等服务就绪后运行回调，服务变化时卸载并重跑。 */
  inject?(deps: string[], callback: (scoped: ClientPluginContext) => void): unknown
  locale?: unknown
}

// 插件所需服务（cordis fiber inject）：
//  - locale：声明后 fiber 会**等待**官方 locale 服务（dsh-client-locale）激活后才运行 apply，
//    从而保证 apply 内 ctx.get('locale') 返回活跃的 LocaleRuntime，能 register 词典并
//    subscribe(render) 收到语言切换通知。
//  - slots / sidebarRightTabs **不列入顶层 inject**：官方插槽服务若缺失会把整个插件 park 在
//    pending（官方 boot 的 assertEntriesActive 会因此报错），且插件其余部分（数据面/样式）并不
//    依赖它们。改为在 apply 内用 ctx.inject(['slots','sidebarRightTabs'], …) 悬挂子 fiber：
//    服务就绪即注册、服务变化即卸载重跑、插件本体照常生效。
export const inject: string[] = ['locale']

/** 测试导出（client-smoke 渲染路径验证）。 */
export const VisualWorkflowView = null
export const __test = { workbenchTabDefinition, createWorkbenchOpener }

/**
 * 插件 apply 入口。
 * @param ctx - 官方 client 插件上下文（服务经 ctx.get 运行时解析）。
 */
export function apply(ctx: ClientPluginContext): void {
  // ---------- 1. 样式注入（fiber 卸载时移除） ----------
  ctx.effect?.(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'visual-workflow'
    tag.textContent = styles
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, 'visual-workflow: styles')

  // ---------- 2. i18n 注册（官方 locale 服务可用时；不可用按浏览器语言回退） ----------
  const localeService = ctx.get?.('locale') as
    | { register?(ns: string, dicts: { zh: unknown; en: unknown }): unknown; subscribe?(fn: () => void): () => void }
    | null
    | undefined
  try {
    localeService?.register?.(I18N_NS, { zh, en })
  } catch {
    // 注册失败回退自持词典（text/detectLanguage 仍可用）
  }

  // ---------- 3. 入口按钮点击处理（模块级单例，供插槽组件调用） ----------
  setWorkbenchOpenHandler(createWorkbenchOpener(ctx))
  ctx.effect?.(() => () => setWorkbenchOpenHandler(null), 'visual-workflow: entry handler')

  // ---------- 4. 官方插槽注册（等 slots / sidebarRightTabs 就绪） ----------
  const registerSlots = (scoped: ClientPluginContext): void => {
    const slots = scoped.get?.('slots') as SlotsServiceLike | null | undefined
    const tabs = scoped.get?.('sidebarRightTabs') as SidebarRightTabsServiceLike | null | undefined
    if (!slots || !tabs) return
    scoped.effect?.(() => registerWorkbenchTabType(tabs), 'visual-workflow: workbench tab type')
    scoped.effect?.(() => injectWorkbenchTabBody(slots), 'visual-workflow: workbench tab body')
    scoped.effect?.(() => injectWorkbenchEntry(slots), 'visual-workflow: sidebar entry')
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['slots', 'sidebarRightTabs'], registerSlots)
  } else {
    // 旧运行时无 ctx.inject：尽力直取（服务未就绪时静默跳过，插件其余部分不受影响）
    registerSlots(ctx)
  }

  // ---------- 5. 常驻容器 + 独立 React root（Studio 永不卸载） ----------
  // 官方右侧 Sidebar 只渲染**激活标签页**的 body：切标签页 / 切全局面板 / 分栏 / 浮动都会
  // unmount body，close→reopen 更是全新 TabRecord。把 Studio 挂在插件自持的常驻容器里，
  // body 组件只负责把容器搬进自己的 DOM（见 sidebar/workbench-tab.tsx 的挂载点注册表），
  // 即可满足「关闭仅隐藏、重进状态原样恢复」的既有需求。
  ctx.effect?.(() => {
    const holder = document.createElement('div')
    holder.id = WORKBENCH_HOLDER_ID
    const container = document.createElement('div')
    container.id = WORKBENCH_CONTAINER_ID
    holder.append(container)
    document.body.append(holder)

    // 先登记宿主，再渲染：避免 body 先于宿主就绪挂载时容器无处安放。
    setWorkbenchMountHost({ holder, container })

    const root: Root = createRoot(container)
    // 语言切换响应式：重算词典 → 广播给全部工作台 React 树（常驻 Studio + 插槽入口按钮）
    // → 重新渲染。官方 locale 服务（LocaleRuntime）暴露 subscribe(fn)。
    const render = (): void => {
      const t = text(detectLanguage(ctx.get?.('locale'))) as Dict
      setWorkbenchDict(t)
      root.render(React.createElement(WorkbenchHost, { ctx, t }))
    }
    render()
    const unsubscribe = typeof localeService?.subscribe === 'function' ? localeService.subscribe(render) : undefined

    return () => {
      unsubscribe?.()
      // 先摘除挂载点登记：此后标签页 body 的卸载回调不再搬运容器。
      setWorkbenchMountHost(null)
      root.unmount()
      holder.remove()
    }
  }, 'visual-workflow: workbench host')
}

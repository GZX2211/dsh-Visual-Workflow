// src/client/sidebar/workbench-tab.tsx
//
// 工作台 → 官方右侧 Sidebar 标签页（DSH 0.1.5-rc.1 迁移核心）。
//
// 官方两阶段注册（取证：dsh-client-ui-sidebar-right 的 tab-registry 与 sidebar.right.pane.tab 插槽）：
//   阶段一：类型「是什么」—— ctx.sidebarRightTabs.register({ id, kind, priority, title, … })；
//   阶段二：类型「画什么」—— keyed 插槽 sidebar.right.pane.tab 下按 **id** 注册 body 组件。
//   ⚠️ body / title 的注册 key 必须用定义里的 `id`，不是 `kind`
//      （官方 dsh-client-ui-sidebar-files：FILES_ID ≠ FILES_KIND；调度侧 entryKey = definition.id）。
//
// 为什么 body 只承载一个「常驻容器」：
//   官方右侧 Sidebar **只渲染当前激活标签页的 body**（dockkit 的 paneBody 里只有 activeTab 一个
//   节点），切标签页 / 切全局面板 / 分栏 / 浮动都会 unmount body，close→reopen 更是全新的
//   TabRecord。若把 Studio 直接作为 body 组件渲染，用户既有需求「关闭仅隐藏、重进状态原样恢复」
//   必然被破坏。故沿用插件原有的「常驻容器 + 独立 React root」架构：Studio 挂在插件自持的
//   容器里永不卸载，body 组件只负责在激活时把该容器搬进自己的 DOM（卸载时搬回隐藏 holder）。
//
// 多 body 并存（分栏 / 多会话）时的归属：**最新挂载者持有**，其余渲染占位提示。

import { useLayoutEffect, useRef } from 'react'
import { getWorkbenchDict, useWorkbenchDict } from './locale-bridge.js'

/** 本实现在标签页系统中的唯一身份；同时是 body / title 插槽的注册 key。 */
export const WORKBENCH_TAB_ID = 'dsh-visual-workflow'
/** 页面类型的类型判别符（`ctx.sidebarRight.openTab(kind)` 用它打开）。 */
export const WORKBENCH_TAB_KIND = 'visual-workflow'
/** body 注册的插槽 key。 */
export const WORKBENCH_TAB_SLOT = 'sidebar.right.pane.tab'

/** 常驻容器的 DOM id（entry.ts 创建；样式在 styles.ts）。 */
export const WORKBENCH_CONTAINER_ID = 'visual-workflow-workbench-host'
/** 常驻容器的隐藏持有者 id（无标签页持有容器时容器回到这里）。 */
export const WORKBENCH_HOLDER_ID = 'visual-workflow-workbench-holder'

/** 标签页类型定义（提交给 ctx.sidebarRightTabs.register 的纯数据）。 */
export interface WorkbenchTabDefinition {
  /** 实现身份（唯一）；body / title 插槽按它注册。 */
  id: string
  /** 类型判别符；`openTab` 用它打开。 */
  kind: string
  /** 优先级带。 */
  priority: 'extension' | 'builtin' | 'fallback'
  /**
   * 标签 chip 的初始标题（打开时被捕获进布局记录）。
   * 官方文档明确：thunk 每次投影都重新读取，故语言切换无需重新注册 —— 这里读取
   * 模块级词典桥的当前值，天然跟随语言切换。
   */
  title: () => string
}

/**
 * 构造标签页类型定义。
 *
 * - 不写 `patterns` → 页面类型（按 kind 打开，不参与资源地址认领，绝不会抢官方文件预览）；
 * - 不写 `guide` → **刻意**：官方 `defaultSeed` 按 guide 条目总数决定新面板的默认页，
 *   当前随包组合只有「文件」1 条；再加一条会把新面板默认页从「文件」变成 guide 页，
 *   属改变官方既有行为。工作台改由插件入口按钮打开。
 * @returns 类型定义（每次调用返回新对象；title 为读取词典桥的 thunk）。
 */
export function workbenchTabDefinition(): WorkbenchTabDefinition {
  return {
    id: WORKBENCH_TAB_ID,
    kind: WORKBENCH_TAB_KIND,
    priority: 'builtin',
    title: () => getWorkbenchDict().workflows,
  }
}

// ---------------------------------------------------------------------------
// 常驻容器注册表
// ---------------------------------------------------------------------------

/** 常驻容器的宿主信息（holder = 无标签页持有时容器所在处）。 */
export interface WorkbenchMountHost {
  /** 隐藏持有者：无存活标签页 body 时容器停放于此（display:none）。 */
  holder: HTMLElement
  /** 常驻容器：内部是独立的 React root（Studio 永不卸载）。 */
  container: HTMLElement
}

/** 当前常驻容器宿主（entry.ts 在 apply 时设置，卸载时清空）。 */
let mountHost: WorkbenchMountHost | null = null

/** 存活的标签页 body 挂载点（按挂载先后排序；末位为「最新挂载者」）。 */
const liveHosts: HTMLElement[] = []

/**
 * 设置（或清空）常驻容器宿主。
 * @param host - 宿主信息；null 表示插件卸载（清空全部挂载点登记）。
 */
export function setWorkbenchMountHost(host: WorkbenchMountHost | null): void {
  mountHost = host
  liveHosts.length = 0
  if (host !== null) placeWorkbenchContainer()
}

/** 测试用：读取当前宿主（null 表示未初始化）。 */
export function getWorkbenchMountHost(): WorkbenchMountHost | null {
  return mountHost
}

/**
 * 登记一个标签页 body 挂载点并接管常驻容器；返回注销（body 卸载时调用）。
 * @param host - body 内的挂载点元素。
 * @returns 注销函数（把容器交还给下一个存活挂载点或隐藏 holder）。
 */
export function attachWorkbenchHost(host: HTMLElement): () => void {
  if (!liveHosts.includes(host)) liveHosts.push(host)
  placeWorkbenchContainer()
  return () => {
    const at = liveHosts.indexOf(host)
    if (at >= 0) liveHosts.splice(at, 1)
    if (host.dataset.wfMount !== undefined) delete host.dataset.wfMount
    placeWorkbenchContainer()
  }
}

/**
 * 把常驻容器安置到「最新挂载的存活 body」；无存活 body 时放回隐藏 holder。
 * 同时给每个挂载点打 `data-wf-mount`（held / empty），供 CSS 控制占位提示的显示。
 * 只写 DOM、不触发 React 状态更新（挂载/卸载本身已由 React 驱动）。
 */
function placeWorkbenchContainer(): void {
  const mount = mountHost
  if (mount === null) return
  // 剔除已脱离文档的挂载点（React 卸载 wrapper 但注销回调未及执行时的兜底）
  for (let index = liveHosts.length - 1; index >= 0; index -= 1) {
    if (!liveHosts[index].isConnected) liveHosts.splice(index, 1)
  }
  const target = liveHosts.length > 0 ? liveHosts[liveHosts.length - 1] : mount.holder
  if (mount.container.parentElement !== target) target.append(mount.container)
  for (const host of liveHosts) {
    host.dataset.wfMount = host.contains(mount.container) ? 'held' : 'empty'
  }
}

/**
 * 测试用：读取当前是否有挂载点登记（判定「谁持有容器」）。
 * @returns 存活挂载点数量。
 */
export function liveWorkbenchHostCount(): number {
  return liveHosts.length
}

// ---------------------------------------------------------------------------
// 标签页 body
// ---------------------------------------------------------------------------

/**
 * 工作台标签页 body：只承载常驻容器。
 * - 激活时把常驻容器移入本节点（Studio 立即可见，且**从未卸载**，状态原样）；
 * - 卸载时把容器交还（下一个存活 body，或隐藏 holder）；
 * - 未持有容器时（多 body 并存）显示占位提示，避免出现「空白面板」。
 */
export function WorkbenchTabBody() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // 订阅词典：语言切换时占位提示跟随变化
  const dict = useWorkbenchDict()
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    return attachWorkbenchHost(host)
  }, [])
  return (
    <div className="wf-tab-mount" ref={hostRef}>
      <div className="wf-tab-mount__placeholder">{dict.workbenchInUse}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 运行联动：官方右侧 Sidebar 全屏缩回
// ---------------------------------------------------------------------------

/**
 * 若官方右侧 Sidebar 处于**全屏**展示，则点击官方自己的展示模式切换按钮把它缩回；
 * 非全屏时保持原状（返回 false，不做任何事）。
 *
 * 为什么用 DOM 点击而不是 API：官方 `ctx.sidebarRight`（ISidebarRight）**没有**任何
 * fullscreen 方法（只有 isExpanded / toggleExpanded，官方注释明确「presentation switch
 * 是面板自己的控件，不属于该 face」）；`ctx.layout.openRightbar(track, fullscreen)` 是
 * 面板 seat **向** layout frame 的单向上报通道，反向调用会与 seat 的下一次上报互相打架。
 * 故采用官方自带的自动化属性：面板元素带 `data-sidebar-right-panel="fullscreen"` 表示
 * 处于全屏，此时其模式按钮带 `data-sidebar-right-mode="push"`（该属性恒为「下一个模式」）。
 *
 * @returns 是否执行了缩回（true = 曾处于全屏且已点击；false = 非全屏或未找到按钮）。
 */
export function shrinkOfficialSidebarIfFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  try {
    if (document.querySelector('[data-sidebar-right-panel="fullscreen"]') === null) return false
    const button = document.querySelector('[data-sidebar-right-mode="push"]') as { click?: () => void } | null
    if (button === null || typeof button.click !== 'function') return false
    button.click()
    return true
  } catch {
    // 官方结构变化等异常：静默降级（仅影响「运行」时的沉浸式体验，不影响运行本身）
    return false
  }
}

// ---------------------------------------------------------------------------
// 官方服务最小形状与注册装配（零官方包运行时依赖）
// ---------------------------------------------------------------------------

/** slots 服务最小形状（0.1.5-rc.1 官方形态）。 */
export interface SlotsServiceLike {
  /** 等待插槽被声明后安装贡献；callback 必须**返回**其 disposer。 */
  inject?(key: string, callback: () => unknown): unknown
  /** 注册组件到某插槽。 */
  register?(options: Record<string, unknown>, component: unknown): unknown
}

/** sidebarRightTabs 服务最小形状（阶段一注册表）。 */
export interface SidebarRightTabsServiceLike {
  register(definition: unknown): () => void
}

/** 把 invoke 结果（可能是函数 / 迭代器 / undefined）收窄为可调用 disposer。 */
function toDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => {}
}

/**
 * 阶段一：注册工作台标签页类型。
 * @param tabs - ctx.sidebarRightTabs。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export function registerWorkbenchTabType(tabs: SidebarRightTabsServiceLike): () => void {
  return toDisposer(tabs.register(workbenchTabDefinition()))
}

/**
 * 阶段二：把 body 注册进 keyed 插槽 `sidebar.right.pane.tab`（key = 类型定义的 id）。
 * @param slots - ctx.slots。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export function injectWorkbenchTabBody(slots: SlotsServiceLike): () => void {
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {}
  const dispose = slots.inject(WORKBENCH_TAB_SLOT, () =>
    // ⚠️ 必须 return：漏掉返回值会导致插件卸载时 body 注册不被清理（官方参考实现同款写法）。
    slots.register!({ name: WORKBENCH_TAB_SLOT, key: WORKBENCH_TAB_ID }, WorkbenchTabBody),
  )
  return toDisposer(dispose)
}

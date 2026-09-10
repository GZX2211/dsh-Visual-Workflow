// src/client/sidebar/footer-entry.tsx
//
// 工作台入口按钮 → 官方 `sidebar.footer.action` 插槽（DSH 0.1.5-rc.1 迁移）。
//
// 迁移前：入口按钮由 MutationObserver 观察 body 结构、按 CSS-module 类名子串找官方「设置」
// 按钮，再手工 insertBefore 注入 —— 官方侧边栏结构一变即失效（0.1.2 → 0.1.5 已发生过一次）。
// 迁移后：注册进官方一等公民插槽 `sidebar.footer.action`（list 型，root 作用域；
// 官方随包的 Cordis 面板按钮用的就是它），由官方负责位置、折叠态与样式上下文。
//
// 点击语义（用户裁决）：**幂等聚焦** —— 每次点击 = 展开官方右侧 Sidebar + 打开/聚焦工作台
// 标签页；不切换收起（收起由官方自带的折叠控件与标签页关闭按钮负责）。

import { WORKBENCH_TAB_KIND, type SlotsServiceLike } from './workbench-tab.js'
import { getWorkbenchDict, useWorkbenchDict } from './locale-bridge.js'

/** 入口按钮注册的插槽 key。 */
export const WORKBENCH_ENTRY_SLOT = 'sidebar.footer.action'
/** 入口按钮在插槽内的排序（升序；官方随包条目在侧边栏底部「设置」旁）。 */
export const WORKBENCH_ENTRY_ORDER = 100

// ---------------------------------------------------------------------------
// 点击处理（模块级单例）
// ---------------------------------------------------------------------------
// 组件由官方 slot 框架挂载（与 entry.ts 的 React root 不是同一棵树），拿不到 apply 闭包里的
// ctx。故把点击处理注册为模块级单例：entry.ts 在 apply 时设置，卸载时清空。
// 这与 locale-bridge 的模块级词典同源 —— 官方文档也明确 thunk 类只读值「每次使用重新读取」，
// 模块级可变单例正是这类跨树只读值的标准承载方式。

let openHandler: (() => void) | null = null

/**
 * 设置入口按钮的点击处理。
 * @param handler - 处理函数；null 表示插件卸载（按钮点击变为无操作）。
 */
export function setWorkbenchOpenHandler(handler: (() => void) | null): void {
  openHandler = handler
}

/** 测试用：读取当前点击处理。 */
export function getWorkbenchOpenHandler(): (() => void) | null {
  return openHandler
}

/** 官方右侧 Sidebar 服务的最小形状（ISidebarRight 的运行时守卫子集）。 */
export interface SidebarRightLike {
  /** 按 kind 打开页面类型；会自动展开列并在目标 pane 内去重聚焦。 */
  openTab?(kind: string, options?: unknown): void
  /** 当前是否有挂载的会话面板（无 seat 时 undefined）。 */
  active?(): unknown
}

/** 官方 layout 服务的最小形状（仅用于「先回到会话界面」的兜底导航）。 */
export interface LayoutLike {
  /** 选中全局面板；null = 回到会话界面。 */
  selectPanel?(panelId: unknown): void
}

/**
 * 构造入口按钮的点击处理：打开（或聚焦）工作台标签页。
 *
 * 失败模式（官方取证）：
 *   - `sidebarRight` 服务缺失（非 Web 组合）→ 静默降级，不做任何事；
 *   - 无挂载的会话 seat（首页无会话 / 用户停在某个全局面板）→ 官方 `openTab` 会抛
 *     `sidebarRight: no session surface is mounted`。此时先调 `layout.selectPanel(null)`
 *     回到会话界面（`RightbarRoot` 仅在此刻挂载 seat 子树），下一拍重试一次。
 *
 * @param ctx - 插件 apply 的上下文（`get(name)`）。
 * @returns 点击处理函数（永不抛错）。
 */
export function createWorkbenchOpener(ctx: { get?(name: string): unknown }): () => void {
  return () => {
    const sidebarRight = ctx.get?.('sidebarRight') as SidebarRightLike | null | undefined
    if (typeof sidebarRight?.openTab !== 'function') return
    try {
      sidebarRight.openTab(WORKBENCH_TAB_KIND)
      return
    } catch {
      // 无挂载 seat：走下面的兜底导航 + 重试
    }
    try {
      ;(ctx.get?.('layout') as LayoutLike | null | undefined)?.selectPanel?.(null)
    } catch {
      // layout 服务异常：忽略（重试仍会尽力）
    }
    setTimeout(() => {
      try {
        sidebarRight.openTab?.(WORKBENCH_TAB_KIND)
      } catch {
        // 重试仍失败：静默（避免把宿主异常抛进 React 事件处理）
      }
    }, 0)
  }
}

// ---------------------------------------------------------------------------
// 入口按钮组件
// ---------------------------------------------------------------------------

/** 入口按钮 props（owner props + 可选注入面）。 */
export interface WorkbenchEntryButtonProps {
  /** owner props：侧边栏是否宽屏渲染（false = 56px 折叠轨道，只显示图标）。 */
  wide?: boolean
}

/**
 * 侧边栏底部「工作流」入口按钮。
 * 展开态 = 三横线图标 + 文案；折叠态 = 仅图标（与官方「设置」按钮同级视觉）。
 */
export function WorkbenchEntryButton({ wide = true }: WorkbenchEntryButtonProps) {
  const dict = useWorkbenchDict()
  const label = dict.workflows
  return (
    <button
      type="button"
      className={wide ? 'wf-sidebar-entry' : 'wf-sidebar-entry wf-sidebar-entry--rail'}
      data-wf-entry="workflow"
      aria-label={label}
      title={label}
      onClick={() => {
        openHandler?.()
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z" />
      </svg>
      <div className="wf-sidebar-entry__label">{label}</div>
    </button>
  )
}

/**
 * 把入口按钮注册进官方 `sidebar.footer.action` 插槽。
 * @param slots - ctx.slots。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export function injectWorkbenchEntry(slots: SlotsServiceLike): () => void {
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {}
  const dispose = slots.inject(WORKBENCH_ENTRY_SLOT, () =>
    // ⚠️ 必须 return：漏掉返回值会导致插件卸载时注册不被清理。
    slots.register!(
      {
        name: WORKBENCH_ENTRY_SLOT,
        id: 'visual-workflow',
        order: WORKBENCH_ENTRY_ORDER,
        label: () => getWorkbenchDict().workflows,
      },
      WorkbenchEntryButton,
    ),
  )
  return typeof dispose === 'function' ? (dispose as () => void) : () => {}
}

// src/client/studio/useWorkbenchView.ts
//
// 工作台视图模式状态机（图2 交互改造）：
//   - 「float」：悬浮窗口（侧边栏入口 → 独立可拖/缩放窗口，覆盖于官方页面之上）。
//   - 「split」：分栏窗口（官方对话区保留左半 + 插件工作台右半，中间可拖分隔线）。
//
// 职责：
//   1. 视图模式状态（float/split）+ 持久化（localStorage view-mode）。
//   2. 分栏窗口宽度（--wf-split-w）+ 持久化（split-width）。
//   3. 官方 Web 页面 DOM 注入核心（图2 批注）：
//      - 侧边栏入口按钮（图标+「工作流」，注册到官方「设置」按钮上方、样式与其一致；
//        折叠态只显示图标）。入口内容与位置通过 MutationObserver 在官方侧边栏结构变化时
//        **幂等**地重新注入。
//      - 分栏：**不修改官方 frame 网格结构/子项归属**（实测官方 frame 含额外 handle 等
//        子项，覆盖其 grid 列会导致官方布局错位）。改为：给官方对话主列 centerCol 设
//        右内边距（让出右侧），工作台以 fixed 定位覆盖右侧。退出时还原。
//   4. 打开/关闭工作台。
//
// ⚠️ 稳定性约束：注入用的 MutationObserver **只观察 childList（结构变化），绝不观察
//   attributes**，且 place() 只在值变化时才写 className/class 与移动位置——否则 observer
//   回调改自身属性会再次触发观察，形成无限自循环，阻塞主线程导致整页崩溃（已发生过）。
//
// 运行联动（「点击运行 → 自动切分栏并折叠工作台自身左右栏」）由 Studio 层组合：
//   先调 `setViewMode('split')`，再折叠面板、再触发运行。此模块只负责模式切换与持久化。
//
// 说明：本模块只做「视图模式」与分栏 DOM 注入；不修改官方源码，仅基于运行时 DOM 注入
//   （符合 AGENTS.md「不得修改 dsh 底层核心框架，全部基于非侵入式扩展」）。

import { useCallback, useEffect, useRef, useState } from 'react'

/** 视图模式。 */
export type WorkbenchViewMode = 'float' | 'split'

/** 视图模式持久化键。 */
export const VIEW_MODE_KEY = 'visual-workflow:view-mode'
/** 分栏窗口宽度持久化键。 */
export const SPLIT_WIDTH_KEY = 'visual-workflow:split-width'
/** 分栏宽度默认值（px）。 */
export const SPLIT_WIDTH_DEFAULT = 640
/** 分栏窗格最小/最大宽度（px）。 */
export const SPLIT_WIDTH_MIN = 360
export const SPLIT_WIDTH_MAX = 1280

/** 极简存储抽象（便于单测注入 localStorage mock）。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读取视图模式（损坏/未知回退 float）。 */
export function readViewMode(storage: StorageLike): WorkbenchViewMode {
  try {
    return storage.getItem(VIEW_MODE_KEY) === 'split' ? 'split' : 'float'
  } catch {
    return 'float'
  }
}

/** 写入视图模式。 */
export function writeViewMode(storage: StorageLike, mode: WorkbenchViewMode): void {
  try {
    storage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // 忽略（隐私模式等）
  }
}

/** 读取分栏宽度（钳制到合法区间）。 */
export function readSplitWidth(storage: StorageLike): number {
  try {
    const value = Number(storage.getItem(SPLIT_WIDTH_KEY))
    if (!Number.isFinite(value) || value <= 0) return SPLIT_WIDTH_DEFAULT
    return clampSplitWidth(value)
  } catch {
    return SPLIT_WIDTH_DEFAULT
  }
}

/** 写入分栏宽度。 */
export function writeSplitWidth(storage: StorageLike, width: number): void {
  try {
    storage.setItem(SPLIT_WIDTH_KEY, String(Math.round(clampSplitWidth(width))))
  } catch {
    // 忽略
  }
}

/** 钳制分栏宽度到合法区间。 */
export function clampSplitWidth(width: number): number {
  return Math.max(SPLIT_WIDTH_MIN, Math.min(SPLIT_WIDTH_MAX, Math.round(width)))
}

// ---------------------------------------------------------------------------
// 官方 Web 页面 DOM 定位（运行时注入，不修改官方源码）
// ---------------------------------------------------------------------------
// 官方 CSS-module 前缀（pI_x6G_/hHd-Xa_/VOzbGW_ 等）为构建期 hash，但类名主体是语义的
// （frame/sidebarCol/centerCol/detailsCol/newSession/settingsArea/trigger），选择器用主体
// 子串匹配以对抗 hash 变动。已实测（playwright）：#root>div>.pI_x6G_frame{grid}
//   列: sidebarCol(280) centerCol(1160) detailsCol(0)；frame 另有 overlayLayer(absolute)、
//   handle 等子项 → 覆盖其 grid 列会与之冲突，故分栏不触碰 frame 网格。

/** 官方整体框架（frame）：sidebarCol 的父节点；grid 容器（分栏不修改它）。 */
export function officialFrame(): HTMLElement | null {
  return document.querySelector('[class*="sidebarCol"]')?.parentElement ?? null
}

/** 官方对话主区域列（centerCol）：分栏时给它设右内边距让出右侧。 */
export function officialCenterCol(): HTMLElement | null {
  return document.querySelector('[class*="centerCol"]')
}

/** 官方侧边栏底部「设置」按钮（入口锚点：插到其上方 + 复制其样式）。 */
export function officialSettingButton(): HTMLElement | null {
  // 入口按钮复制了官方「设置」按钮的 className（含 trigger/settingsArea 子串），
  // 必须用 :not([data-wf-entry]) 排除自身，否则选择器会误匹配入口按钮本身。
  return document.querySelector('[class*="settingsArea"] button:not([data-wf-entry]), [class*="trigger"]:not([data-wf-entry])')
}

/** 官方某列的选择器（保留导出）。 */
export function officialCol(segment: 'sidebarCol' | 'centerCol' | 'detailsCol'): HTMLElement | null {
  return document.querySelector('[class*="' + segment + '"]')
}

/** 构建侧边栏入口按钮元素（图标 + 「工作流」）。
 *  样式与官方「设置」按钮一致：复制其 className（CSS-module hash 类，运行时读取保证准确）。
 *  @param officialBtn 官方「设置」按钮，用于复制样式类名；缺省仅保留 wf-sidebar-entry 标记。 */
export function buildSidebarEntryButton(label: string, officialBtn?: HTMLElement | null): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = officialBtn && officialBtn.className && officialBtn.className.trim()
    ? ('wf-sidebar-entry ' + officialBtn.className.trim())
    : 'wf-sidebar-entry'
  button.dataset.wfEntry = 'workflow'
  button.setAttribute('aria-label', label)
  // 文字放入子元素：官方侧边栏折叠时用 CSS 裁切/隐藏文字，裸文本节点无法被隐藏
  const labelEl = document.createElement('div')
  labelEl.className = 'wf-sidebar-entry__label'
  labelEl.textContent = label
  button.append(labelEl)
  // 三横线图标（沿用原 FAB 图标语义）
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('aria-hidden', 'true')
  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p1.setAttribute('fill', 'currentColor')
  p1.setAttribute('d', 'M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z')
  svg.append(p1)
  button.prepend(svg)
  return button
}

/**
 * 进入分栏：给官方对话主列 centerCol 设右内边距（左侧对话区），并把分栏宽度写入
 * :root CSS 变量（供 fixed 工作台使用）。**不修改官方 frame 网格结构**。
 * @param centerCol 官方对话主列。
 * @param width 分栏宽度（px）。
 */
export function enterSplit(centerCol: HTMLElement, width: number): void {
  centerCol.style.paddingRight = width + 'px'
  document.documentElement.style.setProperty('--wf-split-w', width + 'px')
}

/** 退出分栏：还原官方对话主列右内边距与 :root CSS 变量。 */
export function exitSplit(): void {
  const centerCol = officialCenterCol()
  centerCol?.style.removeProperty('padding-right')
  document.documentElement.style.removeProperty('--wf-split-w')
}

export interface WorkbenchViewFace {
  /** 工作台是否打开。 */
  open: boolean
  /** 当前视图模式。 */
  viewMode: WorkbenchViewMode
  /** 分栏宽度（px）。 */
  splitWidth: number
  /** 打开工作台（侧边栏入口点击）。 */
  openWorkbench(): void
  /** 关闭工作台。 */
  closeWorkbench(): void
  /** 切换工作台开关（侧边栏入口「再次点击关闭」；浮窗/分栏共用）。 */
  toggleOpen(): void
  /** 设置视图模式（并持久化、驱动分栏 DOM 注入）。 */
  setViewMode(mode: WorkbenchViewMode): void
  /** 在 float/split 之间切换（标题栏窗口切换按钮）。 */
  toggleView(): void
  /** 设置分栏宽度（拖动分隔线；更新 centerCol 内边距与 :root 变量并持久化）。 */
  setSplitWidth(width: number): void
}

/** 是否在浏览器环境（SSR/测试守卫）。 */
function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

/** 工作台视图模式状态机。 */
export function useWorkbenchView(): WorkbenchViewFace {
  const [open, setOpen] = useState(false)
  const [viewMode, setViewModeState] = useState<WorkbenchViewMode>(() =>
    isBrowser() ? readViewMode(window.localStorage) : 'float',
  )
  const [splitWidth, setSplitWidthState] = useState<number>(() =>
    isBrowser() ? readSplitWidth(window.localStorage) : SPLIT_WIDTH_DEFAULT,
  )
  const openRef = useRef<() => void>(() => undefined)

  const setViewMode = useCallback((mode: WorkbenchViewMode) => {
    setViewModeState(mode)
    if (isBrowser()) writeViewMode(window.localStorage, mode)
  }, [])

  const openWorkbench = useCallback(() => {
    setOpen(true)
    // 打开时以持久化的视图模式为准（float/split 都按最后记忆展开）
    if (isBrowser()) setViewModeState(readViewMode(window.localStorage))
  }, [])

  const closeWorkbench = useCallback(() => {
    setOpen(false)
  }, [])

  // 侧边栏入口「再次点击关闭」：toggle 打开/收起工作台（浮窗与分栏共用同一 open 态，
  // 关闭即收起宿主，浮窗/分栏随之消失）。打开时以持久化的视图模式为准。
  const toggleOpen = useCallback((): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (isBrowser()) setViewModeState(readViewMode(window.localStorage))
  }, [open])

  const toggleView = useCallback(() => {
    setViewMode(viewMode === 'float' ? 'split' : 'float')
  }, [setViewMode, viewMode])

  const setSplitWidth = useCallback((width: number) => {
    const clamped = clampSplitWidth(width)
    setSplitWidthState(clamped)
    if (isBrowser()) {
      writeSplitWidth(window.localStorage, clamped)
      const centerCol = officialCenterCol()
      if (centerCol) centerCol.style.paddingRight = clamped + 'px'
      document.documentElement.style.setProperty('--wf-split-w', clamped + 'px')
    }
  }, [])

  // 常驻：保持最新 toggleOpen 引用（供侧边栏入口回调使用，避免 closure 陈旧）。
  useEffect(() => {
    openRef.current = toggleOpen
  }, [toggleOpen])

  // 常驻：注入官方侧边栏入口按钮。
  // 观察官方侧边栏结构变化（childList）以在折叠/展开/重渲染后重新注入。
  // ⚠️ 只观察 childList、绝不观察 attributes，且 place() 只在值变化时才写
  //   className/class/位置 —— 否则 observer 回调改自身属性会自我触发，导致无限循环
  //   阻塞主线程（页面崩溃）。
  useEffect(() => {
    if (!isBrowser()) return
    let entry: HTMLButtonElement | null = null
    const place = (): void => {
      const anchor = officialSettingButton()
      if (!anchor) return
      // 找到真正包住设置按钮的 settingsArea 容器（不是其下的空 wrapper）。
      // 官方「设置」按钮外包了一层 display:contents 的空 div，anchor.parentElement
      // 取到的是那个空 wrapper；若把入口插进它，入口会随 settingsArea 内部的横向
      // flex 布局与设置按钮同排挤压（折叠态实测：settingsArea 变 row，同排显示）。
      // 用 closest('[class*="settingsArea"]') 取到容器，再取其父 footArea 作为插入点，
      // 使入口成为 footArea（纵向 column）里 settingsArea 的**兄弟**、位于其上方。
      const settingsArea = anchor.closest?.('[class*="settingsArea"]') ?? anchor.parentElement
      const footArea = settingsArea?.parentElement
      if (!settingsArea || !footArea) return
      if (!entry) {
        entry = buildSidebarEntryButton('工作流', anchor)
        entry.onclick = () => openRef.current()
      }
      // 仅在值变化时修改（防自循环）
      const nextCls = 'wf-sidebar-entry ' + anchor.className.trim()
      if (entry.className !== nextCls) entry.className = nextCls
      // 折叠态只显示图标（官方侧边栏折叠时 root 带 collapsed 类）
      const collapsed = !!document.querySelector('[class*="sidebarCol"] [class*="collapsed"]')
      if (entry.classList.contains('wf-sidebar-entry--rail') !== collapsed) {
        entry.classList.toggle('wf-sidebar-entry--rail', collapsed)
      }
      // 插入到 footArea 内、settingsArea 之前（footArea 纵向 → 设置在下方，入口在上方）
      if (entry.nextElementSibling !== settingsArea) {
        footArea.insertBefore(entry, settingsArea)
      }
    }
    place()
    // 观察根随页面必然存在的 body（而非可能延迟渲染的 sidebarCol）。
    // 时序根因：插件 apply 在官方侧边栏渲染前运行，此时 sidebarCol 为 null，
    // 旧实现 `if (sidebar) observer.observe(...)` 直接不挂 observer，首次 place() 也因
    // 找不到设置按钮提前 return —— 之后侧边栏渲染出来但再无触发，入口永不注入。
    // 改为观察 body（childList + subtree），任意后续 DOM 变更都会重跑幂等的 place()，
    // 直到锚点出现才真正插入入口按钮。
    const observer = new MutationObserver(() => place())
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      entry?.remove()
      entry = null
    }
  }, [])

  // 分栏 DOM 注入：open && split → 给官方 centerCol 设右内边距；否则还原。
  useEffect(() => {
    if (!isBrowser()) return
    if (open && viewMode === 'split') {
      const centerCol = officialCenterCol()
      if (centerCol) enterSplit(centerCol, splitWidth)
      return
    }
    exitSplit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewMode])

  return { open, viewMode, splitWidth, openWorkbench, closeWorkbench, toggleOpen, setViewMode, toggleView, setSplitWidth }
}

// src/client/studio/panel-layout.ts
//
// 面板几何与折叠态的持久化（纯函数 + StorageLike 注入，便于单测；与
// instance-options.ts 同构：读写都经注入的极简存储边界，不在本模块直接取 window）。
//
// 读取保留防御：缺失/损坏/越界一律回退默认——宽度/高度必须是有限正数，
// mode 必须落在折叠循环 [0, PANEL_CYCLE_LEN) 内，否则回退 defaultPanels()。
//
// 写入只有两处（都不在渲染期重复写）：
//   - 拖动结束（usePanelLayout.beginResize 的 pointerup）写当前这一向几何；
//   - mode 变化（usePanelLayout 的 effect，按值比对后）写 mode 键。

import type { StorageLike } from '../lib/storage.js'
import type { PanelLayout } from './studio-types.js'
import { defaultPanels } from './studio-initial.js'
import { PANEL_CYCLE_LEN } from './studio-selectors.js'

/** localStorage 键（左右宽度/底高沿用旧项目键名；mode 为折叠态新增键）。 */
export const LAYOUT_KEYS = {
  mode: 'visual-workflow:panel-mode',
  leftWidth: 'visual-workflow:left-width',
  rightWidth: 'visual-workflow:right-width',
  bottomHeight: 'visual-workflow:bottom-height',
} as const

/** 面板几何的可调方向（与 LAYOUT_KEYS 的几何键一一对应）。 */
export type PanelSizeSide = 'left' | 'right' | 'bottom'

/** 读取持久化面板几何与折叠态（非法/损坏/越界回退默认）。 */
export function restorePanels(storage: StorageLike): PanelLayout {
  const fallback = defaultPanels()
  return {
    mode: storedMode(storage, fallback.mode),
    leftWidth: storedSize(storage, LAYOUT_KEYS.leftWidth, fallback.leftWidth),
    rightWidth: storedSize(storage, LAYOUT_KEYS.rightWidth, fallback.rightWidth),
    bottomHeight: storedSize(storage, LAYOUT_KEYS.bottomHeight, fallback.bottomHeight),
  }
}

/** 写入折叠态（PANELS_SET 改 mode 后调用一次）。 */
export function keepPanelMode(storage: StorageLike, mode: number): void {
  write(storage, LAYOUT_KEYS.mode, String(mode))
}

/** 写入某一向几何（拖动结束后调用一次）。 */
export function keepPanelSize(storage: StorageLike, side: PanelSizeSide, value: number): void {
  const key = side === 'left'
    ? LAYOUT_KEYS.leftWidth
    : side === 'right'
      ? LAYOUT_KEYS.rightWidth
      : LAYOUT_KEYS.bottomHeight
  write(storage, key, String(value))
}

/** 几何读取：有限正数才有效（0/NaN/负值/垃圾文本回退默认）。 */
function storedSize(storage: StorageLike, key: string, fallback: number): number {
  try {
    const value = Number(storage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/** 折叠态读取：必须是循环范围内的非负整数（越界/小数/垃圾文本回退默认）。 */
function storedMode(storage: StorageLike, fallback: number): number {
  try {
    const value = Number(storage.getItem(LAYOUT_KEYS.mode))
    return Number.isFinite(value) && value >= 0 && value < PANEL_CYCLE_LEN ? Math.floor(value) : fallback
  } catch {
    return fallback
  }
}

/** 写入（隐私模式等异常静默：记忆失败不得影响交互）。 */
function write(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch {
    // 忽略（隐私模式等）
  }
}

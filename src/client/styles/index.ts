// src/client/styles/index.ts
//
// 工作台样式总装。原 src/client/styles.ts 的单一大模板已按域拆分到本目录各片段，
// 这里按原文件顺序拼接后仍然只导出一个 `styles` 字符串。
//
// 契约：
//   1. 数组顺序即覆盖顺序（同特异性下后写的规则覆盖先写的）→ 禁止重排、禁止随手插入；
//   2. 对外只导出 `styles`，由 entry.ts 注入 <style data-plugin="visual-workflow">；
//   3. 片段是纯 CSS 字符串常量，零 import / 零依赖，不使用 CSS Modules；
//   4. 类名前缀 wf-，颜色与尺寸一律走 DSH design token（--dsw-alias-*）与 tokens.ts 变量；
//   5. 新增样式按域归入对应片段；跨域覆盖（窄屏适配等）落在 responsive.ts。
//
// 顺序（自上而下即注入顺序）：
//    1. tokens.ts            全局样式：设计 token
//    2. chrome.ts            顶栏与骨架
//    3. toolbar.ts           工具栏与通用控件
//    4. canvas.ts            画布域
//    5. rails.ts             侧栏与底栏域
//    6. inspector.ts         属性栏域
//    7. overlays.ts          浮层域
//    8. host-mount.ts        宿主接入：Sidebar 标签页挂载点
//    9. combo.ts             组合管理域
//   10. service-console.ts   模式二服务控制台
//   11. sidebar-entry.ts     宿主接入：官方侧边栏入口按钮
//   12. responsive.ts        窄屏适配
//   13. scheduler.ts         定时任务域

import { tokensStyles } from './tokens.js'
import { chromeStyles } from './chrome.js'
import { toolbarStyles } from './toolbar.js'
import { canvasStyles } from './canvas.js'
import { railsStyles } from './rails.js'
import { inspectorStyles } from './inspector.js'
import { overlaysStyles } from './overlays.js'
import { hostMountStyles } from './host-mount.js'
import { comboStyles } from './combo.js'
import { serviceConsoleStyles } from './service-console.js'
import { sidebarEntryStyles } from './sidebar-entry.js'
import { responsiveStyles } from './responsive.js'
import { schedulerStyles } from './scheduler.js'

/** 注入顺序固定的样式片段表（注释即该片段的职责，禁止调整顺序）。 */
const parts: string[] = [
  tokensStyles, // 全局样式：设计 token
  chromeStyles, // 顶栏与骨架
  toolbarStyles, // 工具栏与通用控件
  canvasStyles, // 画布域
  railsStyles, // 侧栏与底栏域
  inspectorStyles, // 属性栏域
  overlaysStyles, // 浮层域
  hostMountStyles, // 宿主接入：Sidebar 标签页挂载点
  comboStyles, // 组合管理域
  serviceConsoleStyles, // 模式二服务控制台
  sidebarEntryStyles, // 宿主接入：官方侧边栏入口按钮
  responsiveStyles, // 窄屏适配
  schedulerStyles, // 定时任务域
]

/** 工作台全部样式（片段各自的拼接顺序即覆盖顺序）。 */
export const styles: string = parts.map((part) => part.trim()).join('\n\n')

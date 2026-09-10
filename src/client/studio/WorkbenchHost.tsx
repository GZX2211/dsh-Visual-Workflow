// src/client/studio/WorkbenchHost.tsx
//
// 工作台宿主（DSH 0.1.5-rc.1 迁移后极简化）。
//
// 迁移前：宿主负责 float/split 视图模式状态机、官方侧边栏入口按钮的 DOM 注入、
// 官方对话主列（centerCol）右内边距注入、浮窗/分栏外壳渲染、首次打开的延迟挂载等。
// 迁移后，工作台的呈现位置与打开方式全部交给官方右侧 Sidebar：
//   - 呈现：官方 sidebar.right.pane.tab 插槽内承载本宿主的**常驻容器**（见
//     sidebar/workbench-tab.tsx 的挂载点注册表），Studio 因此永不卸载；
//   - 打开：官方 sidebar.footer.action 插槽的入口按钮 → ctx.sidebarRight.openTab(kind)
//     （见 sidebar/footer-entry.tsx）。
//
// 本组件职责仅剩：
//   ① 解析「当前主会话」（会话树根）并跟随官方 sessions 快照变化 —— 供实例列表「当前」标签、
//      实例创建目标会话、运行轮询会话判定使用（工作台**不按会话隔离**，列表是全部会话的集合）；
//   ② 渲染 <Studio>；
//   ③ 提供运行联动的沉浸式回调（官方右侧 Sidebar 若处于全屏则缩回普通态；非全屏保持原状）。

import { useEffect, useState } from 'react'
import type { Dict } from '../i18n.js'
import { Studio } from './Studio.js'
import { currentSessionOf, rootSessionIdOf, type SessionsServiceLike } from '../sidebar/session-root.js'
import { shrinkOfficialSidebarIfFullscreen } from '../sidebar/workbench-tab.js'

// 会话解析缝继续 re-export（历史导入路径不变；实现已迁至 sidebar/session-root.ts）。
export { currentSessionOf, rootSessionIdOf }

/** 宿主上下文（兼容官方 client 注入的 ctx 最小形状）。 */
export interface WorkbenchHostContext {
  get?(name: string): unknown
  effect?(fn: () => (() => void) | void, label?: string): unknown
  locale?: unknown
}

/** 解析当前会话树根（守卫式读取；服务缺失返回空串）。 */
function rootSessionOf(ctx: WorkbenchHostContext): string {
  return rootSessionIdOf(currentSessionOf(ctx), ctx.get?.('sessions') as SessionsServiceLike | null | undefined)
}

/**
 * 工作台宿主组件。
 * @param ctx - 官方 client 上下文（仅用于读取 sessions 快照）。
 * @param t - 文案词典（语言切换时由 entry.ts 重渲染传入）。
 */
export function WorkbenchHost({ ctx, t }: { ctx: WorkbenchHostContext; t: Dict }) {
  const [sessionId, setSessionId] = useState(() => rootSessionOf(ctx))

  // 会话变化时跟随（需求 §4.5.7：仅更新「当前」标签与新建实例的目标会话，不重置界面）
  useEffect(() => {
    const sessions = ctx.get?.('sessions') as SessionsServiceLike | null | undefined
    const off = sessions?.list?.subscribe?.(() => {
      setSessionId(rootSessionOf(ctx))
    })
    return () => {
      off?.()
    }
  }, [ctx])

  return <Studio t={t} sessionId={sessionId} onRunImmersive={shrinkOfficialSidebarIfFullscreen} />
}

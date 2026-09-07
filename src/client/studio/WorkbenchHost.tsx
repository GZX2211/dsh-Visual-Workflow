// src/client/studio/WorkbenchHost.tsx
//
// 工作台宿主（图1/图2 交互改造）：为官方 Web 页面提供插件工作台的统一宿主。
//   - 常驻：侧边栏入口注入由 useWorkbenchView 完成（官方 sidebarDOM 注入）。
//   - 打开后按视图模式渲染：
//       float → 悬浮窗口（WorkbenchFrame 浮窗形态：独立窗口覆盖于官方页面之上）；
//       split → 分栏窗口（WorkbenchFrame 分栏形态：fixed 覆盖右侧，官方对话主列由
//               useWorkbenchView 设右内边距让出右半，不动官方 frame 网格）。
//   - **切换窗口零副作用（修复）**：float/split 由同一个 WorkbenchFrame 组件呈现，
//     内容 <Studio> 恒挂载于框架内（React 位置/类型恒定）——切换视图模式只改外壳
//     样式与交互，画布内容、未保存修改、运行快照、轮询结果、选中实例、面板布局
//     等全部状态原样保留。此前双分支各自渲染 <Studio>，切换即卸载重建、状态全丢。
//     切换按钮（toggleView）只切模式并持久化，不触发布局/保存/运行逻辑（用户验收）。
//   - 会话绑定与订阅（工作台全局化改版）：工作台**不再按会话隔离**——实例/服务
//     列表为全部会话的集合，宿主只解析「当前主会话」（会话树根）供——① 实例列表
//     「当前」标签；② 进入时画布默认选中当前会话实例。会话切换跟随仅更新标签
//     （用户裁决：打开期间不强制跳转画布；重新进入时按新当前会话自动选中）。
//
// 职责：只做「挂载位置 + 当前主会话解析」；工作台业务逻辑仍在 Studio。

import { useEffect, useState } from 'react'
import type { Dict } from '../i18n.js'
import { Studio } from './Studio.js'
import { WorkbenchFrame } from './WorkbenchFrame.js'
import { useWorkbenchView } from './useWorkbenchView.js'

/** 宿主上下文（兼容官方 client 注入的 ctx 最小形状）。 */
export interface WorkbenchHostContext {
  get?(name: string): unknown
  effect?(fn: () => (() => void) | void, label?: string): unknown
  locale?: unknown
}

/** 会话 id 解析：经 sessions 服务读当前选中会话（守卫；无会话返回空串）。 */
function currentSessionOf(ctx: WorkbenchHostContext): string {
  const sessions = ctx.get?.('sessions') as
    | { list?: { getSnapshot?(): { current?: unknown; byId?: Record<string, unknown> }; get?(): { current?: unknown; byId?: Record<string, unknown> } } }
    | null
    | undefined
  const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.()
  const current = snapshot?.current
  return typeof current === 'string' ? current : ''
}

/** 会话树根 id 解析（实例/服务按会话树根隔离）。 */
export function rootSessionIdOf(
  current: string,
  sessions: { list?: { getSnapshot?(): { current?: unknown; byId?: Record<string, unknown> }; get?(): { current?: unknown; byId?: Record<string, unknown> } } } | null | undefined,
): string {
  if (!current) return ''
  const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.()
  if (!snapshot?.byId) return current
  let cursor = current
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const entry = snapshot.byId[cursor] as { parentSessionId?: unknown } | undefined
    const parent = typeof entry?.parentSessionId === 'string' ? entry.parentSessionId : ''
    if (!parent || !snapshot.byId[parent]) return cursor
    cursor = parent
  }
  return cursor
}

/** 工作台宿主组件。 */
export function WorkbenchHost({ ctx, t }: { ctx: WorkbenchHostContext; t: Dict }) {
  const view = useWorkbenchView()
  const [sessionId, setSessionId] = useState(() => rootSessionIdOf(currentSessionOf(ctx), ctx.get?.('sessions') as never))

  // 会话变化时跟随（无会话回退当前会话；需求 §4.5.7）
  useEffect(() => {
    const sessions = ctx.get?.('sessions') as
      | { list?: { subscribe?(fn: () => void): () => void; get?(): unknown } }
      | null
      | undefined
    const off = sessions?.list?.subscribe?.(() => {
      setSessionId(rootSessionIdOf(currentSessionOf(ctx), ctx.get?.('sessions') as never))
    })
    return () => {
      off?.()
    }
  }, [ctx])

  const studioProps = {
    t,
    sessionId,
    viewMode: view.viewMode,
    onToggleView: view.toggleView,
    onEnterSplit: () => view.setViewMode('split'),
  }

  // 未打开：仅保留侧边栏入口（useWorkbenchView 注入），宿主不渲染任何内容。
  if (!view.open) return null

  // 统一窗口框架（WorkbenchFrame）：float/split 为同一组件实例的两种形态，
  // Studio 恒挂载于框架内容容器 —— 视图切换不卸载 Studio，状态全部保留。
  // 浮窗形态：标题栏兼任窗口标题栏（可拖动 + 关闭）；分栏形态：无关闭按钮、
  // 标题栏不可拖动（与旧 split 分支行为一致：不传 onClose/onTitlebarDrag）。
  return (
    <WorkbenchFrame
      mode={view.viewMode}
      splitWidth={view.splitWidth}
      onResize={view.setSplitWidth}
      onClose={view.closeWorkbench}
    >
      {(frameApi) => (
        <Studio
          {...studioProps}
          onClose={view.viewMode === 'float' ? frameApi.close : undefined}
          onTitlebarDrag={view.viewMode === 'float' ? frameApi.drag : undefined}
        />
      )}
    </WorkbenchFrame>
  )
}
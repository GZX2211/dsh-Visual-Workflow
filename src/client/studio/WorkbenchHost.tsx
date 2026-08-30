// src/client/studio/WorkbenchHost.tsx
//
// 工作台宿主（图1/图2 交互改造）：为官方 Web 页面提供插件工作台的统一宿主。
//   - 常驻：侧边栏入口注入由 useWorkbenchView 完成（官方 sidebarDOM 注入）。
//   - 打开后按视图模式渲染：
//       float → FloatingWindow（独立悬浮窗口，覆盖于官方页面之上）；
//       split → 工作台以 fixed 定位覆盖右侧（官方对话主列由 useWorkbenchView 设右内边距
//              让出右半，不动官方 frame 网格）。工作台不再作为官方 frame 的子节点渲染，
//              从根本上避免与官方 React 布局冲突。
//   - 会话绑定与订阅（实例/服务按「会话树根 id」隔离，与旧 entry 逻辑一致）。
//
// 职责：只做「挂载位置 + 会话绑定」；工作台业务逻辑仍在 Studio。

import { useEffect, useState } from 'react'
import type { Dict } from '../i18n.js'
import { Studio } from './Studio.js'
import { FloatingWindow } from './floating-window.js'
import { SplitWindow } from './SplitWindow.js'
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

  // 悬浮窗口（float）：覆盖于官方页面之上，标题栏兼任窗口标题栏（可拖动 + 关闭）。
  if (view.viewMode === 'float') {
    return (
      <FloatingWindow t={t} open onClose={view.closeWorkbench}>
        {({ close, drag }) => (
          <Studio {...studioProps} onClose={close} onTitlebarDrag={drag} />
        )}
      </FloatingWindow>
    )
  }

  // 分栏窗口（split）：工作台以 fixed 定位覆盖右侧；中间分隔线可拖（SplitWindow）。
  // 官方对话主列右内边距由 useWorkbenchView effect 维护（不动官方 frame 网格）。
  return (
    <div className="wf-split-pane">
      <SplitWindow splitWidth={view.splitWidth} onResize={view.setSplitWidth}>
        <Studio {...studioProps} />
      </SplitWindow>
    </div>
  )
}

// src/client/entry.ts
//
// Client 半区插件入口：
//   1. 主界面右下角圆形 FAB + 浮窗工作台（body 常驻，独立于视图环激活态）；
//   2. 样式注入（style[data-plugin]）+ i18n 注册（官方 locale 服务命名空间 visualWorkflow）。
// 卸载：样式移除、浮窗 root 卸载、订阅释放（ctx.effect）。
//
// 变更（2026.08.25 用户验收批注）：**不再注册 conversation.view 会话页 tab**
// （「不要在这里注册我的插件入口」）——插件入口仅保留 FAB + 浮窗工作台。

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Studio } from './studio/Studio.js'
import { FloatingWindow } from './studio/floating-window.js'
import { zh, en, text, detectLanguage, type Dict } from './i18n.js'
import { styles } from './styles.js'
import './entry.css'

/** i18n 命名空间（注册进官方 locale 服务）。 */
export const I18N_NS = 'visualWorkflow'

/** 会话 id 解析：经 sessions 服务读当前选中会话（守卫；无会话返回空串）。
 *  官方 v0.1.1 读法：sessions.list 为 ObservableSnapshot（getSnapshot().current）；
 *  兼容旧运行时的 list.get()。 */
function currentSessionOf(ctx: { get?(name: string): unknown }): string {
  const sessions = ctx.get?.('sessions') as
    | {
        list?: {
          getSnapshot?(): { current?: unknown; byId?: Record<string, unknown> }
          get?(): { current?: unknown; byId?: Record<string, unknown> }
        }
      }
    | null
    | undefined
  const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.()
  const current = snapshot?.current
  return typeof current === 'string' ? current : ''
}

/**
 * 会话树根 id 解析（疑点二修复）：DSH 中每个子代理对话持有独立 childSessionId
 * （官方 dsh-subagent：childId = SessionId(randomUUID())，header.parentSession 记录
 * 父链），若工作台直接绑定「当前选中会话」，在子代理对话界面打开时列表按子代理
 * 会话过滤为空，实例被误认为「跟随代理 ID」。实例/服务按**会话树根**隔离：
 * 沿官方 sessions.list summaries 的 parentSessionId 上溯到无父（根）会话，
 * 主代理与其全部后代子代理共享同一实例列表。快照无该字段（旧运行时）时回退
 * 当前会话自身（行为不变，单代理场景无回归）。
 */
export function rootSessionIdOf(
  current: string,
  sessions: {
    list?: {
      getSnapshot?(): { current?: unknown; byId?: Record<string, unknown> }
      get?(): { current?: unknown; byId?: Record<string, unknown> }
    }
  } | null
    | undefined,
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

// 无硬依赖：样式/DOM 全部自持；locale/sessions 经 ctx.get 守卫（测试/降级友好）。
export const inject: string[] = []

/** 测试导出（client-smoke 渲染路径验证）。 */
export const VisualWorkflowView = null
export const __test = { FloatingWindow }

export function apply(ctx: {
  get?(name: string): unknown
  effect?(fn: () => (() => void) | void, label?: string): unknown
  locale?: unknown
}): void {
  // 样式注入（fiber 卸载时移除）
  ctx.effect?.(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'visual-workflow'
    tag.textContent = styles
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, 'visual-workflow: styles')

  // i18n 注册（官方 locale 服务可用时；不可用按浏览器语言回退）
  const localeService = ctx.get?.('locale') as { register?(ns: string, dicts: { zh: unknown; en: unknown }): unknown } | null | undefined
  try {
    localeService?.register?.(I18N_NS, { zh, en })
  } catch {
    // 注册失败回退自持词典
  }

  // 浮窗宿主：body 常驻容器（FAB + 窗口），与视图环激活态解耦
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let offSession: (() => void) | null = null
  ctx.effect?.(() => {
    container = document.createElement('div')
    container.id = 'visual-workflow-float-host'
    document.body.append(container)
    const render = (sessionId: string): void => {
      const t = text(detectLanguage(ctx.get?.('locale')))
      root ??= createRoot(container!)
      root.render(
        React.createElement(FloatingWindow, {
          t,
          children: ({ close, drag }) => React.createElement(Studio, {
            t: t as Dict,
            // 疑点二修复：实例/服务按「会话树根 id」隔离——主代理与其全部后代
            // 子代理共享同一实例列表；在子代理对话界面打开工作台亦可见。
            sessionId: rootSessionIdOf(currentSessionOf(ctx), ctx.get?.('sessions') as never),
            onClose: close,
            // 单一标题栏：工作台标题顶栏兼任窗口标题栏（可拖动）
            onTitlebarDrag: drag,
          }),
        }),
      )
    }
    render(currentSessionOf(ctx))
    // 会话变化时跟随（无会话下拉：绑定当前会话，需求 §4.5.7）
    const sessions = ctx.get?.('sessions') as
      | { list?: { subscribe?(fn: () => void): () => void; get?(): unknown } }
      | null
      | undefined
    if (sessions?.list?.subscribe) {
      offSession = sessions.list.subscribe(() => {
        render(currentSessionOf(ctx))
      })
    }
    return () => {
      offSession?.()
      offSession = null
      root?.unmount()
      root = null
      container?.remove()
      container = null
    }
  }, 'visual-workflow: floating window')
}

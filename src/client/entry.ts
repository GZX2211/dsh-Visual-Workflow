// src/client/entry.ts
//
// Client 半区插件入口：
//   1. conversation.view slot 注册（对话区视图环，order 20）；
//   2. 主界面右下角圆形 FAB + 浮窗工作台（常驻 body，独立于视图环激活态）；
//   3. 样式注入（style[data-plugin]）+ i18n 注册（官方 locale 服务命名空间）。
// 卸载：样式移除、浮窗 root 卸载、slot disposer 随 fiber 注销（ctx.effect）。

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Studio } from './studio/Studio.js'
import { FloatingWindow } from './studio/floating-window.js'
import { zh, en, text, detectLanguage } from './i18n.js'
import { styles } from './styles.js'
import './entry.css'

/** i18n 命名空间（注册进官方 locale 服务）。 */
export const I18N_NS = 'visualWorkflow'

/** 会话 id 解析：经 sessions 服务读当前会话（守卫；无会话返回空串）。 */
function currentSessionOf(ctx: { get?(name: string): unknown }): string {
  const sessions = ctx.get?.('sessions') as
    | { list?: { get?(): { current?: unknown } } }
    | null
    | undefined
  const current = sessions?.list?.get?.()?.current
  return typeof current === 'string' ? current : ''
}

// 必需 service 声明：slots 为硬依赖；locale/sessions 经 ctx.get 守卫（测试/降级友好）。
export const inject: string[] = ['slots']

/** 对话区视图（slot 挂载形态；与浮窗工作台共享同一 Studio）。 */
export function VisualWorkflowView(props: { sessionId?: unknown; language?: unknown }) {
  const t = text(detectLanguage(props.language))
  return React.createElement(Studio, { t, sessionId: String(props.sessionId ?? '') })
}

/** 测试导出（client-smoke 渲染路径验证）。 */
export const __test = { VisualWorkflowView, FloatingWindow }

export function apply(ctx: {
  get?(name: string): unknown
  effect?(fn: () => (() => void) | void, label?: string): unknown
  slots?: unknown
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
    const language = detectLanguage(ctx.get?.('locale'))
    const render = (sessionId: string): void => {
      const t = text(language)
      root ??= createRoot(container!)
      root.render(
        React.createElement(FloatingWindow, {
          t,
          children: React.createElement(Studio, { t, sessionId }),
        }),
      )
    }
    render(currentSessionOf(ctx))
    // 会话变化时跟随（无会话下拉：绑定当前会话）
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

  // conversation.view slot（对话区视图环：order 20 工作流）
  const slots = ctx.slots as
    | {
        inject?(name: string, factory: () => unknown): unknown
      }
    | null
    | undefined
  if (slots?.inject) {
    ctx.effect?.(() => {
      const register = (slots as { register?(options: Record<string, unknown>, view: unknown): unknown }).register
      if (typeof register !== 'function') return undefined
      const language = detectLanguage(ctx.get?.('locale'))
      return register({
        name: 'conversation.view',
        id: 'visual-workflow',
        order: 20,
        label: () => {
          const t = text(detectLanguage(ctx.get?.('locale')))
          return t.libTab.workflow
        },
        inject: (sessionId: unknown) => ({
          sessionId: String(sessionId ?? ''),
          language: detectLanguage(ctx.get?.('locale')) || language,
        }),
      }, VisualWorkflowView) as () => void
    }, 'visual-workflow: conversation view')
  }
}

// src/client/entry.ts
//
// Client 半区插件入口：
//   1. 主界面右下角圆形 FAB + 浮窗工作台（body 常驻，独立于视图环激活态）；
//   2. 样式注入（style[data-plugin]）+ i18n 注册（官方 locale 服务命名空间 visualWorkflow）。
// 卸载：样式移除、浮窗 root 卸载、订阅释放（ctx.effect）。
//
// 变更（2026.08.25 用户验收批注）：**不再注册 conversation.view 会话页 tab**
// ——插件入口仅保留 FAB + 浮窗工作台。

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FloatingWindow } from './studio/floating-window.js'
import { WorkbenchHost } from './studio/WorkbenchHost.js'
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
    // 父链字段在 DSH 0.1.2 由 parentSessionId 更名为 parentId（SessionSummary；
    // 0.1.2-rc.1 类型取证：parentId + origin:'subagent'）。双读兼容运行版本：
    // 优先 parentId、回退旧名，保证子代理后代仍能上溯到根（实例/服务按会话树根隔离）。
    const entry = snapshot.byId[cursor] as { parentId?: unknown; parentSessionId?: unknown } | undefined
    const rawParent = entry?.parentId ?? entry?.parentSessionId
    const parent = typeof rawParent === 'string' ? rawParent : ''
    if (!parent || !snapshot.byId[parent]) return cursor
    cursor = parent
  }
  return cursor
}

// 插件所需服务（cordis fiber inject）。
//  - locale：声明后 fiber 会**等待**官方 locale 服务（dsh-client-locale）激活后才运行
//    apply，从而保证 apply 内 ctx.get('locale') 返回活跃的 LocaleRuntime，能 register
//    词典并 subscribe(render) 收到语言切换通知。此前 inject 为空，插件可能先于 locale
//    激活：ctx.get('locale') 为 undefined → detectLanguage 回退 navigator.language
//    （zh-CN）→ 词典恒为中文，且 subscribe 因 localeService 为 null 未订阅 —— 语言
//    切换既不读 active 也不触发重渲染（界面停留中文的根因）。
//  - sessions 在 WorkbenchHost 内经 ctx.get?.('sessions') 防御式读取（可能延迟出现），
//    不声明在 inject（避免 locale 之外的隐性依赖把插件整体 park 住）。
// 样式/DOM 全部自持；测试/降级友好。
export const inject: string[] = ['locale']

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

  // 工作台宿主：body 常驻容器（由 WorkbenchHost 按视图模式渲染浮窗/分栏；
  // 入口改为官方侧边栏注入，见 useWorkbenchView；会话绑定由 WorkbenchHost 自理）。
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  ctx.effect?.(() => {
    container = document.createElement('div')
    container.id = 'visual-workflow-workbench-host'
    document.body.append(container)
    // 语言切换响应式：官方 locale 服务（dsh-client-locale LocaleRuntime）暴露
    // subscribe(fn)，语言变化时回调。重算 t 并重渲染，使插件界面跟随配置语言。
    const localeService = ctx.get?.('locale') as {
      subscribe?(fn: () => void): () => void
    } | null | undefined
    const render = (): void => {
      const t = text(detectLanguage(ctx.get?.('locale')))
      root ??= createRoot(container!)
      root.render(React.createElement(WorkbenchHost, { ctx, t: t as Dict }))
    }
    render()
    const unsubscribe = typeof localeService?.subscribe === 'function' ? localeService.subscribe(render) : undefined
    return () => {
      unsubscribe?.()
      root?.unmount()
      root = null
      container?.remove()
      container = null
    }
  }, 'visual-workflow: workbench host')
}

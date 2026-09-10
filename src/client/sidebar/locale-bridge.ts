// src/client/sidebar/locale-bridge.ts
//
// 工作台词典桥（模块级可订阅单例）。
//
// 为什么需要它：工作台现在由**两处独立的 React 树**渲染 ——
//   ① 官方 sidebar.footer.action 插槽里的入口按钮（由官方 slot 框架挂载）；
//   ② 官方 sidebar.right.pane.tab 插槽里的标签页 body（内部只承载常驻容器）。
// 而词典由 entry.ts 的 apply 统一持有（`text(detectLanguage(ctx.get('locale')))`，
// 语言切换时经官方 locale 服务的 subscribe 重算）。
// 把当前词典经本模块广播，两处 React 树都能用 useSyncExternalStore 订阅并跟随语言切换，
// 无需依赖官方插槽的 locale 座位语义（避免运行时不确定性）。

import { useSyncExternalStore } from 'react'
import { en, type Dict } from '../i18n.js'

/** 当前词典（默认英文：与「无 locale 服务时按浏览器语言」的降级路径一致，此处仅兜底）。 */
let current: Dict = en

const listeners = new Set<() => void>()

/** 读取当前词典（useSyncExternalStore 的 getSnapshot；返回稳定引用）。 */
export function getWorkbenchDict(): Dict {
  return current
}

/** 订阅词典变化（useSyncExternalStore 的 subscribe）。 */
export function subscribeWorkbenchDict(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 更新当前词典并通知订阅者（entry.ts 在首次渲染与每次语言切换时调用）。
 * 同引用不通知（避免无意义重渲染）。
 * @param next - 新词典。
 */
export function setWorkbenchDict(next: Dict): void {
  if (next === current) return
  current = next
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 单个订阅者异常不影响其余
    }
  }
}

/** 订阅当前词典的 React hook（组件因此跟随语言切换重渲染）。 */
export function useWorkbenchDict(): Dict {
  return useSyncExternalStore(subscribeWorkbenchDict, getWorkbenchDict, getWorkbenchDict)
}

/** 测试用：复位为默认词典并清空订阅者。 */
export function resetWorkbenchDictForTest(): void {
  current = en
  listeners.clear()
}

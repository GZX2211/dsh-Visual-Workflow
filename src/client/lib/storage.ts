// src/client/lib/storage.ts
//
// 极简存储抽象（localStorage 子集）：便于单测注入内存 mock，避免直接依赖 window。
// 原定义在 studio/useWorkbenchView.ts 内；浮窗/分栏视图模式删除后，该抽象仍被
// studio/instance-options.ts（「开启新会话」/工作区路径记忆）使用，故独立成模块。

/** 极简存储抽象（getItem/setItem 即可满足全部调用点）。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

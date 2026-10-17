// src/client/studio/instance-options.ts
//
// 「开启新会话」界面记忆（StudioState.instanceOptions）的 localStorage 缓存。
//
// 模板态的勾选与工作区路径已改为**模板级持久化配置**（模板文档的
// startNewSession / workspacePath 字段，随模板保存与删除），不再落此缓存；本缓存
// 只服务**资产态**的一次性勾选记忆（资产没有模板文档可承载配置）：
//   - 形状收敛为 { newSession }（路径恒空：资产态无路径来源，继承当前会话工作区）；
//   - 旧版本缓存（含 workspacePath）读取时忽略该字段，写回时收敛为新形状；
//   - 纯函数 + StorageLike 注入（极简存储抽象，便于单测）。

import type { StorageLike } from '../lib/storage.js'

/** instanceOptions 持久化键。 */
export const INSTANCE_OPTIONS_KEY = 'visual-workflow:instance-options'

/** 资产态一次性「开启新会话」记忆。 */
export interface InstanceOptions {
  /** 创建实例前是否新建主会话（资产态「开启新会话」复选框）。 */
  newSession: boolean
}

/** 默认实例选项（与 createInitialState 一致）。 */
export function defaultInstanceOptions(): InstanceOptions {
  return { newSession: false }
}

/** 读取缓存（缺失/损坏回退默认值；隐私模式等异常静默）。 */
export function restoreInstanceOptions(storage: StorageLike): InstanceOptions {
  try {
    const raw = storage.getItem(INSTANCE_OPTIONS_KEY)
    if (!raw) return defaultInstanceOptions()
    const parsed = JSON.parse(raw) as Partial<InstanceOptions> | null
    return { newSession: parsed?.newSession === true }
  } catch {
    return defaultInstanceOptions()
  }
}

/** 写入缓存（newSession 布尔化后落盘；不含路径——模板态的路径不在此）。 */
export function keepInstanceOptions(storage: StorageLike, options: InstanceOptions): void {
  try {
    storage.setItem(INSTANCE_OPTIONS_KEY, JSON.stringify({ newSession: options.newSession === true }))
  } catch {
    // 忽略（隐私模式等）
  }
}

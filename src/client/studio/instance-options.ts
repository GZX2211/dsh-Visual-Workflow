// src/client/studio/instance-options.ts
//
// 「开启新会话」+ 工作区路径（StudioState.instanceOptions）的 localStorage 缓存
// （用户裁决）：
//   - instanceOptions 是「从模板创建实例」的一次性临时选项（创建实例时消费后
//     重置），**不持久化到模板/实例文档**（需求 §4.5.3）；
//   - 但它属于用户界面记忆——「开启新会话」复选框与工作区路径必须做到重复
//     进入工作台不丢失。工作台保持挂载已覆盖打开/关闭循环；此处再把值落盘
//     localStorage，即使宿主重建/页面刷新也能恢复（双保险）。
//   - 纯函数 + StorageLike 注入（极简存储抽象，便于单测）。
//     说明：StorageLike 原定义在 studio/useWorkbenchView.ts 内；该模块随浮窗/分栏视图模式
//     一并删除，类型已迁至 client/lib/storage.ts。

import type { StorageLike } from '../lib/storage.js'

/** instanceOptions 持久化键。 */
export const INSTANCE_OPTIONS_KEY = 'visual-workflow:instance-options'

/** 实例选项（对齐 StudioState.instanceOptions；创建实例时一次性消费）。 */
export interface InstanceOptions {
  /** 创建实例前是否新建主会话（模板态「开启新会话」复选框）。 */
  newSession: boolean
  /** 新会话工作区路径（留空继承当前主会话工作区）。 */
  workspacePath: string
}

/** 默认实例选项（与 createInitialState 一致）。 */
export function defaultInstanceOptions(): InstanceOptions {
  return { newSession: false, workspacePath: '' }
}

/** 读取缓存（缺失/损坏回退默认值；隐私模式等异常静默）。 */
export function restoreInstanceOptions(storage: StorageLike): InstanceOptions {
  try {
    const raw = storage.getItem(INSTANCE_OPTIONS_KEY)
    if (!raw) return defaultInstanceOptions()
    const parsed = JSON.parse(raw) as Partial<InstanceOptions>
    return {
      newSession: parsed.newSession === true,
      workspacePath: typeof parsed.workspacePath === 'string' ? parsed.workspacePath : '',
    }
  } catch {
    return defaultInstanceOptions()
  }
}

/** 写入缓存（newSession 布尔化、workspacePath 字符串化后落盘）。 */
export function keepInstanceOptions(storage: StorageLike, options: InstanceOptions): void {
  try {
    storage.setItem(INSTANCE_OPTIONS_KEY, JSON.stringify({
      newSession: options.newSession === true,
      workspacePath: typeof options.workspacePath === 'string' ? options.workspacePath : '',
    }))
  } catch {
    // 忽略（隐私模式等）
  }
}
// src/client/lib/remote-error.ts
//
// 远端错误的读取口径（纯函数）：稳定错误码与可读文案只在这里读取。
// 列表 hook 的「按错误码特化处理」与组件层提示都消费本模块，避免各自复制同一读取规则
// （错误码语义变更时不会漏改一处）。

import type { RemoteError } from './remote.js'

/** 远端错误的稳定码（无码 = 传输/解析失败）。 */
export function remoteErrorCodeOf(error: unknown): string {
  return String((error as RemoteError | null | undefined)?.code ?? '')
}

/** 远端错误的可读文案：Error 用 message；非 Error 用字符串原文；两者皆缺回退错误码。 */
export function remoteErrorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  const code = remoteErrorCodeOf(error)
  if (code) return code
  return error === null || error === undefined ? '' : String(error)
}

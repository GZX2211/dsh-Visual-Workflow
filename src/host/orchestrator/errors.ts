// src/host/orchestrator/errors.ts
//
// 编排运行时的错误内核（无业务依赖，供本模块与工具层共用）：
//   - WfError：稳定 code 的编排错误（工具层转 isError 工具结果 / 测试断言共用）；
//   - messageOf：任意抛出值的可读错误消息提取。

/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export class WfError extends Error {
  readonly code: string
  constructor(message: string, code: string, extras?: Record<string, unknown>) {
    super(message)
    this.name = 'WfError'
    this.code = code
    if (extras) Object.assign(this, extras)
  }
}

/** 错误消息提取（Error 或任意值）。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

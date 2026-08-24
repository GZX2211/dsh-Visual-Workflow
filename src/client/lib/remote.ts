// src/client/lib/remote.ts
//
// 工作台远端调用：POST /visual-workflow/<endpoint>，body { args }，返回 value。
// 端点名直接引用共享协议常量表（host 同源），与后端零漂移。
// 错误语义：网络失败/非 ok 响应 → 抛出后端 message（HTTP 状态兜底文案）。

import * as EP from '../../host/shared/protocol.js'

export { EP }

/** 调用 Host API（同源 fetch）。 */
export async function remoteCall(endpoint: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`/visual-workflow/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    })
  } catch (error) {
    throw new Error(`无法连接工作流服务：${error instanceof Error ? error.message : String(error)}`)
  }
  let payload: { ok?: unknown; value?: unknown; error?: { message?: unknown } } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // 非 JSON 响应
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload?.error?.message ?? `工作流服务错误（HTTP ${response.status}）`))
  }
  return payload.value
}

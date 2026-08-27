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
  let payload: { ok?: unknown; value?: unknown; error?: { message?: unknown; code?: unknown } } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // 非 JSON 响应
  }
  if (!response.ok || payload.ok === false) {
    // 稳定错误码随 Error 携带（Bug 20）：后端错误响应 { message, code }，调用方可
    // 按 code 分支处理（如 FLOW_REVISION_CONFLICT 冲突时自动刷新），而非仅通用 message。
    const error = new Error(String(payload?.error?.message ?? `工作流服务错误（HTTP ${response.status}）`)) as Error & { code?: string }
    const code = (payload?.error as { code?: unknown } | undefined)?.code
    if (typeof code === 'string' && code) error.code = code
    throw error
  }
  return payload.value
}

/**
 * 流式调用 Host API（SSE 透传）：POST /visual-workflow/<endpoint>，把服务端
 * SSE 的 data 行文本逐行回调（解析归调用方）；流结束 resolve。
 * 非 2xx（未写流头）抛出后端 message；AbortError 静默返回（调用方主动停止）。
 */
export async function streamCall(
  endpoint: string,
  args: Record<string, unknown>,
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/visual-workflow/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw new Error(`无法连接工作流服务：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    let message = `工作流服务错误（HTTP ${response.status}）`
    let code: string | undefined
    try {
      const payload = (await response.json()) as { error?: { message?: unknown; code?: unknown } }
      if (payload?.error?.message) message = String(payload.error.message)
      const rawCode = payload?.error?.code
      if (typeof rawCode === 'string' && rawCode) code = rawCode
    } catch {
      // 非 JSON 响应：保留兜底文案
    }
    // 稳定错误码随 Error 携带（与 remoteCall 一致，Bug 20）
    const error = new Error(message) as Error & { code?: string }
    if (code) error.code = code
    throw error
  }
  if (!response.body) throw new Error('流式响应无内容')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index: number
      // 按行切分回调节（空行/注释行由调用方过滤）
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line.trim()) onLine(line)
      }
    }
    if (buffer.trim()) onLine(buffer.replace(/\r$/, ''))
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw error
  }
}

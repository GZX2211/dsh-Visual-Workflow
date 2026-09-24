// src/client/lib/remote.ts
//
// 工作台远端调用：POST /visual-workflow/<endpoint>，body { args }，返回 value。
// 端点名直接引用共享协议常量表（host 同源），与后端零漂移。
//
// 失败语义（显式区分，见 client AGENTS「数据流与数据访问边界」）：
//   - 业务失败：后端 { ok:false, error:{ message, code } } → 抛出携带稳定 code 的 Error；
//   - 传输/解析失败：连接失败 → 「无法连接工作流服务」；响应超时 → code=REMOTE_TIMEOUT；
//   - 主动取消：调用方 signal 触发 → 原样抛出 AbortError（调用方按取消语义静默处理）。
// 每个非流式调用都在超时预算内完成（timeoutMs=0 表示不设超时），悬挂请求不再永久占用调用方。

import * as EP from '../../host/shared/protocol.js'

export { EP }

/** 传输层超时错误码（client 侧专有；后端业务码见共享协议 ERR_* 常量）。 */
export const REMOTE_TIMEOUT_CODE = 'REMOTE_TIMEOUT'

/** 非流式调用默认超时：覆盖启动服务/运行/导入导出等长耗时端点，仅收敛「永久悬挂」。 */
export const DEFAULT_REMOTE_TIMEOUT_MS = 120_000

/** 轮询专用短超时：单轮请求悬挂时必须尽快释放 in-flight 位，下一轮才能继续。 */
export const POLL_REMOTE_TIMEOUT_MS = 8_000

/** 携带稳定错误码的远端错误（code 可判定，调用方按语义分支）。 */
export interface RemoteError extends Error {
  code?: string
}

/**
 * 乐观锁冲突判定（稳定错误码本体在共享协议常量）：保存路径据此走「冲突语义」
 * （刷新列表 + 明确提示用户重试），而不是仅展示通用 message 后静默继续。
 */
export function isRevisionConflict(error: unknown): boolean {
  return (error as RemoteError | null | undefined)?.code === EP.ERR_REVISION_CONFLICT
}

export interface RemoteCallOptions {
  /** 主动取消（卸载/切换文档/停止轮询时中止在途请求）。 */
  signal?: AbortSignal
  /** 超时毫秒；0 = 不设超时（仅依赖 signal 取消）。缺省 DEFAULT_REMOTE_TIMEOUT_MS。 */
  timeoutMs?: number
}

/** 本次调用的时限（外部取消 + 超时 → 单一 AbortSignal，并保留失败原因）。 */
interface Deadline {
  signal: AbortSignal
  didTimeout(): boolean
  abortedByCaller(): boolean
  dispose(): void
}

function createDeadline(options: RemoteCallOptions | undefined): Deadline {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS
  const external = options?.signal
  const controller = new AbortController()
  let timedOut = false
  const onExternalAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort)
  }
  const timer = timeoutMs > 0
    ? setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    : null
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    abortedByCaller: () => external?.aborted === true && !timedOut,
    dispose: () => {
      if (timer !== null) clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

/** 传输失败归一化：超时 / 主动取消 / 连接失败三态留在网络边界，调用方零猜测。 */
function transportFailure(error: unknown, endpoint: string, deadline: Deadline): Error {
  if (deadline.didTimeout()) {
    const timeout = new Error(`工作流服务响应超时（${endpoint}）`) as RemoteError
    timeout.code = REMOTE_TIMEOUT_CODE
    return timeout
  }
  if (deadline.abortedByCaller() || (error as Error | undefined)?.name === 'AbortError') return error as Error
  return new Error(`无法连接工作流服务：${error instanceof Error ? error.message : String(error)}`)
}

/** 非 2xx 响应 → 携带后端 message/code 的错误（非 JSON 响应保留 HTTP 兜底文案）。 */
async function errorFromResponse(response: Response): Promise<RemoteError> {
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
  const error = new Error(message) as RemoteError
  if (code) error.code = code
  return error
}

/** 调用 Host API（同源 fetch；超时与取消见 RemoteCallOptions）。 */
export async function remoteCall(
  endpoint: string,
  args: Record<string, unknown> = {},
  options?: RemoteCallOptions,
): Promise<unknown> {
  const deadline = createDeadline(options)
  try {
    let response: Response
    try {
      response = await fetch(`/visual-workflow/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
        signal: deadline.signal,
      })
    } catch (error) {
      throw transportFailure(error, endpoint, deadline)
    }
    if (!response.ok) throw await errorFromResponse(response)
    let payload: { ok?: unknown; value?: unknown; error?: { message?: unknown; code?: unknown } } = {}
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      // 非 JSON 响应
    }
    if (payload.ok === false) {
      // 稳定错误码随 Error 携带：调用方按 code 分支处理（如 ERR_REVISION_CONFLICT 冲突语义），
      // 而非仅展示通用 message。
      const error = new Error(String(payload?.error?.message ?? `工作流服务错误（HTTP ${response.status}）`)) as RemoteError
      const code = payload?.error?.code
      if (typeof code === 'string' && code) error.code = code
      throw error
    }
    return payload.value
  } finally {
    deadline.dispose()
  }
}

/**
 * 流式调用 Host API（SSE 透传）：POST /visual-workflow/<endpoint>，把服务端
 * SSE 的 data 行文本逐行回调（解析归调用方）；流结束 resolve。
 * 非 2xx（未写流头）抛出后端 message（含稳定 code）；AbortError 静默返回（调用方主动停止）。
 * 说明：SSE 是长连接，不设整体超时——生命周期由调用方 signal 掌握（谁创建谁释放）。
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
  if (!response.ok) throw await errorFromResponse(response)
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

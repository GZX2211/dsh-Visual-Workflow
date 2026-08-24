// src/host/remote/service-debug.ts
//
// 服务控制台调试流式代理：把浏览器发送的调试问题转发到「运行中服务」的
// OpenAI 兼容 /v1/chat/completions（stream: true），并把服务返回的 SSE 响应体
// 逐块转发回浏览器（打字机渲染）。
//
// 为什么必须经 Host 代理：
//   ① 服务进程 webServer 不输出 CORS 头，浏览器直连会被同源策略拦截；
//   ② apiKey 仅存在于 Host 侧配置，代理在服务端携带鉴权头，密钥不落浏览器；
//   ③ 调试会话用 `debug-` 前缀 userId 隔离，与真实多租户会话互不串扰。

/** 调试代理目标（运行中服务）。 */
export interface ServiceDebugTarget {
  /** 服务端口（serviceManager.status 返回）。 */
  port: number
  /** 服务鉴权密钥（null 表示未启用；配置后转发 Bearer）。 */
  apiKey: string | null
  /** 调试用 userId（`debug-<sessionId>`，隔离调试会话）。 */
  userId: string
}

/** 流式写出缝（Node ServerResponse 的最小面）。 */
export interface SseSink {
  write(chunk: string): void
  end(): void
}

/** 调试代理错误（status 供路由层映射；已写头前 sendJson / 写头后 SSE error 行）。 */
export class ServiceDebugError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ServiceDebugError'
    this.status = status
    this.code = code
  }
}

/** 上游服务非 2xx 时读取错误文本（SSE error 行 / OpenAI error 体 / 原始文本）。 */
async function upstreamErrorText(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } }
    if (payload?.error?.message) return String(payload.error.message)
  } catch {
    // 非 JSON 响应体，走原始文本
  }
  const text = await response.text().catch(() => '')
  return text.trim() || `服务返回 HTTP ${response.status}`
}

/**
 * 发起调试请求：POST 上游 /v1/chat/completions（stream: true），校验响应状态后
 * 返回响应 body 流。非 2xx 抛 ServiceDebugError（调用方此时尚未写响应头，
 * 可返回标准 JSON 错误）。为什么先 fetch 再写头：上游鉴权/参数错误应在
 * HTTP 状态码层透传，而不是伪装成 SSE 错误流。
 */
export async function openServiceDebug(
  target: ServiceDebugTarget,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response
  try {
    response = await fetchImpl(`http://127.0.0.1:${target.port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'workflow-debug',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        user_id: target.userId,
      }),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ServiceDebugError(502, `无法连接服务进程：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const message = await upstreamErrorText(response)
    if ((response.status === 401 || response.status === 403) && target.apiKey) {
      throw new ServiceDebugError(response.status, `${message}（调试代理已携带配置的 API Key）`)
    }
    throw new ServiceDebugError(response.status, message)
  }
  if (!response.body) {
    throw new ServiceDebugError(502, '服务流式响应无 body')
  }
  return response.body
}

/**
 * 把上游 SSE body 逐块转发到 sink（原有字节透传；打字机粒度由上游控制）。
 * AbortError 视为用户停止，静默收尾。
 */
export async function pumpServiceDebug(
  body: ReadableStream<Uint8Array>,
  sink: SseSink,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text) sink.write(text)
    }
    const tail = decoder.decode()
    if (tail) sink.write(tail)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw error
  } finally {
    sink.end()
  }
}

/** 转发一次调试请求（组合 open + pump；已写头场景用）。 */
export async function streamServiceDebug(
  target: ServiceDebugTarget,
  prompt: string,
  sink: SseSink,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const body = await openServiceDebug(target, prompt, fetchImpl, signal)
  await pumpServiceDebug(body, sink, signal)
}

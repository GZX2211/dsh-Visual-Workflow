// src/host/http-io.ts
//
// 宿主级横切契约：两个 HTTP 边界（GUI API 与模式二 OpenAI 兼容服务）共用的
// 请求体读取与 JSON 响应写出。
//
// 为什么在 host 根：这是两个以上模块以相同语义消费、且不含业务状态的最小契约
// （host/AGENTS.md「宿主级横切契约」）。上限与「超限错误」由调用方注入——两个边界
// 对外错误形状不同（HttpError vs OpenAiError），横切层只表达「读到了什么、何时超限、
// 请求流是否异常」这些事实，不决定各自的错误码语义。

/** 请求体读取的最小结构（官方 webServer 的 req 收窄：只用 data/end/error/destroy）。 */
export interface BodyRequest {
  on(event: string, listener: (chunk?: unknown) => void): unknown
  destroy?(): void
}

/** JSON 响应写出的最小结构。 */
export interface JsonResponseSink {
  writeHead(status: number, headers: Record<string, string>): unknown
  end(body: string): unknown
}

/**
 * 请求流异常（读取过程中 req 的 `error` 事件）。
 * 用稳定的 name 而非 instanceof 单个模块实例来分类：调用方（两个边界）据此把
 * 「客户端请求体未完整送达」判为调用方错误，而不是内部故障（D05-01）。
 */
export class RequestStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestStreamError'
  }
}

/** 是否请求流异常（跨边界分类用）。 */
export function isRequestStreamError(error: unknown): boolean {
  if (error instanceof RequestStreamError) return true
  return (error as { name?: unknown } | null | undefined)?.name === 'RequestStreamError'
}

/**
 * 读取请求体为 UTF-8 文本。
 *
 * 超限即 reject（以调用方注入的 errorOf 构造错误）并 destroy 请求；`settled` 保证
 * 无论超限、结束还是异常，只结算一次（后续块不再进入缓冲）。
 * 注意：这里不承担「超限后仍在缓冲」的修复——现网两份实现都已在入缓冲前 return
 * （见 reports/audit/CROSS-CUTTING.md §3.1）；settled 只用于保证结算唯一。
 */
export function readRequestBody(
  req: BodyRequest,
  options: { limit: number; errorOf(limit: number): Error },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += Buffer.byteLength(String(chunk ?? ''))
      if (size > options.limit) {
        settled = true
        reject(options.errorOf(options.limit))
        req.destroy?.()
        return
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? '')))
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      const message = error instanceof Error ? error.message : String(error)
      reject(new RequestStreamError(message))
    })
  })
}

/** 写出 JSON 响应（两个边界的公共形态：UTF-8 + no-store）。 */
export function sendJsonResponse(res: JsonResponseSink, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

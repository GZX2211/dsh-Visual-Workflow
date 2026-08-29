// src/host/remote/http.ts
//
// GUI API 传输层基础：HttpError（带状态与稳定 code）、请求体读取（上限 413）、
// JSON 响应写出与请求体上限常量。路由层与端点分发共用。

/** 请求体上限（64MB——文件模板 base64 上传需要大体积）。 */
const BODY_LIMIT = 64 * 1024 * 1024

/** HTTP 错误（status 供路由层写响应；code 供 client 分支处理）。 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code)
}

/** 读取请求体（JSON 文本；超限 413）。 */
export function readBody(req: { on(event: string, listener: (chunk?: unknown) => void): unknown; destroy?(): void }, limit = BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk) => {
      size += Buffer.byteLength(String(chunk ?? ''))
      if (size > limit) {
        reject(httpError(413, 'request body too large'))
        req.destroy?.()
        return
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? '')))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function sendJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body: string): unknown }, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

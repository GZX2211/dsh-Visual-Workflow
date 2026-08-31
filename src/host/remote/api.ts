// src/host/remote/api.ts
//
// GUI API 层入口（历史单一文件拆分后的收口文件）：
//   - 最终类 VisualWorkflowApi 汇聚继承链（VisualWorkflowApiBase ←
//     VisualWorkflowApiWorkflows ← VisualWorkflowApiTemplates ←
//     VisualWorkflowApiEcosystem ← VisualWorkflowApiCatalog ←
//     VisualWorkflowApiRuns），方法体逐字移动、零逻辑修改；
//   - 路由挂载 registerRoutes（POST /visual-workflow/<endpoint> 白名单分发）与
//     serviceDebug SSE 流式代理；re-export 拆分前的全部公共 API。

import * as EP from '../shared/protocol.js'
import { HttpError, httpError, readBody, sendJson } from './http.js'
import { openServiceDebug, pumpServiceDebug, ServiceDebugError, type SseSink } from './service-debug.js'
import type { ApiHost, WebServerLike } from './api-base.js'
import { VisualWorkflowApiScheduler } from './api-scheduler.js'

/**
 * GUI API 最终类：全部端点方法经继承链汇聚（端点白名单由共享协议常量派生）。
 */
export class VisualWorkflowApi extends VisualWorkflowApiScheduler {}

export function registerRoutes(
  ctx: { get(name: string): unknown; logger?: { warn?(message: string): void } },
  host: ApiHost,
): () => void {
  const api = new VisualWorkflowApi(ctx, host)
  const webServer = ctx.get('webServer') as WebServerLike | null | undefined
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[visual-workflow] webServer 服务不可用，GUI API 未挂载')
    return () => {}
  }
  return webServer.register({
    kind: 'prefix',
    path: '/visual-workflow',
    async handler(req, res) {
      const httpReq = req as { method?: unknown; url?: unknown }
      try {
        if (httpReq.method !== 'POST') {
          sendJson(res as never, 405, { ok: false, error: { message: 'method not allowed; use POST' } })
          return
        }
        const url = new URL(String(httpReq.url ?? '/'), 'http://localhost')
        const segments = url.pathname.split('/').filter(Boolean)
        const endpoint = segments[segments.length - 1] ?? ''
        let args: Record<string, unknown> = {}
        const body = await readBody(httpReq as never)
        if (body.trim()) {
          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch {
            throw httpError(400, 'invalid JSON body')
          }
          args = (parsed as { args?: Record<string, unknown> })?.args ?? {}
        }
        // 流式端点（serviceDebug）：SSE 透传，不走 JSON 分发
        if (endpoint === EP.EP_SERVICE_DEBUG) {
          await streamServiceDebugEndpoint(host, args, res as never, httpReq as never)
          return
        }
        const value = await api.handle(endpoint, args)
        sendJson(res as never, 200, { ok: true, value })
      } catch (error) {
        const code = (error as { code?: string })?.code ?? ''
        const status = error instanceof HttpError || error instanceof ServiceDebugError
          ? error.status
          : code === 'FLOW_REVISION_CONFLICT' || code === 'WF_LOCKED' || code === 'WF_SERVICE_RUNNING' || code === 'WF_SERVICE_NOT_RUNNING'
            ? 409
            : code === 'WF_SERVICE_NOT_FOUND'
              ? 404
              : code === 'WF_SERVICE_BAD_ID'
                ? 400
                : code === 'WF_FLOW_INVALID'
                  ? 422
                  : 500
        // 错误响应携带稳定 code（HttpError.code / 引擎 WfError.code），供前端按错误码分支
        // （如 FLOW_REVISION_CONFLICT 冲突时自动刷新，而非仅展示通用 message，Bug 20）。
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res as never, status, { ok: false, error: { message, ...(code ? { code } : {}) } })
      }
    },
  })
}

async function streamServiceDebugEndpoint(
  host: ApiHost,
  args: Record<string, unknown>,
  res: {
    writeHead(status: number, headers: Record<string, string>): unknown
    write(chunk: string): unknown
    end(body?: string): unknown
  },
  req: { on?(event: string, listener: () => void): unknown },
): Promise<void> {
  const serviceId = String(args?.serviceId ?? '')
  const sessionId = String(args?.sessionId ?? '')
  const prompt = String(args?.prompt ?? '')
  if (!serviceId || !sessionId || !prompt.trim()) {
    throw httpError(400, 'requires serviceId, sessionId and prompt')
  }
  const manager = host.serviceManager
  if (!manager) throw httpError(501, 'service manager unavailable')
  const status = (await manager.status(serviceId)) as { status?: string; port?: number } | null
  if (status?.status !== 'running' || !status.port) {
    throw httpError(409, '服务未运行，请先启动服务', 'WF_SERVICE_NOT_RUNNING')
  }
  const controller = new AbortController()
  // 浏览器断连时中止转发（避免残留请求占用服务并发槽）
  if (typeof req.on === 'function') {
    req.on('close', () => controller.abort())
  }
  let headSent = false
  try {
    // 先打开上游流并校验状态（401/400 等错误在写头前以 JSON 透传），再写 SSE 头
    const body = await openServiceDebug(
      { port: status.port, apiKey: host.apiKey ?? null, userId: `debug-${sessionId}` },
      prompt,
      fetch,
      controller.signal,
    )
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    headSent = true
    const sink: SseSink = {
      write: (chunk) => {
        try {
          res.write(chunk)
        } catch {
          // 浏览器已断开：中止上游请求，交由收尾
          controller.abort()
        }
      },
      end: () => {
        try {
          res.end()
        } catch {
          // 已断开：忽略
        }
      },
    }
    await pumpServiceDebug(body, sink, controller.signal)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    if (headSent) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`)
      } catch {
        // 已断开：忽略
      }
      res.end()
      return
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// re-export：原入口公共 API（拆分后外部引用路径不变）
// ---------------------------------------------------------------------------

export { HttpError } from './http.js'
export type { ApiHost } from './api-base.js'

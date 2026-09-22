// tests/host/api/service-debug-endpoint.test.ts
//
// 服务调试流式代理端点（api/service-debug-endpoint.ts + service-debug.ts）：
// 运行中服务 → SSE 逐块透传、调试 userId 隔离、鉴权头透传、未运行 409、
// 参数缺失 400 与上游状态透传。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRoutes } from '../../../src/host/api/index.js'
import { cleanupAll, makeHarness, type Harness } from './fixtures/api-harness.js'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupAll()
})

/** 构造上游 SSE 响应体（逐块下发）。 */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

/** fake res（记录写头与 SSE 块）。 */
function makeSseRes() {
  const chunks: string[] = []
  let head: { status: number; headers: Record<string, string> } | null = null
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      head = { status, headers }
    },
    write(chunk: string) {
      chunks.push(String(chunk))
    },
    end(body?: string) {
      if (body) chunks.push(String(body))
    },
  }
  return { res, chunks, head: () => head }
}

/** 注册路由并返回 handler。 */
async function registeredHandler(h: Harness): Promise<(req: unknown, res: unknown) => Promise<void>> {
  let registered: { handler: (req: unknown, res: unknown) => Promise<void> } | null = null
  h.ctx.services.set('webServer', {
    register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
      registered = route
      return () => {}
    },
  })
  registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
  return registered!.handler
}

const reqOf = (args: Record<string, unknown>) => ({
  method: 'POST',
  url: '/visual-workflow/serviceDebug',
  on(event: string, cb: (chunk?: unknown) => void) {
    if (event === 'data') cb(JSON.stringify({ args }))
    if (event === 'end') cb()
  },
  destroy() {},
})

describe('服务调试流式代理（serviceDebug）', () => {
  it('运行中服务：SSE 逐块透传 + 调试 userId 隔离 + 默认无鉴权头', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const fetchMock = vi.fn(async () => new Response(sseStream([
      'data: {"delta":{"content":"你好"}}\n\n',
      'data: [DONE]\n\n',
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await registeredHandler(h)
    const { res, chunks, head } = makeSseRes()

    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: '测试问题' }), res)

    expect(head()?.status).toBe(200)
    expect(head()?.headers['Content-Type']).toContain('text/event-stream')
    const joined = chunks.join('')
    expect(joined).toContain('data: {"delta":{"content":"你好"}}\n\n')
    expect(joined).toContain('data: [DONE]\n\n')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:7877/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.user_id).toBe('debug-session-9')
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: 'user', content: '测试问题' }])
    expect((init.headers as Record<string, string>)?.Authorization).toBeUndefined()
  })

  it('apiKey 已配置：转发携带 Bearer 鉴权头（密钥不落浏览器）', async () => {
    const h = await makeHarness()
    h.host.apiKey = 'sk-secret'
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const fetchMock = vi.fn(async () => new Response(sseStream(['data: [DONE]\n\n']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await registeredHandler(h)
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: 'hi' }), makeSseRes().res)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-secret')
  })

  it('服务未运行 → 409 WF_SERVICE_NOT_RUNNING（JSON 错误，未写流头）', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'stopped' }),
    } as never
    const handler = await registeredHandler(h)
    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      write(chunk: string) {
        responses[responses.length - 1].body += String(chunk)
      },
      end(body?: string) {
        responses[responses.length - 1].body += String(body ?? '')
        return this
      },
    }
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: 'hi' }), res)
    expect(responses[0].status).toBe(409)
    expect(JSON.parse(responses[0].body)).toMatchObject({ ok: false, error: { message: expect.stringContaining('未运行') } })
  })

  it('参数缺失 → 400；上游 401 → 状态透传（JSON）', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const handler = await registeredHandler(h)
    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      write(chunk: string) {
        responses[responses.length - 1].body += String(chunk)
      },
      end(body?: string) {
        responses[responses.length - 1].body += String(body ?? '')
        return this
      },
    }
    await handler(reqOf({ serviceId: 'svc-1' }), res)
    expect(responses[0].status).toBe(400)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"API Key 无效"}}', { status: 401 })))
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 's', prompt: 'hi' }), res)
    expect(responses[1].status).toBe(401)
    expect(JSON.parse(responses[1].body)).toMatchObject({ ok: false, error: { message: 'API Key 无效' } })
  })
})

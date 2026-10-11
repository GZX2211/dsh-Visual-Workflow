// tests/host/api/routes.test.ts
//
// GUI API 路由注册与错误映射（api/routes.ts）：注册/注销、方法校验（405）、
// 无效 JSON（400）、未知端点（404）、稳定错误码 → HTTP 状态映射。

import { afterEach, describe, expect, it } from 'vitest'
import { registerRoutes } from '../../../src/host/api/index.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('路由注册与错误映射', () => {
  it('registerRoutes：注册/注销、非 POST 405、无效 JSON 400、错误映射', async () => {
    const h = await makeHarness()
    let registered: { kind?: string; path?: string; handler?: (req: unknown, res: unknown) => Promise<void> } | null = null
    const fakeWebServer = {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {
          registered = null
        }
      },
    }
    h.ctx.services.set('webServer', fakeWebServer)
    const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    expect(registered).toMatchObject({ kind: 'prefix', path: '/visual-workflow' })

    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    /** 构造流式 req（data 触发一次 body、end 收尾；无 body 时仅 end）。 */
    const reqOf = (method: string, url: string, body?: string) => ({
      method,
      url,
      on(event: string, cb: (chunk?: unknown) => void) {
        if (event === 'data' && body !== undefined) cb(body)
        if (event === 'end') cb()
      },
      destroy() {},
    })

    // 非 POST → 405
    await registered!.handler!(reqOf('GET', '/visual-workflow/listWorkflows'), res)
    expect(responses[0].status).toBe(405)

    // 无效 JSON → 400
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{bad json'), res)
    expect(responses[1].status).toBe(400)

    // 正常端点（带 body）
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(responses[2].status).toBe(200)
    expect(JSON.parse(responses[2].body)).toMatchObject({ ok: true })

    // 未知端点 → 404
    await registered!.handler!(reqOf('POST', '/visual-workflow/nope'), res)
    expect(responses[3].status).toBe(404)

    // 错误响应携带稳定 code（Bug 20）：revision 冲突 → 409 + code 字段
    const conflictFlow = { id: 'flow-code-1', sessionId: 'session-1', mode: 'mode1', name: 'c', description: '', revision: 0, nodes: [], lines: [] }
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[4].status).toBe(200)
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[5].status).toBe(409)
    expect(JSON.parse(responses[5].body)).toMatchObject({ ok: false, error: { message: expect.any(String), code: 'FLOW_REVISION_CONFLICT' } })

    // 领域错误码 → HTTP 状态映射（transfer 领域码：历史上因错误类型不一致退化为 500）
    await registered!.handler!(reqOf('POST', '/visual-workflow/exportWorkflow', JSON.stringify({ args: { sessionId: 'session-1', id: 'nope' } })), res)
    expect(responses[6].status).toBe(404)
    expect(JSON.parse(responses[6].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_NOT_FOUND' } })
    await registered!.handler!(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: 'not-json' } })), res)
    expect(responses[7].status).toBe(400)
    expect(JSON.parse(responses[7].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_JSON' } })
    await registered!.handler!(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: '{"format":"x"}' } })), res)
    expect(responses[8].status).toBe(422)
    expect(JSON.parse(responses[8].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_BUNDLE' } })

    // disposer 生效
    dispose()
    expect(registered).toBeNull()
  })

  it('请求流错误 → 400（调用方请求未完整送达，不得坍缩为 500 内部故障）', async () => {
    const h = await makeHarness()
    let handler: ((req: unknown, res: unknown) => Promise<void>) | null = null
    const fakeWebServer = {
      register(route: { handler: (req: unknown, res: unknown) => Promise<void> }) {
        handler = route.handler
        return () => {}
      },
    }
    h.ctx.services.set('webServer', fakeWebServer)
    registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)

    const sent: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number) { sent.push({ status, body: '' }) },
      end(body: string) { if (sent.length > 0) sent[sent.length - 1].body = body },
    }
    const errorReq = {
      method: 'POST',
      url: '/visual-workflow/toolCombos',
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'error') listener(new Error('socket hang up'))
        return this
      },
      destroy() {},
    }
    await handler!(errorReq, res)
    expect(sent[0].status).toBe(400)
    expect(JSON.parse(sent[0].body)).toMatchObject({ ok: false })
  })
})

describe('GUI 边界来源校验与按端点 body 上限（K2）', () => {
  /** 注册前缀路由并返回 handler（本组用例独立装配，不依赖其它 describe 的状态）。 */
  async function registerGui(): Promise<(req: unknown, res: unknown) => Promise<void>> {
    const h = await makeHarness()
    let handler: ((req: unknown, res: unknown) => Promise<void>) | null = null
    h.ctx.services.set('webServer', {
      register(route: { handler: (req: unknown, res: unknown) => Promise<void> }) {
        handler = route.handler
        return () => {}
      },
    })
    registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    return handler!
  }

  function responseSink() {
    const sent: Array<{ status: number; body: string }> = []
    return {
      sent,
      writeHead(status: number) { sent.push({ status, body: '' }) },
      end(body: string) { if (sent.length > 0) sent[sent.length - 1].body = body },
    }
  }

  function requestOf(url: string, body: string, headers: Record<string, string> = {}) {
    return {
      method: 'POST',
      url,
      headers,
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data' && body !== '') listener(Buffer.from(body))
        if (event === 'end') listener()
        return this
      },
      destroy() {},
    }
  }

  it('跨站来源发起的写请求 → 403；本地同源请求放行', async () => {
    const handler = await registerGui()
    const res = responseSink()

    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}', {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      host: '127.0.0.1:19387',
    }), res)
    expect(res.sent.at(-1)?.status).toBe(403)
    expect(JSON.parse(res.sent.at(-1)!.body)).toMatchObject({ ok: false })

    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}', {
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:19387',
      host: '127.0.0.1:19387',
    }), res)
    expect(res.sent.at(-1)?.status).toBe(200)

    // 无来源头的本机客户端（curl/脚本）按「仅本机可信」定位放行
    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(res.sent.at(-1)?.status).toBe(200)
  })

  it('无参端点超过小上限 → 413（不再被强制收满 64MB）', async () => {
    const handler = await registerGui()
    const res = responseSink()
    const oversized = JSON.stringify({ args: { pad: 'x'.repeat(32 * 1024) } })
    await handler(requestOf('/visual-workflow/toolCombos', oversized), res)
    expect(res.sent.at(-1)?.status).toBe(413)
  })

  it('导入端点保留 64MB 档：3MB 体积不被按常规档拒绝', async () => {
    const handler = await registerGui()
    const res = responseSink()
    const body = JSON.stringify({ args: { json: 'x'.repeat(3 * 1024 * 1024) } })
    await handler(requestOf('/visual-workflow/importWorkflow', body), res)
    // 体积合法（不 413），内容不是合法 bundle → 400 领域码
    expect(res.sent.at(-1)?.status).toBe(400)
  })
})

describe('registerRoutes：webServer 缺失', () => {
  it('告警并返回 no-op disposer（不抛错、不注册）', async () => {
    const h = await makeHarness()
    const warns: string[] = []
    const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: (message) => warns.push(message) } }, h.host)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('webServer 服务不可用')
  })
})

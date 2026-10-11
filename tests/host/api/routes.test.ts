// tests/host/api/routes.test.ts
//
// GUI API 路由注册与错误映射（api/routes.ts）：注册/注销、方法校验（405）、
// 无效 JSON（400）、未知端点（404）、稳定错误码 → HTTP 状态映射。
//
// 每个用例聚焦一条契约（tests/AGENTS.md：一个测试聚焦一个行为），
// 因此各自装配独立的 handler 与响应接收器，不共享响应数组下标。

import { afterEach, describe, expect, it } from 'vitest'
import { registerRoutes } from '../../../src/host/api/index.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

type RouteHandler = (req: unknown, res: unknown) => Promise<void>

interface CapturedResponse {
  status: number
  body: string
}

/** 捕获 writeHead/end 的最小响应替身（每次请求 push 一条记录）。 */
function responseSink(): { sent: CapturedResponse[]; res: unknown } {
  const sent: CapturedResponse[] = []
  const res = {
    writeHead(status: number) {
      sent.push({ status, body: '' })
      return this
    },
    end(body: string) {
      sent[sent.length - 1].body = String(body ?? '')
      return this
    },
  }
  return { sent, res }
}

/** 构造流式 req（data 触发一次 body、end 收尾；无 body 时仅 end）。 */
function reqOf(method: string, url: string, body?: string) {
  return {
    method,
    url,
    on(event: string, cb: (chunk?: unknown) => void) {
      if (event === 'data' && body !== undefined) cb(body)
      if (event === 'end') cb()
    },
    destroy() {},
  }
}

/** 装配被测 handler：注册前缀路由并返回 handler 与 disposer。 */
async function registerHandler(): Promise<{
  handler: RouteHandler
  dispose: () => void
  isRegistered: () => boolean
}> {
  const h = await makeHarness()
  const registered: { route: { kind?: string; path?: string; handler?: RouteHandler } | null } = { route: null }
  h.ctx.services.set('webServer', {
    register(route: { kind: string; path: string; handler: RouteHandler }) {
      registered.route = route
      return () => {
        registered.route = null
      }
    },
  })
  const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
  const handler: RouteHandler | undefined = registered.route?.handler
  if (!handler) throw new Error('registerRoutes 未注册 handler')
  return { handler, dispose, isRegistered: () => registered.route !== null }
}

describe('路由注册与注销', () => {
  it('以前缀路由注册到 /visual-workflow；disposer 注销生效', async () => {
    const { dispose, isRegistered } = await registerHandler()
    expect(isRegistered()).toBe(true)
    dispose()
    expect(isRegistered()).toBe(false)
  })
})

describe('方法校验与请求解析', () => {
  it('非 POST → 405', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    await handler(reqOf('GET', '/visual-workflow/listWorkflows'), res)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(405)
  })

  it('请求体不是合法 JSON → 400', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    await handler(reqOf('POST', '/visual-workflow/toolCombos', '{bad json'), res)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(400)
  })

  it('合法请求 → 200 且响应体 ok:true', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    await handler(reqOf('POST', '/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(200)
    expect(JSON.parse(sent[0].body)).toMatchObject({ ok: true })
  })

  it('未知端点 → 404', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    await handler(reqOf('POST', '/visual-workflow/nope'), res)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(404)
  })
})

describe('稳定错误码 → HTTP 状态映射', () => {
  it('乐观锁冲突 → 409 且响应体带 FLOW_REVISION_CONFLICT', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    const conflictFlow = { id: 'flow-code-1', sessionId: 'session-1', mode: 'mode1', name: 'c', description: '', revision: 0, nodes: [], lines: [] }
    const body = JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })
    // 首次写入成功（rev 0 → 1），第二次携带同一 rev 0 → 冲突
    await handler(reqOf('POST', '/visual-workflow/putWorkflow', body), res)
    expect(sent.at(-1)?.status).toBe(200)
    await handler(reqOf('POST', '/visual-workflow/putWorkflow', body), res)
    expect(sent.at(-1)?.status).toBe(409)
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ ok: false, error: { message: expect.any(String), code: 'FLOW_REVISION_CONFLICT' } })
  })

  it('transfer 领域码：NOT_FOUND → 404、INVALID_JSON → 400、INVALID_BUNDLE → 422（不退化为 500）', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()

    await handler(reqOf('POST', '/visual-workflow/exportWorkflow', JSON.stringify({ args: { sessionId: 'session-1', id: 'nope' } })), res)
    expect(sent.at(-1)?.status).toBe(404)
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_NOT_FOUND' } })

    await handler(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: 'not-json' } })), res)
    expect(sent.at(-1)?.status).toBe(400)
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_JSON' } })

    await handler(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: '{"format":"x"}' } })), res)
    expect(sent.at(-1)?.status).toBe(422)
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_BUNDLE' } })
  })
})

describe('请求流错误', () => {
  it('请求流错误 → 400（调用方请求未完整送达，不得坍缩为 500 内部故障）', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    const errorReq = {
      method: 'POST',
      url: '/visual-workflow/toolCombos',
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'error') listener(new Error('socket hang up'))
        return this
      },
      destroy() {},
    }
    await handler(errorReq, res)
    expect(sent[0].status).toBe(400)
    expect(JSON.parse(sent[0].body)).toMatchObject({ ok: false })
  })
})

describe('GUI 边界来源校验与按端点 body 上限（K2）', () => {
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
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()

    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}', {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      host: '127.0.0.1:19387',
    }), res)
    expect(sent.at(-1)?.status).toBe(403)
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ ok: false })

    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}', {
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:19387',
      host: '127.0.0.1:19387',
    }), res)
    expect(sent.at(-1)?.status).toBe(200)

    // 无来源头的本机客户端（curl/脚本）按「仅本机可信」定位放行
    await handler(requestOf('/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(sent.at(-1)?.status).toBe(200)
  })

  it('无参端点超过小上限 → 413（不再被强制收满 64MB）', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    const oversized = JSON.stringify({ args: { pad: 'x'.repeat(32 * 1024) } })
    await handler(requestOf('/visual-workflow/toolCombos', oversized), res)
    expect(sent.at(-1)?.status).toBe(413)
  })

  it('导入端点保留 64MB 档：3MB 体积不被按常规档拒绝', async () => {
    const { handler } = await registerHandler()
    const { sent, res } = responseSink()
    const body = JSON.stringify({ args: { json: 'x'.repeat(3 * 1024 * 1024) } })
    await handler(requestOf('/visual-workflow/importWorkflow', body), res)
    // 体积合法（不 413），内容不是合法 bundle → 400 领域码
    expect(sent.at(-1)?.status).toBe(400)
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

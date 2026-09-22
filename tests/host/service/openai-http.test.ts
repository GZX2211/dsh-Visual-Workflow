// tests/host/service/openai-http.test.ts
//
// OpenAI 兼容 **HTTP 适配层**单测：SSE 序列化纯函数形态、路由注册（exact 白名单）、
// webServer 缺失时的降级、流式/非流式响应、鉴权与参数错误的 HTTP 状态映射。
// 核心（会话/编排语义）单测见 ./openai-api.test.ts。

import { describe, expect, it } from 'vitest'
import {
  completionJson,
  errorJson,
  OpenAiError,
  registerOpenAiApi,
  sseChunk,
  sseDone,
  sseError,
} from '../../../src/host/service/index.js'
import { makeHarness } from './fixtures/openai-fixture.js'

describe('SSE 纯函数', () => {
  it('sseChunk：OpenAI chunk 形态 + delta/finish_reason', () => {
    const line = sseChunk('chatcmpl-1', 'm', '你好', null)
    expect(line.startsWith('data: ')).toBe(true)
    const payload = JSON.parse(line.slice(6))
    expect(payload.choices[0].delta.content).toBe('你好')
    expect(payload.choices[0].finish_reason).toBeNull()
  })

  it('sseDone / sseError / completionJson / errorJson 形态', () => {
    expect(sseDone()).toBe('data: [DONE]\n\n')
    expect(sseError('boom')).toContain('"boom"')
    const json = completionJson('chatcmpl-1', 'm', '回答')
    expect((json.choices as Array<{ message: { content: string } }>)[0].message.content).toBe('回答')
    expect(errorJson(new OpenAiError(401, 'authentication_error', 'invalid_api_key', 'bad'))).toMatchObject({
      error: { type: 'authentication_error', code: 'invalid_api_key' },
    })
  })
})

describe('registerOpenAiApi（路由薄壳）', () => {
  function routeHarness() {
    const routes: Array<{ kind: string; path: string; handler(req: unknown, res: unknown): Promise<void> }> = []
    const webServer = {
      register: (route: { kind: string; path: string; handler(req: unknown, res: unknown): Promise<void> }) => {
        routes.push(route)
        return () => {}
      },
    }
    const ctx = {
      get: (name: string) => (name === 'webServer' ? webServer : null),
      logger: { warn() {} },
    }
    return { ctx, routes }
  }

  it('注册 /v1/chat/completions 与 /v1/models 两个 exact 路由', () => {
    const h = makeHarness()
    const { ctx, routes } = routeHarness()
    const dispose = registerOpenAiApi(ctx as never, h.api)
    expect(routes.map((r) => r.path).sort()).toEqual(['/v1/chat/completions', '/v1/models'])
    expect(routes.every((r) => r.kind === 'exact')).toBe(true)
    dispose()
  })

  it('webServer 缺失时告警降级（不抛错）', () => {
    const h = makeHarness()
    const dispose = registerOpenAiApi({ get: () => null, logger: { warn() {} } } as never, h.api)
    dispose()
  })

  it('POST 流式请求：SSE 头 + chunk 行 + [DONE]', async () => {
    const h = makeHarness()
    const { ctx, routes } = routeHarness()
    registerOpenAiApi(ctx as never, h.api)
    const handler = routes.find((r) => r.path === '/v1/chat/completions')!.handler
    const chunks: string[] = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        chunks.push(`HEAD ${status} ${Object.entries(headers).map(([k, v]) => `${k}=${v}`).join(' ')}`)
      },
      write(chunk: string) { chunks.push(chunk) },
      end() {},
    }
    const req = {
      method: 'POST',
      headers: {},
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: '问题' }], user_id: 'u-1', stream: true })))
        if (event === 'end') listener()
        return this
      },
    }
    await handler(req, res)
    expect(chunks[0].startsWith('HEAD 200')).toBe(true)
    expect(chunks.some((c) => c.includes('text/event-stream'))).toBe(true)
    expect(chunks.some((c) => c.startsWith('data: [DONE]'))).toBe(true)
  })

  it('POST 非流式请求：完整 JSON 响应', async () => {
    const h = makeHarness()
    const { ctx, routes } = routeHarness()
    registerOpenAiApi(ctx as never, h.api)
    const handler = routes.find((r) => r.path === '/v1/chat/completions')!.handler
    const sent: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number) { sent.push({ status, body: '' }) },
      end(body: string) { if (sent.length > 0) sent[sent.length - 1].body = body },
    }
    const req = {
      method: 'POST',
      headers: {},
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: '问题' }], user_id: 'u-1' })))
        if (event === 'end') listener()
        return this
      },
    }
    await handler(req, res)
    expect(sent[0].status).toBe(200)
    const payload = JSON.parse(sent[0].body)
    expect(payload.choices[0].message.content).toBe('')
  })

  it('鉴权失败 401；缺 userId 400；GET /v1/models 200', async () => {
    const h = makeHarness({ apiKey: 'k-1' })
    const { ctx, routes } = routeHarness()
    registerOpenAiApi(ctx as never, h.api)
    const chat = routes.find((r) => r.path === '/v1/chat/completions')!.handler
    const models = routes.find((r) => r.path === '/v1/models')!.handler
    const sent: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number) { sent.push({ status, body: '' }) },
      end(body: string) { if (sent.length > 0) sent[sent.length - 1].body = body },
    }
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data') listener(Buffer.from('{}'))
        if (event === 'end') listener()
        return this
      },
    }
    await chat(req, res)
    expect(sent.at(-1)?.status).toBe(401)
    // 鉴权通过后缺 userId → 400
    const req2 = { ...req, headers: { authorization: 'Bearer k-1' } }
    await chat(req2, res)
    expect(sent.at(-1)?.status).toBe(400)
    // models GET
    await models({ method: 'GET' }, res)
    expect(sent.at(-1)?.status).toBe(200)
  })
})

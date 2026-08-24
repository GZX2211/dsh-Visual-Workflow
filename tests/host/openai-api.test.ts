// tests/host/openai-api.test.ts
//
// OpenAI 兼容 API 单测（T-032，fake orchestrator/store/agent）：
//   请求解析（userId/问题提取/stream）、鉴权 401、并发 429、编排调用参数
//   （mode2+question）、断点自动续跑、SSE 流式增量与 [DONE]、非流式 JSON、
//   /v1/models、SSE 纯函数。

import { describe, expect, it } from 'vitest'
import type { RunStatus } from '../../src/host/shared/types.js'
import {
  OpenAiApi,
  OpenAiError,
  parseChatRequest,
  registerOpenAiApi,
  sseChunk,
  sseDone,
  sseError,
  completionJson,
  errorJson,
} from '../../src/host/service/openai-api.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'
import type { ServiceState } from '../../src/host/shared/types.js'

/** fake 数据层（openai-api 用到的面）。 */
class FakeStore {
  runs: RunSnapshot[] = []
  service: ServiceState | null = null
  async getRun(id: string): Promise<RunSnapshot | null> {
    return this.runs.find((run) => run.id === id) ?? null
  }
  async listRuns(flowId: string): Promise<RunSnapshot[]> {
    return this.runs.filter((run) => run.flowId === flowId)
  }
  async getServiceById(): Promise<ServiceState | null> {
    return this.service
  }
}

/** fake 编排器（记录调用；终态可控）。 */
class FakeOrchestrator {
  startCalls: Array<{ sessionId: string; flowId: string; mode: string; question: string }> = []
  resumeCalls: Array<{ sessionId: string; flowId: string }> = []
  status: RunStatus = 'completed'
  nextRunId = 'run-1'
  async startRun(input: { sessionId: string; flowId: string; mode: string; question?: string }) {
    this.startCalls.push({ ...input, question: input.question ?? '' })
    return { runId: this.nextRunId, defPath: '/def.json' }
  }
  async resumeRun(input: { sessionId: string; flowId: string }) {
    this.resumeCalls.push(input)
    return { runId: 'run-resumed', defPath: '/def.json' }
  }
  runSnapshot(): { status: RunStatus; summary: string } | null {
    return { status: this.status, summary: '摘要' }
  }
}

interface Harness {
  api: OpenAiApi
  store: FakeStore
  orchestrator: FakeOrchestrator
  sweeps: { count: number }
  sessions: Map<string, string>
}

function makeHarness(options: { apiKey?: string | null; maxConcurrent?: number; status?: RunStatus } = {}): Harness {
  const store = new FakeStore()
  const orchestrator = new FakeOrchestrator()
  orchestrator.status = options.status ?? 'completed'
  const sweeps = { count: 0 }
  const sessions = new Map<string, string>()
  let seq = 0
  const api = new OpenAiApi({
    store: store as never,
    orchestrator: orchestrator as never,
    serviceId: 'svc-1',
    apiKey: options.apiKey ?? null,
    maxConcurrent: options.maxConcurrent ?? 50,
    resolveSession: async (userId) => {
      let sid = sessions.get(userId)
      if (!sid) {
        sid = `session-${++seq}`
        sessions.set(userId, sid)
      }
      return sid
    },
    ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } }, provider: 'deepseek', model: 'deepseek-chat' }),
    sweep: async () => { sweeps.count += 1 },
    pollMs: 1,
  })
  return { api, store, orchestrator, sweeps, sessions }
}

function pausedRun(id: string): RunSnapshot {
  return {
    id,
    flowId: 'svc-1',
    flowName: '服务',
    sessionId: 'session-1',
    mode: 'mode2',
    status: 'paused',
    startedAt: '2026-08-24T00:00:00.000Z',
    endedAt: null,
    summary: '',
    nodes: [],
  }
}

describe('parseChatRequest', () => {
  it('body user_id 解析；问题取末条 user 文本', () => {
    const parsed = parseChatRequest({
      messages: [
        { role: 'system', content: 'x' },
        { role: 'user', content: '第一条' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: [{ type: 'text', text: '真正的问题' }] },
      ],
      user_id: 'user-1',
    })
    expect(parsed).toMatchObject({ userId: 'user-1', question: '真正的问题', stream: false })
  })

  it('Header X-User-Id 兜底（body 缺 user_id）', () => {
    const parsed = parseChatRequest({ messages: [{ role: 'user', content: 'q' }] }, 'user-from-header')
    expect(parsed.userId).toBe('user-from-header')
  })

  it('缺 userId → 400', () => {
    try {
      parseChatRequest({ messages: [{ role: 'user', content: 'q' }] })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiError)
      expect((error as OpenAiError).status).toBe(400)
    }
  })

  it('messages 空/无 user 内容 → 400', () => {
    expect(() => parseChatRequest({ messages: [] })).toThrowError(OpenAiError)
    expect(() => parseChatRequest({ messages: [{ role: 'assistant', content: 'x' }] })).toThrowError(OpenAiError)
  })

  it('stream=true 透传', () => {
    expect(parseChatRequest({ messages: [{ role: 'user', content: 'q' }], stream: true, user_id: 'u' }).stream).toBe(true)
  })
})

describe('OpenAiApi.authorize', () => {
  it('apiKey 关闭时放行', () => {
    const h = makeHarness({ apiKey: null })
    expect(() => h.api.authorize('')).not.toThrow()
  })

  it('apiKey 匹配 Bearer 通过；缺失/错误 401', () => {
    const h = makeHarness({ apiKey: 'secret-1' })
    expect(() => h.api.authorize('Bearer secret-1')).not.toThrow()
    expect(() => h.api.authorize('')).toThrowError(OpenAiError)
    try {
      h.api.authorize('Bearer wrong')
      expect.unreachable()
    } catch (error) {
      expect((error as OpenAiError).status).toBe(401)
    }
  })
})

describe('OpenAiApi.acquire（并发上限）', () => {
  it('超过上限 429；释放后可再进', () => {
    const h = makeHarness({ maxConcurrent: 2 })
    const release1 = h.api.acquire()
    const release2 = h.api.acquire()
    expect(() => h.api.acquire()).toThrowError(OpenAiError)
    try {
      h.api.acquire()
      expect.unreachable()
    } catch (error) {
      expect((error as OpenAiError).status).toBe(429)
    }
    release1()
    expect(() => h.api.acquire()).not.toThrow()
    release2()
  })

  it('并发槽释放幂等', () => {
    const h = makeHarness({ maxConcurrent: 1 })
    const release = h.api.acquire()
    release()
    release()
    expect(() => h.api.acquire()).not.toThrow()
  })
})

describe('OpenAiApi.runChat', () => {
  it('全新运行：mode2 + question + 用户问题注入；终态 completed 返回文本', async () => {
    const h = makeHarness()
    const result = await h.api.runChat({ userId: 'user-1', question: '今天天气如何', stream: false })
    expect(h.orchestrator.startCalls).toHaveLength(1)
    expect(h.orchestrator.startCalls[0]).toMatchObject({ sessionId: 'session-1', flowId: 'svc-1', mode: 'mode2', question: '今天天气如何' })
    expect(result).toMatchObject({ status: 'completed', runId: 'run-1', text: '' })
    expect(h.sessions.get('user-1')).toBe('session-1')
  })

  it('存在断点（paused）时自动续跑而非全新启动', async () => {
    const h = makeHarness()
    h.store.runs.push(pausedRun('run-old'))
    const result = await h.api.runChat({ userId: 'user-1', question: '继续', stream: false })
    expect(h.orchestrator.resumeCalls).toHaveLength(1)
    expect(h.orchestrator.resumeCalls[0]).toMatchObject({ sessionId: 'session-1', flowId: 'svc-1' })
    expect(h.orchestrator.startCalls).toHaveLength(0)
    expect(result.runId).toBe('run-resumed')
  })

  it('父代理回合事件增量驱动流式回调（assistant/message 文本增量）', async () => {
    const h = makeHarness()
    // 事件在请求前已存在：seq 0 起全部可见（回合未结束也先 flush 增量）
    const agent = { followup() {}, session: { seq: 0, events: [
      { seq: 0, type: 'turn/start', data: {} },
      { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好，' }] } } },
      { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好，世界' }] } } },
      { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ] } }
    const deltas: string[] = []
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => 'session-1',
      ensureRootAgent: async () => ({ agent }),
      sweep: async () => {},
      pollMs: 1,
    })
    const result = await api.runChat({ userId: 'user-1', question: 'q', stream: true }, (delta) => deltas.push(delta))
    expect(deltas).toEqual(['你好，', '世界'])
    expect(result).toMatchObject({ status: 'completed', text: '你好，世界' })
  })

  it('run 终态 failed → error 描述', async () => {
    const h = makeHarness({ status: 'failed' })
    const result = await h.api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(result.status).toBe('failed')
    expect(result.error).toBeTruthy()
  })

  it('每轮轮询推进 watchdog（sweep 被调用）', async () => {
    const h = makeHarness()
    await h.api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(h.sweeps.count).toBeGreaterThan(0)
  })
})

describe('OpenAiApi.models', () => {
  it('返回父代理节点模型信息', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 's', name: '服务', description: '', revision: 1,
      nodes: [{ id: 'n-parent', kind: 'parent', position: { x: 0, y: 0 }, data: { label: '父', systemPrompt: '', provider: 'deepseek', model: 'deepseek-chat', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null, proxySourceId: null } }],
      lines: [], createdAt: '', updatedAt: '', status: 'running',
    } as ServiceState
    const models = await h.api.models()
    expect(models.data).toEqual([{ id: 'deepseek-chat', object: 'model', owned_by: 'deepseek', created: 0 }])
  })

  it('无父代理节点时返回空列表', async () => {
    const h = makeHarness()
    expect((await h.api.models()).data).toEqual([])
  })
})

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

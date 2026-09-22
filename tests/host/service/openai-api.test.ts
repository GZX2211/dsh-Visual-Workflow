// tests/host/service/openai-api.test.ts
//
// OpenAI 兼容 API **核心**单测（T-032，fake orchestrator/store/agent）：
//   请求解析（userId/问题提取/stream）、鉴权 401、并发 429、编排调用参数
//   （mode2+question）、断点自动续跑、服务级新会话、流式增量回调、超时与客户端断开、
//   /v1/models。
// HTTP/SSE 适配层单测见 ./openai-http.test.ts。

import { describe, expect, it } from 'vitest'
import { OpenAiApi, OpenAiError, parseChatRequest } from '../../../src/host/service/index.js'
import type { ServiceState } from '../../../src/host/shared/types.js'
import { makeHarness, pausedRun } from './fixtures/openai-fixture.js'

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

  it('服务级新会话：每请求新建会话（cwd=工作区）+ 全新启动（不复用断点）', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 'session-1', name: '服务', description: '', revision: 1,
      nodes: [], lines: [], createdAt: '', updatedAt: '',
      startNewSession: true, workspacePath: 'D:\\work\\svc-ws',
      status: 'stopped',
    }
    // 断点存在也不续跑（新会话模式每请求全新会话）
    h.store.runs.push(pausedRun('run-old'))
    const created: Array<{ label?: string; cwd?: string }> = []
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => { throw new Error('新会话模式不应走映射') },
      createSession: async (options) => { created.push(options); return 'session-fresh' },
      ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } } }),
      sweep: async () => {},
      pollMs: 1,
    })
    await api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ cwd: 'D:\\work\\svc-ws' })
    expect(h.orchestrator.startCalls[0]).toMatchObject({ sessionId: 'session-fresh', mode: 'mode2' })
    expect(h.orchestrator.resumeCalls).toHaveLength(0)
  })

  it('服务级新会话：工作区路径两侧空白被裁剪后作为 cwd', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 'session-1', name: '服务', description: '', revision: 1,
      nodes: [], lines: [], createdAt: '', updatedAt: '',
      startNewSession: true, workspacePath: '  D:\\work\\pad-ws  ',
      status: 'stopped',
    }
    const created: Array<{ cwd?: string }> = []
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => 'session-1',
      createSession: async (options) => { created.push(options); return 'session-fresh' },
      ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } } }),
      sweep: async () => {},
      pollMs: 1,
    })
    await api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(created[0]?.cwd).toBe('D:\\work\\pad-ws')
  })

  it('服务级新会话：无工作区配置 → 不传 cwd（不继承、不猜测）', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 'session-1', name: '服务', description: '', revision: 1,
      nodes: [], lines: [], createdAt: '', updatedAt: '',
      startNewSession: true, status: 'stopped',
    }
    const created: Array<{ cwd?: string }> = []
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => 'session-1',
      createSession: async (options) => { created.push(options); return 'session-fresh' },
      ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } } }),
      sweep: async () => {},
      pollMs: 1,
    })
    await api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(created).toHaveLength(1)
    expect(created[0]?.cwd).toBeUndefined()
  })

  it('服务级新会话：createSession 能力缺失时回退会话映射（防御）', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 'session-1', name: '服务', description: '', revision: 1,
      nodes: [], lines: [], createdAt: '', updatedAt: '',
      startNewSession: true, status: 'stopped',
    }
    const result = await h.api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(h.orchestrator.startCalls[0]).toMatchObject({ sessionId: 'session-1' })
    expect(result.runId).toBe('run-1')
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

  it('Bug 22：runChat 等待超时（默认 5 分钟起步，可配置）→ 终止运行并抛 generation_timeout', async () => {
    const h = makeHarness({ status: 'running' }) // run 永不终态：靠超时兜底
    await expect(h.api.runChat(
      { userId: 'user-1', question: 'q', stream: false },
      undefined,
      { timeoutMs: 1 },
    )).rejects.toMatchObject({ status: 504, code: 'generation_timeout' })
    // 后台编排运行被显式停止（此前无限轮询，运行与并发槽长期占用）
    expect(h.orchestrator.stopCalls).toContain('run-1')
  })

  it('Bug 23：客户端断开（signal aborted）→ 停止后台运行并抛 client_closed', async () => {
    const h = makeHarness({ status: 'running' })
    const controller = new AbortController()
    controller.abort()
    await expect(h.api.runChat(
      { userId: 'user-1', question: 'q', stream: true },
      undefined,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: 'client_closed' })
    expect(h.orchestrator.stopCalls).toContain('run-1')
  })

  it('缺省超时不生效于正常快路径（默认 5 分钟上界不截断已完成请求）', async () => {
    const h = makeHarness()
    const result = await h.api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(result.status).toBe('completed')
    expect(h.orchestrator.stopCalls).toHaveLength(0)
  })
})

describe('OpenAiApi.models', () => {
  it('返回父代理节点模型信息', async () => {
    const h = makeHarness()
    h.store.service = {
      id: 'svc-1', sessionId: 's', name: '服务', description: '', revision: 1,
      nodes: [{ id: 'n-parent', kind: 'parent', position: { x: 0, y: 0 }, data: { label: '父', systemPrompt: '', provider: 'deepseek', model: 'deepseek-chat', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null } }],
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

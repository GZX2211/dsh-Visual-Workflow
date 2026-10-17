// tests/host/service/openai-api.test.ts
//
// OpenAI 兼容 API **核心**单测（T-032，fake orchestrator/store/agent）：
//   请求解析（userId/问题提取/stream）、鉴权 401、并发 429、编排调用参数
//   （mode2+question）、断点自动续跑、服务级新会话、流式增量回调、超时与客户端断开、
//   /v1/models。
// HTTP/SSE 适配层单测见 ./openai-http.test.ts。

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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

  it('密钥比较走恒定时间原语（源码级守卫：timingSafeEqual + sha256 等长摘要，无直接字符串短路）', () => {
    // 时序侧信道无法用行为断言观测，故守卫写在源码：新增/回退比较方式必须显式改这里。
    const source = readFileSync(new URL('../../../src/host/service/openai-api.ts', import.meta.url), 'utf8')
    expect(source).toContain('timingSafeEqual')
    expect(source).toContain("createHash('sha256')")
    // 修复前的写法：header !== expected —— 会在首个不同字节短路
    expect(source).not.toMatch(/header\s*!==\s*expected/)
    expect(source).not.toMatch(/if\s*\(\s*header\s*===/)
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
    const created: Array<{ cwd?: string }> = []
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

  it('每轮轮询推进 watchdog：轮询次数 N ⇒ sweep 调用 N 次（与终态判定配对）', async () => {
    const h = makeHarness({ status: 'running' })
    // 让轮询次数成为受控事实：前 2 次快照仍在运行，第 3 次给出终态。
    // 本用例把「每轮都推进 watchdog」锁成等值断言：轮询 N 次 ⇒ sweep 恰好 N 次；
    // 只断言 sweep 被执行过，无法发现「某轮忘记推进 watchdog」的回归。
    const pollRounds = 3
    let snapshotCalls = 0
    h.orchestrator.runSnapshot = () => {
      snapshotCalls += 1
      return { status: snapshotCalls < pollRounds ? 'running' : 'completed', summary: '摘要' }
    }
    const result = await h.api.runChat({ userId: 'user-1', question: 'q', stream: false })
    expect(snapshotCalls).toBe(pollRounds)
    expect(h.sweeps.count).toBe(pollRounds)
    expect(result).toMatchObject({ status: 'completed', runId: 'run-1' })
  })

  it('Bug 22：runChat 等待超时（默认 5 分钟起步，可配置）→ 终止运行并抛 generation_timeout', async () => {
    const h = makeHarness({ status: 'running' }) // run 永不终态：靠超时兜底
    await expect(h.api.runChat(
      { userId: 'user-1', question: 'q', stream: false },
      undefined,
      { timeoutMs: 1 },
    )).rejects.toMatchObject({ status: 504, code: 'generation_timeout' })
    // 后台编排运行必须被显式停止：不停止则轮询不止，运行与并发槽被长期占用
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

  it('客户端断开：signal abort 立即停止后台运行（不等下一轮 sweep/轮询）', async () => {
    const h = makeHarness({ status: 'running' })
    let releaseSweep!: () => void
    const gate = new Promise<void>((resolve) => { releaseSweep = resolve })
    let sweeps = 0
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => 'session-1',
      ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } } }),
      // 首轮扫描挂起：abort 必须在这一轮扫描在途时就停掉运行，
      // 而不是等「扫描返回 → 判终态 → sleep → 下一轮 isAborted」走完（旧实现多一个完整周期）。
      sweep: () => { sweeps += 1; return gate },
      pollMs: 1,
    })
    const controller = new AbortController()
    const pending = api.runChat({ userId: 'user-1', question: 'q', stream: true }, undefined, { signal: controller.signal })
    const settled = pending.then(() => null, (error: OpenAiError) => error)

    await vi.waitFor(() => {
      if (sweeps < 1) throw new Error('首轮 sweep 未开始')
    }, { timeout: 2_000 })
    controller.abort()
    await vi.waitFor(() => {
      if (!h.orchestrator.stopCalls.includes('run-1')) throw new Error('abort 未立即停止运行')
    }, { timeout: 2_000 })

    releaseSweep()
    expect((await settled)?.code).toBe('client_closed')
  })

  it('正常终态：abort 监听器被摘除（不留监听器泄漏）', async () => {
    const h = makeHarness()
    const listeners = new Set<() => void>()
    const signal = {
      aborted: false,
      addEventListener: (type: string, listener: () => void) => { if (type === 'abort') listeners.add(listener) },
      removeEventListener: (type: string, listener: () => void) => { if (type === 'abort') listeners.delete(listener) },
    } as unknown as AbortSignal

    const result = await h.api.runChat({ userId: 'user-1', question: 'q', stream: false }, undefined, { signal })
    expect(result.status).toBe('completed')
    expect(listeners.size).toBe(0)
  })
})

describe('OpenAiApi.sweep（跨请求 in-flight 去重）', () => {
  it('重叠推进共享同一次扫描（与 SchedulerEngine.sweep 同构）；结束后可再次推进', async () => {
    const h = makeHarness()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const api = new OpenAiApi({
      store: h.store as never,
      orchestrator: h.orchestrator as never,
      serviceId: 'svc-1',
      apiKey: null,
      maxConcurrent: 50,
      resolveSession: async () => 'session-1',
      ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } } }),
      sweep: () => { calls += 1; return gate },
      pollMs: 1,
    })

    // 同一时刻两次推进（并发请求的轮询）：只应真正扫一次
    const first = api.sweep()
    const second = api.sweep()
    await Promise.resolve()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)

    // 去重不粘住：扫描结束后下一次推进照常执行
    await api.sweep()
    expect(calls).toBe(2)
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

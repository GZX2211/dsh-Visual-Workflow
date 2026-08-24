// src/host/service/openai-api.ts
//
// 模式二服务进程内的 OpenAI 兼容 API：
//   POST /v1/chat/completions —— 流式（SSE 打字机）/ 非流式（完整 JSON）
//   GET  /v1/models           —— 服务信息（兼容客户端发现）
//
// 请求处理链：鉴权（可选 Bearer）→ userId 校验（缺失 400）→ 并发上限（429）→
// 问题提取（messages 末条 user 文本）→ 会话解析（userId→sessionId 持久化映射）→
// 根 Agent 恢复/创建 → 编排运行（mode2；有断点自动续跑）→ 父代理回合
// assistant/message 事件增量经轮询推进为 SSE 流；回合结束且 run 终态后收尾。
//
// 轮询推进同时调用 deps.sweep()（watchdog 单次扫描）——服务进程内看护周期
// 默认 15s，请求等待需主动推进状态机（父代理回合终态判定/空闲超时）。

import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from '../orchestrator/runtime.js'
import type { RunStatus } from '../shared/types.js'
import { findResumableRun } from '../orchestrator/resume.js'

/** OpenAI 兼容错误（status 供 HTTP 层；type/code 供 error body）。 */
export class OpenAiError extends Error {
  readonly status: number
  readonly type: string
  readonly code: string
  constructor(status: number, type: string, code: string, message: string) {
    super(message)
    this.name = 'OpenAiError'
    this.status = status
    this.type = type
    this.code = code
  }
}

/** 请求体上限（16MB，聊天文本足够）。 */
const BODY_LIMIT = 16 * 1024 * 1024

/** 轮询间隔（流式增量刷新/终态检测）。 */
export const OPENAI_POLL_MS = 200

/** SSE 文本块最大长度（打字机分块粒度；超长文本分多块）。 */
export const SSE_CHUNK_LIMIT = 120

export interface OpenAiApiDeps {
  /** 数据层（userId 映射/断点查找）。 */
  store: FlowStore
  /** 编排运行时（startRun/resumeRun/runSnapshot）。 */
  orchestrator: OrchestratorRuntime
  /** 服务 id（编排 flowId 与映射文件作用域）。 */
  serviceId: string
  /** 鉴权密钥（null 关闭）。 */
  apiKey: string | null
  /** 单服务并发请求上限（超出 429）。 */
  maxConcurrent: number
  /** userId → sessionId（SessionMap.resolve）。 */
  resolveSession(userId: string): Promise<string>
  /** 按会话取/建根 Agent（服务进程内装配）。 */
  ensureRootAgent(sessionId: string): Promise<{ agent: unknown; provider?: string; model?: string }>
  /** watchdog 单次推进（回合终态/空闲判定）。 */
  sweep(): Promise<void>
  /** 轮询间隔（测试可控）。 */
  pollMs?: number
  /** 日志缝。 */
  logger?: { warn?(message: string): void }
}

/** 解析后的聊天请求。 */
export interface ParsedChatRequest {
  userId: string
  question: string
  stream: boolean
  model?: string
}

/** 一次编排运行的结果。 */
export interface ChatRunResult {
  /** 父代理最终回答文本（流式/非流式同源）。 */
  text: string
  /** run 终态（completed/failed/stopped/paused）。 */
  status: RunStatus
  /** 运行 id（诊断）。 */
  runId: string
  /** 失败时的错误描述。 */
  error?: string
}

/** 解析并校验请求（鉴权在路由层经 headers 完成；此处校验 userId/messages）。 */
export function parseChatRequest(body: unknown, userIdFromHeader?: string): ParsedChatRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new OpenAiError(400, 'invalid_request_error', 'bad_request', '请求体必须为 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  const messages = raw.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'messages 必须为非空数组')
  }
  const userId = String(raw.user_id ?? userIdFromHeader ?? '').trim()
  if (!userId) {
    throw new OpenAiError(400, 'invalid_request_error', 'missing_user_id', '必须提供 userId（body user_id 或 Header X-User-Id）')
  }
  let question = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index] as { role?: unknown; content?: unknown } | null
    if (entry && entry.role === 'user') {
      question = extractText(entry.content)
      break
    }
  }
  if (!question.trim()) {
    throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'messages 中缺少 user 文本内容')
  }
  return {
    userId,
    question: question.trim(),
    stream: raw.stream === true,
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
  }
}

/** content 字段文本提取（字符串直接返回；块数组取 text 块拼接）。 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : ''))
      .join('')
  }
  return ''
}

/**
 * OpenAI 兼容 API 核心（纯逻辑可测；webServer 注册为薄壳）。
 */
export class OpenAiApi {
  /** in-flight 请求计数（并发上限）。 */
  private inflight = 0

  constructor(private readonly deps: OpenAiApiDeps) {}

  /** 鉴权校验：apiKey 配置非空时要求 Authorization: Bearer <apiKey>。 */
  authorize(authorization: unknown): void {
    const key = this.deps.apiKey
    if (!key) return
    const header = String(authorization ?? '').trim()
    const expected = `Bearer ${key}`
    if (header !== expected) {
      throw new OpenAiError(401, 'authentication_error', 'invalid_api_key', 'API Key 无效')
    }
  }

  /** 获取并发槽；超限抛 429。返回释放函数（finally 必调）。 */
  acquire(): () => void {
    const limit = this.deps.maxConcurrent > 0 ? this.deps.maxConcurrent : 1
    if (this.inflight >= limit) {
      throw new OpenAiError(429, 'rate_limit_error', 'concurrent_limit', `并发请求超过上限（${limit}）`)
    }
    this.inflight += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.inflight -= 1
    }
  }

  /** 执行一次编排请求（wait 循环 + 事件增量回调）。 */
  async runChat(
    input: ParsedChatRequest,
    onDelta?: (delta: string) => void,
  ): Promise<ChatRunResult> {
    const sessionId = await this.deps.resolveSession(input.userId)
    const { agent } = await this.deps.ensureRootAgent(sessionId)
    const agentLike = (agent ?? null) as {
      followup?(message: unknown): unknown
      session?: { seq?: unknown; events?: unknown[] }
    } | null
    if (!agentLike || typeof agentLike.followup !== 'function') {
      throw new OpenAiError(500, 'server_error', 'agent_unavailable', '服务会话 Agent 不可用')
    }

    // 有断点（暂停/中断）自动续跑；否则全新编排
    const prev = await findResumableRun(this.deps.store, { sessionId, flowId: this.deps.serviceId })
    const started = prev
      ? await this.deps.orchestrator.resumeRun({ sessionId, flowId: this.deps.serviceId, fromRunId: prev.id })
      : await this.deps.orchestrator.startRun({ sessionId, flowId: this.deps.serviceId, mode: 'mode2', question: input.question })
    const runId = started.runId

    // 父代理回合事件增量推进（assistant/message 累计文本；turn/end 标记）
    let baseSeq = Number(agentLike.session?.seq ?? 0)
    let text = ''
    let turnEnded = false
    const pollMs = this.deps.pollMs ?? OPENAI_POLL_MS
    for (;;) {
      await this.deps.sweep()
      const events = agentLike.session?.events ?? []
      for (let index = baseSeq; index < events.length; index += 1) {
        const event = events[index] as { type?: unknown; data?: { message?: { content?: unknown } } } | null
        if (!event) continue
        if (event.type === 'assistant/message' && event.data?.message?.content !== undefined) {
          const joined = extractText(event.data.message.content)
          if (joined && joined !== text) {
            const delta = joined.startsWith(text) ? joined.slice(text.length) : joined
            text = joined
            if (delta && onDelta) onDelta(delta)
          }
        } else if (event.type === 'turn/end') {
          turnEnded = true
        }
      }
      baseSeq = events.length

      const snapshot = this.deps.orchestrator.runSnapshot(runId)
      const status = snapshot?.status
      if (status !== undefined && status !== 'running') {
        return {
          text,
          status,
          runId,
          ...(status !== 'completed' ? { error: failureText(status, snapshot?.summary ?? '') } : {}),
        }
      }
      if (turnEnded && status === 'running') {
        // 回合已结束但 run 未终态：等待 wf_finish 收尾/看护兜底（继续轮询）
      }
      await sleep(pollMs)
    }
  }

  /** GET /v1/models：服务模型信息（父代理节点模型；缺失返回空列表）。 */
  async models(): Promise<{ object: string; data: Array<{ id: string; object: string; owned_by: string; created: number }> }> {
    const service = await this.deps.store.getServiceById(this.deps.serviceId).catch(() => null)
    const parent = service?.nodes?.find((node) => node.kind === 'parent')
    const data = (parent as { data?: Record<string, unknown> } | undefined)?.data
    const model = typeof data?.model === 'string' && data.model ? data.model : undefined
    const provider = typeof data?.provider === 'string' && data.provider ? data.provider : undefined
    if (model) {
      return {
        object: 'list',
        data: [{ id: model, object: 'model', owned_by: provider ?? 'workflow', created: 0 }],
      }
    }
    return { object: 'list', data: [] }
  }
}

/** 终态失败的中文描述（SSE 错误行/非流式 error 用）。 */
function failureText(status: RunStatus, summary: string): string {
  if (status === 'failed') return summary || '编排运行失败'
  if (status === 'stopped') return summary || '编排运行被停止'
  if (status === 'paused') return summary || '编排已暂停'
  return `编排异常结束（${status}）`
}

/** SSE 数据行组装（OpenAI 兼容 chunk 形态）。 */
export function sseChunk(id: string, model: string, delta: string, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { ...(delta ? { content: delta } : {}) }, finish_reason: finishReason }],
  })}\n\n`
}

/** SSE 结束标记行。 */
export function sseDone(): string {
  return 'data: [DONE]\n\n'
}

/** SSE 错误行（流中异常收尾用）。 */
export function sseError(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\n`
}

/** 非流式成功响应体（OpenAI 兼容）。 */
export function completionJson(id: string, model: string, content: string): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

/** 错误响应体。 */
export function errorJson(error: OpenAiError): Record<string, unknown> {
  return { error: { message: error.message, type: error.type, code: error.code } }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** webServer 最小结构（官方 register 契约）。 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: unknown, res: unknown): Promise<void> | void
  }): () => void
}

function sendJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body: string): unknown }, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

/**
 * 注册 OpenAI 兼容路由（webServer 可用时挂载；disposer 随 fiber 注销）。
 * 端点：POST /v1/chat/completions、GET /v1/models。
 */
export function registerOpenAiApi(
  ctx: { get(name: string): unknown; logger?: { warn?(message: string): void } },
  api: OpenAiApi,
): () => void {
  const webServer = ctx.get('webServer') as WebServerLike | null | undefined
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[visual-workflow-service] webServer 服务不可用，OpenAI 兼容 API 未挂载')
    return () => {}
  }
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: '/v1/chat/completions',
      async handler(req, res) {
        const httpReq = req as { method?: unknown; headers?: Record<string, string | string[] | undefined> }
        try {
          if (httpReq.method !== 'POST') {
            sendJson(res as never, 405, { error: { message: 'method not allowed', type: 'invalid_request_error' } })
            return
          }
          api.authorize(httpReq.headers?.authorization)
          const body = await readBody(req as never)
          let parsed: unknown
          try {
            parsed = body.trim() ? JSON.parse(body) : {}
          } catch {
            throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'invalid JSON body')
          }
          const headerUserId = headerValue(httpReq.headers?.['x-user-id'])
          const input = parseChatRequest(parsed, headerUserId)
          if (input.stream) {
            await streamResponse(api, input, req as never, res as never)
          } else {
            const release = api.acquire()
            try {
              const result = await api.runChat(input)
              if (result.status !== 'completed') {
                sendJson(res as never, 500, { error: { message: result.error ?? '编排运行失败', type: 'server_error' } })
                return
              }
              sendJson(res as never, 200, completionJson(`chatcmpl-${Date.now().toString(36)}`, input.model ?? 'workflow', result.text))
            } finally {
              release()
            }
          }
        } catch (error) {
          sendJson(res as never, error instanceof OpenAiError ? error.status : 500, errorJson(error instanceof OpenAiError ? error : new OpenAiError(500, 'server_error', 'internal_error', String(error instanceof Error ? error.message : error))))
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/v1/models',
      async handler(req, res) {
        const httpReq = req as { method?: unknown }
        if (httpReq.method !== 'GET') {
          sendJson(res as never, 405, { error: { message: 'method not allowed', type: 'invalid_request_error' } })
          return
        }
        try {
          sendJson(res as never, 200, await api.models())
        } catch (error) {
          sendJson(res as never, 500, { error: { message: error instanceof Error ? error.message : String(error), type: 'server_error' } })
        }
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载尽力而为
      }
    }
  }
}

/** 流式响应：SSE 头 + 逐块 flush + [DONE] 收尾。 */
async function streamResponse(
  api: OpenAiApi,
  input: ParsedChatRequest,
  req: { on(event: string, listener: (chunk?: unknown) => void): unknown; destroy?(): void },
  res: { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown; end(): unknown },
): Promise<void> {
  const release = api.acquire()
  const id = `chatcmpl-${Date.now().toString(36)}`
  const model = input.model ?? 'workflow'
  const chunk = sseChunk
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  try {
    const result = await api.runChat(input, (delta) => {
      for (let offset = 0; offset < delta.length; offset += SSE_CHUNK_LIMIT) {
        res.write(chunk(id, model, delta.slice(offset, offset + SSE_CHUNK_LIMIT), null))
      }
    })
    if (result.status === 'completed') {
      res.write(chunk(id, model, '', 'stop'))
    } else {
      res.write(sseError(result.error ?? failureText(result.status, '')))
    }
    res.write(sseDone())
  } catch (error) {
    res.write(sseError(error instanceof Error ? error.message : String(error)))
    res.write(sseDone())
  } finally {
    release()
  }
  res.end()
}

/** 读取请求体（JSON 文本；超限 413 由调用方映射）。 */
function readBody(req: { on(event: string, listener: (chunk?: unknown) => void): unknown; destroy?(): void }, limit = BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk) => {
      size += Buffer.byteLength(String(chunk ?? ''))
      if (size > limit) {
        reject(new OpenAiError(413, 'invalid_request_error', 'body_too_large', 'request body too large'))
        req.destroy?.()
        return
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? '')))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** header 取值归一（数组取首个）。 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

// src/host/remote/api.ts
//
// GUI API 层：POST /visual-workflow/<endpoint> 端点白名单分发 + webServer 路由挂载。
//
// 协议：
//   - body { args }，响应 { ok: true, value } / { ok: false, error: { message } }；
//     Cache-Control: no-store；未知端点 404；参数缺失 400；校验失败 422；
//     修订/锁冲突 409；非 POST 405；请求体超限 413；
//   - 端点白名单直接由共享协议常量表（EP_*）派生，与共享契约零漂移；
//   - 路由经 webServer.register({ kind: 'prefix', path: '/visual-workflow' }) 挂载
//     （重复注册抛错由官方路由表保证；disposer 随 fiber 注销）。
//
// 端点分组：工作流 / 服务（服务管理器装配前返回 501）/ 模板 / 生态枚举 /
// 工具组合与 MCP / 运行与历史 / 数据库 / 导入导出。

import * as EP from '../shared/protocol.js'
import { RESERVED_TRANSPORT_TOOL } from '../shared/protocol.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from '../orchestrator/runtime.js'
import { findResumableRun } from '../orchestrator/resume.js'
import type { DatabaseNode, WorkflowDocument } from '../shared/graph-model.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import { VectorIndex } from '../embedding/indexer.js'
import {
  buildIndexForDatabase,
  createDatabaseDriver,
  indexPathOf,
  testDatabaseConnection,
} from '../tools/data-tools.js'
import {
  exportWorkflowBundle,
  importWorkflowBundle,
  exportAgentTemplate,
  importAgentTemplate,
} from './transfer.js'
import { listMcpServers, upsertMcpServer, removeMcpServer, toggleMcpServer } from './mcp-registry.js'
import { copyIntoManagedFile } from './download.js'
import { openServiceDebug, pumpServiceDebug, ServiceDebugError, type SseSink } from './service-debug.js'

/** 请求体上限（64MB——文件模板 base64 上传需要大体积）。 */
const BODY_LIMIT = 64 * 1024 * 1024

/**
 * 前端快照标记字段黑名单（保存时剥除，绝不落盘）：
 *  - _draft：客户端本地草稿标记。旧实现把它随模板/服务/工作流一起写盘，
 *    刷新后已入库对象被误判为草稿（本地删除不走后端、保存行为错乱）。
 *  - _clientMeta：预留的其它客户端元数据。
 * 说明：保存逻辑以深拷贝剔除，避免污染对象本身（调用方列表仍可复用）。
 */
const CLIENT_META_KEYS = ['_draft', '_clientMeta'] as const

/** 剥离前端快照标记（浅拷贝，不修改入参）。 */
function stripClientMeta<T extends Record<string, unknown>>(value: T): T {
  const next = { ...value }
  for (const key of CLIENT_META_KEYS) delete next[key]
  return next
}

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

function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code)
}

/** 读取请求体（JSON 文本；超限 413）。 */
function readBody(req: { on(event: string, listener: (chunk?: unknown) => void): unknown; destroy?(): void }, limit = BODY_LIMIT): Promise<string> {
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

function sendJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body: string): unknown }, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

/** 宿主能力缝（index.ts 装配；单测 fake）。 */
export interface ApiHost {
  orchestrator: OrchestratorRuntime
  store: FlowStore
  dataDir: string
  engine: EmbeddingEngine
  /** 模式二服务管理器（服务管理阶段装配；缺失时服务端点返回 501）。 */
  serviceManager?: {
    start(serviceId: string): Promise<unknown>
    stop(serviceId: string): Promise<unknown>
    status(serviceId: string): Promise<unknown>
  }
  /** 服务 apiKey（调试流式代理携带鉴权头用；null 表示未启用，密钥不落浏览器）。 */
  apiKey?: string | null
}

/** webServer 服务最小结构（官方 register 契约）。 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: unknown, res: unknown): Promise<void> | void
  }): () => void
}

/**
 * GUI API：按端点名分发（白名单禁止命中原型链方法）。
 * 所有方法为 async (args) => value；参数缺失抛 HttpError(400)。
 */
export class VisualWorkflowApi {
  constructor(
    private readonly ctx: { get(name: string): unknown },
    private readonly host: ApiHost,
  ) {}

  /** 端点白名单（共享协议常量表派生，与共享契约零漂移）。 */
  static ENDPOINTS = new Set<string>(
    (Object.values(EP) as unknown[]).filter((value): value is string => typeof value === 'string'),
  )

  /** 按端点名分发；未知端点 404。 */
  async handle(endpoint: string, args: unknown): Promise<unknown> {
    const method = VisualWorkflowApi.ENDPOINTS.has(endpoint)
      ? (this as unknown as Record<string, (args: Record<string, unknown>) => Promise<unknown>>)[endpoint]
      : undefined
    if (typeof method !== 'function') throw httpError(404, `unknown endpoint: ${endpoint}`)
    return method.call(this, (args ?? {}) as Record<string, unknown>)
  }

  // ---------- 工作流（按会话分桶） ----------

  async listWorkflows(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    if (!sessionId) throw httpError(400, 'requires sessionId')
    return this.host.store.listWorkflows(sessionId)
  }

  async getWorkflow(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    const flow = await this.host.store.getWorkflow(sessionId, id)
    if (!flow) throw httpError(404, `工作流不存在：${id}`)
    return flow
  }

  async createWorkflow(args: { sessionId?: unknown; name?: unknown; description?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    if (!sessionId) throw httpError(400, 'requires sessionId')
    return this.putWorkflow({
      sessionId,
      flow: {
        id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        mode: 'mode1',
        name: String(args?.name ?? '').trim() || '未命名工作流',
        description: String(args?.description ?? ''),
        revision: 0,
        nodes: [],
        lines: [],
      },
    })
  }

  async putWorkflow(args: { sessionId?: unknown; flow?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const raw = args?.flow as Partial<WorkflowDocument> | null | undefined
    if (!sessionId) throw httpError(400, 'requires sessionId')
    if (!raw || !String(raw.id ?? '').trim()) throw httpError(400, 'requires a flow id')
    const expected = Number(raw.revision)
    if (!Number.isFinite(expected)) throw httpError(400, 'requires a numeric revision')
    const flow = { ...stripClientMeta(raw as Record<string, unknown>), sessionId } as WorkflowDocument
    try {
      const saved = await this.host.store.saveWorkflow(flow, sessionId, { expectedRevision: expected })
      // 双向同步①「画布→编排」：保存成功后刷新活跃 run 的编排事实源
      // （orchestrations/<runId>.json），父代理（definitionPath 指向该文件）
      // 在运行中即可读到最新拓扑（新增节点/连线/修改即时生效）。
      await this.host.orchestrator.refreshActiveDefinitions(flow.id, sessionId, saved)
      return saved
    } catch (error) {
      const code = (error as { code?: string })?.code ?? ''
      if (code === 'FLOW_REVISION_CONFLICT') throw httpError(409, String((error as Error).message), code)
      throw error
    }
  }

  async deleteWorkflow(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    const deleted = await this.host.store.deleteWorkflow(sessionId, id)
    if (!deleted) throw httpError(404, `工作流不存在：${id}`)
    return { deleted: true }
  }

  // ---------- 服务（模式二；服务管理器装配前返回 501） ----------

  async listServices(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    if (!sessionId) throw httpError(400, 'requires sessionId')
    return this.host.store.listServices(sessionId)
  }

  async getService(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    const service = await this.host.store.getService(sessionId, id)
    if (!service) throw httpError(404, `服务不存在：${id}`)
    return service
  }

  async putService(args: { sessionId?: unknown; service?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const raw = args?.service as Record<string, unknown> | null | undefined
    if (!sessionId) throw httpError(400, 'requires sessionId')
    if (!raw || !String(raw.id ?? '').trim()) throw httpError(400, 'requires a service id')
    const expected = Number(raw.revision)
    if (!Number.isFinite(expected)) throw httpError(400, 'requires a numeric revision')
    const serviceId = String(raw.id ?? '').trim()
    try {
      const saved = await this.host.store.saveService(stripClientMeta(raw) as never, sessionId, { expectedRevision: expected })
      // 双向同步①「画布→编排」（模式二同理）：保存成功后刷新活跃 run 事实源。
      await this.host.orchestrator.refreshActiveDefinitions(serviceId, sessionId, {
        id: saved.id,
        sessionId: saved.sessionId,
        mode: 'mode2',
        name: saved.name,
        description: saved.description,
        nodes: saved.nodes,
        lines: saved.lines,
        revision: saved.revision,
      } as WorkflowDocument)
      return saved
    } catch (error) {
      const code = (error as { code?: string })?.code ?? ''
      if (code === 'FLOW_REVISION_CONFLICT') throw httpError(409, String((error as Error).message), code)
      throw error
    }
  }

  async deleteService(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    const deleted = await this.host.store.deleteService(sessionId, id)
    if (!deleted) throw httpError(404, `服务不存在：${id}`)
    return { deleted: true }
  }

  async serviceStart(args: { sessionId?: unknown; serviceId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const serviceId = String(args?.serviceId ?? '')
    if (!sessionId || !serviceId) throw httpError(400, 'requires sessionId and serviceId')
    return this.withServiceManager('start', sessionId, serviceId)
  }

  async serviceStop(args: { sessionId?: unknown; serviceId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const serviceId = String(args?.serviceId ?? '')
    if (!sessionId || !serviceId) throw httpError(400, 'requires sessionId and serviceId')
    return this.withServiceManager('stop', sessionId, serviceId)
  }

  async serviceStatus(args: { sessionId?: unknown; serviceId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const serviceId = String(args?.serviceId ?? '')
    if (!sessionId || !serviceId) throw httpError(400, 'requires sessionId and serviceId')
    return this.withServiceManager('status', sessionId, serviceId)
  }

  private async withServiceManager(action: 'start' | 'stop' | 'status', sessionId: string, serviceId: string): Promise<unknown> {
    // 会话归属校验：服务按 sessionId 分桶，越权会话不得启动/停止/查看他人服务
    // （不匹配按不存在处理，不泄露 serviceId 是否存在）。
    const service = await this.host.store.getService(sessionId, serviceId)
    if (!service) throw httpError(404, `服务不存在：${serviceId}`)
    const manager = this.host.serviceManager
    if (!manager || typeof manager[action] !== 'function') {
      throw httpError(501, '服务管理器尚未启用（模式二服务管理未装配）', 'WF_SERVICE_MANAGER_UNAVAILABLE')
    }
    // 合并返回完整服务状态（Bug 22）：manager 结果只含 serviceId/status/port/pid 等
    // 运行时字段，不能整体替代 ServiceState——否则前端 SERVICE_UPDATED 用残缺对象替换
    // 列表项（name/nodes/lines/revision/sessionId 全部丢失），或因 id 键不匹配变成
    // 静默空操作（启动/停止后状态永不刷新）。以完整文档为基、运行时字段覆盖后返回。
    const result = (await manager[action](serviceId)) as Record<string, unknown>
    return {
      ...service,
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.port !== undefined ? { port: result.port } : {}),
      ...(result.pid !== undefined ? { pid: result.pid } : {}),
    }
  }

  // ---------- 模板（角色/文件/数据库） ----------

  async listTemplates(args: { kind?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database') {
      throw httpError(400, 'requires kind: role|file|database')
    }
    return this.host.store.listTemplates(kind as 'role' | 'file' | 'database')
  }

  async putTemplate(args: { kind?: unknown; template?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database') {
      throw httpError(400, 'requires kind: role|file|database')
    }
    const template = args?.template as Record<string, unknown> | null | undefined
    if (!template || !String(template.id ?? '').trim()) throw httpError(400, 'requires a template id')
    if (kind === 'role' && !String(template.kind ?? '').trim()) {
      template.kind = 'agent'
    }
    // 剥除前端快照标记（_draft 等），防止已入库模板刷新后被误判为草稿
    return this.host.store.saveTemplate(kind as 'role' | 'file' | 'database', stripClientMeta(template) as never)
  }

  /** 删除预览：模板与画布节点深拷贝解耦，删除模板不影响任何已有节点。 */
  async deleteTemplatePreview(args: { kind?: unknown; id?: unknown }): Promise<unknown> {    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database') {
      throw httpError(400, 'requires kind: role|file|database')
    }
    if (!String(args?.id ?? '').trim()) throw httpError(400, 'requires a template id')
    return { affectedNodes: 0, detached: true }
  }

  async deleteTemplate(args: { kind?: unknown; id?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    const id = String(args?.id ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database') {
      throw httpError(400, 'requires kind: role|file|database')
    }
    if (!id) throw httpError(400, 'requires a template id')
    const deleted = await this.host.store.deleteTemplate(kind as 'role' | 'file' | 'database', id)
    if (!deleted) throw httpError(404, `模板不存在：${id}`)
    return { deleted: true }
  }

  // ---------- 工作流模板（flow-templates/，全局共享；图2 交互改造） ----------

  /** 工作流模板列表（全部返回，客户端按 mode 过滤；模板跨会话共享不隔离）。 */
  async listFlowTemplates(): Promise<unknown> {
    return this.host.store.listFlowTemplates()
  }

  /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护）。 */
  async putFlowTemplate(args: { template?: unknown }): Promise<unknown> {
    const raw = args?.template as Record<string, unknown> | null | undefined
    if (!raw || !String(raw.id ?? '').trim()) throw httpError(400, 'requires a flow template id')
    const expected = Number(raw.revision)
    if (!Number.isFinite(expected)) throw httpError(400, 'requires a numeric revision')
    try {
      return await this.host.store.saveFlowTemplate(stripClientMeta(raw) as never, { expectedRevision: expected })
    } catch (error) {
      const code = (error as { code?: string })?.code ?? ''
      if (code === 'FLOW_REVISION_CONFLICT') throw httpError(409, String((error as Error).message), code)
      throw error
    }
  }

  /** 删除工作流模板（仅删模板文件，不影响已生成的实例）。 */
  async deleteFlowTemplate(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires a flow template id')
    const deleted = await this.host.store.deleteFlowTemplate(id)
    if (!deleted) throw httpError(404, `工作流模板不存在：${id}`)
    return { deleted: true }
  }

  /** 受管文件上传：base64 内容 → data/files/<safeName>（原子发布；返回 managedPath）。 */
  async fileUpload(args: { name?: unknown; base64?: unknown }): Promise<unknown> {
    const name = String(args?.name ?? '').trim()
    const base64 = String(args?.base64 ?? '')
    if (!name || !base64) throw httpError(400, 'requires name and base64')
    return copyIntoManagedFile(this.host.dataDir, { name, base64 })
  }

  // ---------- 生态枚举（presets / tools / models） ----------

  /** agent preset 模式列表（agentPresets 服务缺失时返回空列表）。 */
  async presets(): Promise<unknown> {
    const agentPresets = this.ctx.get('agentPresets') as { list?: () => Promise<unknown[]> } | null | undefined
    if (!agentPresets || typeof agentPresets.list !== 'function') return []
    try {
      const items = (await agentPresets.list()) ?? []
      return items
        .filter((item) => (item as { broken?: unknown }).broken !== true)
        .map((item) => {
          const entry = item as { id?: unknown; name?: unknown; metadata?: { name?: unknown; description?: unknown }; description?: unknown; trust?: unknown }
          return {
            id: entry.id,
            name: entry.name ?? entry.metadata?.name ?? entry.id,
            description: entry.description ?? entry.metadata?.description ?? '',
            trust: entry.trust ?? 'user',
          }
        })
    } catch (error) {
      throw new Error(`preset 列表读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 全局层可见工具清单（供组合勾选）。 */
  async tools(): Promise<unknown> {
    const tools = this.ctx.get('tools') as { schemas?: (scope?: unknown) => unknown } | null | undefined
    if (!tools || typeof tools.schemas !== 'function') return []
    try {
      const schemas = (tools.schemas() ?? []) as unknown[]
      return (Array.isArray(schemas) ? schemas : [])
        .map((schema) => {
          const entry = schema as { name?: unknown; title?: unknown; description?: unknown }
          return { name: entry.name ?? entry.title ?? '', description: entry.description ?? '' }
        })
        .filter((item) => item.name && item.name !== RESERVED_TRANSPORT_TOOL)
    } catch (error) {
      throw new Error(`工具清单读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 可选模型列表（llm 服务缺失返回空列表；单 provider 失败跳过）。 */
  async models(): Promise<unknown> {
    const llm = this.ctx.get('llm') as
      | { listProviders?: () => unknown[]; listModels?: (provider: string) => Promise<unknown[]> }
      | null
      | undefined
    if (!llm || typeof llm.listProviders !== 'function') return []
    const out: Array<{ provider: string; model: string }> = []
    let providers: unknown[] = []
    try {
      providers = llm.listProviders() ?? []
    } catch {
      providers = []
    }
    for (const entry of providers) {
      const name = typeof entry === 'string' ? entry : (entry as { id?: unknown; name?: unknown })?.id ?? (entry as { name?: unknown })?.name
      if (!name) continue
      try {
        if (typeof llm.listModels !== 'function') continue
        const models = (await llm.listModels(String(name))) ?? []
        for (const model of models ?? []) {
          const info = typeof model === 'string' ? null : model as { id?: unknown; name?: unknown; efforts?: Array<{ id?: unknown; name?: unknown }> }
          const id = typeof model === 'string' ? model : info?.id ?? info?.name
          if (id) {
            // 思考强度列表：适配器公布的 reasoning efforts（V-02）；未公开时 undefined（client 回退内置档位）
            const efforts = Array.isArray(info?.efforts)
              ? info.efforts
                  .map((effort) => ({ id: String(effort.id ?? ''), name: String(effort.name ?? effort.id ?? '') }))
                  .filter((effort) => effort.id)
              : undefined
            out.push({ provider: String(name), model: String(id), ...(efforts ? { efforts } : {}) })
          }
        }
      } catch {
        // 单 provider 失败跳过
      }
    }
    return out
  }

  // ---------- 工具组合 / 插件目录 / MCP ----------

  async toolCombos(): Promise<unknown> {
    return this.host.store.listToolCombos()
  }

  async toolComboPut(args: { combo?: unknown }): Promise<unknown> {
    const combo = args?.combo as Record<string, unknown> | null | undefined
    const id = String(combo?.id ?? '')
    if (!combo || !id.startsWith('combo-') || !String(combo.name ?? '').trim()) {
      throw httpError(400, '组合需要 combo- 前缀 id 与名称')
    }
    return this.host.store.saveToolCombo({
      id: id as `combo-${string}`,
      name: String(combo.name).trim(),
      tools: Array.isArray(combo.tools)
        ? combo.tools.filter((name) => typeof name === 'string' && name && name !== RESERVED_TRANSPORT_TOOL)
        : [],
      mcpServers: Array.isArray(combo.mcpServers) ? combo.mcpServers.filter((name) => typeof name === 'string' && name) : [],
    })
  }

  async toolComboDelete(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return { deleted: await this.host.store.deleteToolCombo(id) }
  }

  /**
   * 插件目录：工具（全局层 ∪ 存活 agent scope ∪ preset standing scope，含中文
   * 描述映射）+ MCP 服务器 + 已装载插件摘要。scope key 必须是 agent 对象本身
   * （官方 ScopeKey 语义），传错只能看到全局层。
   */
  async pluginCatalog(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const schemas = await this.allToolSchemas(sessionId || undefined)
    const mcpServers = await listMcpServers().catch(() => [])
    const items: unknown[] = []
    const seen = new Set<string>()
    for (const schema of schemas) {
      const entry = schema as { name?: unknown; title?: unknown; description?: unknown }
      const name = String(entry.name ?? entry.title ?? '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      items.push({
        key: `tool:${name}`,
        name,
        description: zhDescription(name, String(entry.description ?? '')),
        kind: 'tool',
        source: name.startsWith('mcp__') ? 'mcp' : 'builtin',
      })
    }
    const loader = this.ctx.get('loader') as { entries?: () => unknown[] } | null | undefined
    let loadedPlugins: string[] = []
    try {
      if (loader && typeof loader.entries === 'function') {
        const plugins: string[] = []
        for (const entry of loader.entries() ?? []) {
          const options = (entry as { options?: Record<string, unknown> })?.options ?? {}
          if (options.group) continue
          const name = String(options.name ?? '')
          if (!name || plugins.includes(name)) continue
          plugins.push(name)
        }
        loadedPlugins = plugins
      }
    } catch {
      loadedPlugins = []
    }
    return {
      items,
      loadedPlugins,
      mcp: mcpServers.map((server: { id?: unknown; serverName?: unknown; url?: unknown; command?: unknown; transport?: unknown; disabled?: unknown; args?: unknown; env?: unknown }) => ({
        id: server.id,
        name: server.serverName,
        serverName: server.serverName,
        description: server.url
          ? `MCP 服务器（streamable-http：${server.url}）`
          : `MCP 服务器（stdio：${server.command}）`,
        transport: server.transport,
        disabled: server.disabled === true,
        // 组合管理「编辑」表单的字段来源：缺失时编辑后启动命令/参数恒为空
        command: String(server.command ?? ''),
        args: Array.isArray(server.args) ? server.args : [],
        env: server.env ?? {},
        url: String(server.url ?? ''),
        category: 'mcp',
      })),
    }
  }

  /** 全部可见工具 schema（全局层 ∪ 存活 root agent ∪ preset standing scope）。 */
  private async allToolSchemas(sessionId?: string): Promise<unknown[]> {
    const tools = this.ctx.get('tools') as { schemas?: (scope?: unknown) => unknown } | null | undefined
    if (!tools || typeof tools.schemas !== 'function') return []
    const out = new Map<string, unknown>()
    const collect = (scope?: unknown): void => {
      let list: unknown[] = []
      try {
        list = scope === undefined ? ((tools.schemas?.() ?? []) as unknown[]) : ((tools.schemas?.(scope) ?? []) as unknown[])
      } catch {
        list = []
      }
      for (const schema of Array.isArray(list) ? list : []) {
        const name = String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? '')
        if (name && !out.has(name)) out.set(name, schema)
      }
    }
    collect(undefined)
    const agents = this.ctx.get('agents') as { roots?: () => unknown[]; get?: (id: string) => unknown } | null | undefined
    if (agents && typeof agents.get === 'function') {
      const candidates = new Set<unknown>()
      try {
        for (const root of agents.roots?.() ?? []) {
          if (root && String((root as { id?: unknown })?.id ?? '')) candidates.add(root)
        }
      } catch {
        // roots 不可用
      }
      if (sessionId) {
        try {
          const agent = agents.get(sessionId)
          if (agent) candidates.add(agent)
        } catch {
          // 会话 agent 不可用
        }
      }
      for (const agent of candidates) collect(agent)
    }
    const agentPresets = this.ctx.get('agentPresets') as { list?: () => Promise<unknown[]>; standingKeyFor?: (id: string) => Promise<unknown> } | null | undefined
    if (agentPresets && typeof agentPresets.list === 'function' && typeof agentPresets.standingKeyFor === 'function') {
      try {
        for (const item of (await agentPresets.list()) ?? []) {
          const pid = String((item as { id?: unknown })?.id ?? '').trim()
          if (!pid) continue
          try {
            const key = await agentPresets.standingKeyFor(pid)
            if (key !== undefined) collect(key)
          } catch {
            // 单个 preset 失败跳过
          }
        }
      } catch {
        // agentPresets 不可用
      }
    }
    // 剔除官方保留的 Code Mode 传输名 run_code：组合管理可选列表不得展示
    // （子代理自动携带该工具，且官方 restrict 禁止其进入 allow/deny 名单）。
    // 注意：不剔除其它工具——str_replace_editor 等官方简单模式专用工具保留展示，
    // 在描述中标注「简单模式专用，非该模式禁止勾选」，运行时由 resolveAgentTools
    // 兜底（父代理 scope 视图过滤），避免勾选后官方 restrict 抛 unknown。
    return [...out.values()].filter((schema) => {
      const entry = schema as { name?: unknown; title?: unknown }
      return String(entry.name ?? entry.title ?? '') !== RESERVED_TRANSPORT_TOOL
    })
  }

  /** MCP 服务器：列表 / 增删改 / 启停（写入 profile 托管区，重启生效）。 */
  async mcpList(): Promise<unknown> {
    const servers = await listMcpServers()
    return servers.map((server) => ({
      id: server.id,
      serverName: server.serverName,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args ?? [],
      env: server.env ?? {},
      url: server.url ?? '',
      disabled: server.disabled === true,
    }))
  }

  async mcpPut(args: { server?: unknown }): Promise<unknown> {
    return upsertMcpServer(args?.server ?? {})
  }

  async mcpDelete(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return removeMcpServer(id)
  }

  async mcpToggle(args: { id?: unknown; disabled?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return toggleMcpServer(id, args?.disabled !== false)
  }

  // ---------- 运行（父代理编排） ----------

  /** 启动运行：存在可恢复断点（暂停/中断）时自动续跑，否则全新启动。 */
  async run(args: { sessionId?: unknown; flowId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    const prev = await findResumableRun(this.host.store, { sessionId, flowId })
    if (prev) {
      return this.host.orchestrator.resumeRun({ sessionId, flowId, fromRunId: prev.id })
    }
    return this.host.orchestrator.startRun({ sessionId, flowId })
  }

  /** 运行状态轮询：内存快照优先，终态（内存已释放）回退磁盘历史。会话归属校验。 */
  async runStatus(args: { sessionId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const runId = String(args?.runId ?? '')
    if (!sessionId || !runId) throw httpError(400, 'requires sessionId and runId')
    const snapshot = this.host.orchestrator.runSnapshot(runId)
    if (snapshot) {
      if (snapshot.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
      return snapshot
    }
    const disk = await this.host.store.getRun(runId)
    if (!disk || disk.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
    return disk
  }

  /** 会话活跃 run 列表（workbench 进入时自动选中运行中实例用；running/paused 保留锁）。 */
  async activeRuns(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    if (!sessionId) throw httpError(400, 'requires sessionId')
    return this.host.orchestrator.activeRunsForSession(sessionId)
  }

  async runStop(args: { sessionId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const runId = String(args?.runId ?? '')
    if (!sessionId || !runId) throw httpError(400, 'requires sessionId and runId')
    // 会话归属校验：内存激活 run 直接比对；已释放的终态 run 回退磁盘比对
    // （越权会话不得停止他人运行；不匹配按不存在处理，不泄露 runId 是否存在）。
    const entry = this.host.orchestrator.entryFor(runId)
    if (entry) {
      if (entry.snapshot.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
      await this.host.orchestrator.stopRun(runId)
      return { stopped: true }
    }
    const disk = await this.host.store.getRun(runId)
    if (!disk || disk.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
    // 终态幂等：磁盘记录存在且归属匹配 → 视为已停止
    return { stopped: true }
  }

  async runHistory(args: { sessionId?: unknown; flowId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    // 会话隔离（Bug 14）：运行历史必须限定当前会话，否则可按 flowId 读到
    // 其他会话的 run 记录（多租户隔离，架构文档 §9）。
    return this.host.store.listRuns(flowId, sessionId)
  }

  /** 断点续跑（历史面板「恢复」入口；runId 缺省取该工作流最近可恢复记录）。 */
  async runResume(args: { sessionId?: unknown; flowId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    const result = await this.host.orchestrator.resumeRun({
      sessionId,
      flowId,
      ...(args?.runId ? { fromRunId: String(args.runId) } : {}),
    })
    return result
  }

  // ---------- 数据库（GUI 面板） ----------

  /** 连接测试（本地/服务器驱动均可；返回可展示消息）。 */
  async dbTest(args: { node?: unknown }): Promise<unknown> {
    const node = args?.node as DatabaseNode | null | undefined
    if (!node || node.kind !== 'database') throw httpError(400, 'requires a database node')
    return testDatabaseConnection(node)
  }

  /** 表结构预览（只读）。 */
  async dbSchema(args: { node?: unknown }): Promise<unknown> {
    const node = args?.node as DatabaseNode | null | undefined
    if (!node || node.kind !== 'database') throw httpError(400, 'requires a database node')
    const driver = createDatabaseDriver(node)
    try {
      return await driver.schema()
    } finally {
      driver.close()
    }
  }

  /**
   * 检索预览：命中索引直接检索；索引缺失或 rebuild=true 时先构建（本地库）。
   * 嵌入不可用时索引自动落 BM25（结果标注 source）。
   */
  async dbSearchPreview(args: { dataId?: unknown; query?: unknown; topK?: unknown; node?: unknown; rebuild?: unknown }): Promise<unknown> {
    const dataId = String(args?.dataId ?? '')
    const query = String(args?.query ?? '').trim()
    if (!dataId) throw httpError(400, 'requires dataId')
    const topK = Number(args?.topK ?? 5)
    const index = new VectorIndex(indexPathOf(this.host.dataDir, dataId))
    if (args?.rebuild === true || (await index.load()) === null) {
      const node = args?.node as DatabaseNode | null | undefined
      if (!node || node.kind !== 'database') throw httpError(422, '索引不存在且未提供数据库节点，无法构建')
      await buildIndexForDatabase(this.host.dataDir, node, this.host.engine)
    }
    if (!query) return { dataId, hits: [] }
    const result = await index.search(query, topK, this.host.engine)
    return { dataId, ...(result ?? { hits: [] }) }
  }

  // ---------- 导入导出（v2 bundle） ----------

  async exportWorkflow(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    return { json: await exportWorkflowBundle(this.host.store, sessionId, id) }
  }

  async importWorkflow(args: { json?: unknown; conflictMode?: unknown }): Promise<unknown> {
    // 图2 交互改造：导入一律落为「工作流模板」（全局共享），不再直接创建实例——
    // 用户需在画布中「创建实例」后才能运行（sessionId 参数不再需要）。
    return importWorkflowBundle(this.host.store, args?.json, {
      conflictMode: args?.conflictMode as 'rename' | 'overwrite' | undefined,
    })
  }

  async exportAgentTemplate(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return { json: await exportAgentTemplate(this.host.store, id) }
  }

  async importAgentTemplate(args: { json?: unknown; conflictMode?: unknown }): Promise<unknown> {
    return importAgentTemplate(this.host.store, args?.json, {
      conflictMode: args?.conflictMode as 'rename' | 'overwrite' | undefined,
    })
  }
}

/** 内置常用工具中文描述映射（未命中回退原文，英文加 [EN] 前缀）。 */
const TOOL_ZH: Record<string, string> = {
  read: '读取文件内容（支持多种编码与行区间）',
  write: '创建或整体替换文件内容',
  edit: '对已有文件做精确的局部文本替换',
  bash: '在沙箱中执行 shell 命令',
  run_code: '在代码运行时中执行一段代码',
  str_replace_editor: '代码/文本编辑器：查看、替换、插入、撤销（简单模式专用，非该模式禁止勾选）',
  glob: '按通配符模式查找文件路径',
  grep: '在文件内容中按正则搜索并返回匹配行',
  todo_write: '维护并更新结构化任务清单',
  pwsh: '执行 PowerShell 命令',
  web_search: '联网搜索当前信息',
  ssh_exec: '在配置的 SSH 主机上执行远程命令',
  ssh_list: '列出已配置的 SSH 主机',
  ssh_upload: '上传本地文件到 SSH 主机',
  ssh_download: '从 SSH 主机下载文件到本地',
  ssh_tunnel: '管理本地端口转发隧道',
  ssh_cluster: '在多台 SSH 主机上并发执行同一命令',
  list_agents: '列出可继续交互的后台子代理',
  send_message: '向后台子代理发送消息继续对话',
  interrupt_agent: '请求取消后台子代理当前回合',
  subagent: '委派自包含任务给子代理处理',
  workflow: '运行多子代理编排工作流脚本',
}

function zhDescription(name: string, fallback: string): string {
  const hit = TOOL_ZH[name]
  if (hit) return hit
  const text = String(fallback ?? '').trim()
  if (!text) return '（暂无描述）'
  return /[\u4e00-\u9fa5]/.test(text) ? text : `[EN] ${text}`
}

/**
 * 注册 /visual-workflow/* 路由（webServer 服务可用后挂载；disposer 随 fiber 注销）。
 * 端点分发：POST + body { args }；错误映射 400/404/405/409/413/422/501。
 */
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

/**
 * serviceDebug 流式响应（不走 JSON 分发）：校验参数 → 查运行状态 → 代理 SSE。
 * 已写头后的异常经 SSE error 行收尾（浏览器端按流解析）；未写头异常向上抛由
 * 路由层映射 HTTP 状态。为什么用 Host 代理：服务进程无 CORS 头 + apiKey 密钥
 * 不落浏览器（见 service-debug.ts 头注释）。
 */
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

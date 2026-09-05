// src/host/remote/api-workflows.ts
//
// GUI API 工作流与服务端点（VisualWorkflowApiWorkflows extends Base）：
// 工作流 CRUD（含画布保存后刷新运行事实源的双向同步）与服务启停/状态
// （含运行时字段合并的完整 ServiceState 返回）。方法体逐字移动。

import type { WorkflowDocument } from '../shared/graph-model.js'
import { resolveWorkspacePath } from '../workspace/verify.js'
import { httpError } from './http.js'
import { stripClientMeta } from './api-base.js'
import { VisualWorkflowApiBase } from './api-base.js'

export class VisualWorkflowApiWorkflows extends VisualWorkflowApiBase {
  // ---------- 工作流（工作台全局化：列表跨会话，读写按实例自身会话） ----------

  /**
   * 工作流列表（工作台全局化改版）：sessionId 缺省时返回**全部会话**的工作流
   * 实例（工作台全局面板数据源）；传入时按会话过滤（定时任务检测目标会话
   * 已有实例用）。
   */
  async listWorkflows(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = args?.sessionId === undefined || args.sessionId === null
      ? undefined
      : String(args.sessionId)
    return this.host.store.listWorkflows(sessionId)
  }

  /**
   * 创建新主会话端点（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
   * 实例绑定该新会话 id）。
   *   - workspacePath 传入时校验存在为目录（resolveWorkspacePath）并作为新会话 cwd；
   *   - workspacePath 缺省时继承创建者会话（sessionId）的 cwd（与定时任务 new-session 一致）；
   *   - cwd 解析不到时省略（官方会话默认工作区）。
   */
  async createSession(args: { sessionId?: unknown; workspacePath?: unknown; label?: unknown }): Promise<unknown> {
    const provider = this.host.sessionProvider
    if (!provider || typeof provider.createSession !== 'function') {
      throw httpError(501, '会话创建能力未装配', 'WF_AGENT_UNAVAILABLE')
    }
    const creatorSessionId = String(args?.sessionId ?? '')
    const label = String(args?.label ?? '工作流实例').trim() || '工作流实例'
    // 新会话工作区：显式路径优先（校验存在为目录）；否则继承创建者会话 cwd（读不到省略）
    const explicit = String(args?.workspacePath ?? '').trim()
    let cwd: string | undefined
    if (explicit) {
      cwd = await this.checkedWorkspacePath(explicit)
    } else if (creatorSessionId && this.host.sessionCwdOf) {
      cwd = await this.host.sessionCwdOf(creatorSessionId).catch(() => undefined)
    }
    const sessionId = await provider.createSession({
      label,
      agentPreset: 'standard',
      ...(cwd ? { cwd } : {}),
    })
    return { sessionId }
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
    // 退役字段剥除：startNewSession/workspacePath 已改为「创建实例」的一次性临时选项，
    // 不再持久化到实例文档（旧数据残留字段保存即清除；也不再校验旧路径是否存在）。
    const flow = stripClientMeta(raw as Record<string, unknown>)
    delete flow.startNewSession
    delete flow.workspacePath
    const normalized = { ...flow, sessionId } as WorkflowDocument
    try {
      const saved = await this.host.store.saveWorkflow(normalized, sessionId, { expectedRevision: expected })
      // 双向同步①「画布→编排」：保存成功后刷新活跃 run 的编排事实源
      // （orchestrations/<runId>.json），父代理（definitionPath 指向该文件）
      // 在运行中即可读到最新拓扑（新增节点/连线/修改即时生效）。
      await this.host.orchestrator.refreshActiveDefinitions(normalized.id, sessionId, saved)
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

  /**
   * 服务列表（工作台全局化改版）：sessionId 缺省时返回**全部会话**的服务实例
   * （工作台全局面板数据源）；传入时按会话过滤（旧单会话面板兼容调用）。
   */
  async listServices(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = args?.sessionId === undefined || args.sessionId === null
      ? undefined
      : String(args.sessionId)
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
      // 退役字段剥除（同 putWorkflow）：startNewSession/workspacePath 不再持久化，
      // 旧服务实例重新保存后「服务级新会话」字段被清除（请求回退 userId 固定会话）。
      const normalized = stripClientMeta(raw)
      delete normalized.startNewSession
      delete normalized.workspacePath
      const saved = await this.host.store.saveService(normalized as never, sessionId, { expectedRevision: expected })
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

  /** 校验可选工作区路径（存在且为目录；空值返回 undefined；异常转 400）。 */
  private async checkedWorkspacePath(value: unknown): Promise<string | undefined> {
    try {
      return await resolveWorkspacePath(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw httpError(400, message)
    }
  }

}
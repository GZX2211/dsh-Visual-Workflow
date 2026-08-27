// src/host/storage/flow-store.ts
//
// FlowStore（T-012）：插件数据层。目录规划按需求文档 §6（默认 <dataDir>/）：
//   workflows/<flowId>.json              模式一工作流实例（文件内 sessionId 字段标记归属）
//   services/<serviceId>.json            模式二服务实例（工作流定义 + 端口/鉴权/状态）
//   services/<serviceId>.sessions.json   userId → sessionId 映射（§4.7 sessions-map）
//   roles/<roleId>.json                  角色模板（全局共享）
//   data/<dataId>.json                   数据模板（文件/数据库，全局共享）
//   data/files/                          受管文件副本（T-026 拷贝）
//   combos.json                          工具组合列表（全局共享）
//   runs/<runId>.json                    运行历史（RunSnapshot，含 flowId/断点/节点产出）
//   orchestrations/<runId>.json          运行时流程定义（父代理只读的事实源）
//
// 为什么每个实例单独成文件（架构文档 §4.1 / 需求 §6）：单文件即单资源，
// 原子写粒度=资源粒度——并发编辑同一工作流经 withJsonLock 串行化，
// 不同资源互不阻塞；删除即删文件，无"数组中残留空洞"。
//
// 会话隔离（需求 §4.2.2 规则 3 / Q23）：workflow/service 文件内记录 sessionId，
// 列出/读取按 sessionId 过滤；模板（roles/data/combos）全局共享不隔离。
//
// 原子性：所有写操作走 atomic.ts 的 withJsonLock + atomicWriteJson（临时文件 +
// fsync + 原子发布）；进程内锁 FIFO + 磁盘锁跨进程互斥（T-011 已验证）。

import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, readJson, withJsonLock } from './atomic.js'
import type { WorkflowDocument, GraphNode } from '../shared/graph-model.js'
import type {
  ServiceState,
  RoleTemplate,
  FileTemplate,
  DatabaseTemplate,
  ToolCombo,
  RunSnapshot,
} from '../shared/types.js'

// ---------------------------------------------------------------------------
// 类型与错误
// ---------------------------------------------------------------------------

/** 模板种类：角色 / 文件 / 数据库（§4.2.3/§4.2.4；左侧栏「角色」「数据」Tab）。 */
export type TemplateKind = 'role' | 'file' | 'database'

/** 全部模板的判别联合（按目录区分；data/ 内 file/database 以字段判别）。 */
export type Template = RoleTemplate | FileTemplate | DatabaseTemplate

/** 保存选项：陈旧快照冲突保护（旧项目 nextFlowRevision 语义保留）。 */
export interface SaveOptions {
  /** 客户端加载时的 revision；与当前不一致且非 force 时抛冲突。 */
  expectedRevision?: number | null
  /** 强制覆盖（跳过冲突检查）。 */
  force?: boolean
}

/** revision 冲突错误：另一会话已保存更新的版本（架构文档 §4.1 原子性与锁一致）。 */
export class FlowRevisionConflictError extends Error {
  readonly code = 'FLOW_REVISION_CONFLICT'
  constructor(
    readonly id: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number,
  ) {
    super(`资源 "${id}" 在加载后被修改（期望 revision ${expectedRevision ?? '无'}，当前 ${actualRevision}），请刷新后合并再保存`)
    this.name = 'FlowRevisionConflictError'
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 文件名消毒：id 中非法字符替换为下划线（防路径穿越/坏文件名）。 */
function safeFilePart(value: string): string {
  const sanitized = String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!sanitized || sanitized === '.' || sanitized === '..') return '_'
  return sanitized
}

/** 前端快照标记字段（保存时剥除，绝不落盘——旧实现把 _draft 写盘导致已入库对象被误判草稿）。 */
const CLIENT_META_KEYS = ['_draft', '_clientMeta'] as const

/** 剥除前端快照标记（浅拷贝，不修改入参）。 */
function stripClientMeta<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const next = { ...(value as Record<string, unknown>) }
  for (const key of CLIENT_META_KEYS) delete next[key]
  return next as T
}

/** 提取当前 revision（非法/缺失按 0 处理，旧项目 flowRevision 语义）。 */
function flowRevision(value: { revision?: number } | null): number {
  const r = Number(value?.revision)
  return Number.isInteger(r) && r >= 0 ? r : 0
}

/**
 * 计算保存后的 revision：无显式冲突期望时自动 +1；有期望时必须匹配（除非 force）。
 * 为什么只认显式 expectedRevision（不沿用旧项目 incoming.revision 回退）：文档内
 * revision 是存储层记账字段，保存方携带的任意快照值不应隐式变成冲突期望——
 * 否则"复制快照再保存"会误触发乐观锁（旧项目客户端每次显式传 expectedRevision，
 * 本项目把该语义收敛为显式参数）。
 */
function nextFlowRevision(incoming: { revision?: number; id?: string }, current: { revision?: number } | null, options: SaveOptions = {}): number {
  if (!current) return 1
  const actual = flowRevision(current)
  const rawExpected = options.expectedRevision
  if (rawExpected === undefined || rawExpected === null) {
    return actual + 1
  }
  const expected = Number(rawExpected)
  if (options.force !== true && expected !== actual) {
    throw new FlowRevisionConflictError(incoming?.id ?? (current as { id?: string })?.id ?? '?', expected, actual)
  }
  return actual + 1
}

/** 判断数据模板对象是数据库模板（以 dbType 字段判别）。 */
function isDatabaseTemplate(t: Template): t is DatabaseTemplate {
  return typeof (t as DatabaseTemplate).dbType === 'string'
}

// ---------------------------------------------------------------------------
// FlowStore
// ---------------------------------------------------------------------------

export class FlowStore {
  /** 全部子目录名（init 时创建，常量表供测试断言）。 */
  static readonly DIRS = ['workflows', 'services', 'roles', 'data', 'data/files', 'runs', 'orchestrations'] as const

  constructor(public readonly root: string) {}

  /** 初始化目录结构（幂等：mkdir recursive，重复调用安全）。 */
  async init(): Promise<void> {
    for (const dir of FlowStore.DIRS) {
      await mkdir(join(this.root, dir), { recursive: true })
    }
  }

  // ---- 路径计算（内部） ----------------------------------------------------

  private workflowPath(flowId: string): string {
    return join(this.root, 'workflows', `${safeFilePart(flowId)}.json`)
  }

  private servicePath(serviceId: string): string {
    return join(this.root, 'services', `${safeFilePart(serviceId)}.json`)
  }

  private sessionsPath(serviceId: string): string {
    return join(this.root, 'services', `${safeFilePart(serviceId)}.sessions.json`)
  }

  private templatePath(kind: TemplateKind, id: string): string {
    const dir = kind === 'role' ? 'roles' : 'data'
    return join(this.root, dir, `${safeFilePart(id)}.json`)
  }

  private runsPath(runId: string): string {
    return join(this.root, 'runs', `${safeFilePart(runId)}.json`)
  }

  private orchestrationPath(runId: string): string {
    return join(this.root, 'orchestrations', `${safeFilePart(runId)}.json`)
  }

  private combosPath(): string {
    return join(this.root, 'combos.json')
  }

  // ---- 工作流（模式一；按 sessionId 隔离） ----------------------------------

  /** 列出某会话的全部工作流（按 updatedAt 倒序）。 */
  async listWorkflows(sessionId: string): Promise<WorkflowDocument[]> {
    const dir = join(this.root, 'workflows')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: WorkflowDocument[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const doc = await readJson<WorkflowDocument | null>(join(dir, name), null)
      if (doc && doc.sessionId === sessionId) items.push(doc)
    }
    return items.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  }

  /** 读取单个工作流；不属于该会话返回 null（隔离语义）。 */
  async getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null> {
    const doc = await readJson<WorkflowDocument | null>(this.workflowPath(flowId), null)
    if (!doc || doc.sessionId !== sessionId) return null
    return doc
  }

  /** 保存工作流（创建/更新统一；revision 递增 + 冲突保护 + 原子写）。 */
  async saveWorkflow(flow: WorkflowDocument, sessionId: string, options: SaveOptions = {}): Promise<WorkflowDocument> {
    if (!sessionId) throw new Error('saveWorkflow 需要 sessionId')
    if (!flow?.id) throw new Error('saveWorkflow 需要 flow id')
    const path = this.workflowPath(flow.id)
    return withJsonLock(path, async () => {
      const current = await readJson<WorkflowDocument | null>(path, null)
      const revision = nextFlowRevision(flow, current, options)
      const now = new Date().toISOString()
      const saved: WorkflowDocument = {
        ...stripClientMeta(flow),
        revision,
        sessionId,
        createdAt: flow.createdAt ?? current?.createdAt ?? now,
        updatedAt: now,
      }
      await atomicWriteJson(path, saved)
      return saved
    })
  }

  /** 删除工作流；仅当归属会话匹配时删除（返回是否删除成功）。 */
  async deleteWorkflow(sessionId: string, flowId: string): Promise<boolean> {
    const path = this.workflowPath(flowId)
    return withJsonLock(path, async () => {
      const current = await readJson<WorkflowDocument | null>(path, null)
      if (!current || current.sessionId !== sessionId) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 服务（模式二；按 sessionId 隔离） ------------------------------------

  /** 列出某会话的全部服务（跳过 *.sessions.json 映射文件）。 */
  async listServices(sessionId: string): Promise<ServiceState[]> {
    const dir = join(this.root, 'services')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: ServiceState[] = []
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.sessions.json')) continue
      const doc = await readJson<ServiceState | null>(join(dir, name), null)
      if (doc && doc.sessionId === sessionId) items.push(doc)
    }
    return items.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  }

  /** 读取单个服务；不属于该会话返回 null。 */
  async getService(sessionId: string, serviceId: string): Promise<ServiceState | null> {
    const doc = await readJson<ServiceState | null>(this.servicePath(serviceId), null)
    if (!doc || doc.sessionId !== sessionId) return null
    return doc
  }

  /** 按 id 读取服务（不校验归属会话；服务管理器/服务进程用）。 */
  async getServiceById(serviceId: string): Promise<ServiceState | null> {
    return readJson<ServiceState | null>(this.servicePath(serviceId), null)
  }

  /** 列出全部服务（不按会话过滤；自动恢复扫描用）。 */
  async listServicesAll(): Promise<ServiceState[]> {
    const dir = join(this.root, 'services')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: ServiceState[] = []
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.sessions.json')) continue
      const doc = await readJson<ServiceState | null>(join(dir, name), null)
      if (doc) items.push(doc)
    }
    return items.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  }

  /** 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态）。 */
  async getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null> {
    const service = await this.getServiceById(serviceId)
    if (!service) return null
    return {
      id: service.id,
      sessionId: service.sessionId,
      mode: 'mode2',
      name: service.name,
      description: service.description,
      nodes: service.nodes,
      lines: service.lines,
      revision: service.revision,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    }
  }

  /** 保存服务（revision 递增 + 冲突保护；status/port 等运行字段由服务管理器独立更新）。 */
  async saveService(service: ServiceState, sessionId: string, options: SaveOptions = {}): Promise<ServiceState> {
    if (!sessionId) throw new Error('saveService 需要 sessionId')
    if (!service?.id) throw new Error('saveService 需要 service id')
    const path = this.servicePath(service.id)
    return withJsonLock(path, async () => {
      const current = await readJson<ServiceState | null>(path, null)
      const revision = nextFlowRevision(service, current, options)
      const now = new Date().toISOString()
      const saved: ServiceState = {
        ...stripClientMeta(service),
        revision,
        sessionId,
        createdAt: service.createdAt ?? current?.createdAt ?? now,
        updatedAt: now,
      }
      await atomicWriteJson(path, saved)
      return saved
    })
  }

  /** 删除服务（级联删除其 sessions 映射文件）。 */
  async deleteService(sessionId: string, serviceId: string): Promise<boolean> {
    const path = this.servicePath(serviceId)
    return withJsonLock(path, async () => {
      const current = await readJson<ServiceState | null>(path, null)
      if (!current || current.sessionId !== sessionId) return false
      await rm(path, { force: true })
      await rm(this.sessionsPath(serviceId), { force: true })
      return true
    })
  }

  // ---- 模板（全局共享，不隔离） ---------------------------------------------

  /** 列出角色模板（精确返回类型重载，供调用方免断言）。 */
  async listTemplates(kind: 'role'): Promise<RoleTemplate[]>
  /** 列出文件模板（data/ 下按字段判别过滤）。 */
  async listTemplates(kind: 'file'): Promise<FileTemplate[]>
  /** 列出数据库模板（data/ 下按字段判别过滤）。 */
  async listTemplates(kind: 'database'): Promise<DatabaseTemplate[]>
  /** 列出某类模板（kind 联合兜底；具体子类型请用窄签名）。 */
  async listTemplates(kind: TemplateKind): Promise<Template[]>
  /** 列出某类模板（roles/ 为角色模板；data/ 为文件+数据库模板，按字段判别过滤）。 */
  async listTemplates(kind: TemplateKind): Promise<Template[]> {
    const dir = kind === 'role' ? join(this.root, 'roles') : join(this.root, 'data')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: Template[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const t = await readJson<Template | null>(join(dir, name), null)
      if (!t) continue
      // 数据模板同目录混存：file 与 database 以 dbType 字段判别（§6 目录规划）
      if (kind === 'file' && isDatabaseTemplate(t)) continue
      if (kind === 'database' && !isDatabaseTemplate(t)) continue
      items.push(t)
    }
    return items.sort((a, b) => String((a as RoleTemplate).name ?? '').localeCompare(String((b as RoleTemplate).name ?? '')))
  }

  /** 按 id 取单个模板（无则 null；导入导出用）。 */
  async getTemplate(kind: TemplateKind, id: string): Promise<Template | null> {
    const list = await this.listTemplates(kind)
    return list.find((item) => item.id === id) ?? null
  }

  /** 保存模板（原子写；模板 id 由调用方生成；返回带 createdAt/updatedAt 的持久化副本）。 */
  async saveTemplate(kind: TemplateKind, template: Template): Promise<Template> {
    if (!template?.id) throw new Error('saveTemplate 需要 template id')
    const path = this.templatePath(kind, template.id)
    return withJsonLock(path, async () => {
      const now = new Date().toISOString()
      const saved = { ...stripClientMeta(template), createdAt: (template as { createdAt?: string }).createdAt ?? now, updatedAt: now }
      await atomicWriteJson(path, saved)
      return saved as Template
    })
  }

  /** 删除模板（仅删文件，不影响画布中已深拷贝的节点——§4.2.1 解耦语义）。 */
  async deleteTemplate(kind: TemplateKind, id: string): Promise<boolean> {
    const path = this.templatePath(kind, id)
    return withJsonLock(path, async () => {
      const exists = (await readJson<Template | null>(path, null)) !== null
      if (!exists) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 运行历史（runs/<runId>.json 单文件；按 flowId 过滤） ------------------

  /** 列出某工作流的全部 run（按 startedAt 倒序）。 */
  async listRuns(flowId: string): Promise<RunSnapshot[]> {
    const dir = join(this.root, 'runs')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: RunSnapshot[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const run = await readJson<RunSnapshot | null>(join(dir, name), null)
      if (run && run.flowId === flowId) items.push(run)
    }
    return items.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
  }

  /** 读取单个 run 快照。 */
  async getRun(runId: string): Promise<RunSnapshot | null> {
    return readJson<RunSnapshot | null>(this.runsPath(runId), null)
  }

  /** run 是否存在（恢复入口校验用）。 */
  async runExists(runId: string): Promise<boolean> {
    return (await readJson<RunSnapshot | null>(this.runsPath(runId), null)) !== null
  }

  /** 保存 run 快照（断点持久化走同一入口；原子写保证崩溃不撕裂）。 */
  async saveRun(run: RunSnapshot): Promise<RunSnapshot> {
    if (!run?.id) throw new Error('saveRun 需要 run id')
    const path = this.runsPath(run.id)
    return withJsonLock(path, async () => {
      await atomicWriteJson(path, run)
      return run
    })
  }

  /** 扫描全部 run id（reconcileStaleRuns 用，T-027）。 */
  async listAllRunIds(): Promise<string[]> {
    const dir = join(this.root, 'runs')
    try {
      return (await readdir(dir)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length))
    } catch {
      return []
    }
  }

  // ---- 工具组合（combos.json 单文件） ---------------------------------------

  /** 列出全部工具组合（全局共享）。 */
  async listToolCombos(): Promise<ToolCombo[]> {
    const state = await readJson<{ combos: ToolCombo[] }>(this.combosPath(), { combos: [] })
    return state.combos ?? []
  }

  /** 保存工具组合（id 须为 combo- 前缀，§4.6 规则 2）。 */
  async saveToolCombo(combo: ToolCombo): Promise<ToolCombo> {
    if (!combo?.id || !combo.id.startsWith('combo-')) throw new Error('工具组合 id 必须以 combo- 前缀')
    if (!Array.isArray(combo.tools)) throw new Error('工具组合 tools 必须为数组')
    const path = this.combosPath()
    return withJsonLock(path, async () => {
      const state = await readJson<{ combos: ToolCombo[] }>(path, { combos: [] })
      const combos = [combo, ...(state.combos ?? []).filter((c) => c.id !== combo.id)]
      await atomicWriteJson(path, { combos })
      return combo
    })
  }

  /** 删除工具组合。 */
  async deleteToolCombo(id: string): Promise<boolean> {
    const path = this.combosPath()
    return withJsonLock(path, async () => {
      const state = await readJson<{ combos: ToolCombo[] }>(path, { combos: [] })
      const existed = (state.combos ?? []).some((c) => c.id === id)
      if (!existed) return false
      await atomicWriteJson(path, { combos: (state.combos ?? []).filter((c) => c.id !== id) })
      return true
    })
  }

  // ---- userId → sessionId 映射（模式二多租户隔离，§4.1.3 规则 7） -------------

  /** 读取某服务的 userId 映射（返回副本，防调用方意外修改内部缓存）。 */
  async userIdMap(serviceId: string): Promise<Record<string, string>> {
    const map = await readJson<Record<string, string>>(this.sessionsPath(serviceId), {})
    return { ...(map ?? {}) }
  }

  /** 保存某服务的 userId 映射（原子写；映射持久化在服务重启后仍有效）。 */
  async saveUserIdMap(serviceId: string, map: Record<string, string>): Promise<void> {
    await withJsonLock(this.sessionsPath(serviceId), async () => {
      await atomicWriteJson(this.sessionsPath(serviceId), map ?? {})
    })
  }

  /**
   * 合并写入某服务的 userId 映射（读改写在同一把 withJsonLock 内完成）。
   * 为什么必须合并而不是「先 userIdMap 再 saveUserIdMap」：后者是两次独立锁
   * 作用域内的读改-写，不同 userId 并发首解析时互相覆盖（丢失映射 → 重启后
   * 上下文断裂）。合并写把 read-modify-write 收进同一临界区，并发安全。
   */
  async mergeUserIdMap(serviceId: string, entries: Record<string, string>): Promise<Record<string, string>> {
    return withJsonLock(this.sessionsPath(serviceId), async () => {
      const current = await readJson<Record<string, string>>(this.sessionsPath(serviceId), {})
      const merged: Record<string, string> = { ...(current ?? {}), ...entries }
      await atomicWriteJson(this.sessionsPath(serviceId), merged)
      return merged
    })
  }

  // ---- 编排事实源（orchestrations/<runId>.json，父代理只读） ------------------

  /** 保存运行时流程定义（startRun 时写入，父代理只读的事实源）。 */
  async saveOrchestration(runId: string, flow: WorkflowDocument): Promise<void> {
    await withJsonLock(this.orchestrationPath(runId), async () => {
      await atomicWriteJson(this.orchestrationPath(runId), flow)
    })
  }

  /** 读取运行时流程定义。 */
  async readOrchestration(runId: string): Promise<WorkflowDocument | null> {
    return readJson<WorkflowDocument | null>(this.orchestrationPath(runId), null)
  }

  /** 运行时流程定义文件的绝对路径（编排指令 facts.definitionPath 注入用，T-021）。 */
  orchestrationFilePath(runId: string): string {
    return this.orchestrationPath(runId)
  }

  /** 删除运行时流程定义（run 收尾/清理时调用）。 */
  async deleteOrchestration(runId: string): Promise<boolean> {
    const path = this.orchestrationPath(runId)
    return withJsonLock(path, async () => {
      const exists = (await readJson<WorkflowDocument | null>(path, null)) !== null
      if (!exists) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 数据模板辅助 ---------------------------------------------------------

  /** 数据模板按子类筛选：file（文件）或 database（数据库）——复用 listTemplates 重载的精确过滤。 */
  async listDataTemplates(subKind: 'file' | 'database'): Promise<Array<FileTemplate | DatabaseTemplate>> {
    return subKind === 'database' ? this.listTemplates('database') : this.listTemplates('file')
  }

  /** 节点 → 模板深拷贝（§4.2.1：拖入画布时深拷贝模板嵌入工作流 JSON，此后断引用）。 */
  templateToNode(template: Template, id: string, position: { x: number; y: number }): GraphNode | null {
    if ((template as RoleTemplate).kind === 'parent' || (template as RoleTemplate).kind === 'agent') {
      const r = template as RoleTemplate
      return {
        id,
        kind: r.kind,
        position: { ...position },
        data: {
          label: r.name,
          systemPrompt: r.systemPrompt,
          provider: r.provider,
          model: r.model,
          reasoning: r.reasoning,
          presetId: r.presetId ?? null,
          retryLimit: r.retryLimit,
          reactLimit: r.reactLimit ?? null,
          inputSchema: r.inputSchema ?? '',
          outputSchema: r.outputSchema ?? '',
          injectSystemPrompt: r.injectSystemPrompt !== false,
          promptFilePath: r.promptFilePath ?? undefined,
          groupId: null,
          proxySourceId: null,
        },
      }
    }
    if (isDatabaseTemplate(template)) {
      return {
        id,
        kind: 'database',
        position: { ...position },
        data: {
          label: template.name,
          description: template.description,
          dbType: template.dbType,
          dbKind: template.dbKind,
          localPath: template.localPath,
          conn: template.conn,
          vectorSource: template.vectorSource,
        },
      }
    }
    const f = template as FileTemplate
    // files 列表（多选）优先；兼容单选旧字段（fileName/managedPath）
    const files = Array.isArray(f.files) && f.files.length > 0
      ? f.files.map((item) => ({ fileName: String(item?.fileName ?? ''), managedPath: String(item?.managedPath ?? '') }))
      : []
    return {
      id,
      kind: 'file',
      position: { ...position },
      data: {
        label: f.name,
        fileKind: f.fileKind,
        content: f.content ?? '',
        managedPath: f.managedPath,
        fileName: f.managedPath ? f.managedPath.split(/[\\/]/).pop() : '',
        ...(files.length > 0 ? { files } : {}),
      },
    }
  }
}

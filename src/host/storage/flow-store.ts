// src/host/storage/flow-store.ts
//
// FlowStore：插件持久化事实层的唯一公共门面。
//
// 核心职责（见 ./AGENTS.md）：把 Host 的持久化文档以「单文件即单资源 + 原子发布 +
// 进程内/跨进程锁」保存与读取。目录布局与路径计算的稳定契约见 ./storage-paths.ts；
// 原子写/读与锁原语见 ./atomic.ts；写入字段与版本策略的纯逻辑见 ./document-policy.ts；
// 模板种类判别见 ./template-model.ts；服务↔工作流投影见 ./service-view.ts。
//
// 非职责：不做 Workflow/图语义决策（合法性、状态机、运行推进、结构编辑）；不持有
// 运行态内存事实（运行锁/快照/等待器归 orchestrator）；不定义第二套 Workflow 结构
// 事实源。
//
// 会话隔离（需求 §4.2.2 规则 3 / Q23）：workflow/service 文件内记录 sessionId，
// 列出/读取按 sessionId 过滤；模板（roles/data/groups/flow-templates）与工具组合
// 全局共享不隔离。

import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, readJson, withJsonLock, CorruptJsonError } from './atomic.js'
import {
  DIRS as DATA_DIRS,
  NESTED_DIRS as NESTED_DATA_DIRS,
  combosPath,
  flowTemplatePath,
  orchestrationPath,
  runsPath,
  servicePath,
  sessionsPath,
  templateDir,
  templatePath,
  workflowPath,
} from './storage-paths.js'
import { isDatabaseTemplate, type Template, type TemplateKind } from './template-model.js'
import {
  keepServerFieldsOf,
  nextFlowRevision,
  stripClientMeta,
  type SaveOptions,
} from './document-policy.js'
import { serviceToWorkflowView } from './service-view.js'
import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js'
import type {
  ServiceState,
  ToolCombo,
  RunSnapshot,
  RoleTemplate,
  FileTemplate,
  DatabaseTemplate,
  GroupTemplate,
} from '../shared/types.js'

// 公共契约再导出（保持既有 import 路径：`from '.../storage/flow-store.js'`）：
// 模板种类判别（template-model）与保存选项/冲突错误（document-policy）。
export type { Template, TemplateKind } from './template-model.js'
export type { SaveOptions } from './document-policy.js'
export { FlowRevisionConflictError } from './document-policy.js'

// ---------------------------------------------------------------------------
// 列表读取容错（持久化层策略）
// ---------------------------------------------------------------------------

/**
 * 列表场景逐文件读取：单个文件损坏（CorruptJsonError）时跳过该文件返回 null，
 * 不阻塞整个列表——一个损坏的 JSON 不应让同目录其他正常文件全部不可见（Bug 21）。
 * 其余读取失败（EACCES 等）仍上浮（保留可诊断性，防止把权限问题伪装成空列表）。
 * 注意：单资源读取不使用本函数——单资源读遇损坏必须抛错（见 ./AGENTS.md）。
 */
async function readListEntry<T>(dir: string, name: string): Promise<T | null> {
  try {
    return await readJson<T | null>(join(dir, name), null)
  } catch (error) {
    if (error instanceof CorruptJsonError) return null
    throw error
  }
}

/** 按 updatedAt 倒序（缺失时间戳按空串处理，稳定排序）。 */
function byUpdatedAtDesc<T extends { updatedAt?: string }>(a: T, b: T): number {
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
}

// ---------------------------------------------------------------------------
// FlowStore
// ---------------------------------------------------------------------------

export class FlowStore {
  /** 顶层数据目录（init 时创建；常量表供测试与外部工具断言布局）。 */
  static readonly DIRS = DATA_DIRS
  /** 嵌套子目录（相对 root；随顶层目录一并幂等创建）。 */
  static readonly NESTED_DIRS = NESTED_DATA_DIRS

  constructor(public readonly root: string) {}

  /** 初始化目录结构（幂等：mkdir recursive，重复调用安全）。 */
  async init(): Promise<void> {
    for (const dir of [...FlowStore.DIRS, ...FlowStore.NESTED_DIRS]) {
      await mkdir(join(this.root, dir), { recursive: true })
    }
  }

  // ---- 工作流（模式一；工作台全局化后列表按需跨会话） ------------------------

  /**
   * 列出工作流（按 updatedAt 倒序）。
   * 工作台全局化改版：sessionId 缺省时列出**全部会话**的工作流实例（工作台
   * 全局面板「所有实例」数据源）；传入 sessionId 时仍按会话过滤（定时任务
   * 检测目标会话已有实例、旧单会话面板兼容调用）。
   */
  async listWorkflows(sessionId?: string): Promise<WorkflowDocument[]> {
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
      const doc = await readListEntry<WorkflowDocument>(dir, name)
      if (doc && (sessionId === undefined || doc.sessionId === sessionId)) items.push(doc)
    }
    return items.sort(byUpdatedAtDesc)
  }

  /** 读取单个工作流；不属于该会话返回 null（隔离语义）。 */
  async getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null> {
    const doc = await readJson<WorkflowDocument | null>(workflowPath(this.root, flowId), null)
    if (!doc || doc.sessionId !== sessionId) return null
    return doc
  }

  /** 保存工作流（创建/更新统一；revision 递增 + 冲突保护 + 原子写）。 */
  async saveWorkflow(flow: WorkflowDocument, sessionId: string, options: SaveOptions = {}): Promise<WorkflowDocument> {
    if (!sessionId) throw new Error('saveWorkflow 需要 sessionId')
    if (!flow?.id) throw new Error('saveWorkflow 需要 flow id')
    const path = workflowPath(this.root, flow.id)
    return withJsonLock(path, async () => {
      const current = await readJson<WorkflowDocument | null>(path, null)
      const revision = nextFlowRevision(flow, current, options)
      const now = new Date().toISOString()
      const saved: WorkflowDocument = {
        ...stripClientMeta(flow, keepServerFieldsOf(options)),
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
    const path = workflowPath(this.root, flowId)
    return withJsonLock(path, async () => {
      const current = await readJson<WorkflowDocument | null>(path, null)
      if (!current || current.sessionId !== sessionId) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 服务（模式二；工作台全局化后列表按需跨会话） --------------------------

  /**
   * 列出服务（跳过 *.sessions.json 映射文件；按 updatedAt 倒序）。
   * 工作台全局化改版：sessionId 缺省时列出**全部会话**的服务实例；传入时按
   * 会话过滤（旧单会话面板兼容调用）。
   */
  async listServices(sessionId?: string): Promise<ServiceState[]> {
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
      const doc = await readListEntry<ServiceState>(dir, name)
      if (doc && (sessionId === undefined || doc.sessionId === sessionId)) items.push(doc)
    }
    return items.sort(byUpdatedAtDesc)
  }

  /** 读取单个服务；不属于该会话返回 null。 */
  async getService(sessionId: string, serviceId: string): Promise<ServiceState | null> {
    const doc = await readJson<ServiceState | null>(servicePath(this.root, serviceId), null)
    if (!doc || doc.sessionId !== sessionId) return null
    return doc
  }

  /** 按 id 读取服务（不校验归属会话；服务管理器/服务进程用）。 */
  async getServiceById(serviceId: string): Promise<ServiceState | null> {
    return readJson<ServiceState | null>(servicePath(this.root, serviceId), null)
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
      const doc = await readListEntry<ServiceState>(dir, name)
      if (doc) items.push(doc)
    }
    return items.sort(byUpdatedAtDesc)
  }

  /** 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态；纯投影，不读盘）。 */
  async getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null> {
    const service = await this.getServiceById(serviceId)
    if (!service) return null
    return serviceToWorkflowView(service)
  }

  /**
   * 按「工作流视图」写回服务实例（补丁工具用）：只覆盖图结构与元参数，
   * 保留服务自身的运行字段（status/port/apiKeyHash/时间戳），避免调用方拼错形状。
   *
   * 并发契约：存在性/归属校验、合并、revision 记账与写盘全部在**同一把服务文件锁**内
   * 完成——若在锁外读取再锁内写回，会覆盖 ServiceManager 并发写入的运行字段（丢更新）。
   */
  async saveServiceAsFlow(doc: WorkflowDocument, sessionId: string, options: SaveOptions = {}): Promise<WorkflowDocument> {
    if (!sessionId) throw new Error('saveServiceAsFlow 需要 sessionId')
    if (!doc?.id) throw new Error('saveServiceAsFlow 需要 service id')
    const path = servicePath(this.root, doc.id)
    return withJsonLock(path, async () => {
      const current = await readJson<ServiceState | null>(path, null)
      if (!current) throw new Error(`服务不存在：${doc.id}`)
      if (current.sessionId !== sessionId) throw new Error(`服务不属于该会话：${doc.id}`)
      const merged: ServiceState = {
        ...current,
        name: doc.name ?? current.name,
        description: doc.description ?? current.description,
        nodes: doc.nodes,
        lines: doc.lines,
        ...(doc.meta ? { meta: doc.meta } : {}),
      }
      const saved = await this.writeServiceDoc(path, merged, current, sessionId, options)
      return serviceToWorkflowView(saved)
    })
  }

  /** 保存服务（revision 递增 + 冲突保护；status/port 等运行字段由服务管理器独立更新）。 */
  async saveService(service: ServiceState, sessionId: string, options: SaveOptions = {}): Promise<ServiceState> {
    if (!sessionId) throw new Error('saveService 需要 sessionId')
    if (!service?.id) throw new Error('saveService 需要 service id')
    const path = servicePath(this.root, service.id)
    return withJsonLock(path, async () => {
      const current = await readJson<ServiceState | null>(path, null)
      return this.writeServiceDoc(path, service, current, sessionId, options)
    })
  }

  /**
   * 服务文档写回（调用方必须已持该服务文件锁，且已完成各自的校验）：
   * revision 记账 + 客户端字段剥除 + 原子写，返回落盘副本。
   */
  private async writeServiceDoc(
    path: string,
    incoming: ServiceState,
    current: ServiceState | null,
    sessionId: string,
    options: SaveOptions,
  ): Promise<ServiceState> {
    const revision = nextFlowRevision(incoming, current, options)
    const now = new Date().toISOString()
    const saved: ServiceState = {
      ...stripClientMeta(incoming, keepServerFieldsOf(options)),
      revision,
      sessionId,
      createdAt: incoming.createdAt ?? current?.createdAt ?? now,
      updatedAt: now,
    }
    await atomicWriteJson(path, saved)
    return saved
  }

  /** 删除服务（级联删除其 sessions 映射文件）。 */
  async deleteService(sessionId: string, serviceId: string): Promise<boolean> {
    const path = servicePath(this.root, serviceId)
    return withJsonLock(path, async () => {
      const current = await readJson<ServiceState | null>(path, null)
      if (!current || current.sessionId !== sessionId) return false
      await rm(path, { force: true })
      await rm(sessionsPath(this.root, serviceId), { force: true })
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
  /** 列出协作组模板（groups/ 目录）。 */
  async listTemplates(kind: 'group'): Promise<GroupTemplate[]>
  /** 列出某类模板（kind 联合兜底；具体子类型请用窄签名）。 */
  async listTemplates(kind: TemplateKind): Promise<Template[]>
  /** 列出某类模板（roles/ 角色；groups/ 协作组；data/ 文件+数据库按字段判别过滤）。 */
  async listTemplates(kind: TemplateKind): Promise<Template[]> {
    const dir = join(this.root, templateDir(kind))
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: Template[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const t = await readListEntry<Template>(dir, name)
      if (!t) continue
      // 数据模板同目录混存：file 与 database 以 dbType 字段判别（§6 目录规划）
      if (kind === 'file' && isDatabaseTemplate(t)) continue
      if (kind === 'database' && !isDatabaseTemplate(t)) continue
      items.push(t)
    }
    return items.sort((a, b) => String((a as { name?: string }).name ?? '').localeCompare(String((b as { name?: string }).name ?? '')))
  }

  /**
   * 按 id 取单个模板（无则 null；导入导出用）。
   * 单资源读：直接按 id 定位文件并保持 file/database 子类判别；损坏 JSON 抛
   * CorruptJsonError（不伪装成「不存在」，避免导入路径静默覆盖损坏数据）。
   */
  async getTemplate(kind: TemplateKind, id: string): Promise<Template | null> {
    const t = await readJson<Template | null>(templatePath(this.root, kind, id), null)
    if (!t) return null
    if (kind === 'file' && isDatabaseTemplate(t)) return null
    if (kind === 'database' && !isDatabaseTemplate(t)) return null
    return t
  }

  /**
   * 保存模板（原子写；模板 id 由调用方生成；返回带 createdAt/updatedAt 的持久化副本）。
   * 时间戳策略与其余 save* 一致：createdAt = 调用方值 ?? 既有值 ?? now，
   * 避免更新时把创建时间重置为当前时间。
   */
  async saveTemplate(kind: TemplateKind, template: Template): Promise<Template> {
    if (!template?.id) throw new Error('saveTemplate 需要 template id')
    const path = templatePath(this.root, kind, template.id)
    return withJsonLock(path, async () => {
      const current = await readJson<Template | null>(path, null)
      const now = new Date().toISOString()
      const saved = {
        ...stripClientMeta(template),
        createdAt: template.createdAt ?? current?.createdAt ?? now,
        updatedAt: now,
      }
      await atomicWriteJson(path, saved)
      return saved as Template
    })
  }

  /** 删除模板（仅删文件，不影响画布中已深拷贝的节点——§4.2.1 解耦语义）。 */
  async deleteTemplate(kind: TemplateKind, id: string): Promise<boolean> {
    const path = templatePath(this.root, kind, id)
    return withJsonLock(path, async () => {
      const exists = (await readJson<Template | null>(path, null)) !== null
      if (!exists) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 工作流模板（flow-templates/，全局共享，不按会话隔离；图2 交互改造） ----

  /** 列出全部工作流模板（按 updatedAt 倒序；全局共享，所有会话可见）。 */
  async listFlowTemplates(): Promise<WorkflowTemplate[]> {
    const dir = join(this.root, 'flow-templates')
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const items: WorkflowTemplate[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const t = await readListEntry<WorkflowTemplate>(dir, name)
      if (t) items.push(t)
    }
    return items.sort(byUpdatedAtDesc)
  }

  /** 按 id 读取单个工作流模板（无则 null）。 */
  async getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null> {
    return readJson<WorkflowTemplate | null>(flowTemplatePath(this.root, templateId), null)
  }

  /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护 + 原子写；无 sessionId 隔离）。 */
  async saveFlowTemplate(template: WorkflowTemplate, options: SaveOptions = {}): Promise<WorkflowTemplate> {
    if (!template?.id) throw new Error('saveFlowTemplate 需要模板 id')
    const path = flowTemplatePath(this.root, template.id)
    return withJsonLock(path, async () => {
      const current = await readJson<WorkflowTemplate | null>(path, null)
      const revision = nextFlowRevision(template, current, options)
      const now = new Date().toISOString()
      const saved: WorkflowTemplate = {
        ...stripClientMeta(template, keepServerFieldsOf(options)),
        revision,
        createdAt: template.createdAt ?? current?.createdAt ?? now,
        updatedAt: now,
      }
      await atomicWriteJson(path, saved)
      return saved
    })
  }

  /** 删除工作流模板（仅删文件，不影响已生成的实例——模板/实例深拷贝解耦语义）。 */
  async deleteFlowTemplate(templateId: string): Promise<boolean> {
    const path = flowTemplatePath(this.root, templateId)
    return withJsonLock(path, async () => {
      const exists = (await readJson<WorkflowTemplate | null>(path, null)) !== null
      if (!exists) return false
      await rm(path, { force: true })
      return true
    })
  }

  // ---- 运行历史（runs/<runId>.json 单文件；按 flowId 过滤） ------------------

  /**
   * 列出某工作流的全部 run（按 startedAt 倒序）。
   * @param sessionId 可选会话过滤：传入时仅返回归属该会话的 run（历史查询端点
   *   必须传，防跨会话运行历史泄露；resume 侧因调用前已按会话定位 flow 可不传）。
   */
  async listRuns(flowId: string, sessionId?: string): Promise<RunSnapshot[]> {
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
      const run = await readListEntry<RunSnapshot>(dir, name)
      if (run && run.flowId === flowId && (sessionId === undefined || run.sessionId === sessionId)) items.push(run)
    }
    return items.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
  }

  /** 读取单个 run 快照。 */
  async getRun(runId: string): Promise<RunSnapshot | null> {
    return readJson<RunSnapshot | null>(runsPath(this.root, runId), null)
  }

  /** 保存 run 快照（断点持久化走同一入口；原子写保证崩溃不撕裂）。 */
  async saveRun(run: RunSnapshot): Promise<RunSnapshot> {
    if (!run?.id) throw new Error('saveRun 需要 run id')
    const path = runsPath(this.root, run.id)
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
    const state = await readJson<{ combos: ToolCombo[] }>(combosPath(this.root), { combos: [] })
    return state.combos ?? []
  }

  /** 保存工具组合（id 须为 combo- 前缀，§4.6 规则 2）。 */
  async saveToolCombo(combo: ToolCombo): Promise<ToolCombo> {
    if (!combo?.id || !combo.id.startsWith('combo-')) throw new Error('工具组合 id 必须以 combo- 前缀')
    if (!Array.isArray(combo.tools)) throw new Error('工具组合 tools 必须为数组')
    const path = combosPath(this.root)
    return withJsonLock(path, async () => {
      const state = await readJson<{ combos: ToolCombo[] }>(path, { combos: [] })
      const combos = [combo, ...(state.combos ?? []).filter((c) => c.id !== combo.id)]
      await atomicWriteJson(path, { combos })
      return combo
    })
  }

  /** 删除工具组合。 */
  async deleteToolCombo(id: string): Promise<boolean> {
    const path = combosPath(this.root)
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
    const map = await readJson<Record<string, string>>(sessionsPath(this.root, serviceId), {})
    return { ...(map ?? {}) }
  }

  /**
   * 合并写入某服务的 userId 映射（读改写在同一把 withJsonLock 内完成）。
   * 为什么必须合并而不是「先读再整表写回」：后者是两次独立锁作用域内的读改-写，
   * 不同 userId 并发首解析时互相覆盖（丢失映射 → 重启后上下文断裂）。合并写把
   * read-modify-write 收进同一临界区，并发安全。
   *
   * 生命周期不变式（跨文件，见 ./AGENTS.md）：映射文件从属于服务文档。删除服务后
   * 不得再写映射；调用方在写入前须确认服务仍存在（storage 不保证跨文件事务）。
   */
  async mergeUserIdMap(serviceId: string, entries: Record<string, string>): Promise<Record<string, string>> {
    return withJsonLock(sessionsPath(this.root, serviceId), async () => {
      const current = await readJson<Record<string, string>>(sessionsPath(this.root, serviceId), {})
      const merged: Record<string, string> = { ...(current ?? {}), ...entries }
      await atomicWriteJson(sessionsPath(this.root, serviceId), merged)
      return merged
    })
  }

  // ---- 编排事实源（orchestrations/<runId>.json，父代理只读） ------------------

  /** 保存运行时流程定义（startRun 时写入，父代理只读的事实源）。 */
  async saveOrchestration(runId: string, flow: WorkflowDocument): Promise<void> {
    await withJsonLock(orchestrationPath(this.root, runId), async () => {
      await atomicWriteJson(orchestrationPath(this.root, runId), flow)
    })
  }

  /** 读取运行时流程定义。 */
  async readOrchestration(runId: string): Promise<WorkflowDocument | null> {
    return readJson<WorkflowDocument | null>(orchestrationPath(this.root, runId), null)
  }

  /** 运行时流程定义文件的绝对路径（编排指令 facts.definitionPath 注入用，T-021）。 */
  orchestrationFilePath(runId: string): string {
    return orchestrationPath(this.root, runId)
  }
}

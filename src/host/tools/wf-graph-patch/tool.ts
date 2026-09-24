// src/host/tools/wf-graph-patch/tool.ts
//
// wf_graph_patch 工具注册（自主编排方案 §4.2）：父代理写图的**唯一入口**，语义三分区。
//
// 三分区（同一工具、三条零共享代码路径）：
//   A. 图结构变更（create_node/remove_node/update_node_data/connect/disconnect/create_group/
//      set_group_members）→ 检查器校验 + 元参数硬护栏（仅 origin='agent'）+ 原子落盘；
//   B. 元参数（set_meta）→ 归一化 + 新规模下的护栏复检 + 落 meta；
//   C. 运行状态标记（mark_node）→ 闸门状态推进（D-07；P3 追加闸门身份判定）。
//   同一补丁混用不同组 → WF_PATCH_MIXED_GROUPS（参数层拒绝，错误文本写明分区原因）。
//
// 落盘规范（§3 数据流）：scope='template' 改工作流模板（规划期）；scope='instance'
// 改当前实例（运行期），并即时刷新活跃 run 的事实源与画布回显（双向同步②）。
// 新建通路（用户裁决 2026.09，修正方案 §4.2 的自相矛盾）：scope='template' 带
// `create` 参数 = 新建模板（规划期主用例：无模板 → 产出模板）；不带 create 仍是
// 「必须已存在」的更新语义。显式传入已存在的 targetId + create → WF_PATCH_CONFLICT，
// 绝不静默覆盖。create 只允许与 graph 组同用（其余组语义不成立）。
// 坐标纯视图数据（D-16）：补丁不接受 position，新建节点写哨兵 {0,0} 交由客户端自动布局。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用），≤120 tokens。

import { randomUUID } from 'node:crypto'

import { WF_GRAPH_PATCH, ERR_REVISION_CONFLICT } from '../../shared/protocol.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { callerOf } from '../infrastructure/caller.js'
import { WfError } from '../../orchestrator/index.js'
import {
  checkGraphInvariants,
  effectiveOrgMeta,
  hasBlockingIssues,
  mainNodeIdOf,
  metaLimitIssues,
  metaOfDocument,
  normalizeOrgMeta,
  orgUsageOf,
  validateFlow,
  type GraphIssue,
} from '../../graph/index.js'
import { applyGraphOps, applyMarkOp, OP_FIELD_SHAPES, ROLE_NODE_DATA_CONTRACT } from './apply.js'
import {
  GROUP_HINTS,
  groupsOf,
  unknownOpsOf,
  type GraphPatchOp,
  type MarkPatchOp,
  type MetaPatchOp,
  type NewTemplateSpec,
  type PatchGroup,
  type PatchOp,
  type PatchScope,
} from './types.js'
import type { GraphNode, Line, WorkflowDocument, WorkflowTemplate } from '../../shared/graph-model.js'
import type { OrgMeta } from '../../shared/types.js'
import type { MilestoneMarkResult, MilestoneRunFacts, RunEntry } from '../../orchestrator/index.js'

/** 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。 */
export interface GraphPatchHost {
  /** 数据层读写（模板/实例文档 + 运行事实源刷新）。 */
  store: {
    getFlowTemplate(id: string): Promise<WorkflowTemplate | null>
    saveFlowTemplate(template: WorkflowTemplate, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowTemplate>
    getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null>
    saveWorkflow(doc: WorkflowDocument, sessionId: string, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowDocument>
    getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null>
    saveServiceAsFlow?(doc: WorkflowDocument, sessionId: string, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowDocument>
    getRun(runId: string): Promise<unknown>
    listRuns(flowId: string): Promise<unknown[]>
  }
  /** 编排运行时能力（mark_node 路径 + 事实源刷新 + 空闲基准）。 */
  orchestrator: {
    activeRunForSession(sessionId: string): RunEntry | null
    flowLockInfo(flowId: string): { runId: string; sessionId: string; status: string } | null
    currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument>
    touchRunForSession(sessionId: string): boolean
    refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void>
    /** 闸门标记所需的运行事实（只读；快照归运行时所有）。 */
    milestoneFactsFor(sessionId: string): MilestoneRunFacts | null
    /** 闸门节点状态写入（运行快照的唯一写者）；返回递增后的已用次数。 */
    markMilestoneNode(sessionId: string, input: { nodeId: string; status: 'ok' | 'fail' }): MilestoneMarkResult
  }
  /** 运行快照落盘（mark_node 后固化状态；缺省跳过持久化——单测可省）。 */
  persistRun?: (runId: string) => Promise<void>
  /** 闸门已用次数（不含首次编排 D-21）；P3 实现真实计数，缺省 0。 */
  milestoneUsedOf?: (sessionId: string) => number
  /**
   * 新建模板 id 生成缝（create 通路；缺省用 node:crypto 的 randomUUID 截断）。
   * 抽成缝的原因：单测需要确定性 id，而 id 生成不是工具的校验逻辑。
   */
  newTemplateId?: () => string
}

/** 补丁执行结果（工具返回体）。 */
export interface GraphPatchToolResult {
  ok: true
  scope: PatchScope
  targetId: string
  revision: number
  applied: number
  warnings: Array<{ code: string; message: string }>
  /** true = 本次补丁新建了模板（scope=template + create）；targetId 即新模板 id。 */
  newTemplate?: boolean
  /** mark_node 后本 run 已完成的闸门次数（D-21：不含首次编排）。 */
  milestoneUsed?: number
  created?: string[]
  removed?: string[]
  updated?: string[]
  connected?: string[]
  disconnected?: string[]
  meta?: OrgMeta
  marked?: { nodeId: string; status: 'ok' | 'fail'; runId: string }
}

/** 检查器 issue → 返回体 warnings（warning 级不阻断）。 */
function warningsOf(issues: GraphIssue[]): Array<{ code: string; message: string }> {
  return (issues ?? [])
    .filter((issue) => issue.level === 'warning')
    .map((issue) => ({ code: issue.code, message: issue.message }))
}

/**
 * 阻断型 issue → WF_GRAPH_INVALID（错误文本带全部明细与修复建议，
 * 这是模型自我修正的唯一通道，故必须把建议原样透出）。
 */
function throwGraphInvalid(issues: GraphIssue[]): never {
  const detail = issues.map((issue) => {
    const where = [...(issue.nodeIds ?? []), ...(issue.lineIds ?? [])].join(',')
    const hint = String(issue.suggestion ?? '').trim()
    return `[${issue.code}]${where ? `(${where})` : ''} ${issue.message}${hint ? ` → 建议：${hint}` : ''}`
  }).join('\n')
  throw new WfError(`补丁被图检查器阻断（${issues.length} 项）：\n${detail}`, 'WF_GRAPH_INVALID')
}

/** 补丁 op 数上限（元参数 patchOpsMax 由 A/B 组各自在护栏里判定；此处只做整体 sanity）。 */
const PATCH_OPS_HARD_LIMIT = 200

/** 目标实际类型：工作流模板 / 实例（工作流或服务）。 */
type TargetKind = 'template' | 'instance' | 'none'

/**
 * 判定目标实际类型（按真实存在性，不按调用方声明）：
 * scope 与类型不匹配时给出可行动错误（§4.2 WF_SCOPE_INVALID），避免「用错 scope
 * 把实例当模板保存」这类静默错写。
 */
async function detectTargetKind(
  host: GraphPatchHost,
  input: { sessionId: string; targetId: string },
): Promise<TargetKind> {
  const template = await host.store.getFlowTemplate(input.targetId)
  if (template) return 'template'
  const workflow = await host.store.getWorkflow(input.sessionId, input.targetId)
  if (workflow) return 'instance'
  const service = await host.store.getServiceAsFlow(input.targetId)
  if (service) return 'instance'
  return 'none'
}

/** 校验 scope 与目标类型匹配（§4.2 WF_SCOPE_INVALID）。 */
async function assertScopeTarget(
  host: GraphPatchHost,
  scope: PatchScope,
  input: { sessionId: string; targetId: string },
): Promise<void> {
  const kind = await detectTargetKind(host, input)
  if (scope === 'template' && kind === 'instance') {
    throw new WfError(
      'scope=\'template\' 只能用于工作流模板；该 targetId 是工作流/服务实例，请改用 scope=\'instance\'',
      'WF_SCOPE_INVALID',
    )
  }
  if (scope === 'instance' && kind === 'template') {
    throw new WfError(
      'scope=\'instance\' 不能用于工作流模板；规划期改模板请用 scope=\'template\'',
      'WF_SCOPE_INVALID',
    )
  }
}

/**
 * 新建模板说明解析（create 通路）。
 * 非法形状一律 WF_BAD_ARGS（参数层错误，先于任何读盘）。
 */
function parseNewTemplateSpec(value: unknown): NewTemplateSpec | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new WfError('create 必须是对象：{ name, description?, mode? }', 'WF_BAD_ARGS')
  }
  const raw = value as { name?: unknown; description?: unknown; mode?: unknown }
  const name = String(raw.name ?? '').trim()
  if (!name) throw new WfError('create.name 必填（新建模板必须有可读名称）', 'WF_BAD_ARGS')
  const mode = raw.mode === undefined || raw.mode === null ? 'mode1' : String(raw.mode)
  if (mode !== 'mode1' && mode !== 'mode2') {
    throw new WfError("create.mode 必须是 'mode1' 或 'mode2'", 'WF_BAD_ARGS')
  }
  const description = raw.description === undefined || raw.description === null ? '' : String(raw.description)
  return { name, description, mode: mode as 'mode1' | 'mode2' }
}

/** 生成新模板 id（可注入缝，单测用确定性 id；缺省 tpl-<12 hex>）。 */
function generateTemplateId(host: GraphPatchHost): string {
  if (host.newTemplateId) return String(host.newTemplateId())
  return 'tpl-' + randomUUID().replace(/-/g, '').slice(0, 12)
}

/** 新建模板骨架（空图 + revision 0；ops 负责填成一份完整合法图）。 */
function newTemplateDoc(id: string, spec: NewTemplateSpec): WorkflowTemplate {
  return {
    id,
    mode: spec.mode ?? 'mode1',
    name: spec.name,
    description: spec.description ?? '',
    nodes: [],
    lines: [],
    revision: 0,
  }
}

/** 混组拒绝（§4.2 参数层校验）。 */
function assertSingleGroup(ops: PatchOp[]): PatchGroup {
  const unknown = unknownOpsOf(ops)
  if (unknown.length > 0) {
    throw new WfError(`补丁含未知操作：${unknown.join('、')}（允许：graph / meta / mark 三组，见工具描述）`, 'WF_GRAPH_INVALID')
  }
  const groups = groupsOf(ops)
  if (groups.length === 0) throw new WfError('补丁为空：ops 至少需要一个操作', 'WF_GRAPH_INVALID')
  if (groups.length > 1) {
    throw new WfError(
      `同一补丁混用了不同 op 组（${groups.map((group) => `${group}: ${GROUP_HINTS[group]}`).join('；')}）——一组一次，请拆成多次提交`,
      'WF_PATCH_MIXED_GROUPS',
    )
  }
  return groups[0]
}

/** A 组：图结构变更（校验 → 护栏 → 落盘 → 事实源刷新）。 */
async function runGraphGroup(
  host: GraphPatchHost,
  input: { scope: PatchScope; sessionId: string; targetId: string; origin: 'agent' | 'user'; expectRevision?: number; newTemplateDoc?: WorkflowTemplate },
  ops: GraphPatchOp[],
): Promise<{ revision: number; issues: GraphIssue[]; result: ReturnType<typeof applyGraphOps>; savedId: string }> {
  const loaded = await loadDoc(host, input)
  const doc = loaded as WorkflowDocument
  const before = effectiveOrgMeta(metaOfDocument(doc))
  const result = applyGraphOps({ doc, ops })
  // 串联既有结构校验（§6.3）：先 validateFlow（结构合法性）→ 再 checkGraphInvariants（编排质量）
  const structural = validateFlow(result.doc as unknown as WorkflowDocument)
  if (!structural.ok) {
    throw new WfError(
      `补丁违反结构校验：${structural.issues.slice(0, 6).map((issue) => `[${issue.code}] ${issue.message}`).join('；')}`,
      'WF_GRAPH_INVALID',
    )
  }
  const meta = input.origin === 'agent' ? before : {}
  const issues = checkGraphInvariants({
    flow: result.doc as unknown as WorkflowDocument,
    meta: input.origin === 'agent' ? before : undefined,
    origin: input.origin,
    patchOps: ops.length,
    milestoneUsed: Math.max(0, Math.floor(Number(host.milestoneUsedOf?.(input.sessionId)) || 0)),
  })
  const blocking = issues.filter((issue) => issue.level === 'error')
  if (blocking.length > 0) throwGraphInvalid(blocking)
  void meta
  // P4：记录「父代理最近一次补丁」——画布给这些节点加「AI 调整」角标。
  // 只写 origin=agent；用户保存路径经 FlowStore.stripClientMeta 清除本字段，
  // 因此角标天然只表示「用户尚未确认的代理改动」。
  if (input.origin === 'agent') {
    ;(result.doc as { lastPatch?: unknown }).lastPatch = {
      origin: 'agent',
      at: new Date().toISOString(),
      nodeIds: [...new Set([...result.createdNodeIds, ...result.updatedNodeIds])],
    }
  }
  const saved = await saveDoc(host, input, result.doc as unknown as WorkflowDocument)
  return { revision: saved.revision, issues, result, savedId: saved.id }
}

/** B 组：元参数（归一化 → 新规模护栏复检 → 落 meta）。 */
async function runMetaGroup(
  host: GraphPatchHost,
  input: { scope: PatchScope; sessionId: string; targetId: string; origin: 'agent' | 'user'; expectRevision?: number },
  ops: MetaPatchOp[],
): Promise<{ revision: number; issues: GraphIssue[]; meta: OrgMeta }> {
  const doc = (await loadDoc(host, input)) as WorkflowDocument
  const merged: Partial<OrgMeta> = {}
  for (const op of ops) Object.assign(merged, op.meta ?? {})
  const next = normalizeOrgMeta({ ...metaOfDocument(doc), ...merged })
  const usage = orgUsageOf(doc, {
    milestoneUsed: Math.max(0, Math.floor(Number(host.milestoneUsedOf?.(input.sessionId)) || 0)),
  })
  // 收紧预算时可能立刻违反新上限：同一套硬护栏复检，避免「写坏预算把图卡住」
  const limited = input.origin === 'agent' ? metaLimitIssues(next, usage) : []
  const blocking = limited.filter((issue) => issue.level === 'error')
  if (blocking.length > 0) throwGraphInvalid(blocking)
  const updated = { ...doc, meta: next } as WorkflowDocument
  const saved = await saveDoc(host, input, updated)
  return { revision: saved.revision, issues: limited, meta: next }
}

/**
 * C 组：运行状态标记（闸门状态机；D-07/D-21/§5.2 扩展2）。
 * 状态机三关（任一不过即 WF_MILESTONE_INVALID，绝不静默放过）：
 *   ① 必须在**闸门轮**：fact.executorIsMilestone（由 proxy.data.role='milestone' 驱动）——
 *      纯编排轮、普通执行轮都没有可标记的闸门；
 *   ② 目标必须是**当前闸门**：nodeId 可写闸门虚拟节点 id 或父代理节点 id，两者都归一到
 *      父代理节点 id 后与 fact.executorParentId 比对；
 *   ③ 预算：status=ok 时 milestoneUsed 不得达到 milestoneMax（0 = 不限制；不含首次编排 D-21）。
 * 落地：快照写入**只能经运行时的 markMilestoneNode**（运行事实唯一写者）——工具层只做
 * 判定与归一化，再持久化（persistRun 缝）。
 */
async function runMarkGroup(
  host: GraphPatchHost,
  sessionId: string,
  ops: MarkPatchOp[],
): Promise<{ marked: { nodeId: string; status: 'ok' | 'fail'; runId: string }[]; issues: GraphIssue[] }> {
  const facts = host.orchestrator.milestoneFactsFor(sessionId)
  if (!facts) {
    throw new WfError('mark_node: 当前会话没有正在运行的编排（闸门标记只在运行期有意义）', 'WF_MILESTONE_INVALID')
  }
  host.orchestrator.touchRunForSession(sessionId)
  const parentId = facts.executorParentId
  if (!facts.executorIsMilestone || !parentId) {
    throw new WfError(
      'mark_node: 当前不是父代理闸门轮——只有被 proxy（data.role=\'milestone\'）驱动的闸门轮才需要标记',
      'WF_MILESTONE_INVALID',
    )
  }
  const entry = host.orchestrator.activeRunForSession(sessionId)
  if (!entry) {
    throw new WfError('mark_node: 当前会话没有正在运行的编排（闸门标记只在运行期有意义）', 'WF_MILESTONE_INVALID')
  }
  const flow = await host.orchestrator.currentResolvedFlow(entry)
  const marked: Array<{ nodeId: string; status: 'ok' | 'fail'; runId: string }> = []
  let used = facts.milestoneUsed
  for (const op of ops) {
    const requested = String(op?.nodeId ?? '')
    const mainId = mainNodeIdOf(flow, requested) ?? requested
    if (mainId !== parentId) {
      throw new WfError(
        `mark_node:「${requested}」不是当前父代理闸门节点（当前闸门：${facts.milestoneProxyId ?? parentId}）`,
        'WF_MILESTONE_INVALID',
      )
    }
    // 参数层与预算判定仍由本工具的纯函数完成（nodeId 合法性 / status 取值 / 闸门预算）
    const result = applyMarkOp({
      op: { ...op, nodeId: mainId },
      runId: facts.runId,
      nodeIds: facts.nodeIds,
      milestoneUsed: used,
      milestoneMax: facts.milestoneMax,
    })
    // 快照写入交还运行时的唯一写者（工具层不再直接改写节点状态与 milestoneUsed）
    const written = host.orchestrator.markMilestoneNode(sessionId, { nodeId: result.nodeId, status: result.status })
    used = written.milestoneUsed
    marked.push(result)
  }
  // 预算已随每次写入落在快照上（可审计 + 续跑继承；父代理自动完成路径永不写它）
  if (host.persistRun) await host.persistRun(facts.runId)
  return { marked, issues: [] }
}

/** 读取目标文档（模板 / 模式一实例 / 模式二服务视图）。 */
async function loadDoc(
  host: GraphPatchHost,
  input: { scope: PatchScope; sessionId: string; targetId: string; newTemplateDoc?: WorkflowTemplate },
): Promise<WorkflowDocument | WorkflowTemplate> {
  // create 通路：新建模板尚不存在，基线为空图骨架（由本批 ops 填成合法图）
  if (input.newTemplateDoc) return input.newTemplateDoc
  if (input.scope === 'template') {
    const template = await host.store.getFlowTemplate(input.targetId)
    if (!template) throw new WfError(`工作流模板不存在：${input.targetId}`, 'WF_ORG_NOT_FOUND')
    return template
  }
  const workflow = await host.store.getWorkflow(input.sessionId, input.targetId)
  if (workflow) return workflow
  const service = await host.store.getServiceAsFlow(input.targetId)
  if (service) return service
  throw new WfError(`工作流/服务实例不存在或不属于本会话：${input.targetId}`, 'WF_ORG_NOT_FOUND')
}

/** 写回目标文档（模板 / 实例），并刷新活跃 run 的事实源。 */
async function saveDoc(
  host: GraphPatchHost,
  input: { scope: PatchScope; sessionId: string; targetId: string; expectRevision?: number; newTemplateDoc?: WorkflowTemplate },
  doc: WorkflowDocument | WorkflowTemplate,
): Promise<{ id: string; revision: number }> {
  const expected = Number.isFinite(Number(input.expectRevision))
    ? Number(input.expectRevision)
    : Number((doc as { revision?: unknown }).revision) || 0
  // 服务端字段保留（P4）：补丁工具是服务端写者，保留 lastPatch（用户保存路径才清除标注）
  const keepServerFields = true
  try {
    if (input.scope === 'template') {
      const template = await host.store.saveFlowTemplate({ ...doc, revision: expected } as WorkflowTemplate, { expectedRevision: expected, keepServerFields })
      return { id: template.id, revision: Number(template.revision) || 0 }
    }
    const isService = doc.mode === 'mode2'
    if (isService && host.store.saveServiceAsFlow) {
      const saved = await host.store.saveServiceAsFlow(doc as WorkflowDocument, input.sessionId, { expectedRevision: expected, keepServerFields })
      await host.orchestrator.refreshActiveDefinitions(saved.id, input.sessionId, saved)
      return { id: saved.id, revision: Number(saved.revision) || 0 }
    }
    if (isService) {
      throw new WfError('模式二服务实例暂不支持由补丁直接改写（请改用 scope=\'template\' 规划，或先停止服务）', 'WF_SCOPE_INVALID')
    }
    const saved = await host.store.saveWorkflow({ ...(doc as WorkflowDocument), revision: expected }, input.sessionId, { expectedRevision: expected, keepServerFields })
    // 双向同步②：补丁落盘 → 刷新活跃 run 事实源（画布回显由前端轮询/保存事件驱动）
    await host.orchestrator.refreshActiveDefinitions(saved.id, input.sessionId, saved)
    return { id: saved.id, revision: Number(saved.revision) || 0 }
  } catch (error) {
    const code = (error as { code?: string })?.code ?? ''
    if (code === ERR_REVISION_CONFLICT) {
      throw new WfError('画布刚被修改，请基于最新拓扑重新提交（expectRevision 不匹配，本工具不自动重试）', 'WF_PATCH_CONFLICT')
    }
    throw error
  }
}

/** 组装并执行一次补丁（导出供单测直接断言，无需起工具注册表）。 */
export async function executeGraphPatch(
  host: GraphPatchHost,
  sessionId: string,
  args: { scope?: unknown; targetId?: unknown; ops?: unknown; origin?: unknown; expectRevision?: unknown; create?: unknown },
): Promise<GraphPatchToolResult> {
  const scope = String(args?.scope ?? '') as PatchScope
  if (scope !== 'template' && scope !== 'instance') {
    throw new WfError('scope 必须是 \'template\' 或 \'instance\'', 'WF_SCOPE_INVALID')
  }
  const spec = parseNewTemplateSpec(args?.create)
  const origin: 'agent' | 'user' = args?.origin === 'user' ? 'user' : 'agent'
  const ops = Array.isArray(args?.ops) ? (args?.ops as PatchOp[]) : []
  if (ops.length === 0) throw new WfError('补丁为空：ops 至少需要一个操作', 'WF_BAD_ARGS')
  if (ops.length > PATCH_OPS_HARD_LIMIT) {
    throw new WfError(`单次补丁操作过多（${ops.length} > ${PATCH_OPS_HARD_LIMIT}），请拆分提交`, 'WF_GRAPH_INVALID')
  }
  const group = assertSingleGroup(ops)
  const expectRevision = Number.isFinite(Number(args?.expectRevision)) ? Number(args.expectRevision) : undefined

  // —— create 通路的参数层约束（先于任何读盘，错误可立即自我修正） ——
  if (spec && scope !== 'template') {
    throw new WfError("create 只能用于 scope='template'（新建的是工作流模板，不是实例）", 'WF_SCOPE_INVALID')
  }
  if (spec && group !== 'graph') {
    throw new WfError(`create 只能与 graph 组同用（当前是 ${group} 组）：新建模板必须一次给出完整合法图，元参数请随后单独提交 set_meta`, 'WF_SCOPE_INVALID')
  }
  if (spec && expectRevision !== undefined) {
    throw new WfError('create 与 expectRevision 互斥：新建没有可比的旧版本', 'WF_BAD_ARGS')
  }

  let targetId = String(args?.targetId ?? '').trim()
  if (spec) {
    if (!targetId) targetId = generateTemplateId(host)
    // 显式给 id 时绝不静默覆盖既有模板（TOCTOU 由 saveDoc 的 expectedRevision=0 二次兜底）
    const existing = await host.store.getFlowTemplate(targetId)
    if (existing) {
      throw new WfError(
        `工作流模板已存在：${targetId}。若要改它，请去掉 create 并带上 expectRevision=${Number(existing.revision) || 0}`,
        'WF_PATCH_CONFLICT',
      )
    }
  } else if (!targetId) {
    throw new WfError('补丁需要 targetId（templateId 或 flowId）', 'WF_BAD_ARGS')
  }

  const baseInput = {
    scope,
    sessionId,
    targetId,
    origin,
    ...(expectRevision !== undefined ? { expectRevision } : {}),
    ...(spec ? { newTemplateDoc: newTemplateDoc(targetId, spec) } : {}),
  }
  // 新建路径跳过「目标必须已存在」校验（它正是本批补丁要创建的东西）
  if (!spec) await assertScopeTarget(host, scope, { sessionId, targetId })

  if (group === 'graph') {
    const { revision, issues, result } = await runGraphGroup(host, baseInput, ops as GraphPatchOp[])
    return {
      ok: true,
      scope,
      targetId,
      revision,
      applied: ops.length,
      warnings: warningsOf(issues),
      // create 通路：明确告知模型「这是新模板 id，后续补丁/投产都用它」
      ...(spec ? { newTemplate: true } : {}),
      created: result.createdNodeIds,
      removed: result.removedNodeIds,
      updated: result.updatedNodeIds,
      connected: result.connectedLineIds,
      disconnected: result.disconnectedLineIds,
    }
  }
  if (group === 'meta') {
    const { revision, issues, meta } = await runMetaGroup(host, baseInput, ops as MetaPatchOp[])
    return { ok: true, scope, targetId, revision, applied: ops.length, warnings: warningsOf(issues), meta }
  }
  const { marked, issues } = await runMarkGroup(host, sessionId, ops as MarkPatchOp[])
  // C 组不改文档：revision 取自运行快照（run 记录内的文档版本），避免白读一次磁盘
  const entry = host.orchestrator.activeRunForSession(sessionId)
  return {
    ok: true,
    scope,
    targetId,
    revision: Number((entry?.baseFlow as { revision?: unknown } | undefined)?.revision) || 0,
    applied: ops.length,
    warnings: warningsOf(issues),
    marked: marked[0],
    // 闸门预算进度（D-21）：让父代理立刻看到「还剩几次闸门」，无需再查目录
    milestoneUsed: Math.max(0, Math.floor(Number(entry?.snapshot?.milestoneUsed) || 0)),
  }
}

/**
 * graph 组各 op 的**字段契约文本**（由 OP_FIELD_SHAPES 渲染）。
 * 为什么必须出现在 Schema 里：ops 是 `additionalProperties:true` 的自由对象，模型无法从
 * JSON Schema 推断字段名；2026-09 实机取证显示，只举一个 create_node 例子时模型会对
 * connect 的端点字段靠猜（from/to），并把节点字段平铺到 op 顶层——两类失败都只能靠试错收敛。
 * 契约文本与 apply 层错误消息共用 OP_FIELD_SHAPES，保证「文档说的」和「报错说的」永远一致。
 */
const GRAPH_OP_CONTRACT = [
  `create_node ${OP_FIELD_SHAPES.create_node}`,
  `remove_node ${OP_FIELD_SHAPES.remove_node}`,
  `update_node_data ${OP_FIELD_SHAPES.update_node_data}`,
  `connect ${OP_FIELD_SHAPES.connect}`,
  `disconnect ${OP_FIELD_SHAPES.disconnect}`,
  `create_group ${OP_FIELD_SHAPES.create_group}`,
  `set_group_members ${OP_FIELD_SHAPES.set_group_members}`,
].join('; ')

/**
 * meta 组 / mark 组的 op 字段契约（与 graph 组同一「单一事实源」策略）。
 * 为什么也要写：这两个 op 此前从未在描述里出现字段名，模型只能猜 `meta` 的嵌套方式。
 */
const META_MARK_OP_CONTRACT = [
  "{ op:'set_meta', meta: Partial<OrgMeta> } — org budget knobs, e.g. { op:'set_meta', meta:{ nodeMax:12 } }",
  "{ op:'mark_node', nodeId:string, status:'ok'|'fail' } — completes the CURRENT milestone gate only",
].join('; ')

/**
 * 注册 wf_graph_patch（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfGraphPatch(
  ctx: { get(name: string): unknown },
  host: GraphPatchHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_graph_patch')
  }
  const def = defineTool({
    name: WF_GRAPH_PATCH,
    description:
      'Apply one patch to a workflow template or the running instance. This tool has three op groups: graph structure, meta parameters, and run-state marking. A patch must use ops from ONE group at a time. ' +
      'Planning a NEW template: pass scope=template plus create={name, description?, mode?} with graph ops that build a complete valid graph (start + executable units + end). The response returns newTemplate=true and targetId = the new template id; never pass expectRevision there. ' +
      `graph group ops — EXACT field shapes, copy verbatim: ${GRAPH_OP_CONTRACT}. ` +
      `meta/mark group ops: ${META_MARK_OP_CONTRACT}. ` +
      ROLE_NODE_DATA_CONTRACT + '. ' +
      'Connections are validated by the graph checker and persisted atomically. Missing/misspelled op fields are rejected as WF_BAD_ARGS (fix the parameter shape); real graph problems come back as WF_GRAPH_INVALID (fix the graph, suggestions included). ' +
      'The flow graph must stay an acyclic DAG even for review rework: model "review failed" as a forward conditional branch (condition={type:"fail"}) into a repair node that rejoins the main line downstream — a back-edge to an upstream node is rejected with flowCycle. ' +
      'meta group: set_meta — updates the org budget itself (re-checked against the current graph). ' +
      'mark group: mark_node — completes the CURRENT milestone gate: only valid while the parent turn is a gate driven by a proxy with data.role=milestone. Pass either the gate proxy id or the parent node id; the response reports milestoneUsed. ' +
      'Fails with WF_* codes: WF_BAD_ARGS (bad op shape), WF_PATCH_MIXED_GROUPS (mixed groups), WF_GRAPH_INVALID (checker errors, details include fixes), WF_PATCH_CONFLICT (stale expectRevision; never retried), WF_ORG_NOT_FOUND, WF_SCOPE_INVALID, WF_MILESTONE_INVALID. ' +
      'Never pass node positions: coordinates are view-only and re-laid out by the canvas automatically.',
    parameters: {
      scope: { type: 'string', required: true, enum: ['template', 'instance'] as const, description: 'template: plan a reusable workflow template; instance: adjust the current running instance.' },
      targetId: { type: 'string', description: 'Workflow template id (scope=template) or workflow/instance id (scope=instance). Required unless create is given; with create you may omit it to let the server mint a new id.' },
      create: {
        type: 'object',
        additionalProperties: false,
        description: 'Create a NEW workflow template (scope=template and graph ops only). Omit when updating an existing target. Fails with WF_PATCH_CONFLICT if the given targetId already exists.',
        properties: {
          name: { type: 'string', required: true, description: 'Human-readable template name.' },
          description: { type: 'string', description: 'Optional template description.' },
          mode: { type: 'string', enum: ['mode1', 'mode2'] as const, description: 'Workflow mode; default mode1.' },
        },
      },
      origin: { type: 'string', enum: ['agent', 'user'] as const, description: 'Change origin; default agent. Org-budget guardrails apply only to agent changes.' },
      expectRevision: { type: 'number', description: 'Optimistic-lock revision you last read; mismatch is rejected without retry (WF_PATCH_CONFLICT).' },
      ops: {
        type: 'array',
        required: true,
        description:
          'Patch operations; all ops must belong to ONE group (graph | meta | mark). '
          + `Exact field shapes — copy verbatim: ${GRAPH_OP_CONTRACT}. `
          + 'Example: [{ "op": "create_node", "node": { "kind": "agent", "id": "n1", "data": { "label": "分析" } } }, '
          + '{ "op": "connect", "source": "n1", "target": "n2" }].',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: {
      // 【关键】additionalProperties: false + 声明必须覆盖 executeGraphPatch 的全部返回字段，
      // 否则宿主对工具返回体做 JSON Schema 校验时会判定「is not a declared property」并
      // 把成功调用变成错误（2026.09 实机验证发现的 BUG：graph 组的 created/removed/
      // updated/connected/disconnected 与 meta/mark 两组的 meta/marked 均未声明，
      // 三个 op 组全部可用性受损）。单测直接调 executeGraphPatch 绕过该校验，
      // 故另加 tests/host/wf-graph-patch.test.ts 的「output schema 覆盖」用例守护。
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'true when the patch was persisted.' },
          scope: { type: 'string', required: true, enum: ['template', 'instance'] as const, description: 'Echo of the patch scope.' },
          targetId: { type: 'string', required: true, description: 'Echo of the patched target id.' },
          revision: { type: 'number', required: true, description: 'New revision after persisting.' },
          applied: { type: 'number', required: true, description: 'Number of ops applied.' },
          warnings: { type: 'array', required: true, description: 'Checker warnings (non-blocking).', items: { type: 'object', additionalProperties: true } },
          newTemplate: { type: 'boolean', description: 'true when this patch created a new template; targetId is then the new template id.' },
          milestoneUsed: { type: 'number', description: 'Completed milestone gates in this run after a mark_node patch (the first orchestration is not counted).' },
          // graph 组：本次补丁实际改动的 id 清单（节点/连线），供模型继续引用
          created: { type: 'array', items: { type: 'string' }, description: 'Node ids created by this patch (graph group).' },
          removed: { type: 'array', items: { type: 'string' }, description: 'Node ids removed by this patch (graph group; includes proxy nodes dropped with their source).' },
          updated: { type: 'array', items: { type: 'string' }, description: 'Node/group ids updated by this patch (graph group).' },
          connected: { type: 'array', items: { type: 'string' }, description: 'Line ids created by this patch (graph group).' },
          disconnected: { type: 'array', items: { type: 'string' }, description: 'Line ids removed by this patch (graph group).' },
          // meta 组：落盘后的生效元参数（规范化/夹取结果）
          meta: { type: 'object', additionalProperties: true, description: 'Effective org meta after a set_meta patch (meta group).' },
          // mark 组：本次标记结果（nodeId/status/runId）
          marked: {
            type: 'object',
            additionalProperties: false,
            description: 'Marked milestone node after a mark_node patch (mark group).',
            properties: {
              nodeId: { type: 'string', required: true, description: 'The marked parent/gate node id.' },
              status: { type: 'string', required: true, enum: ['ok', 'fail'] as const, description: 'Milestone marking status.' },
              runId: { type: 'string', required: true, description: 'The active run id the marking belongs to.' },
            },
          },
        },
      },
      render: textRender,
    },
    async execute(args, exec: ToolExecLike) {
      const caller = callerOf(exec)
      if (caller.isChild) throw new WfError('子代理无法调用 wf_graph_patch（改图是父代理的组织权限）', 'WF_NOT_ROOT')
      if (!caller.sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
      return executeGraphPatch(host, caller.sessionId, (args ?? {}) as Record<string, unknown>)
    },
  })
  return tools.register(def)
}

// 说明：以下类型 re-export 便于单测与宿主装配从单一入口引用（避免多处 import 路径漂移）。
export type { GraphNode, Line }
export { hasBlockingIssues }

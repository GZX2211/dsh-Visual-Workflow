// src/host/tools/wf-graph-patch/tool.ts
//
// wf_graph_patch 工具注册：父代理写图的**唯一入口**。
//
// 唯一语义：图结构变更（create_node/remove_node/update_node_data/connect/disconnect/
// create_group/set_group_members）→ 取值存在性校验（presetId / provider / model /
// reasoning）+ 检查器校验 + 元参数硬护栏 + 原子落盘。
// 元参数（组织预算）**不是**一种操作：它是约束改图方的硬护栏，被约束方不得自行调整，
// 只能在画布/设置中由用户修改。
//
// 落盘规范：scope='template' 改工作流模板（规划期）；scope='instance' 改当前实例
// （运行期），并即时刷新活跃 run 的编排基线与画布回显（双向同步）。
// 新建通路：scope='template' 带 `create` 参数 = 新建模板（规划期主用例：无模板 →
// 产出模板）；不带 create 仍是「必须已存在」的更新语义。显式传入已存在的 targetId +
// create → WF_PATCH_CONFLICT，绝不静默覆盖。create 只允许与 graph 组同用（其余组语义不成立）。
// 坐标是纯视图数据：补丁不接受 position，新建节点写哨兵 {0,0} 交由客户端自动布局。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）；字段形状
// 与提交规则由 wf_org_catalog 的 rules 提供，避免同一份契约在两处常驻文本里各自漂移。

import { randomUUID } from 'node:crypto'

import { WF_GRAPH_PATCH, ERR_REVISION_CONFLICT } from '../../shared/protocol.js'
import { defineTool, type ToolExecLike } from '../infrastructure/define-tool.js'
import { registerTool, requireToolsService } from '../infrastructure/register-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { callerOf } from '../infrastructure/caller.js'
import { WfError } from '../../orchestrator/index.js'
import {
  checkGraphInvariants,
  effectiveOrgMeta,
  hasBlockingIssues,
  metaOfDocument,
  orgBudgetOf,
  orgUsageOf,
  validateFlow,
  type GraphIssue,
} from '../../graph/index.js'
import { applyGraphOpsTolerant } from './apply.js'
import { knownModelsOf, modelSelectionFailures, writtenModelSelectionsOf, type ModelCatalogEntry } from './policy.js'
import {
  ALLOWED_OP_NAMES_TEXT,
  unknownOpsOf,
  type GraphPatchOp,
  type GraphPatchResult,
  type NewTemplateSpec,
  type PatchOp,
  type PatchOpFailure,
  type PatchScope,
} from './types.js'
import type { GraphNode, Line, WorkflowDocument, WorkflowTemplate } from '../../shared/graph-model.js'
import type { OrgBudget } from '../../shared/types.js'
import type { RunEntry } from '../../orchestrator/index.js'

/** 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。 */
export interface GraphPatchHost {
  /** 数据层读写（模板/实例文档 + 编排基线刷新）。 */
  store: {
    getFlowTemplate(id: string): Promise<WorkflowTemplate | null>
    saveFlowTemplate(template: WorkflowTemplate, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowTemplate>
    getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null>
    saveWorkflow(doc: WorkflowDocument, sessionId: string, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowDocument>
    getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null>
    saveServiceAsFlow?(doc: WorkflowDocument, sessionId: string, options: { expectedRevision: number; keepServerFields?: boolean }): Promise<WorkflowDocument>
    getRun(runId: string): Promise<unknown>
    listRuns(flowId: string): Promise<unknown[]>
    /** 工具组合清单：节点 presetId 的取值来源之一（存在性校验用）。 */
    listToolCombos(): Promise<unknown[]>
  }
  /**
   * agent preset 目录（presetId 的另一取值来源）。
   * 属 best-effort 生态缝：缺失或枚举失败时该来源不参与存在性判定。
   */
  listPresets?: () => Promise<Array<{ id?: unknown }>>
  /**
   * 模型清单（provider/model 配对的**唯一取值来源**，reasoning 档位的来源）。
   * 与 listPresets 同为 best-effort 生态缝：缺失或枚举失败时本批取值不参与存在性判定。
   */
  listModels?: () => Promise<unknown[]>
  /** 编排运行时能力（编排基线刷新 + 空闲基准）。 */
  orchestrator: {
    activeRunForSession(sessionId: string): RunEntry | null
    flowLockInfo(flowId: string): { runId: string; sessionId: string; status: string } | null
    currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument>
    touchRunForSession(sessionId: string): boolean
    refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void>
  }
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
  /**
   * 只读预算：生效元参数上限 + 当前规模 → 剩余量。
   * 为什么进返回体：元参数对改图方是硬护栏且**不可自行调整**，父代理需要立刻看到
   * 「还剩多少规模」，否则只能靠撞护栏报错来试出边界。
   */
  budget: OrgBudget
  warnings: Array<{ code: string; message: string }>
  /** true = 本次补丁新建了模板（scope=template + create）；targetId 即新模板 id。 */
  newTemplate?: boolean
  created?: string[]
  removed?: string[]
  updated?: string[]
  connected?: string[]
  disconnected?: string[]
}

/** 由图文档与已用量组装只读预算（生效元参数按文档声明归一）。 */
function budgetOf(doc: WorkflowDocument, options: { patchOps?: number } = {}): OrgBudget {
  return orgBudgetOf(effectiveOrgMeta(metaOfDocument(doc)), orgUsageOf(doc, options))
}

/** 检查器 issue → 返回体 warnings（warning 级不阻断）。 */
function warningsOf(issues: GraphIssue[]): Array<{ code: string; message: string }> {
  return (issues ?? [])
    .filter((issue) => issue.level === 'warning')
    .map((issue) => ({ code: issue.code, message: issue.message }))
}

/**
 * 文本型归一化提示（D-07）：写图只产文本型 file 节点，被归一化时显式告知调用方。
 * 为什么不静默：调用方以为写入了受管文件节点，实际拿到的是文本节点；不告知会让它按错误的
 * 心智模型继续编排（例如以为下游能读到某个受管文件的内容）。
 */
function fileNodeTextOnlyWarnings(nodeIds: readonly string[]): Array<{ code: string; message: string }> {
  if (!nodeIds || nodeIds.length === 0) return []
  return [{
    code: 'fileNodeTextOnly',
    message: `file nodes were written as TEXT type (${nodeIds.join(', ')}): a graph patch does not produce managed files — a managed file must point to an existing managed copy, which would block planning such as a deliverable file to be produced later; if you really need a managed file, select it by hand on the canvas.`,
  }]
}

/**
 * 阻断型 issue → WF_GRAPH_INVALID（错误文本带全部明细与修复建议，
 * 这是模型自我修正的唯一通道，故必须把建议原样透出）。
 */
function throwGraphInvalid(issues: GraphIssue[]): never {
  const detail = issues.map((issue) => {
    const where = [...(issue.nodeIds ?? []), ...(issue.lineIds ?? [])].join(',')
    const hint = String(issue.suggestion ?? '').trim()
    return `[${issue.code}]${where ? `(${where})` : ''} ${issue.message}${hint ? ` -> suggestion: ${hint}` : ''}`
  }).join('\n')
  throw new WfError(`WF_GRAPH_INVALID: the patch was blocked by the graph checker (${issues.length} issue(s)):\n${detail}`, 'WF_GRAPH_INVALID')
}

/** 补丁 op 数上限（元参数 patchOpsMax 由检查器护栏判定；此处只做整体 sanity）。 */
const PATCH_OPS_HARD_LIMIT = 200

/**
 * 单条 op 失败清单 → 聚合错误（整批拒绝）。
 *
 * 为什么必须一次列全：ops 之间存在有序依赖，逐条试错会让父代理对同一批补丁反复重试；
 * 一次列全它可以一轮改完。
 * 为什么消息里保留每条自己的错误码：只有码能让模型分辨「改入参形状」还是「改图」。
 * 批次级码取一致语义：全部为参数层错误才是 WF_BAD_ARGS，出现图语义错误则归 WF_GRAPH_INVALID。
 */
function throwPatchErrors(errors: PatchOpFailure[]): never {
  const detail = errors.map((item) => `#${item.index + 1} ${item.op} [${item.code}] ${item.message}`).join('\n')
  const code = errors.every((item) => item.code === 'WF_BAD_ARGS') ? 'WF_BAD_ARGS' : 'WF_GRAPH_INVALID'
  throw new WfError(
    `the patch was not applied: ${errors.length} op(s) are invalid, so nothing was persisted (the target graph is unchanged)\n${detail}\nFix every reported problem and submit again.`,
    code,
  )
}

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
  const service = await ownedServiceFlow(host, input.sessionId, input.targetId)
  if (service) return 'instance'
  return 'none'
}

/**
 * 服务实例的归属过滤读取（模式二视图）：`getServiceAsFlow` 不校验归属（服务管理器/
 * 服务进程用），工具层不得据它把他人会话的服务实例读进补丁管线——越权在取数处即回
 * 「不存在」，与 loadDoc 的 WF_ORG_NOT_FOUND 同口径（不再等到写盘才报中文错误）。
 */
async function ownedServiceFlow(
  host: GraphPatchHost,
  sessionId: string,
  targetId: string,
): Promise<WorkflowDocument | null> {
  const service = await host.store.getServiceAsFlow(targetId)
  return service && service.sessionId === sessionId ? service : null
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
      "WF_SCOPE_INVALID: scope='template' only applies to a workflow template, but this targetId is a workflow/service instance — use scope='instance'",
      'WF_SCOPE_INVALID',
    )
  }
  if (scope === 'instance' && kind === 'template') {
    throw new WfError(
      "WF_SCOPE_INVALID: scope='instance' cannot be used on a workflow template — to change a template during planning use scope='template'",
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
    throw new WfError('WF_BAD_ARGS: create must be an object: { name, description?, mode? }', 'WF_BAD_ARGS')
  }
  const raw = value as { name?: unknown; description?: unknown; mode?: unknown }
  const name = String(raw.name ?? '').trim()
  if (!name) throw new WfError('WF_BAD_ARGS: create.name is required (a new template needs a readable name)', 'WF_BAD_ARGS')
  const mode = raw.mode === undefined || raw.mode === null ? 'mode1' : String(raw.mode)
  if (mode !== 'mode1' && mode !== 'mode2') {
    throw new WfError("WF_BAD_ARGS: create.mode must be 'mode1' or 'mode2'", 'WF_BAD_ARGS')
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

/**
 * 未知 op 拒绝（参数层校验）。
 * 未知 op 名归为入参形状错误（WF_BAD_ARGS）而非图语义错误：否则模型会去改图，
 * 而真正要改的是自己的 op 名。
 */
function assertKnownOps(ops: PatchOp[]): void {
  const unknown = unknownOpsOf(ops)
  if (unknown.length > 0) {
    throw new WfError(`WF_BAD_ARGS: unknown ops in the patch: ${unknown.join(', ')} (allowed ops: ${ALLOWED_OP_NAMES_TEXT})`, 'WF_BAD_ARGS')
  }
}

/** 图结构变更组：逐条容错应用 → 聚合拒绝或结构校验 → 元参数硬护栏 → 落盘 → 编排基线刷新。 */
async function runGraphGroup(
  host: GraphPatchHost,
  input: { scope: PatchScope; sessionId: string; targetId: string; expectRevision?: number; newTemplateDoc?: WorkflowTemplate },
  ops: GraphPatchOp[],
): Promise<{ revision: number; issues: GraphIssue[]; result: GraphPatchResult; savedId: string; budget: OrgBudget }> {
  // 图管道按 WorkflowDocument 语义运作（模板与实例在此同构）。create / scope=template
  // 通路的 loadDoc 返回的是模板本体（WorkflowTemplate 缺 sessionId 这一与图无关的实例归属
  // 字段），故此处收敛一次。不引入类型体操：判据只是「模板在该管道内按文档处理」。
  const doc = (await loadDoc(host, input)) as WorkflowDocument
  const meta = effectiveOrgMeta(metaOfDocument(doc))
  // 逐条应用并收集全部失败项：本工具不做部分应用（ops 有序依赖 + 整图检查器，
  // 部分应用会落盘半成品图），因此 errors 非空即整批拒绝。
  const applied = applyGraphOpsTolerant({ doc, ops })
  const failures = [
    ...applied.errors,
    ...await presetIdFailuresOf(host, ops, applied.result.doc),
    ...await modelSelectionFailuresOf(host, ops, applied.result.doc),
  ]
  if (failures.length > 0) throwPatchErrors(failures)
  const result = applied.result
  // 串联既有结构校验：先 validateFlow（结构合法性）→ 再 checkGraphInvariants（编排质量）
  const structural = validateFlow(result.doc)
  if (!structural.ok) {
    throw new WfError(
      `WF_GRAPH_INVALID: the patch violates structural validation: ${structural.issues.slice(0, 6).map((issue) => `[${issue.code}] ${issue.message}`).join('; ')}`,
      'WF_GRAPH_INVALID',
    )
  }
  // 改图方恒为代理（工具不再提供来源参数）：元参数硬护栏因此永久生效。
  const issues = checkGraphInvariants({
    flow: result.doc,
    meta,
    origin: 'agent',
    patchOps: ops.length,
  })
  const blocking = issues.filter((issue) => issue.level === 'error')
  if (blocking.length > 0) throwGraphInvalid(blocking)
  // 记录「父代理最近一次补丁」——画布给这些节点加「AI 调整」角标。用户保存路径经
  // FlowStore.stripClientMeta 清除本字段，因此角标天然只表示「用户尚未确认的代理改动」。
  ;(result.doc as { lastPatch?: unknown }).lastPatch = {
    origin: 'agent',
    at: new Date().toISOString(),
    nodeIds: [...new Set([...result.createdNodeIds, ...result.updatedNodeIds])],
  }
  const saved = await saveDoc(host, input, result.doc)
  return {
    revision: saved.revision,
    issues,
    result,
    savedId: saved.id,
    // 预算取补丁后的规模：父代理据此判断「还能加几个节点」，而不是补丁前的旧值
    budget: budgetOf(result.doc, { patchOps: ops.length }),
  }
}

/** 目录清单里的一行（存在性校验只关心 id）。 */
interface IdCarrier { id?: unknown }

/**
 * 本批 ops **显式写入**的 presetId 的存在性校验结果。
 *
 * 只校验本批写入值：节点上被保留的历史值不在本次职责内，否则一次只改标签的补丁
 * 也会因旧值被拒。
 * 空值不算错：`presetId` 为空是「先建骨架、后配工具组合」的合法中间态，由图检查器
 * 以告警提示（运行期它等价于零工具集，这一点由告警文案说清）。
 * 目录枚举为空时放弃判定：preset 清单是 best-effort 生态缝（服务不可用时返回空清单），
 * 按空目录判定会把合法引用误判为不存在。
 */
async function presetIdFailuresOf(
  host: GraphPatchHost,
  ops: PatchOp[],
  applied: WorkflowDocument,
): Promise<PatchOpFailure[]> {
  const written = writtenPresetIdsOf(ops, applied)
  if (written.length === 0) return []
  const known = await knownPresetIdsOf(host)
  if (!known) return []
  return written
    .filter((item) => !known.has(item.presetId))
    .map((item) => ({
      index: item.index,
      op: item.op,
      code: 'WF_BAD_ARGS',
      message: `node "${item.nodeId}": presetId "${item.presetId}" does not exist - values must come from wf_org_catalog combos[].id (tool combos, recommended) or presets[].id (official presets); an empty presetId means that node runs with zero tools. Available ids: ${sampleOf(known)}`,
    }))
}

/** 已知 presetId 集合（组合 id ∪ 官方 preset id）；两者都枚举不到时返回 null（放弃判定）。 */
async function knownPresetIdsOf(host: GraphPatchHost): Promise<Set<string> | null> {
  const combos = await host.store.listToolCombos()
  const presets = host.listPresets ? await host.listPresets().catch(() => [] as IdCarrier[]) : []
  const ids = new Set<string>()
  for (const item of combos as IdCarrier[]) {
    const id = String(item?.id ?? '').trim()
    if (id) ids.add(id)
  }
  for (const item of presets) {
    const id = String(item?.id ?? '').trim()
    if (id) ids.add(id)
  }
  return ids.size > 0 ? ids : null
}

/** 候选 id 清单的可读摘要（截断，避免错误文本被目录撑爆）。 */
function sampleOf(ids: Set<string>): string {
  const all = [...ids]
  const head = all.slice(0, 10).join(', ')
  return all.length > 10 ? `${head}, ... (${all.length} total)` : head
}

/** 本批 ops 显式写入的 presetId（create_node / update_node_data 的角色节点）。 */
function writtenPresetIdsOf(
  ops: PatchOp[],
  applied: WorkflowDocument,
): Array<{ index: number; op: string; nodeId: string; presetId: string }> {
  const out: Array<{ index: number; op: string; nodeId: string; presetId: string }> = []
  ops.forEach((op, index) => {
    if (op.op === 'create_node') {
      const node = (op as { node?: Record<string, unknown> }).node
      const kind = String(node?.kind ?? '')
      if (kind !== 'agent' && kind !== 'parent') return
      const presetId = explicitPresetId((node?.data as Record<string, unknown> | undefined)?.presetId)
      if (presetId) out.push({ index, op: 'create_node', nodeId: String(node?.id ?? '(id pending)'), presetId })
      return
    }
    if (op.op === 'update_node_data') {
      const nodeId = String(op.nodeId ?? '').trim()
      // 以应用后的文档为准：同一批里先建后改的节点也能解析到
      const target = applied.nodes.find((node) => node.id === nodeId)
      if (!target || (target.kind !== 'agent' && target.kind !== 'parent')) return
      const presetId = explicitPresetId((op.data as Record<string, unknown> | undefined)?.presetId)
      if (presetId) out.push({ index, op: 'update_node_data', nodeId, presetId })
    }
  })
  return out
}

/** 显式写入的 presetId（null/undefined/空白 = 未写入，不算错误）。 */
function explicitPresetId(raw: unknown): string {
  return raw === undefined || raw === null ? '' : String(raw).trim()
}

/**
 * 本批 ops **显式写入**的 provider/model/reasoning 的存在性校验结果。
 *
 * 与 presetId 存在性校验同口径：只校验本批写入值（历史脏值不阻断只改标签的补丁），
 * 模型清单枚举不到即放弃判定。
 * 为什么必须校验：ops 是自由对象，写错的配对不会被图检查器拦住，一路落盘到运行期
 * LLM 调用处才失败；画布下拉只列清单内的值，清单外的值在面板上退化成显示 (default)——
 * 用户看到的是「工具传了、界面却不回显」（实机取证见 policy.ts 文件头）。
 */
async function modelSelectionFailuresOf(
  host: GraphPatchHost,
  ops: PatchOp[],
  applied: WorkflowDocument,
): Promise<PatchOpFailure[]> {
  const written = writtenModelSelectionsOf(ops, applied)
  if (written.length === 0) return []
  const known = await knownModelEntriesOf(host)
  if (!known) return []
  return modelSelectionFailures(known, written)
}

/** 可用模型清单（缝缺失或枚举失败返回 null = 放弃存在性判定）。 */
async function knownModelEntriesOf(host: GraphPatchHost): Promise<ModelCatalogEntry[] | null> {
  if (!host.listModels) return null
  const rows = await host.listModels().catch(() => [] as unknown[])
  return knownModelsOf(rows ?? [])
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
    if (!template) throw new WfError(`WF_ORG_NOT_FOUND: workflow template not found: ${input.targetId}`, 'WF_ORG_NOT_FOUND')
    return template
  }
  const workflow = await host.store.getWorkflow(input.sessionId, input.targetId)
  if (workflow) return workflow
  const service = await ownedServiceFlow(host, input.sessionId, input.targetId)
  if (service) return service
  throw new WfError(`WF_ORG_NOT_FOUND: workflow/service instance not found or not owned by this session: ${input.targetId}`, 'WF_ORG_NOT_FOUND')
}

/** 写回目标文档（模板 / 实例），并刷新活跃 run 的编排基线。 */
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
      throw new WfError("WF_SCOPE_INVALID: a mode2 service instance cannot be rewritten by a patch; plan with scope='template' or stop the service first", 'WF_SCOPE_INVALID')
    }
    const saved = await host.store.saveWorkflow({ ...(doc as WorkflowDocument), revision: expected }, input.sessionId, { expectedRevision: expected, keepServerFields })
    // 双向同步②：补丁落盘 → 刷新活跃 run 编排基线（画布回显由前端轮询/保存事件驱动）
    await host.orchestrator.refreshActiveDefinitions(saved.id, input.sessionId, saved)
    return { id: saved.id, revision: Number(saved.revision) || 0 }
  } catch (error) {
    const code = (error as { code?: string })?.code ?? ''
    if (code === ERR_REVISION_CONFLICT) {
      throw new WfError('WF_PATCH_CONFLICT: the canvas changed since you read it; resubmit against the latest topology (expectRevision mismatch; this tool never retries automatically)', 'WF_PATCH_CONFLICT')
    }
    throw error
  }
}

/** 组装并执行一次补丁（导出供单测直接断言，无需起工具注册表）。 */
export async function executeGraphPatch(
  host: GraphPatchHost,
  sessionId: string,
  args: { scope?: unknown; targetId?: unknown; ops?: unknown; expectRevision?: unknown; create?: unknown },
): Promise<GraphPatchToolResult> {
  const scope = String(args?.scope ?? '') as PatchScope
  if (scope !== 'template' && scope !== 'instance') {
    throw new WfError("WF_SCOPE_INVALID: scope must be 'template' or 'instance'", 'WF_SCOPE_INVALID')
  }
  const spec = parseNewTemplateSpec(args?.create)
  const ops = Array.isArray(args?.ops) ? (args?.ops as PatchOp[]) : []
  if (ops.length === 0) throw new WfError('WF_BAD_ARGS: the patch is empty; ops needs at least one operation', 'WF_BAD_ARGS')
  if (ops.length > PATCH_OPS_HARD_LIMIT) {
    throw new WfError(`WF_BAD_ARGS: too many ops in one patch (${ops.length} > ${PATCH_OPS_HARD_LIMIT}); split it into batches`, 'WF_BAD_ARGS')
  }
  assertKnownOps(ops)
  const expectRevision = Number.isFinite(Number(args?.expectRevision)) ? Number(args.expectRevision) : undefined

  // —— create 通路的参数层约束（先于任何读盘，错误可立即自我修正） ——
  if (spec && scope !== 'template') {
    throw new WfError("WF_SCOPE_INVALID: create only works with scope='template' (it creates a workflow template, not an instance)", 'WF_SCOPE_INVALID')
  }
  if (spec && expectRevision !== undefined) {
    throw new WfError('WF_BAD_ARGS: create and expectRevision are mutually exclusive (a new template has no previous revision to compare)', 'WF_BAD_ARGS')
  }

  let targetId = String(args?.targetId ?? '').trim()
  if (spec) {
    if (!targetId) targetId = generateTemplateId(host)
    // 显式给 id 时绝不静默覆盖既有模板（TOCTOU 由 saveDoc 的 expectedRevision=0 二次兜底）
    const existing = await host.store.getFlowTemplate(targetId)
    if (existing) {
      throw new WfError(
        `WF_PATCH_CONFLICT: workflow template already exists: ${targetId}. To modify it, drop create and pass expectRevision=${Number(existing.revision) || 0}`,
        'WF_PATCH_CONFLICT',
      )
    }
  } else if (!targetId) {
    throw new WfError('WF_BAD_ARGS: a patch needs targetId (templateId or flowId)', 'WF_BAD_ARGS')
  }

  const baseInput = {
    scope,
    sessionId,
    targetId,
    ...(expectRevision !== undefined ? { expectRevision } : {}),
    ...(spec ? { newTemplateDoc: newTemplateDoc(targetId, spec) } : {}),
  }
  // 新建路径跳过「目标必须已存在」校验（它正是本批补丁要创建的东西）
  if (!spec) await assertScopeTarget(host, scope, { sessionId, targetId })

  const { revision, issues, result, budget } = await runGraphGroup(host, baseInput, ops as GraphPatchOp[])
  return {
    ok: true,
    scope,
    targetId,
    revision,
    applied: ops.length,
    budget,
    warnings: [...warningsOf(issues), ...fileNodeTextOnlyWarnings(result.fileNodeTextOnlyIds)],
    // create 通路：明确告知模型「这是新模板 id，后续补丁/投产都用它」
    ...(spec ? { newTemplate: true } : {}),
    created: result.createdNodeIds,
    removed: result.removedNodeIds,
    updated: result.updatedNodeIds,
    connected: result.connectedLineIds,
    disconnected: result.disconnectedLineIds,
  }
}

/**
 * 注册 wf_graph_patch（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfGraphPatch(
  ctx: { get(name: string): unknown },
  host: GraphPatchHost,
): () => void {
  const tools = requireToolsService(ctx, WF_GRAPH_PATCH)
  const def = defineTool({
    name: WF_GRAPH_PATCH,
    // 描述只写「何时调用 / 前置条件 / 失败语义 / 副作用」：字段形状与提交规则由
    // wf_org_catalog 的 rules.patchContract 单点承载（指针在 ops 参数描述里），
    // 常驻文本只保留影响「是否/如何调用本工具」的内容。
    description:
      'Apply one patch to a workflow template or the running instance. ' +
      'For a NEW template pass scope=template with create and a complete graph (start + executable units + end).',
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
      expectRevision: { type: 'number', description: 'Optimistic-lock revision you last read; mismatch is rejected without retry (WF_PATCH_CONFLICT).' },
      ops: {
        type: 'array',
        required: true,
        description:
          'Patch operations; applied in array order. '
          + 'Exact field shapes are NOT listed here — read rules.patchContract from wf_org_catalog (omit ids). '
          + 'Example: [{ "op": "create_node", "node": { "kind": "agent", "id": "n1", "data": { "label": "Analyze", "presetId": "<combo id>" } } }, '
          + '{ "op": "connect", "source": "n1", "target": "n2" }].',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: {
      // 【关键】additionalProperties: false + 声明必须覆盖 executeGraphPatch 的全部返回字段，
      // 否则宿主对工具返回体做 JSON Schema 校验时会判定「is not a declared property」并
      // 把成功调用变成错误（实机验证发现：变更清单漏声明会让整组 op 不可用）。
      // 单测直接调 executeGraphPatch 绕过该校验，故另有「output schema 覆盖」用例守护本文件。
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
          // 只读预算：additionalProperties:true，避免嵌套字段被宿主判为未声明
          budget: { type: 'object', required: true, additionalProperties: true, description: 'Read-only org budget for the patched target: effective limits plus current usage and remaining room.' },
          newTemplate: { type: 'boolean', description: 'true when this patch created a new template; targetId is then the new template id.' },
          created: { type: 'array', items: { type: 'string' }, description: 'Node ids created by this patch.' },
          removed: { type: 'array', items: { type: 'string' }, description: 'Node ids removed by this patch (includes proxy nodes dropped with their source).' },
          updated: { type: 'array', items: { type: 'string' }, description: 'Node/group ids updated by this patch.' },
          connected: { type: 'array', items: { type: 'string' }, description: 'Line ids created by this patch.' },
          disconnected: { type: 'array', items: { type: 'string' }, description: 'Line ids removed by this patch.' },
        },
      },
      render: textRender,
    },
    async execute(args, exec: ToolExecLike) {
      const caller = callerOf(exec)
      if (caller.isChild) throw new WfError('WF_NOT_ROOT: a child agent cannot call wf_graph_patch; rewriting the graph is a parent-agent organization privilege', 'WF_NOT_ROOT')
      if (!caller.sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
      return executeGraphPatch(host, caller.sessionId, (args ?? {}) as Record<string, unknown>)
    },
  })
  return registerTool(tools, def)
}

// 说明：以下类型 re-export 便于单测与宿主装配从单一入口引用（避免多处 import 路径漂移）。
export type { GraphNode, Line }
export { hasBlockingIssues }

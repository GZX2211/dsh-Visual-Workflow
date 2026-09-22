// src/host/tools/wf-org-catalog/tool.ts
//
// wf_org_catalog 工具注册（自主编排方案 §4.1）：父代理的「人才市场 + 现有资产」只读勘察。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 参数归一化 + 目录组装 + 预算化截断」；
//   - 数据来源全部经宿主缝（FlowStore / 工具开关 / preset 与模型目录 / 当前画布 / 活跃 run），
//     不做任何写操作、不产生副作用（幂等、零副作用、不依赖运行态——有 run 时顺带刷新空闲基准）；
//   - 返回体**强预算化**（≤8KB 设计目标）：只给 id/name/摘要，角色提示词正文仅在
//     detail.roleId 定向请求时返回（且截断），避免一次勘察吃掉大量上下文预算。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用），≤120 tokens。

import { WF_ORG_CATALOG } from '../../shared/protocol.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { callerOf } from '../infrastructure/caller.js'
import { WfError, labelOf } from '../../orchestrator/index.js'
import {
  effectiveOrgMeta,
  executableUnitCount,
  groupCount,
  maxGroupMembers,
  metaOfDocument,
  normalizeOrgMeta,
  orgBudgetOf,
  orgUsageOf,
} from '../../graph/index.js'
import type { GraphNode, WorkflowDocument, WorkflowTemplate } from '../../shared/graph-model.js'
import type { OrgBudget } from '../../shared/types.js'

/** 预算化上限（按 detail 级别分两套：默认自包含，full 才返回正文）。 */
export const CATALOG_LIMITS = {
  /** 角色条目上限（overview）。 */
  roles: 60,
  /** 组合条目上限（两种级别一致；组合是节点 presetId 的取值来源，必须完整可选）。 */
  combos: 30,
  /** preset 条目上限（overview）。 */
  presets: 40,
  /** 模板条目上限（overview）。 */
  templates: 40,
  /** 数据源条目上限（overview）。 */
  dataSources: 40,
  /** full 级别下 dataSources 完整上限。 */
  dataSourcesFull: 200,
  /** 模型条目上限（provider/model 配对；节点 provider/model 的取值来源）。 */
  models: 60,
  /** 单条摘要文本上限（字符）。 */
  summary: 200,
  /** overview 下角色摘要上限（自己不看提示词正文，只保留足够判断能力的特性摘要）。 */
  summaryCompact: 60,
  /** 模型条目摘要上限（别名/描述）。 */
  modelSummary: 60,
  /** 角色提示词正文上限（仅 detailRoleId 定向请求时返回）。 */
  prompt: 4000,
  /** 模板拓扑摘要的节点/连线上限。 */
  topology: 60,
  /** 返回体体积天花板（字符）：超限按序压缩明细列表并标记 truncated。 */
  payload: 24000,
} as const

/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。
 *
 * 为什么没有 `listTools`（2026.09 决策）：节点子代理的工具集只由 `presetId`（工具组合
 * 或官方 preset）决定（runner.ts 的 resolveAgentTools），父代理**无法直接点名工具**，
 * 因此「可用工具总清单」对它没有决策价值，返回它只是白烧上下文预算。
 */
export interface OrgCatalogHost {
  /** 数据层：角色模板 / 工具组合 / 工作流模板 / 工作流实例 / 运行历史。 */
  store: {
    listTemplates(kind: 'role' | 'group'): Promise<unknown[]>
    listToolCombos(): Promise<unknown[]>
    listFlowTemplates(): Promise<WorkflowTemplate[]>
    getFlowTemplate(id: string): Promise<WorkflowTemplate | null>
    listWorkflows(sessionId?: string): Promise<WorkflowDocument[]>
    getRun(runId: string): Promise<unknown>
    listRuns(flowId: string): Promise<unknown[]>
  }
  /**
   * 全局工具开关现状。
   * ensureFresh 可选：宿主实现为 ToolSwitchStore 时会先做跨进程刷新（模式二服务进程
   * 与 GUI 不在同一进程），单测 fake 可省略；本工具只用它保证「开关状态」这一行报告准确。
   */
  toolSwitches: { currentDisabled(): ReadonlySet<string>; ensureFresh?(): Promise<void> }
  /** agent preset 目录（缺失时返回空数组）。 */
  listPresets?: () => Promise<Array<{ id: string; name?: string; description?: string }>>
  /** 模型目录（缺失时返回空数组）：节点 provider/model 的取值来源。 */
  listModels?: () => Promise<Array<{ provider: string; model: string }>>
  /** 当前会话激活运行（有则顺带刷新空闲基准；返回 null = 无运行）。 */
  activeRunOf?: (sessionId: string) => { snapshot: { flowId: string; id: string; status: string } } | null
  /** 取激活运行的最新画布（运行中的事实源口径；缺省回退实例文档）。 */
  currentResolvedFlowOf?: (sessionId: string) => Promise<WorkflowDocument | null>
  /** 刷新运行的空闲基准（有 run 时的双保险；见自主编排方案 §5.1）。 */
  touchRun?: (sessionId: string) => void
  /**
   * 父代理闸门已用次数（不含首次编排，D-21）。
   * 缺省 0：闸门计数状态机在 P3 落地（本轮不实现门判定）——此处只保留取值缝，
   * 刻意不用「运行记录条数」这类语义不符的近似值充数，避免污染预算语义。
   */
  milestoneUsedOf?: (sessionId: string) => number
}

/** 勘察详细级别：overview（默认，自包含且紧凑）/ full（含提示词摘要全文与明细）。 */
export type CatalogDetail = 'overview' | 'full'

/** 文本截断（超限追加省略标记，供模型感知「还有更多」）。 */
export function clip(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…（已截断）` : text
}

/** 数组预算：超限截断并返回是否截断。 */
function clipList<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
  return items.length > limit ? { items: items.slice(0, limit), truncated: true } : { items, truncated: false }
}

/** 数据源条目（画布上可复用的文件/数据库节点）。 */
function dataSourcesOf(flow: WorkflowDocument | null): Array<{ nodeId: string; kind: 'file' | 'database'; label: string; summary: string }> {
  const out: Array<{ nodeId: string; kind: 'file' | 'database'; label: string; summary: string }> = []
  for (const node of (flow?.nodes ?? []) as GraphNode[]) {
    if (node.kind === 'file') {
      const data = node.data as { fileKind?: string; managedPath?: string; fileName?: string; content?: string; files?: unknown[] }
      const summary = data.fileKind === 'file'
        ? `受管文件：${clip(data.fileName || data.managedPath || ((Array.isArray(data.files) ? data.files.length : 0) + ' 个文件'), CATALOG_LIMITS.summary)}`
        : `文本内容 ${String(data.content ?? '').length} 字`
      out.push({ nodeId: node.id, kind: 'file', label: labelOf(node), summary })
      continue
    }
    if (node.kind === 'database') {
      const data = node.data as { dbType?: string; dbKind?: string; localPath?: string; description?: string }
      const summary = data.dbType === 'server'
        ? `服务器 ${String(data.dbKind ?? '')}（只读查询）`
        : `本地 ${String(data.dbKind ?? 'sqlite')}：${clip(data.localPath ?? '', CATALOG_LIMITS.summary)}`
      out.push({ nodeId: node.id, kind: 'database', label: labelOf(node), summary })
    }
  }
  return out
}

/** 拓扑摘要（templateId 定向勘察时返回，供父代理复用既有编排）。 */
export function topologySummaryOf(flow: WorkflowDocument | WorkflowTemplate): {
  nodeCount: number
  lineCount: number
  nodes: Array<{ id: string; kind: string; label: string; groupId?: string | null }>
  lines: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string; condition?: string }>
  truncated: boolean
} {
  const nodes = (flow.nodes ?? []) as GraphNode[]
  const lines = flow.lines ?? []
  const nodeClip = clipList(nodes, CATALOG_LIMITS.topology)
  const lineClip = clipList(lines, CATALOG_LIMITS.topology)
  return {
    nodeCount: nodes.length,
    lineCount: lines.length,
    nodes: nodeClip.items.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.kind === 'proxy' ? `→ ${node.proxySourceId}` : labelOf(node),
      ...(node.kind === 'agent' || node.kind === 'parent' ? { groupId: node.data.groupId ?? null } : {}),
    })),
    lines: lineClip.items.map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition?.type ? { condition: line.condition.type } : {}),
    })),
    truncated: nodeClip.truncated || lineClip.truncated,
  }
}

/** 运行摘要（仅 includeRuns 时返回；本轮预留字段，评估阶段启用）。 */
function runSummaryOf(runs: unknown[]): { id: string; status: string; startedAt: string; nodeOk: number; nodeFail: number } | null {
  const run = runs[0] as { id?: unknown; status?: unknown; startedAt?: unknown; nodes?: Array<{ status?: string }> } | undefined
  if (!run) return null
  const nodes = Array.isArray(run.nodes) ? run.nodes : []
  return {
    id: String(run.id ?? ''),
    status: String(run.status ?? ''),
    startedAt: String(run.startedAt ?? ''),
    nodeOk: nodes.filter((node) => node?.status === 'ok').length,
    nodeFail: nodes.filter((node) => node?.status === 'fail').length,
  }
}

/** 组装目录（导出供单测直接断言，无需起工具注册表）。 */
export async function buildOrgCatalog(
  host: OrgCatalogHost,
  sessionId: string,
  options: { detail?: CatalogDetail; templateId?: string; includeRuns?: boolean; detailRoleId?: string },
): Promise<Record<string, unknown>> {
  // 开关现状：先跨进程刷新（别的 dsh 进程可能刚改过 tool-switches.json），再取快照——
  // 只报告「哪些工具被用户关闭」，用于印证本工具自身是否可见（模型看不到 wf_org_catalog
  // 时即说明被关闭）。父代理无法点名工具，故不再返回可用工具总清单（2026.09 决策）。
  await host.toolSwitches.ensureFresh?.()
  const disabled = host.toolSwitches.currentDisabled()
  const activeRun = host.activeRunOf?.(sessionId) ?? null
  // 双保险（方案 §5.1）：勘察期间父代理在干活 → 刷新空闲基准，避免长勘察被看护误停
  if (activeRun) host.touchRun?.(sessionId)

  // 目标文档：显式 templateId → 该工作流模板；否则当前活跃 run 的实例；再否则本会话最近实例
  let flow: WorkflowDocument | null = null
  let template: WorkflowTemplate | null = null
  if (options.templateId) {
    template = await host.store.getFlowTemplate(options.templateId)
    if (!template) {
      throw new WfError(`工作流模板不存在：${options.templateId}`, 'WF_ORG_NOT_FOUND')
    }
  } else if (activeRun && host.currentResolvedFlowOf) {
    // 运行中：以「运行事实源」口径读当前画布（与编排器 currentResolvedFlow 同源）
    flow = await host.currentResolvedFlowOf(sessionId).catch(() => null)
  }
  if (!template && !flow) {
    // 无激活运行：回退本会话最近实例（规划期勘察同样可用）
    const workflows = await host.store.listWorkflows(sessionId)
    flow = workflows[0] ?? null
  }
  const catalogDoc = (template ?? flow) as WorkflowDocument | WorkflowTemplate | null

  const roles = await host.store.listTemplates('role') as Array<Record<string, unknown>>
  const combos = await host.store.listToolCombos() as Array<Record<string, unknown>>
  const presets = (await host.listPresets?.().catch(() => [])) ?? []
  const models = (await host.listModels?.().catch(() => [])) ?? []
  const templates = await host.store.listFlowTemplates()

  const meta = effectiveOrgMeta(metaOfDocument(catalogDoc))
  const usage = orgUsageOf(catalogDoc, {
    milestoneUsed: Math.max(0, Math.floor(Number(host.milestoneUsedOf?.(sessionId)) || 0)),
  })
  const budget: OrgBudget = orgBudgetOf(meta, usage)
  const detailed = options.detail === 'full'

  // 角色条目：overview 只留「能否承担这个职责」的三个判据（kind / model / 短摘要）；
  // full 才给工具清单与完整提示词摘要。
  const roleItems = roles.map((role) => {
    const base: Record<string, unknown> = {
      id: String(role.id ?? ''),
      name: String(role.name ?? ''),
      kind: role.kind === 'parent' ? 'parent' : 'agent',
      model: `${String(role.provider ?? '')}/${String(role.model ?? '')}`.replace(/^\/|\/$/g, ''),
      summary: clip(role.systemPrompt ?? role.description ?? '', detailed ? CATALOG_LIMITS.summary : CATALOG_LIMITS.summaryCompact),
    }
    if (detailed) {
      base.tools = Array.isArray(role.tools) ? (role.tools as unknown[]).map(String).slice(0, 40) : null
      base.presetId = role.presetId ?? null
      base.retryLimit = role.retryLimit ?? null
      base.reactLimit = role.reactLimit ?? null
    }
    return base
  }).filter((role) => role.id)
  // 组合条目：两种级别都带工具清单——组合 id 就是节点 presetId 的取值，父代理必须能看到
  // 「这个组合能干什么」才能选定（工具清单是决策依据，不是可省信息）。
  const combosItems = combos.map((combo) => ({
    id: String(combo.id ?? ''),
    name: String(combo.name ?? ''),
    tools: Array.isArray(combo.tools) ? (combo.tools as unknown[]).map(String).slice(0, 40) : [],
    mcpServers: Array.isArray(combo.mcpServers) ? (combo.mcpServers as unknown[]).map(String).slice(0, 20) : [],
  })).filter((combo) => combo.id)
  const presetItems = presets.map((preset) => ({
    id: String(preset.id ?? ''),
    name: String(preset.name ?? preset.id ?? ''),
    ...(detailed && preset.description ? { summary: clip(preset.description, CATALOG_LIMITS.summary) } : {}),
  }))
  const modelItems = models
    .map((item) => ({ provider: String(item.provider ?? ''), model: String(item.model ?? '') }))
    .filter((item) => item.provider || item.model)
  const templateItems = templates.map((item) => ({
    id: item.id,
    name: item.name ?? item.id,
    mode: item.mode,
    nodeCount: (item.nodes ?? []).length,
    updatedAt: item.updatedAt ?? null,
  }))
  const sources = dataSourcesOf(flow)
  const roleClip = clipList(roleItems, CATALOG_LIMITS.roles)
  const comboClip = clipList(combosItems, CATALOG_LIMITS.combos)
  const presetClip = clipList(presetItems, CATALOG_LIMITS.presets)
  const modelClip = clipList(modelItems, CATALOG_LIMITS.models)
  const templateClip = clipList(templateItems, CATALOG_LIMITS.templates)
  const dataSourceClip = clipList(sources, detailed ? CATALOG_LIMITS.dataSourcesFull : CATALOG_LIMITS.dataSources)

  const out: Record<string, unknown> = {
    detail: detailed ? 'full' : 'overview',
    // overview 下必须告知如何索取明细，否则模型会以为「目录里就这些」。
    ...(detailed
      ? {}
      : { detailHint: "overview: lists carry ids/names only. Re-call with detail='full' for role summaries, preset descriptions and the full data-source list." }),
    roles: roleClip.items,
    combos: comboClip.items,
    presets: presetClip.items,
    models: modelClip.items,
    dataSources: dataSourceClip.items,
    templates: templateClip.items,
    tools: {
      /** 被用户全局关闭的工具：与「本工具的上下文里有没有 wf_org_catalog / wf_graph_patch」互为印证。 */
      disabled: [...disabled],
    },
    limits: budget,
    // 规模口径与预算一起给出，父代理据此判断「还能加几个节点」
    scale: {
      executableNodes: executableUnitCount(catalogDoc?.nodes),
      groups: groupCount(catalogDoc?.nodes),
      maxGroupMembers: maxGroupMembers(catalogDoc?.nodes),
    },
    truncated: roleClip.truncated || comboClip.truncated || presetClip.truncated
      || modelClip.truncated || templateClip.truncated || dataSourceClip.truncated,
  }
  if (catalogDoc) {
    out.topology = topologySummaryOf(catalogDoc as WorkflowDocument)
  }
  if (options.detailRoleId) {
    const role = roles.find((item) => String(item.id ?? '') === options.detailRoleId)
    out.rolePrompt = role
      ? {
        id: String(role.id ?? ''),
        name: String(role.name ?? ''),
        presetId: role.presetId ?? null,
        model: `${String(role.provider ?? '')}/${String(role.model ?? '')}`.replace(/^\/|\/$/g, ''),
        systemPrompt: clip(role.systemPrompt ?? '', CATALOG_LIMITS.prompt),
      }
      : null
  }
  if (options.includeRuns && flow) {
    const runs = await host.store.listRuns(flow.id).catch(() => [])
    out.recentRun = runSummaryOf(Array.isArray(runs) ? runs : [])
  }
  return fitPayload(out)
}

/**
 * 返回体体积天花板（字符）：超限时按「信息价值从低到高」的顺序压缩明细列表，
 * 并置 truncated=true 提示模型「还有内容未显示，可用 detail/templateId 定向索取」。
 * 为什么需要：条目数上限只约束单列表，多个列表叠加仍可能超预算；这一层是总量兜底。
 */
function fitPayload(out: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(out).length <= CATALOG_LIMITS.payload) return out
  let truncated = out.truncated === true
  const shrinkOrder: Array<{ key: string; limit: number }> = [
    { key: 'dataSources', limit: 20 },
    { key: 'templates', limit: 20 },
    { key: 'presets', limit: 20 },
    { key: 'models', limit: 20 },
    { key: 'roles', limit: 20 },
    { key: 'combos', limit: 20 },
  ]
  for (const step of shrinkOrder) {
    const list = out[step.key]
    if (Array.isArray(list) && list.length > step.limit) {
      out[step.key] = list.slice(0, step.limit)
      truncated = true
    }
    if (JSON.stringify(out).length <= CATALOG_LIMITS.payload) break
  }
  out.truncated = truncated
  return out
}

/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfOrgCatalog(
  ctx: { get(name: string): unknown },
  host: OrgCatalogHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_org_catalog')
  }
  const def = defineTool({
    name: WF_ORG_CATALOG,
    description:
      'Read-only survey of the organization assets available for planning: role templates, tool combos, agent presets, available models, reusable data nodes on the canvas, workflow templates, and the effective org budget (limits/scale). ' +
      'Call it before planning or patching an organization so roles and node configuration stay within budget. ' +
      'A node subagent\'s tools come ONLY from its presetId (a combo id from combos, or an official preset id), so picking presetId here is mandatory — an empty presetId means that node runs with zero tools. ' +
      'Defaults to a compact overview (ids/names); pass detail=\'full\' for role summaries and preset descriptions, detailRoleId to read one role prompt, templateId to read one workflow topology. ' +
      'Idempotent and side-effect free. Only the parent agent may call this; child agents are rejected (WF_NOT_ROOT).',
    parameters: {
      detail: { type: 'string', enum: ['overview', 'full'] as const, description: "Default 'overview' (compact ids/names). 'full' adds role prompt summaries, preset descriptions and the full data-source list." },
      templateId: { type: 'string', description: 'Optional workflow template id: return that template topology summary (nodes/lines/scale) instead of only the global catalog.' },
      includeRuns: { type: 'boolean', description: 'Optional: attach the most recent run summary (node ok/fail counts) for the current instance. Default false.' },
      detailRoleId: { type: 'string', description: 'Optional role template id: attach its full system prompt (truncated) for reuse.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, description: 'Budgeted catalog: detail/roles/combos/presets/models/dataSources/templates/tools.disabled/limits/scale (+optional topology/rolePrompt/recentRun/detailHint).' },
      render: textRender,
    },
    async execute(args, exec: ToolExecLike) {
      const caller = callerOf(exec)
      if (caller.isChild) throw new WfError('子代理无法调用 wf_org_catalog（仅当前会话主 Agent 可勘察组织资产）', 'WF_NOT_ROOT')
      if (!caller.sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
      const raw = (args ?? {}) as { detail?: unknown; templateId?: unknown; includeRuns?: unknown; detailRoleId?: unknown }
      return buildOrgCatalog(host, caller.sessionId, {
        ...(raw.detail === 'full' ? { detail: 'full' as const } : {}),
        ...(String(raw.templateId ?? '').trim() ? { templateId: String(raw.templateId).trim() } : {}),
        ...(raw.includeRuns === true ? { includeRuns: true } : {}),
        ...(String(raw.detailRoleId ?? '').trim() ? { detailRoleId: String(raw.detailRoleId).trim() } : {}),
      })
    },
  })
  return tools.register(def)
}

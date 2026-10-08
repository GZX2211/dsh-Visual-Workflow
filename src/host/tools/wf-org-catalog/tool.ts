// src/host/tools/wf-org-catalog/tool.ts
//
// wf_org_catalog 工具注册：父代理的「组织资产」只读勘察。
//
// 调用模型（用户裁决）：只区分「传 ids / 不传 ids」——
//   - 不传（或空数组 / 空串）→ **资产索引**：组合（含工具清单）、官方 preset、模型与
//     思考强度、编排规则、工作流资产与角色资产索引，以及 ID 约定与召回指引；
//   - 传 ids → **批量详情**：`flow-*` 工作流骨架 / `role-*` 角色完整 systemPrompt /
//     `<flow-id>#<node-id>` 工作流资产内联角色完整 systemPrompt；坏 id 只单条报错，不阻塞其余。
//
// 职责边界：本文件只做「注册 + 取数编排 + 错误归一」；返回体装配在 build.ts（纯函数），
// id 判定在 ids.ts（纯函数）。零写操作、幂等；不读运行实例（实例编排事实由运行期编排
// 指令提供，本工具只暴露资产）。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）。

import { WF_ORG_CATALOG } from '../../shared/protocol.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { callerOf } from '../infrastructure/caller.js'
import { WfError } from '../../orchestrator/index.js'
import {
  buildIndex,
  buildInlineRoleDetail,
  buildRoleDetail,
  buildWorkflowDetail,
  type ResolvedRoleRef,
} from './build.js'
import { detailIdsLimitProblem, normalizeAssetIds, parseAssetId } from './ids.js'
import type {
  CatalogAssetDetail,
  CatalogDetails,
  CatalogDetailError,
  CatalogIndex,
  CatalogModelSource,
  CatalogPresetSource,
} from './types.js'
import type {
  RoleAssetDetail,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../../shared/asset-types.js'
import type { RoleNode } from '../../shared/graph-model.js'

/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。
 *
 * 为什么资产经独立缝而不是直接给 store：资产库是「Active 索引 + 版本行」两层事实的唯一
 * 所有者，工具只需这两层查询；组合清单仍来自宿主数据层（它不是资产事实）。
 * 为什么不含运行态与工具开关：工作流实例与运行事实由运行期编排指令提供——父代理只允许
 * 改当前正在运行的实例，不通过本工具枚举实例；被全局关闭的工具在模型侧表现为
 * UNKNOWN_TOOL，全量关闭清单一来与编排决策无关，二来会吃掉大量上下文预算。
 */
export interface OrgCatalogHost {
  /** 资产库（Active 索引 + 详情召回；资产事实唯一来源）。 */
  assets: {
    listWorkflowAssets(): Promise<WorkflowAssetSummary[]>
    listRoleAssets(): Promise<RoleAssetSummary[]>
    getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>
    getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>
    /**
     * 可选缝：把工作流资产里钉住的**角色版本行 id** 回溯为角色资产 id。
     * 没有它时骨架仍给 roleVersionId（钉的是哪一版），只是无法标注角色资产名。
     */
    getRoleAssetVersion?: (roleRowId: string) => Promise<RoleAssetDetail | null>
  }
  /** 组合清单（非资产事实，仍从宿主数据层取）。 */
  listToolCombos(): Promise<unknown[]>
  /** agent preset 目录（可选缝；缺失按空清单处理）。 */
  listPresets?: () => Promise<CatalogPresetSource[]>
  /** 模型目录（可选缝；缺失按空清单处理）：节点 provider/model/reasoning 的取值来源。 */
  listModels?: () => Promise<CatalogModelSource[]>
}

/** 组装并执行一次勘察（导出供单测直接断言，无需起工具注册表）。 */
export async function executeOrgCatalog(
  host: OrgCatalogHost,
  args: Record<string, unknown>,
): Promise<CatalogIndex | CatalogDetails> {
  const ids = normalizeAssetIds(args?.ids)
  if (ids === null) {
    throw new WfError(
      `ids 必须是字符串数组（只看资产索引请省略该参数）——收到 ${JSON.stringify(args?.ids ?? null)}`,
      'WF_BAD_ARGS',
    )
  }
  const limitProblem = detailIdsLimitProblem(ids.length)
  if (limitProblem) throw new WfError(limitProblem, 'WF_BAD_ARGS')
  return ids.length === 0 ? await buildIndexFrom(host) : await buildDetailsFrom(host, ids)
}

/**
 * 索引取数。
 * 核心清单（资产 / 组合）读取失败**向上抛**——不伪装成「没有资产」，
 * 否则父代理会基于空目录做出错误编排；preset 与模型是可选目录，缺失或失败按空清单处理。
 */
async function buildIndexFrom(host: OrgCatalogHost): Promise<CatalogIndex> {
  const [workflows, roles, combos] = await Promise.all([
    host.assets.listWorkflowAssets(),
    host.assets.listRoleAssets(),
    host.listToolCombos(),
  ])
  const presets = host.listPresets ? await host.listPresets().catch(() => []) : []
  const models = host.listModels ? await host.listModels().catch(() => []) : []
  return buildIndex({
    workflows: workflows ?? [],
    roles: roles ?? [],
    combos: combos as Array<Record<string, unknown>>,
    presets,
    models,
  })
}

/** 单条召回的取数结果：值或该 id 的错误（错误不冒泡为整批失败）。 */
type Lookup<T> = { ok: true; value: T } | { ok: false; error: CatalogDetailError }

async function lookupOf<T>(id: string, read: () => Promise<T>): Promise<Lookup<T>> {
  try {
    return { ok: true, value: await read() }
  } catch (error) {
    return { ok: false, error: { id, code: errorCodeOf(error), message: messageOf(error) } }
  }
}

/**
 * 批量详情召回：逐条独立处理——形状非法 / 资产不存在 / 单条读失败 / 已退役都只记为该 id
 * 的 error，绝不阻塞同批其余 id（用户裁决）。
 */
async function buildDetailsFrom(host: OrgCatalogHost, ids: string[]): Promise<CatalogDetails> {
  const refs = ids.map((id) => ({ id, ref: parseAssetId(id) }))
  const assets: CatalogAssetDetail[] = []
  const errors: CatalogDetailError[] = []
  /** 已确认不存在（null）与读出结果的缓存：同批重复引用只查一次。 */
  const workflowCache = new Map<string, WorkflowAssetDetail | null>()
  const roleCache = new Map<string, RoleAssetDetail | null>()
  const roleVersionCache = new Map<string, ResolvedRoleRef | null>()

  const loadWorkflow = async (assetId: string): Promise<WorkflowAssetDetail | null> => {
    if (!workflowCache.has(assetId)) workflowCache.set(assetId, await host.assets.getWorkflowAsset(assetId))
    return workflowCache.get(assetId) ?? null
  }
  const loadRole = async (assetId: string): Promise<RoleAssetDetail | null> => {
    if (!roleCache.has(assetId)) roleCache.set(assetId, await host.assets.getRoleAsset(assetId))
    return roleCache.get(assetId) ?? null
  }
  /** 角色版本行 id → 资产引用（无回溯缝或行已不存在时返回 null）。 */
  const loadRoleRef = async (roleRowId: string): Promise<ResolvedRoleRef | null> => {
    const reader = host.assets.getRoleAssetVersion
    if (!reader) return null
    if (!roleVersionCache.has(roleRowId)) {
      const detail = await reader(roleRowId)
      roleVersionCache.set(roleRowId, detail ? { assetId: detail.assetId, versionId: detail.versionId } : null)
    }
    return roleVersionCache.get(roleRowId) ?? null
  }

  // 单次预扫分类：形状非法的 id 不进入任何取数，避免为坏 id 触发无谓读盘。
  // 内联角色的容器也计入工作流资产读盘（同一容器去重后只读一次）。
  const workflowIds: string[] = []
  const roleIds: string[] = []
  for (const { ref } of refs) {
    if (!ref.ok) continue
    if (ref.kind === 'workflow') workflowIds.push(ref.id)
    else if (ref.kind === 'role') roleIds.push(ref.id)
    else if (!workflowIds.includes(ref.containerId)) workflowIds.push(ref.containerId)
  }

  const workflowLookups = await Promise.all(workflowIds.map((id) => lookupOf(id, () => loadWorkflow(id))))
  const roleLookups = await Promise.all(roleIds.map((id) => lookupOf(id, () => loadRole(id))))
  const failureOf = new Map<string, CatalogDetailError>()
  for (const lookup of [...workflowLookups, ...roleLookups]) {
    if (!lookup.ok) failureOf.set(lookup.error.id, lookup.error)
  }

  for (const { id, ref } of refs) {
    if (!ref.ok) {
      errors.push({ id, code: 'WF_BAD_ARGS', message: ref.reason })
      continue
    }
    const failure = failureOf.get(id)
    if (failure) {
      errors.push(failure)
      continue
    }
    if (ref.kind === 'workflow') {
      const detail = workflowCache.get(ref.id)
      if (!detail) {
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `工作流资产不存在或已退役：${ref.id}` })
        continue
      }
      // 角色版本回溯是 best-effort：读失败只丢 roleAssetId，骨架主体照常返回。
      const resolved = new Map<string, ResolvedRoleRef>()
      for (const roleRef of detail.roleVersionIds ?? []) {
        const rowId = String(roleRef?.roleVersionId ?? '').trim()
        if (!rowId) continue
        const resolvedRef = await loadRoleRef(rowId).catch(() => null)
        if (resolvedRef) resolved.set(rowId, resolvedRef)
      }
      assets.push(buildWorkflowDetail(detail, (rowId) => resolved.get(rowId) ?? null))
      continue
    }
    if (ref.kind === 'role') {
      const detail = roleCache.get(ref.id)
      if (!detail) {
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `角色资产不存在或已退役：${ref.id}` })
        continue
      }
      assets.push(buildRoleDetail(detail))
      continue
    }
    const container = workflowCache.get(ref.containerId)
    if (!container) {
      errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `工作流资产不存在或已退役：${ref.containerId}` })
      continue
    }
    const node = (container.nodes ?? []).find((item) => item.id === ref.nodeId)
    if (!node) {
      errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `工作流资产 ${ref.containerId} 中不存在节点：${ref.nodeId}` })
      continue
    }
    if (node.kind !== 'agent' && node.kind !== 'parent') {
      errors.push({
        id,
        code: 'WF_BAD_ARGS',
        message: `节点 ${ref.nodeId} 是 ${node.kind}，没有 systemPrompt（只有 agent/parent 角色节点可召回）`,
      })
      continue
    }
    const rowId = (container.roleVersionIds ?? [])
      .find((item) => String(item?.nodeId ?? '') === ref.nodeId)?.roleVersionId
    const roleRef = rowId ? await loadRoleRef(String(rowId)).catch(() => null) : null
    assets.push(buildInlineRoleDetail({
      containerId: ref.containerId,
      node: node as RoleNode,
      ...(roleRef?.assetId ? { roleAssetId: roleRef.assetId } : {}),
      ...(roleRef ? { roleVersionId: roleRef.versionId } : {}),
    }))
  }
  return { kind: 'details', assets, errors }
}

/** 单条读失败的稳定错误码（WfError 自带 code；其余按「取不到该资产」归类）。 */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code ? code : 'WF_ORG_NOT_FOUND'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
      'Read-only survey of the organization assets available for planning. Two call shapes: omit ids for the compact index (tool combos with their tool lists, official presets, provider/model plus reasoning-effort options, the orchestration rules, and the workflow-asset and role-asset index); pass ids to recall details for those entries in one batch. '
      + 'Assets are reusable organization configurations promoted from templates and versioned - recall one to reuse a proven way of staffing and wiring a workflow. They are not templates you may edit: templates are drafts and are NOT listed here. '
      + 'The index rules carry the write-patch contract: rules.patchContract (op field shapes, role-node data fields, submission rules, error-code semantics) and rules.gateMarking (milestone-gate marking rules) - read them before calling wf_graph_patch. '
      + 'Index entries are candidates only (name/description/version); full content is never in the index and must be recalled by id. '
      + 'Supported ids: flow-* (workflow asset -> complete skeleton: stage nodes, roles, groups, lines and data-node bodies, plus roleAssetId/roleVersionId for each role node), role-* (role asset -> full systemPrompt plus its mapping fields), <flow-id>#<node-id> (inline role pinned in that workflow asset -> full systemPrompt of that fixed version). At most 20 ids per call. Bad, missing or retired ids come back as per-item errors and never block the others. '
      + 'A node subagent\'s tools come ONLY from its presetId (a combo id from combos, or an official preset id), so picking presetId from this catalog is mandatory - an empty presetId means that node runs with zero tools. '
      + 'Role-node fields retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId are owned by the canvas UI: they are neither returned here nor settable through wf_graph_patch, so never pass them. '
      + 'The workflow skeleton intentionally omits role systemPrompts (the longest fields) - recall them by composite id when you need to reuse them. Idempotent and side-effect free; only the parent agent may call this, child agents are rejected (WF_NOT_ROOT).',
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset ids to recall in detail; omit (or pass []) for the compact index. Supported: flow-* (workflow asset), role-* (role asset), <flow-id>#<node-id> (inline role pinned in that workflow asset). Bad, missing or retired ids come back as per-item errors and never block the others. At most 20 ids per call - submit further batches when needed.',
      },
    },
    output: {
      // 【关键】additionalProperties: true：宿主对工具返回体做 JSON Schema 校验时，
      // 未声明字段不应把成功调用变成错误（wf_graph_patch 曾因 false 导致三组 op 全废）。
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'kind="index": idConvention / detailHint / combos / presets / models / assets.workflows / assets.roles / rules / truncated. kind="details": assets (workflow skeleton | role asset | inline role) + errors (per-id failures that did not block the rest).',
      },
      render: textRender,
    },
    async execute(args, exec: ToolExecLike) {
      const caller = callerOf(exec)
      if (caller.isChild) throw new WfError('子代理无法调用 wf_org_catalog（仅当前会话主 Agent 可勘察组织资产）', 'WF_NOT_ROOT')
      if (!caller.sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
      return executeOrgCatalog(host, (args ?? {}) as Record<string, unknown>)
    },
  })
  return tools.register(def)
}

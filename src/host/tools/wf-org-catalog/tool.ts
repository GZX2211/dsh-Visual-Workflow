// src/host/tools/wf-org-catalog/tool.ts
//
// wf_org_catalog 工具注册：父代理的「组织资产」只读勘察。
//
// 调用模型（用户裁决）：只区分「传 ids / 不传 ids」——
//   - 不传（或空数组 / 空串）→ **资产索引**：组合（含工具清单）、官方 preset、模型与
//     思考强度、编排规则、工作流资产与角色资产索引，以及 ID 约定与召回指引；
//   - 传 ids → **批量详情**：`flow-*` 工作流骨架 / `role-*` 角色完整 systemPrompt /
//     `<flow-id>#<node-id>` 工作流资产内联角色完整 systemPrompt；
//     `instance` 当前运行实例骨架 / `instance#<node-id>` 该实例内联角色完整 systemPrompt；
//     坏 id 只单条报错，不阻塞其余。
//
// 两条召回通道分层不同：资产三层（索引 → 骨架 → 角色 Prompt），运行实例两层
// （`instance` → `instance#<node-id>`，不进索引、不与资产混召）。
//
// 职责边界：本文件只做「注册 + 取数编排 + 错误归一」；返回体装配在 build.ts（纯函数），
// id 判定在 ids.ts（纯函数）。零写操作、幂等。实例取数只经宿主缝 getActiveRunFlow
// （编排器的语义化查询）——本文件不触达运行表，故能读到的实例恒为「当前会话正在运行的
// 那一个」：历史 run 与其他会话的实例没有取数路径，规划期因此不可能借本工具参考实例。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）。

import { WF_ORG_CATALOG } from '../../shared/protocol.js'
import { defineTool, type ToolExecLike } from '../infrastructure/define-tool.js'
import { registerTool, requireToolsService } from '../infrastructure/register-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { callerOf } from '../infrastructure/caller.js'
import { WfError } from '../../orchestrator/index.js'
import {
  buildIndex,
  buildInlineRoleDetail,
  buildInstanceDetail,
  buildRoleDetail,
  buildWorkflowDetail,
  type ResolvedRoleRef,
} from './build.js'
import { detailIdsLimitProblem, normalizeAssetIds, parseAssetId } from './ids.js'
import { INSTANCE_ID } from './types.js'
import type {
  CatalogAssetDetail,
  CatalogDetailEntry,
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
import type { RoleNode, WorkflowDocument } from '../../shared/graph-model.js'

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
  /**
   * 当前会话**正在运行**的实例文档（`instance` 召回的取数源；无活跃 run 返回 null）。
   *
   * 为什么必填：实例召回是本工具的一等能力，装配方必须显式给出；缺失是编程错误，
   * 不做「静默降级成没有实例」——那会把装配问题伪装成正常状态（工具层另有断言）。
   * 语义：只暴露 running 的实例，且取最新实例文档。历史 run、暂停中的运行与其他会话的
   * 实例在此缝之外就不可达（不是靠校验拦住，而是判据层没有形状）。
   */
  getActiveRunFlow(sessionId: string): Promise<WorkflowDocument | null>
}

/**
 * 组装并执行一次勘察（导出供单测直接断言，无需起工具注册表）。
 *
 * @param sessionId 调用者会话；只有实例相关 id（`instance` / `instance#<nodeId>`）需要它。
 */
export async function executeOrgCatalog(
  host: OrgCatalogHost,
  args: Record<string, unknown>,
  sessionId = '',
): Promise<CatalogIndex | CatalogDetails> {
  const ids = normalizeAssetIds(args?.ids)
  if (ids === null) {
    throw new WfError(
      `WF_BAD_ARGS: ids must be an array of strings (omit it to get the asset index only) - received ${JSON.stringify(args?.ids ?? null)}`,
      'WF_BAD_ARGS',
    )
  }
  const limitProblem = detailIdsLimitProblem(ids.length)
  if (limitProblem) throw new WfError(limitProblem, 'WF_BAD_ARGS')
  return ids.length === 0 ? await buildIndexFrom(host) : await buildDetailsFrom(host, ids, sessionId)
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
async function buildDetailsFrom(host: OrgCatalogHost, ids: string[], sessionId: string): Promise<CatalogDetails> {
  const refs = ids.map((id) => ({ id, ref: parseAssetId(id) }))
  const assets: CatalogDetailEntry[] = []
  const errors: CatalogDetailError[] = []
  /** 已确认不存在（null）与读出结果的缓存：同批重复引用只查一次。 */
  const workflowCache = new Map<string, WorkflowAssetDetail | null>()
  const roleCache = new Map<string, RoleAssetDetail | null>()
  const roleVersionCache = new Map<string, ResolvedRoleRef | null>()

  /**
   * 实例取数：单例运行事实（当前会话至多一条），同批多次引用只取一次。
   * 缺会话身份时抛 WF_BAD_CALLER——那是调用方错误、整批无效，不得降级成「没有实例」。
   */
  let instanceFlow: WorkflowDocument | null = null
  let instanceLoaded = false
  const loadInstanceFlow = async (): Promise<WorkflowDocument | null> => {
    if (!sessionId) {
      throw new WfError('WF_BAD_CALLER: cannot identify the caller session; the running instance cannot be resolved', 'WF_BAD_CALLER')
    }
    if (!instanceLoaded) {
      instanceFlow = await host.getActiveRunFlow(sessionId)
      instanceLoaded = true
    }
    return instanceFlow
  }

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
  // 实例两态（instance / instanceRole）不参与资产取数——它们的取数通道是 getActiveRunFlow，
  // 故必须显式判 kind，不能让 else 兜底把它们当成资产容器。
  const workflowIds: string[] = []
  const roleIds: string[] = []
  for (const { ref } of refs) {
    if (!ref.ok) continue
    if (ref.kind === 'workflow') workflowIds.push(ref.id)
    else if (ref.kind === 'role') roleIds.push(ref.id)
    else if (ref.kind === 'inlineRole' && !workflowIds.includes(ref.containerId)) workflowIds.push(ref.containerId)
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
    // 实例两态：骨架（含「无活跃实例」的禁令体）与该实例的内联角色。
    // 在资产 failure 表之前分派——实例不参与资产取数，故不查 workflow/role 缓存。
    if (ref.kind === 'instance') {
      assets.push(buildInstanceDetail(await loadInstanceFlow()))
      continue
    }
    if (ref.kind === 'instanceRole') {
      const flow = await loadInstanceFlow()
      if (!flow) {
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: 'no instance is running in this session, so its inline roles cannot be recalled' })
        continue
      }
      const node = (flow.nodes ?? []).find((item) => item.id === ref.nodeId)
      if (!node) {
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `node not found in the running instance: ${ref.nodeId}` })
        continue
      }
      if (node.kind !== 'agent' && node.kind !== 'parent') {
        errors.push({
          id,
          code: 'WF_BAD_ARGS',
          message: `node ${ref.nodeId} is ${node.kind} and has no systemPrompt (only agent/parent role nodes can be recalled)`,
        })
        continue
      }
      assets.push(buildInlineRoleDetail({ containerId: INSTANCE_ID, node: node as RoleNode }))
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
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `workflow asset does not exist or has been retired: ${ref.id}` })
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
        errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `role asset does not exist or has been retired: ${ref.id}` })
        continue
      }
      assets.push(buildRoleDetail(detail))
      continue
    }
    const container = workflowCache.get(ref.containerId)
    if (!container) {
      errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `workflow asset does not exist or has been retired: ${ref.containerId}` })
      continue
    }
    const node = (container.nodes ?? []).find((item) => item.id === ref.nodeId)
    if (!node) {
      errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `node not found in workflow asset ${ref.containerId}: ${ref.nodeId}` })
      continue
    }
    if (node.kind !== 'agent' && node.kind !== 'parent') {
      errors.push({
        id,
        code: 'WF_BAD_ARGS',
        message: `node ${ref.nodeId} is ${node.kind} and has no systemPrompt (only agent/parent role nodes can be recalled)`,
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
  const tools = requireToolsService(ctx, WF_ORG_CATALOG)
  const def = defineTool({
    name: WF_ORG_CATALOG,
    description:
      'Read-only survey of the organization assets available for planning. Omit ids for the compact index (combos, presets, models, orchestration rules, asset index); pass ids to recall details in one batch. '
      + 'Assets are reusable configurations; recall one to reuse. Index entries are candidates only — full content by id. Templates are NOT listed here. '
      + 'rules.patchContract and rules.gateMarking carry the write-patch contract — read them before calling wf_graph_patch. '
      + 'Supported ids: flow-* (workflow skeleton), role-* (role asset), <flow-id>#<node-id> (inline role), '
      + 'instance (skeleton of the instance currently running in this session — topology only, no asset content) and instance#<node-id> (that instance\'s inline role). '
      + 'A node subagent\'s tools come ONLY from its presetId; picking one here is mandatory (empty = zero tools). '
      + 'Skeletons omit role systemPrompts; recall them by their composite id. Idempotent, side-effect free.',
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ids to recall in detail; omit (or pass []) for the compact index. Supported: flow-* (workflow asset), role-* (role asset), <flow-id>#<node-id> (inline role pinned in that workflow asset), instance (skeleton of the instance running in this session), instance#<node-id> (inline role of that running instance). Bad, missing or retired ids come back as per-item errors and never block the others. At most 20 ids per call - submit further batches when needed.',
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
      if (caller.isChild) throw new WfError('WF_NOT_ROOT: a child agent cannot call wf_org_catalog; only the session main agent may survey organization assets', 'WF_NOT_ROOT')
      const sessionId = String(caller.sessionId ?? '')
      if (!sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
      return executeOrgCatalog(host, (args ?? {}) as Record<string, unknown>, sessionId)
    },
  })
  return registerTool(tools, def)
}

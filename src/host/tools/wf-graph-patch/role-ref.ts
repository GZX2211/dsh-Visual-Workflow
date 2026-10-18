// src/host/tools/wf-graph-patch/role-ref.ts
//
// 角色引用展开层：把补丁里的 `data.roleAssetId` 解析成完整角色配置。
//
// 为什么需要（2026.10 用户裁决）：父代理写图时不应反复搬运角色 systemPrompt 与
// presetId/provider/model 配置；只写流程与框架、按 id 复用组织资产，才符合
// 「复用 → 在既有资产上改造 → 新建」的编排优先级。展开后的字段仍交给 apply 的既有
// 规范化与存在性校验，因此引用不会绕过任何护栏。
//
// 支持的 id 与 wf_org_catalog 的召回入口一一对应（同一判据由 parseAssetId 复用）：
//   - role-*                  → 角色资产 Active 版本；
//   - flow-*#<node id>        → 工作流资产里的内联角色（固定引用版本）；
//   - instance#<node id>      → 当前会话运行实例里的内联角色。
// 整图资产 id（flow-* 无 #）不支持：本次只做角色节点配置复用，不复制整图骨架。
//
// 语义：
//   - 显式 data 字段覆盖带入值；未覆盖字段来自资产/节点；
//   - 来源写入 op 顶层内部字段（ROLE_SOURCE_ASSET_ID_FIELD），由 apply 落进
//     data.sourceAssetId；内联角色无来源时写空串，update 会清除旧绑定；
//   - 单条引用失败只记录该 op 的错误并跳过，同批其余引用继续（整批仍不落盘）；
//   - 资产库取数抛错向上抛：那是环境/装配失败，不得伪装成模型入参错误。

import { parseAssetId } from '../wf-org-catalog/ids.js'
import { ROLE_SOURCE_ASSET_ID_FIELD } from './types.js'
import type { RoleAssetDetail, WorkflowAssetDetail } from '../../shared/asset-types.js'
import type { RoleNode, WorkflowDocument } from '../../shared/graph-model.js'
import type { PatchOp, PatchOpFailure } from './types.js'

/**
 * 角色引用的宿主取数缝。
 *
 * 与 wf_org_catalog 的资产缝同源：真实装配由 ecosystemAdapters 一并提供，单测可注入
 * 最小 fake。`assets` 缺失时引用直接失败（不静默忽略），因为「忽略引用」会让父代理
 * 以为角色配置已写入，实际落成空壳节点。
 */
export interface RoleRefHost {
  assets?: {
    getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>
    getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>
    /** 可选缝：把工作流资产钉住的角色版本行 id 回溯为角色资产 id。 */
    getRoleAssetVersion?: (roleRowId: string) => Promise<RoleAssetDetail | null>
  }
  /** 当前会话正在运行的实例（instance#<node id> 的取数源；无活跃 run 返回 null）。 */
  getActiveRunFlow?: (sessionId: string) => Promise<WorkflowDocument | null>
}

/** 展开结果：ops 与输入等长；失败索引由 apply 跳过（错误已在此报告）。 */
export interface RoleRefExpansion {
  ops: PatchOp[]
  errors: PatchOpFailure[]
  skipped: Set<number>
}

/** 角色内容字段（资产详情与内联节点的统一投影口径）。 */
interface RoleContent {
  label: string
  systemPrompt: string
  provider: string
  model: string
  reasoning: string | null
  presetId: string | null
  inputSchema: string
  outputSchema: string
}

interface ResolvedRole {
  content: RoleContent
  /** 来源角色资产 id；内联角色无来源时为空串。 */
  sourceAssetId: string
}

interface RoleRefCaches {
  roleAssets: Map<string, Promise<RoleAssetDetail | null>>
  workflowAssets: Map<string, Promise<WorkflowAssetDetail | null>>
  roleVersions: Map<string, Promise<RoleAssetDetail | null>>
  activeFlow?: Promise<WorkflowDocument | null>
}

/** 引用层可自我修正的错误（参数层：要改的是 roleAssetId）。 */
class RoleRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleRefError'
  }
}

/** 宽松字符串化（null / undefined → 空串）。 */
function textOf(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** 非空 trim 后字符串（无内容返回 null）。 */
function trimmedOrNull(value: unknown): string | null {
  const text = textOf(value).trim()
  return text ? text : null
}

/** 同批同一 key 只取一次数（失败结果同样缓存，避免重复触发同一错误）。 */
function cachedOf<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const existing = cache.get(key)
  if (existing) return existing
  const pending = read()
  cache.set(key, pending)
  return pending
}

/** 角色资产详情 → 角色内容（画布字段不在此映射面内）。 */
function contentOfRoleAsset(detail: RoleAssetDetail): RoleContent {
  return {
    label: textOf(detail.name),
    systemPrompt: textOf(detail.systemPrompt),
    provider: textOf(detail.provider),
    model: textOf(detail.model),
    reasoning: detail.reasoning ?? null,
    // 与画布拖入角色资产同口径：资产未记录组合时回退官方默认 preset
    presetId: trimmedOrNull(detail.presetId) ?? 'standard',
    inputSchema: textOf(detail.inputSchema),
    outputSchema: textOf(detail.outputSchema),
  }
}

/**
 * 内联角色节点 → 角色内容。
 *
 * 与资产映射的唯一差别是 presetId：内联节点上的空 presetId 是「零工具集」的既有事实，
 * 复用时必须忠实保留（运行期会由检查器给出 roleNodeNoPreset 告警），不能擅自换成
 * 'standard' —— 那会把一个明确无工具的角色悄悄变成有工具。
 */
function contentOfInlineRole(node: RoleNode): RoleContent {
  const data = node.data
  return {
    label: textOf(data.label),
    systemPrompt: textOf(data.systemPrompt),
    provider: textOf(data.provider),
    model: textOf(data.model),
    reasoning: data.reasoning ?? null,
    presetId: trimmedOrNull(data.presetId) ?? null,
    inputSchema: textOf(data.inputSchema),
    outputSchema: textOf(data.outputSchema),
  }
}

/** 读取 op 的 data（只有 create_node / update_node_data 携带角色 data）。 */
function dataOfOp(op: PatchOp): unknown {
  if (op.op === 'create_node') {
    const node = (op as { node?: unknown }).node
    return node && typeof node === 'object' && !Array.isArray(node) ? (node as { data?: unknown }).data : undefined
  }
  if (op.op === 'update_node_data') return (op as { data?: unknown }).data
  return undefined
}

/**
 * 读取 op 的引用 id。
 * 空值 = 未引用（由调用方清理空字段）；非字符串 = 参数层错误。
 */
function roleAssetIdOf(op: PatchOp): string {
  const data = dataOfOp(op)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const raw = (data as { roleAssetId?: unknown }).roleAssetId
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') {
    throw new RoleRefError(`roleAssetId must be a string when provided (received ${JSON.stringify(raw)})`)
  }
  return raw.trim()
}

/** 清理显式给出的空 roleAssetId，避免空引用字段落盘。 */
function stripEmptyRoleAssetId(op: PatchOp): PatchOp {
  const data = dataOfOp(op)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return op
  if (!('roleAssetId' in (data as Record<string, unknown>))) return op
  const cleaned = { ...(data as Record<string, unknown>) }
  delete cleaned.roleAssetId
  return withData(op, cleaned)
}

/** 用新 data 构造同形状的 op（不改写入参）。 */
function withData(op: PatchOp, data: Record<string, unknown>): PatchOp {
  if (op.op === 'create_node') {
    const node = (op as { node: Record<string, unknown> }).node
    return { ...op, node: { ...node, data } } as unknown as PatchOp
  }
  return { ...op, data } as unknown as PatchOp
}

/** 把解析结果合并进 op：显式 data 覆盖资产值，引用字段与模型手写来源一律剥离。 */
function applyResolvedRole(op: PatchOp, resolved: ResolvedRole): PatchOp {
  const data = dataOfOp(op)
  const explicit = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...resolved.content, ...explicit }
  delete merged.roleAssetId
  // 来源只由展开层通过内部字段注入；模型手写的 sourceAssetId 仍按既有护栏剥离
  delete merged.sourceAssetId
  return {
    ...withData(op, merged),
    [ROLE_SOURCE_ASSET_ID_FIELD]: resolved.sourceAssetId,
  } as unknown as PatchOp
}

/** 读取角色资产（Active 版本）；缝缺失时引用失败。 */
function loadRoleAsset(host: RoleRefHost, assetId: string, caches: RoleRefCaches): Promise<RoleAssetDetail | null> {
  const assets = host.assets
  if (!assets) {
    return Promise.reject(new RoleRefError('role references are not available: the host did not provide the assets seam'))
  }
  return cachedOf(caches.roleAssets, assetId, () => assets.getRoleAsset(assetId))
}

/** 读取工作流资产（内联角色的容器）。 */
function loadWorkflowAsset(host: RoleRefHost, assetId: string, caches: RoleRefCaches): Promise<WorkflowAssetDetail | null> {
  const assets = host.assets
  if (!assets) {
    return Promise.reject(new RoleRefError('role references are not available: the host did not provide the assets seam'))
  }
  return cachedOf(caches.workflowAssets, assetId, () => assets.getWorkflowAsset(assetId))
}

/** 读取当前运行实例（单例事实；同批只取一次）。 */
function loadActiveRunFlow(host: RoleRefHost, sessionId: string, caches: RoleRefCaches): Promise<WorkflowDocument | null> {
  if (!host.getActiveRunFlow) {
    return Promise.reject(new RoleRefError('instance#<node id> is not available: the host did not provide the active-run seam'))
  }
  if (!caches.activeFlow) caches.activeFlow = host.getActiveRunFlow(sessionId)
  return caches.activeFlow
}

/**
 * 工作流资产内联角色的来源资产：优先按 roleVersionIds 回溯（目录骨架同口径），
 * 回溯不可用时回退节点自身的 data.sourceAssetId。
 *
 * 回溯是 best-effort：单条读失败只丢失来源标注，角色内容仍可复用——与
 * wf_org_catalog 对 roleVersionId 的降级方向一致。
 */
async function sourceAssetIdOfInlineNode(
  host: RoleRefHost,
  asset: WorkflowAssetDetail,
  nodeId: string,
  node: RoleNode,
  caches: RoleRefCaches,
): Promise<string> {
  const rowId = trimmedOrNull(
    (asset.roleVersionIds ?? []).find((ref) => String(ref?.nodeId ?? '') === nodeId)?.roleVersionId,
  ) ?? ''
  const reader = host.assets?.getRoleAssetVersion
  if (rowId && reader) {
    const detail = await cachedOf(caches.roleVersions, rowId, () => reader(rowId)).catch(() => null)
    const assetId = trimmedOrNull(detail?.assetId)
    if (assetId) return assetId
  }
  return trimmedOrNull((node.data as { sourceAssetId?: unknown }).sourceAssetId) ?? ''
}

/** 解析单个引用 id（取数 + 内容映射）。 */
async function resolveRoleOf(
  host: RoleRefHost,
  id: string,
  sessionId: string,
  caches: RoleRefCaches,
): Promise<ResolvedRole> {
  const ref = parseAssetId(id)
  if (!ref.ok) throw new RoleRefError(`roleAssetId "${id}" is not a supported id: ${ref.reason}`)
  if (ref.kind === 'workflow') {
    throw new RoleRefError(
      `roleAssetId "${id}" is a whole workflow asset, not a role; this patch supports role references only `
        + '(role-*, flow-*#<node id>, instance#<node id>) — graph skeleton copying is out of scope',
    )
  }
  if (ref.kind === 'instance') {
    throw new RoleRefError(`roleAssetId "${id}" is the running instance skeleton, not a role; use instance#<node id>`)
  }
  if (ref.kind === 'role') {
    const detail = await loadRoleAsset(host, ref.id, caches)
    if (!detail) {
      throw new RoleRefError(`role asset "${ref.id}" does not exist or has been retired; list ids with wf_org_catalog and pass roles[].id`)
    }
    if (detail.retired) {
      throw new RoleRefError(`role asset "${ref.id}" has been retired; recall a live role id from wf_org_catalog`)
    }
    if (detail.kind === 'parent') {
      throw new RoleRefError(`role asset "${ref.id}" is the parent agent's role; the parent agent's prompt is never recallable through wf_org_catalog`)
    }
    return { content: contentOfRoleAsset(detail), sourceAssetId: detail.assetId }
  }
  if (ref.kind === 'inlineRole') {
    const asset = await loadWorkflowAsset(host, ref.containerId, caches)
    if (!asset) {
      throw new RoleRefError(`workflow asset "${ref.containerId}" does not exist; recall a live flow id from wf_org_catalog`)
    }
    if (asset.retired) {
      throw new RoleRefError(`workflow asset "${ref.containerId}" has been retired; recall a live flow id from wf_org_catalog`)
    }
    const node = (asset.nodes ?? []).find((item) => item.id === ref.nodeId)
    if (!node) {
      throw new RoleRefError(`node "${ref.nodeId}" not found in workflow asset "${ref.containerId}"`)
    }
    if (node.kind !== 'agent') {
      throw new RoleRefError(
        `node "${ref.nodeId}" in workflow asset "${ref.containerId}" is ${node.kind}; `
          + "only agent role nodes can be reused (the parent agent's prompt is never recallable)",
      )
    }
    const sourceAssetId = await sourceAssetIdOfInlineNode(host, asset, ref.nodeId, node, caches)
    return { content: contentOfInlineRole(node), sourceAssetId }
  }
  // instanceRole
  if (!sessionId) {
    throw new RoleRefError('cannot identify the caller session; the running instance cannot be resolved')
  }
  const flow = await loadActiveRunFlow(host, sessionId, caches)
  if (!flow) {
    throw new RoleRefError(
      'no instance is running in this session, so its inline role cannot be recalled; '
        + 'use a role asset (role-*) or a workflow-asset inline role instead',
    )
  }
  const node = (flow.nodes ?? []).find((item) => item.id === ref.nodeId)
  if (!node) {
    throw new RoleRefError(`node "${ref.nodeId}" not found in the running instance`)
  }
  if (node.kind !== 'agent') {
    throw new RoleRefError(
      `node "${ref.nodeId}" in the running instance is ${node.kind}; `
        + "only agent role nodes can be reused (the parent agent's prompt is never recallable)",
    )
  }
  const sourceAssetId = trimmedOrNull((node.data as { sourceAssetId?: unknown }).sourceAssetId) ?? ''
  return { content: contentOfInlineRole(node), sourceAssetId }
}

/** 单条失败项（参数层：要修正的是 roleAssetId）。 */
function failureOf(index: number, op: PatchOp, message: string): PatchOpFailure {
  return { index, op: String((op as { op?: unknown }).op ?? ''), code: 'WF_BAD_ARGS', message }
}

/**
 * 展开一批补丁里的角色引用。
 *
 * 返回的 ops 与输入等长：成功项换成完整 data，失败项保持原样并由 skipped 标记，
 * 使调用方的错误索引仍与原批一致（apply 的容错应用逐条跳过失败项）。
 */
export async function expandRoleRefs(
  host: RoleRefHost,
  ops: PatchOp[],
  sessionId: string,
): Promise<RoleRefExpansion> {
  const errors: PatchOpFailure[] = []
  const skipped = new Set<number>()
  const expanded: PatchOp[] = []
  const caches: RoleRefCaches = {
    roleAssets: new Map(),
    workflowAssets: new Map(),
    roleVersions: new Map(),
  }
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]
    let refId: string
    try {
      refId = roleAssetIdOf(op)
    } catch (error) {
      if (!(error instanceof RoleRefError)) throw error
      errors.push(failureOf(index, op, error.message))
      skipped.add(index)
      expanded.push(op)
      continue
    }
    if (!refId) {
      expanded.push(stripEmptyRoleAssetId(op))
      continue
    }
    try {
      const resolved = await resolveRoleOf(host, refId, sessionId, caches)
      expanded.push(applyResolvedRole(op, resolved))
    } catch (error) {
      if (!(error instanceof RoleRefError)) throw error
      errors.push(failureOf(index, op, error.message))
      skipped.add(index)
      expanded.push(op)
    }
  }
  return { ops: expanded, errors, skipped }
}

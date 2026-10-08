// src/host/tools/wf-org-catalog/build.ts
//
// wf_org_catalog 的**纯函数装配层**：把工具层已取到的数据组装成索引/详情返回体。
// 不触盘、不读时钟、不读全局——同一入参必同输出（需要外部事实时一律经回调注入）。
//
// 关键契约（用户裁决）：骨架必须自足——不可二次召回的内容（阶段节点、协作组配置、
// 连线、数据节点正文与连接信息）一次性给全，保证「索引 + 多次详情召回」能拼出与
// 工作流资产等价的完整信息；**唯一按需召回的长字段是角色 systemPrompt**，由骨架里的
// 复合 id 指向。

import { labelOf } from '../../orchestrator/index.js'
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from '../../prompts/index.js'
import { GATE_MARKING_SEMANTICS, PATCH_CONTRACT_TEXT } from '../infrastructure/graph-op-contract.js'
import { CATALOG_LIMITS, ID_CONVENTION, INLINE_ROLE_SEPARATOR } from './types.js'
import type {
  CatalogComboEntry,
  CatalogDatabaseNodeEntry,
  CatalogFileNodeEntry,
  CatalogGroupNodeEntry,
  CatalogIndex,
  CatalogInlineRoleDetail,
  CatalogLineEntry,
  CatalogModelEntry,
  CatalogModelSource,
  CatalogNodeEntry,
  CatalogPresetEntry,
  CatalogPresetSource,
  CatalogProxyNodeEntry,
  CatalogRoleDetail,
  CatalogRoleNodeEntry,
  CatalogStageNodeEntry,
  CatalogWorkflowDetail,
  RoleAssetEntry,
  WorkflowAssetEntry,
} from './types.js'
import type {
  RoleAssetDetail,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetRoleRef,
  WorkflowAssetSummary,
} from '../../shared/asset-types.js'
import type { GraphNode, Line, RoleNode } from '../../shared/graph-model.js'

/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export const DETAIL_HINT =
  '索引里的资产只是**候选**（名称 / 描述 / 版本），完整内容必须再次调用本工具并传 ids 召回：'
  + '["flow-xxx"]=工作流资产完整骨架；["role-xxx"]=角色资产完整 systemPrompt；'
  + '["flow-xxx#node-yyy"]=该工作流资产内联角色固定引用版本的完整 systemPrompt。'
  + '骨架已含阶段节点、协作组配置、连线与数据节点正文（这些没有二次召回通道），'
  + '唯一按需召回的长字段是角色 systemPrompt。ids 中的坏 id 只单条报错，不影响其余。'

/** 骨架返回体里的提示：角色提示词走复合 id 按需召回；角色版本无法解析时的取舍。 */
export const WORKFLOW_DETAIL_NOTE =
  'nodes 中角色节点（kind=agent|parent）的 systemPrompt 未包含：按 inlineRoles 里的复合 id 逐个召回。'
  + 'roleAssetId / roleVersionId 是该节点固定引用的角色资产与版本；角色版本行已无法解析时这两个字段省略（骨架其余字段不受影响）。'

/** 数据库连接里不进模型上下文的密钥字段。 */
const SECRET_CONNECTION_KEYS = ['password'] as const

/** 文本截断（空白压缩 + 超限标注，供角色摘要等短字段使用）。 */
export function clip(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…（已截断）` : text
}

/** 数组预算：超限截断并返回是否截断。 */
function clipList<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
  return items.length > limit ? { items: items.slice(0, limit), truncated: true } : { items, truncated: false }
}

/** 宽松字符串化（null/undefined → 空串）。 */
function textOf(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** 非空 trim 后字符串（无内容返回 null，便于按需省略字段）。 */
function trimmedOrNull(value: unknown): string | null {
  const text = textOf(value).trim()
  return text ? text : null
}

/**
 * 节点 → 角色资产引用的解析结果。
 * `assetId` 为 null 表示角色版本行存在但无法回溯到资产 id（历史数据残缺）：
 * 此时只给 versionId，让模型至少知道「这个节点钉的是哪一版」。
 */
export interface ResolvedRoleRef {
  assetId: string | null
  versionId: number
}

/** 组装资产索引（第一次调用）。 */
export function buildIndex(input: {
  workflows: WorkflowAssetSummary[]
  roles: RoleAssetSummary[]
  combos: Array<Record<string, unknown>>
  presets: CatalogPresetSource[]
  models: CatalogModelSource[]
}): CatalogIndex {
  const workflowEntries = input.workflows.map(workflowAssetEntryOf).filter((entry) => entry.id)
  const roleEntries = input.roles.map(roleAssetEntryOf).filter((entry) => entry.id)
  const comboEntries = input.combos.map(comboEntryOf).filter((entry) => entry.id)
  const presetEntries = input.presets.map(presetEntryOf).filter((entry) => entry.id)
  const modelEntries = input.models.map(modelEntryOf).filter((entry) => entry.provider || entry.model)
  const workflows = clipList(workflowEntries, CATALOG_LIMITS.workflowAssets)
  const roles = clipList(roleEntries, CATALOG_LIMITS.roleAssets)
  const combos = clipList(comboEntries, CATALOG_LIMITS.combos)
  const presets = clipList(presetEntries, CATALOG_LIMITS.presets)
  const models = clipList(modelEntries, CATALOG_LIMITS.models)
  return {
    kind: 'index',
    idConvention: ID_CONVENTION,
    detailHint: DETAIL_HINT,
    combos: combos.items,
    presets: presets.items,
    models: models.items,
    assets: { workflows: workflows.items, roles: roles.items },
    rules: {
      graphSemantics: ORG_SOP_L1_GRAPH_SEMANTICS,
      designMethod: ORG_SOP_DESIGN_METHOD,
      patchContract: PATCH_CONTRACT_TEXT,
      gateMarking: GATE_MARKING_SEMANTICS,
    },
    truncated:
      workflows.truncated
      || roles.truncated
      || combos.truncated
      || presets.truncated
      || models.truncated,
  }
}

function workflowAssetEntryOf(asset: WorkflowAssetSummary): WorkflowAssetEntry {
  const id = textOf(asset.assetId)
  return {
    id,
    name: trimmedOrNull(asset.name) ?? id,
    description: textOf(asset.description),
    versionId: Number(asset.versionId) || 0,
  }
}

/**
 * 角色资产索引条目。
 * 摘要是「够不够拿来参考」的判据，由资产库在列表查询里 JOIN 当前 Active 版本行产出
 * （systemPrompt 前 60 字 + 截断标记，见 `src/host/assets/role-assets.ts`），此处**原样透传**：
 * 两侧各自截断会让 `…（已截断）` 标记叠加。摘要缺失即空串（不编造职责描述），
 * 完整提示词始终可按 id 召回。
 */
function roleAssetEntryOf(asset: RoleAssetSummary): RoleAssetEntry {
  const id = textOf(asset.assetId)
  return {
    id,
    name: trimmedOrNull(asset.name) ?? id,
    kind: asset.kind === 'parent' ? 'parent' : 'agent',
    versionId: Number(asset.versionId) || 0,
    roleAssetType: roleAssetTypeOf(asset.roleAssetType),
    summary: textOf(asset.summary),
  }
}

/**
 * 角色资产类型收窄。
 * 未知值按 `standalone` 处理：与资产模块对「未知 role_asset_type」的降级方向一致
 * （同一事实的两处收窄不得给出不同答案）。
 */
function roleAssetTypeOf(value: unknown): RoleAssetEntry['roleAssetType'] {
  if (value === 'inline' || value === 'shared') return value
  return 'standalone'
}

/**
 * 组合条目：工具清单**不截断**——组合 id 是节点 presetId 的唯一取值来源，
 * 截断会让父代理基于残缺工具集选错组合。
 */
function comboEntryOf(combo: Record<string, unknown>): CatalogComboEntry {
  return {
    id: textOf(combo.id),
    name: textOf(combo.name),
    tools: Array.isArray(combo.tools) ? (combo.tools as unknown[]).map(textOf).filter(Boolean) : [],
    mcpServers: Array.isArray(combo.mcpServers) ? (combo.mcpServers as unknown[]).map(textOf).filter(Boolean) : [],
  }
}

function presetEntryOf(preset: CatalogPresetSource): CatalogPresetEntry {
  const description = textOf(preset.description).trim()
  return {
    id: textOf(preset.id),
    name: textOf(preset.name) || textOf(preset.id),
    ...(description ? { description } : {}),
  }
}

function modelEntryOf(model: CatalogModelSource): CatalogModelEntry {
  const efforts = Array.isArray(model.efforts)
    ? model.efforts
      .map((effort) => ({ id: textOf(effort?.id), name: textOf(effort?.name) || textOf(effort?.id) }))
      .filter((effort) => effort.id)
    : []
  return {
    provider: textOf(model.provider),
    model: textOf(model.model),
    ...(efforts.length > 0 ? { efforts } : {}),
  }
}

/**
 * 节点 → 角色版本行引用映射。
 * 工作流资产的节点内容由角色版本行 join 而来，引用清单是节点与角色资产之间唯一的
 * 对应关系；同一节点出现多条引用时取首条（AssetStore 按节点唯一写入，多条属脏数据）。
 */
function roleRefMapOf(refs: WorkflowAssetRoleRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const ref of refs ?? []) {
    const nodeId = textOf(ref?.nodeId).trim()
    const rowId = textOf(ref?.roleVersionId).trim()
    if (nodeId && rowId && !map.has(nodeId)) map.set(nodeId, rowId)
  }
  return map
}

/** 组装工作流资产骨架（`flow-*` 的返回体）。 */
export function buildWorkflowDetail(
  asset: WorkflowAssetDetail,
  roleRefOf?: (roleRowId: string) => ResolvedRoleRef | null,
): CatalogWorkflowDetail {
  const nodes = (asset.nodes ?? []) as GraphNode[]
  const id = textOf(asset.assetId)
  const refs = roleRefMapOf(asset.roleVersionIds)
  const roleNodeEntryOf = (node: RoleNode): CatalogRoleNodeEntry => {
    const rowId = refs.get(node.id)
    const resolved = rowId && roleRefOf ? roleRefOf(rowId) : null
    return roleNodeEntry(node, resolved?.assetId ?? undefined, resolved?.versionId)
  }
  return {
    type: 'workflow',
    id,
    assetId: id,
    versionId: Number(asset.versionId) || 0,
    name: trimmedOrNull(asset.name) ?? id,
    description: textOf(asset.description),
    mode: asset.mode === 'mode2' ? 'mode2' : 'mode1',
    ...(asset.meta && Object.keys(asset.meta).length > 0 ? { meta: asset.meta } : {}),
    nodes: nodes.map((node) => nodeEntryOf(node, roleNodeEntryOf)),
    lines: (asset.lines ?? []).map(lineEntryOf),
    inlineRoles: nodes
      .filter((node) => node.kind === 'agent' || node.kind === 'parent')
      .map((node) => `${id}${INLINE_ROLE_SEPARATOR}${node.id}`),
    note: WORKFLOW_DETAIL_NOTE,
  }
}

/** 组装角色资产详情（systemPrompt 完整返回，不截断）。 */
export function buildRoleDetail(asset: RoleAssetDetail): CatalogRoleDetail {
  const id = textOf(asset.assetId)
  const reasoning = trimmedOrNull(asset.reasoning)
  const promptSource = trimmedOrNull(asset.systemPromptSource)
  return {
    type: 'role',
    id,
    assetId: id,
    versionId: Number(asset.versionId) || 0,
    roleAssetType: roleAssetTypeOf(asset.roleAssetType),
    name: trimmedOrNull(asset.name) ?? id,
    kind: asset.kind === 'parent' ? 'parent' : 'agent',
    presetId: trimmedOrNull(asset.presetId),
    provider: textOf(asset.provider),
    model: textOf(asset.model),
    ...(reasoning ? { reasoning } : {}),
    inputSchema: textOf(asset.inputSchema),
    outputSchema: textOf(asset.outputSchema),
    ...(promptSource ? { systemPromptSource: promptSource } : {}),
    systemPrompt: textOf(asset.systemPrompt),
  }
}

/**
 * 组装工作流资产内联角色详情（标明所属工作流与节点，避免多角色召回时混淆）。
 * 内容来自该节点在角色资产里的**固定引用版本**（不是该资产的 Active 版本）。
 */
export function buildInlineRoleDetail(input: {
  containerId: string
  node: RoleNode
  roleAssetId?: string
  roleVersionId?: number
}): CatalogInlineRoleDetail {
  const data = input.node.data
  const reasoning = trimmedOrNull(data.reasoning)
  const promptSource = trimmedOrNull(data.systemPromptSource)
  return {
    type: 'inlineRole',
    id: `${input.containerId}${INLINE_ROLE_SEPARATOR}${input.node.id}`,
    containerId: input.containerId,
    nodeId: input.node.id,
    ...(input.roleAssetId ? { roleAssetId: input.roleAssetId } : {}),
    ...(input.roleVersionId !== undefined ? { roleVersionId: input.roleVersionId } : {}),
    label: textOf(data.label),
    presetId: trimmedOrNull(data.presetId),
    provider: textOf(data.provider),
    model: textOf(data.model),
    ...(reasoning ? { reasoning } : {}),
    inputSchema: textOf(data.inputSchema),
    outputSchema: textOf(data.outputSchema),
    groupId: data.groupId ?? null,
    ...(promptSource ? { systemPromptSource: promptSource } : {}),
    systemPrompt: textOf(data.systemPrompt),
  }
}

/**
 * 数据库连接脱敏：密钥字段替换为占位符，其余字段原样保留（保证资产可复用）。
 * 为什么必须脱敏：连接信息没有二次召回通道，必须一次性给出；而密码一旦进入模型
 * 上下文与对话历史就无法收回。
 */
export function maskConnection(conn: unknown): Record<string, unknown> | undefined {
  if (!conn || typeof conn !== 'object' || Array.isArray(conn)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(conn as Record<string, unknown>)) {
    out[key] = SECRET_CONNECTION_KEYS.includes(key as (typeof SECRET_CONNECTION_KEYS)[number]) ? '**' : value
  }
  return out
}

/** 角色节点条目（不可召回字段给全；systemPrompt 走复合 id 按需召回）。 */
function roleNodeEntry(node: RoleNode, roleAssetId?: string, roleVersionId?: number): CatalogRoleNodeEntry {
  const data = node.data
  const reasoning = trimmedOrNull(data.reasoning)
  const promptSource = trimmedOrNull(data.systemPromptSource)
  return {
    id: node.id,
    kind: node.kind,
    label: labelOf(node),
    presetId: trimmedOrNull(data.presetId),
    provider: textOf(data.provider),
    model: textOf(data.model),
    ...(reasoning ? { reasoning } : {}),
    inputSchema: textOf(data.inputSchema),
    outputSchema: textOf(data.outputSchema),
    ...(promptSource ? { systemPromptSource: promptSource } : {}),
    groupId: data.groupId ?? null,
    ...(roleAssetId ? { roleAssetId } : {}),
    ...(roleVersionId !== undefined ? { roleVersionId } : {}),
  }
}

/** 节点条目（按 kind 判别；字段取舍见 CatalogNodeEntry 的说明）。 */
function nodeEntryOf(
  node: GraphNode,
  roleNodeEntryOf: (node: RoleNode) => CatalogRoleNodeEntry,
): CatalogNodeEntry {
  switch (node.kind) {
    case 'start':
    case 'end':
    case 'pause': {
      const entry: CatalogStageNodeEntry = { id: node.id, kind: node.kind, label: labelOf(node) }
      return entry
    }
    case 'agent':
    case 'parent':
      return roleNodeEntryOf(node)
    case 'proxy': {
      const entry: CatalogProxyNodeEntry = {
        id: node.id,
        kind: 'proxy',
        label: textOf(node.data?.label) || node.proxySourceId,
        proxySourceId: node.proxySourceId,
        role: node.data?.role === 'milestone' ? 'milestone' : 'executor',
      }
      return entry
    }
    case 'group': {
      const entry: CatalogGroupNodeEntry = {
        id: node.id,
        kind: 'group',
        label: labelOf(node),
        collabPrompt: textOf(node.data.collabPrompt),
        memberIds: Array.isArray(node.data.memberIds) ? node.data.memberIds.map(textOf) : [],
      }
      return entry
    }
    case 'file': {
      const data = node.data
      const entry: CatalogFileNodeEntry = {
        id: node.id,
        kind: 'file',
        label: labelOf(node),
        fileKind: data.fileKind === 'file' ? 'file' : 'text',
        ...(data.content !== undefined ? { content: textOf(data.content) } : {}),
        ...(data.fileName !== undefined ? { fileName: textOf(data.fileName) } : {}),
        ...(data.managedPath !== undefined ? { managedPath: textOf(data.managedPath) } : {}),
        ...(Array.isArray(data.files)
          ? { files: data.files.map((file) => ({ fileName: textOf(file.fileName), managedPath: textOf(file.managedPath) })) }
          : {}),
      }
      return entry
    }
    case 'database': {
      const data = node.data
      const conn = maskConnection(data.conn)
      const entry: CatalogDatabaseNodeEntry = {
        id: node.id,
        kind: 'database',
        label: labelOf(node),
        description: textOf(data.description),
        dbType: data.dbType === 'server' ? 'server' : 'local',
        dbKind: textOf(data.dbKind),
        ...(data.localPath !== undefined ? { localPath: textOf(data.localPath) } : {}),
        ...(conn ? { conn } : {}),
        ...(trimmedOrNull(data.vectorSource) ? { vectorSource: textOf(data.vectorSource) } : {}),
        ...(data.vectorOptions ? { vectorOptions: data.vectorOptions as Record<string, unknown> } : {}),
      }
      return entry
    }
  }
}

/** 连线条目（条件分支语义是编排事实，必须给全）。 */
function lineEntryOf(line: Line): CatalogLineEntry {
  const condition = line.condition?.type
  return {
    id: line.id,
    source: line.source,
    target: line.target,
    sourceHandle: line.sourceHandle,
    targetHandle: line.targetHandle,
    ...(condition
      ? { condition: { type: condition, ...(line.condition?.label ? { label: line.condition.label } : {}) } }
      : {}),
  }
}

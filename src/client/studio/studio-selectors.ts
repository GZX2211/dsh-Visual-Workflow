// src/client/studio/studio-selectors.ts
//
// 工作台状态机选择器（纯函数，派生数据）：当前工作流/模板/服务文档、
// 运行状态判定与编辑器渲染数据。组件与 hooks 消费；Inspector 按
// editorData 的 kind 分发表单。

import type { StudioState, EditorData, CanvasNode } from './studio-types.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import type { WorkflowAssetDetail } from '../../host/shared/asset-types.js'

/** 当前工作流文档（内存列表优先；草稿回退）。 */
export function currentFlowOf(state: StudioState): WorkflowDocument | null {
  if (state.currentKind !== 'workflow' || !state.currentId) return null
  return state.workflows.find((flow) => flow.id === state.currentId) ?? null
}

/** 当前工作流模板文档（模板态画布）。 */
export function currentFlowTemplateOf(state: StudioState): WorkflowTemplate | null {
  if (state.currentKind !== 'flowTemplate' || !state.currentId) return null
  return state.flowTemplates.find((template) => template.id === state.currentId) ?? null
}

/** 当前工作流资产文档（资产态画布；当前 id 必须与已装载的 assetDoc 同源）。 */
export function currentFlowAssetOf(state: StudioState): WorkflowAssetDetail | null {
  if (state.currentKind !== 'flowAsset' || !state.currentId) return null
  return state.assetDoc?.assetId === state.currentId ? state.assetDoc : null
}

/**
 * 模板态与资产态共用「创建实例」前置（实例只能由模版/资产生成）：
 * 二者画布内容语义一致（编辑中的草稿 → 保存为实例），运行入口也走同一分支。
 */
export function isInstanceSourceKind(kind: StudioState['currentKind']): boolean {
  return kind === 'flowTemplate' || kind === 'flowAsset'
}

/** 当前服务文档。 */
export function currentServiceOf(state: StudioState): ServiceState | null {
  if (state.currentKind !== 'service' || !state.currentId) return null
  return state.services.find((service) => service.id === state.currentId) ?? null
}

/**
 * P4：当前文档里「父代理最近一次补丁」（origin='agent'）改动的节点 id。
 * 用途：画布给这些节点加「AI 调整」角标，让用户理解画布为何变了。
 * 语义边界：用户一旦在画布上保存，宿主侧的 stripClientMeta 会清除 lastPatch
 * （客户端快照里本来就没有该字段），所以角标只反映「尚未被用户确认的代理改动」。
 * 纯函数；非法/缺失一律返回空数组（旧数据零影响）。
 */
export function agentPatchedNodeIdsOf(state: StudioState): string[] {
  const doc = currentFlowTemplateOf(state) ?? currentFlowOf(state) ?? currentServiceOf(state)
  const patch = (doc as { lastPatch?: { nodeIds?: unknown } } | null | undefined)?.lastPatch
  const raw = Array.isArray(patch?.nodeIds) ? (patch?.nodeIds as unknown[]) : []
  return [...new Set(raw.map((id) => String(id ?? '')).filter(Boolean))]
}

/** 当前运行状态（running 判定）。 */
export function isRunningOf(state: StudioState): boolean {
  return state.run.snapshot?.status === 'running' || (state.run.runId !== null && state.run.snapshot === null)
}

/**
 * 当前**实例**是否处于「运行中」（模式一；运行中实例的保存二次确认与画布锁定共用）。
 * 判定来源双保险：① 当前跟踪的 run 快照（flowId 必须等于当前实例，避免跟踪到别的实例）；
 * ② 全量活跃 run 摘要轮询（跨会话/外部触发也能判定）。
 * 模式二按用户裁决保持现状（服务常驻运行，无「运行中画布」语义），恒为 false。
 * 暂停（paused）不算运行中：暂停时保存既不弹确认、也不锁画布。
 */
export function instanceRunningOf(state: StudioState): boolean {
  if (state.mode !== 'mode1') return false
  if (state.currentKind !== 'workflow') return false
  const flow = currentFlowOf(state)
  if (!flow) return false
  const tracked = state.run.snapshot
  if (tracked && tracked.status === 'running' && tracked.flowId === flow.id) return true
  return state.activeRuns.some((item) => item.flowId === flow.id && item.sessionId === flow.sessionId && item.status === 'running')
}

/**
 * 活跃 run 摘要的投影类型：实例列表状态徽标（全量活跃 run → 按实例定位）。
 * 投影与索引都保留 runId/sessionId——徽标之外的运行对账（Studio）也消费同一份索引。
 */
export interface ActiveRunBadge {
  status: string
  runId: string
  sessionId: string
}

/** 单个实例的索引键：flowId + sessionId（同一实例可被多个会话持有同名 id，必须带会话维度）。 */
function activeRunIndexKey(flowId: string, sessionId: string): string {
  return `${flowId}\u0000${sessionId}`
}

/**
 * 活跃 run 摘要 → 以「实例（flowId+sessionId）」为键的索引，供实例列表按实例 O(1) 取状态徽标
 * （此前每实例一次全量 `activeRuns.find` 线性查找，n 个实例即 n 次全表扫描）。
 * 纯函数：输入即全部事实，不读全局；同一 key 重复出现时以最后一条为准（列表顺序即权威）。
 * 只丢弃缺 flowId 的脏条目（无法归属实例）——其余字段缺失按空串降级，不改变既有展示口径。
 */
export function activeRunIndexOf(state: StudioState): Map<string, ActiveRunBadge> {
  const index = new Map<string, ActiveRunBadge>()
  for (const item of state.activeRuns) {
    const flowId = String(item?.flowId ?? '')
    if (!flowId) continue
    const sessionId = String(item?.sessionId ?? '')
    const status = String(item?.status ?? '')
    const runId = String(item?.runId ?? '')
    index.set(activeRunIndexKey(flowId, sessionId), { status, runId, sessionId })
  }
  return index
}

/** 实例 → 运行徽标（activeRunIndex 键）；无活跃 run 返回 null。 */
export function activeRunBadgeOf(
  index: ReadonlyMap<string, ActiveRunBadge>,
  flowId: string,
  sessionId: string,
): ActiveRunBadge | null {
  return index.get(activeRunIndexKey(flowId, sessionId)) ?? null
}

/** 实例列表的运行状态徽标数据源（左栏/底栏共用；`currentSnapshot` 为该实例的更即时快照）。 */
export interface InstanceRunBadge {
  /** 活跃 run 摘要（来自全量轮询）；null = 无活跃 run。 */
  active: ActiveRunBadge | null
  /** 当前跟踪 run 快照的 status（仅当快照属于该实例）；无法判定当前实例时为 null。 */
  currentSnapshot: string | null
}

/**
 * 按实例投影运行状态徽标（渲染层不再做全量线性查找）：**一次**扫描活跃 run 建索引
 * （O(n+m)），逐实例只做一次 Map 查询。顺序与入参一致，不改变已有语义：
 * 快照优先于活跃摘要由消费方（实例列表）按既有口径决定。
 */
export function instanceRunBadgesOf(
  flows: ReadonlyArray<{ id: string; sessionId: string }>,
  current: { runId: string | null; snapshot: { flowId: string; status: string } | null },
  index: ReadonlyMap<string, ActiveRunBadge>,
): Map<string, InstanceRunBadge> {
  const out = new Map<string, InstanceRunBadge>()
  for (const flow of flows) {
    const active = activeRunBadgeOf(index, flow.id, flow.sessionId)
    const currentSnapshot = current.runId !== null && current.snapshot?.flowId === flow.id
      ? current.snapshot.status
      : null
    out.set(flow.id, { active, currentSnapshot })
  }
  return out
}

/**
 * 协作组成员显示名（唯一本体）：成员节点缺失或 label 缺失/为 null 时回退成员 id。
 * 画布 协作组卡片（GraphCanvas）与右侧属性栏（editorDataOf）共用，避免两处各写一份回退规则。
 * 只接受已解析出的成员节点，节点的查找方式（Map / find）由调用方决定。
 */
export function memberLabelOf(member: CanvasNode | undefined, memberId: string): string {
  return String((member?.data as { label?: unknown } | undefined)?.label ?? memberId)
}

/**
 * 领域对象 → 属性栏表单数据源（EditorData.data 是字符串键表单数据）。
 * 逐键拷贝而非 `as unknown as Record<string, unknown>` 双重断言：断言会完全绕过类型检查、
 * 掩盖数据模型不一致（同 studio-types.ts 的 Drafted<T> 取舍）。
 */
function formDataOf(value: object): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = item
  return result
}

/** 编辑器数据（右侧面板渲染源）。 */
export function editorDataOf(state: StudioState): EditorData | null {
  const editor = state.editor
  if (!editor) return null
  if (editor.source === 'workflow') {
    const flow = state.workflows.find((item) => item.id === editor.id)
    return flow
      ? { kind: 'workflow', data: { name: flow.name, description: flow.description }, name: flow.name }
      : null
  }
  if (editor.source === 'flowTemplate') {
    const template = state.flowTemplates.find((item) => item.id === editor.id)
    return template
      ? { kind: 'workflow', data: { name: template.name, description: template.description }, name: template.name, template: true, templateId: template.id }
      : null
  }
  if (editor.source === 'flowAsset') {
    const detail = state.assetDoc
    if (!detail || detail.assetId !== editor.id) return null
    return {
      kind: 'workflow',
      data: { name: detail.name, description: detail.description },
      name: detail.name,
      asset: true,
      assetId: detail.assetId,
      ...(detail.retired === true ? { retired: true } : {}),
    }
  }
  if (editor.source === 'roleAsset') {
    const detail = state.assetRoleDoc
    if (!detail || detail.assetId !== editor.id) return null
    // 角色资产详情与 RoleTemplate 字段同域：直接作为属性栏 role 表单的数据源投影
    return {
      kind: 'role',
      data: formDataOf(detail),
      name: detail.name,
      isParent: detail.kind === 'parent',
      roleAsset: true,
      assetId: detail.assetId,
      ...(detail.retired === true ? { retired: true } : {}),
    }
  }
  if (editor.source === 'experience') {
    const entry = state.experienceDoc
    if (!entry || entry.id !== editor.id) return null
    // 经验字段域与属性栏表单一一对应：直接作为表单数据源投影；非活跃 = 已归档（显示「恢复」）
    return {
      kind: 'experience',
      data: formDataOf(entry),
      name: entry.responsibility,
      experience: true,
      experienceId: entry.id,
      ...(entry.active ? {} : { retired: true }),
    }
  }
  if (editor.source === 'service') {
    const service = state.services.find((item) => item.id === editor.id)
    return service
      ? { kind: 'service', data: { name: service.name, description: service.description }, name: service.name }
      : null
  }
  if (editor.source === 'template') {
    const template = state.templates[editor.kind].find((item) => item.id === editor.id)
    if (!template) return null
    const kind0 = editor.kind
    return {
      kind: kind0,
      data: formDataOf(template),
      name: String((template as { name?: unknown }).name ?? ''),
      templateId: template.id,
      template: true,
      isParent: kind0 === 'role' && (template as { kind?: unknown }).kind === 'parent',
    }
  }
  if (editor.source === 'node') {
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    if (!node) return null
    const data = node.data
    if (node.kind === 'parent' || node.kind === 'agent') {
      // sourceAssetId 是「画布角色节点绑定到某个角色资产」的唯一事实（拖入资产时写入）：
      // 属性栏据此决定是否给出与左侧栏一致的回滚按钮
      const sourceAssetId = typeof data.sourceAssetId === 'string' ? data.sourceAssetId : ''
      return {
        kind: 'role',
        data,
        name: String(data.label ?? ''),
        nodeId: node.id,
        isParent: node.kind === 'parent',
        ...(sourceAssetId === '' ? {} : { sourceAssetId }),
      }
    }
    if (node.kind === 'file') return { kind: 'file', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'database') return { kind: 'database', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'group') {
      // 去重展示（历史数据可能残留重复 memberIds），与删除逻辑保持一致，避免出现「重复成员行/计数虚高」
      const memberIds = [...new Set((data.memberIds as string[] | undefined) ?? [])]
      const members = memberIds.map((memberId) => ({
        id: memberId,
        label: memberLabelOf(state.canvas.nodes.find((item) => item.id === memberId), memberId),
      }))
      return { kind: 'group', data, name: String(data.label ?? ''), nodeId: node.id, members }
    }
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') return { kind: 'stage', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'proxy') {
      const sourceId = String((node as { proxySourceId?: unknown }).proxySourceId ?? '')
      const main = state.canvas.nodes.find((item) => item.id === sourceId)
      return {
        kind: 'proxy',
        data,
        name: '',
        nodeId: node.id,
        mainLabel: String((main?.data as { label?: unknown } | undefined)?.label ?? ''),
      }
    }
    return { kind: 'role', data, name: String(data.label ?? ''), nodeId: node.id }
  }
  if (editor.source === 'edge') {
    const edge = state.canvas.edges.find((item) => item.id === editor.id)
    return edge ? { kind: 'edge', data: formDataOf(edge), name: '' } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// 折叠切换循环（3 态）与面板显隐推导
// ---------------------------------------------------------------------------

/** 折叠/切换循环长度（共 3 态：左展开→切换底栏→收起底栏→左展开）。 */
export const PANEL_CYCLE_LEN = 3
/** 循环位置枚举：0=左栏展开 1=底栏展开 2=收起底栏/左栏(全隐)。 */
export const PANEL_MODE_LEFT = 0
export const PANEL_MODE_BOTTOM = 1
export const PANEL_MODE_NONE = 2

/** 折叠/切换下一步循环位置（左展→切换底栏→收起底栏→左展）。 */
export function nextPanelMode(mode: number): number {
  return (mode + 1) % PANEL_CYCLE_LEN
}

/** 左栏是否展开（循环位置 0）。 */
export function leftPanelOpenOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_LEFT
}

/** 底栏是否展开（循环位置 1）。 */
export function bottomPanelOpenOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_BOTTOM
}

/** 是否处于「全隐」态（循环位置 2：收起底栏/左栏，仅画布）。 */
export function panelsFullyCollapsedOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_NONE
}

/**
 * 右侧属性栏是否显示：默认隐藏（折叠），仅当选中「具备属性」的对象时才展开。
 * 判定 = 编辑对象存在且其属性栏类型不是「阶段」（阶段节点/侧栏阶段卡片不具备属性，不弹）；
 * 其余（实例/工作流/服务/模板/角色/文件/数据库/Team/连线/画布角色节点含父代理节点/虚拟节点）都弹。
 * 注意：父代理模板也具备属性（属性栏显示模板内容），此处一并弹出。
 */
export function inspectorOpenOf(state: StudioState): boolean {
  const data = editorDataOf(state)
  return data != null && data.kind !== 'stage'
}

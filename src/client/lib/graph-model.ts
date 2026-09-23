// src/client/lib/graph-model.ts
//
// Client 图模型（照搬旧项目 src/client/graph-model.js 的算法与结构，TS 化 + 新数据模型适配）：
//   - 节点种类 parent/agent/file/database/start/end/pause/group/proxy（共享类型 GraphNode）；
//   - 连线 lines 携带 condition{type,label}，颜色按连线类型（流程/上下文/数据库/条件）；
//   - 模板 → 节点深拷贝解耦（拖入即快照，无 templateId 引用，需求 §4.2.1）。
// 类型仅引用 src/host/shared/graph-model.ts（纯类型层，零运行时 import）。

import type { GraphNode, Line, NodeKind, WorkflowDocument } from '../../host/shared/graph-model.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate, RunSnapshot } from '../../host/shared/types.js'
import { tidyNodes } from './layout-fit.js'
import type { LayoutBoxNode } from './layout-fit.js'
import { groupCardSizeOf } from './card-geometry.js'

// ---------------------------------------------------------------------------
// 连接点表（与 Host graph/model.ts 保持一致的客户端镜像）
// ---------------------------------------------------------------------------

type HandleSpec = { inputs: string[]; outputs: string[] }

export const HANDLES: Record<string, HandleSpec> = {
  parent: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  agent: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  proxy: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  file: { inputs: [], outputs: ['ctx-out'] },
  database: { inputs: [], outputs: ['db-out'] },
  // 输入/输出节点仅保留一个流程连接点（用户验收标注：连接点多了，应当只有一个；
  // 外部问题已自动注入输入节点，流式返回不依赖输出节点 ctx 连线）
  start: { inputs: [], outputs: ['flow-out'] },
  end: { inputs: ['flow-in'], outputs: [] },
  pause: { inputs: ['flow-in'], outputs: ['flow-out'] },
  group: { inputs: ['flow-in'], outputs: ['flow-out'] },
}

/** 阶段节点显示名（模式一：启动/结束；模式二：输入/输出，需求 §4.2.5.1）。 */
export function stageLabels(mode: string): { start: string; end: string; pause: string } {
  const isMode2 = mode === 'mode2'
  return { start: isMode2 ? '输入' : '启动', end: isMode2 ? '输出' : '结束', pause: '暂停' }
}

/** 阶段节点固定卡片（模式二没有暂停，需求 §4.2.5.1 规则 1/2）。 */
export function stageTemplateKinds(mode: string): Array<{ kind: NodeKind; label: string }> {
  const labels = stageLabels(mode)
  const out: Array<{ kind: NodeKind; label: string }> = [
    { kind: 'start', label: labels.start },
    { kind: 'end', label: labels.end },
  ]
  if (mode !== 'mode2') out.push({ kind: 'pause', label: labels.pause })
  return out
}

export function defaultOutputHandle(kind: string): string {
  const def = HANDLES[kind] ?? HANDLES.agent
  return def.outputs[def.outputs.length - 1] ?? 'flow-out'
}

export function defaultInputHandle(kind: string): string {
  const def = HANDLES[kind] ?? HANDLES.agent
  return def.inputs[def.inputs.length - 1] ?? 'flow-in'
}

// ---------------------------------------------------------------------------
// 画布视图类型
// ---------------------------------------------------------------------------

/** 画布节点 = 存储节点（节点 JSON 即事实源）+ 视图补充字段。 */
export type CanvasNode = GraphNode

/** 画布连线 = 存储连线 + 视图补充（颜色 class / 显示标签）。 */
export type CanvasLine = Line & { lineType: string; label: string }

/** 条件连线标签（需求 §4.3 连线类型表）。 */
export function conditionLabel(condition: Line['condition'] | null | undefined): string {
  if (!condition) return ''
  if (condition.type === 'pass') return '[通过]'
  if (condition.type === 'fail') return '[不通过]'
  if (condition.type === 'content') return `[${String(condition.label ?? '内容').slice(0, 12)}]`
  return ''
}

/**
 * 连线颜色 class（条件 pass|fail|content / 通道 db / ctx / 默认 flow 空串）。
 * 优先级（用户裁决 2026-02）：**条件优先**——用户显式设了条件就显示条件颜色，
 * 否则按通道着色。画布渲染与 flowToCanvasLines 共用本函数（唯一本体）。
 */
export function lineColorClass(line: Line): string {
  const condition = line?.condition?.type
  if (condition === 'pass') return 'is-pass'
  if (condition === 'fail') return 'is-fail'
  if (condition === 'content') return 'is-content'
  const sourceHandle = line?.sourceHandle ?? ''
  const targetHandle = line?.targetHandle ?? ''
  if (sourceHandle === 'db-out' || targetHandle === 'db-in') return 'is-db'
  if (sourceHandle === 'ctx-out' || targetHandle === 'ctx-in') return 'is-ctx'
  return ''
}

// ---------------------------------------------------------------------------
// 模板 → 画布节点（深拷贝解耦：拖入时拷贝一份，此后与模板无引用，§4.2.1）
// ---------------------------------------------------------------------------

export type TemplateKind = 'role' | 'file' | 'database'
export type TemplateMap = Map<string, RoleTemplate | FileTemplate | DatabaseTemplate>

/** 模板映射：{ role: Map, file: Map, database: Map }（id → 模板）。 */
export function templatesToMaps(
  roleTemplates: RoleTemplate[] | null | undefined,
  fileTemplates: FileTemplate[] | null | undefined,
  databaseTemplates: DatabaseTemplate[] | null | undefined,
): Record<TemplateKind, TemplateMap> {
  return {
    role: new Map((roleTemplates ?? []).map((template) => [template.id, template])),
    file: new Map((fileTemplates ?? []).map((template) => [template.id, template])),
    database: new Map((databaseTemplates ?? []).map((template) => [template.id, template])),
  }
}

/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/file/database；传入 GroupTemplate 时按 None 处理（协作组模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export function templateToNodeData(
  kind: 'role' | 'file' | 'database',
  template: RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate | null | undefined,
): Record<string, unknown> | null {
  if (!template) return null
  const label = String(template.name ?? '').trim() ? String(template.name) : ''
  if (kind === 'role') {
    const role = template as RoleTemplate
    return {
      label,
      systemPrompt: String(role.systemPrompt ?? ''),
      provider: String(role.provider ?? ''),
      model: String(role.model ?? ''),
      reasoning: (role.reasoning as string | null | undefined) ?? null,
      presetId: role.presetId ?? 'standard',
      retryLimit: Number(role.retryLimit ?? 3),
      reactLimit: role.reactLimit ?? null,
      inputSchema: String(role.inputSchema ?? ''),
      outputSchema: String(role.outputSchema ?? ''),
      injectSystemPrompt: role.injectSystemPrompt !== false,
      injectToolSections: role.injectToolSections !== false,
      promptFilePath: String(role.promptFilePath ?? '') || undefined,
      groupId: null,
    }
  }
  if (kind === 'file') {
    const file = template as FileTemplate
    const managedPath = String(file.managedPath ?? '')
    // files 列表（多选）优先；兼容单选旧字段（fileName/managedPath）——
    // 拖入画布的数据形状以本函数为唯一实现（后端曾有的同名映射已随 storage 模块治理
    // 删除：模板→节点映射属客户端画布职责），不丢失多选文件路径（需求 §4.2.4.1）。
    const files = Array.isArray(file.files) && file.files.length > 0
      ? file.files.map((item) => ({ fileName: String(item?.fileName ?? ''), managedPath: String(item?.managedPath ?? '') }))
      : []
    return {
      label,
      fileKind: file.fileKind === 'file' ? 'file' : 'text',
      content: String(file.content ?? ''),
      managedPath: managedPath || undefined,
      fileName: String(managedPath ? managedPath.split(/[\\/]/).pop() : ''),
      ...(files.length > 0 ? { files } : {}),
    }
  }
  const db = template as DatabaseTemplate
  return {
    label,
    description: String(db.description ?? ''),
    dbType: db.dbType === 'server' ? 'server' : 'local',
    dbKind: db.dbKind ?? 'sqlite',
    localPath: String(db.localPath ?? ''),
    conn: db.conn ? { ...db.conn } : undefined,
    vectorSource: db.vectorSource === 'bm25' ? 'bm25' : 'embedding',
  }
}

/** 画布节点 kind 统一读取（顶层 kind 优先，兼容 data.kind 历史数据）。 */
export function nodeKindOf(node: GraphNode | { kind?: string; data?: { kind?: string } } | null | undefined): string {
  return node?.kind ?? node?.data?.kind ?? 'agent'
}

/** flow → 画布连线（line 条件对象 → 显示标签/颜色）。 */
export function flowToCanvasLines(lines: Line[] | null | undefined): CanvasLine[] {
  return (lines ?? []).map((line) => ({
    ...line,
    lineType: lineColorClass(line),
    label: line.condition?.type ? conditionLabel(line.condition) : '',
  }))
}

/**
 * 序列化写回：画布节点 → 存储节点（剔除视图字段；虚拟节点保留 proxySourceId 与
 * data 的 label/role（P3 闸门识别）；阶段节点只保留 label 硬编码；组节点保留 memberIds/size）。
 */
export function serializeFlow(currentFlow: WorkflowDocument, nodes: CanvasNode[], lines: CanvasLine[]): WorkflowDocument {
  return {
    ...currentFlow,
    nodes: (nodes ?? []).map((node) => {
      const kind = nodeKindOf(node)
      const nodeAny = node as { proxySourceId?: string; data?: Record<string, unknown> }
      if (kind === 'proxy') {
        // P3：虚拟节点的 data（label / role）是「闸门识别」的事实源，必须随保存写回；
        // 只保留这两个已知字段，避免把画布视图字段（如 selected）落到文档里。
        const proxyData = nodeAny.data ?? {}
        const data: Record<string, unknown> = {}
        if (proxyData.label !== undefined) data.label = String(proxyData.label)
        if (proxyData.role === 'milestone' || proxyData.role === 'executor') data.role = proxyData.role
        return {
          id: node.id,
          kind,
          position: node.position,
          proxySourceId: nodeAny.proxySourceId,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        } as GraphNode
      }
      if (kind === 'start' || kind === 'end' || kind === 'pause') {
        return { id: node.id, kind, position: node.position, data: { label: String(nodeAny.data?.label ?? '') } } as GraphNode
      }
      const data = { ...(nodeAny.data ?? {}) }
      delete (data as Record<string, unknown>).kind
      return { id: node.id, kind, position: node.position, data } as GraphNode
    }),
    lines: (lines ?? []).map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition?.type ? { condition: { ...line.condition } } : {}),
    })),
  }
}

/** 画布节点 kind → 模板 kind（parent/agent → role；proxy/stage/group 无模板）。 */
export function templateKindOfNode(nodeKind: string): TemplateKind | null {
  if (nodeKind === 'parent' || nodeKind === 'agent') return 'role'
  if (nodeKind === 'file') return 'file'
  if (nodeKind === 'database') return 'database'
  return null
}

// ---------------------------------------------------------------------------
// 连接校验（与 Host graph/validate 规则一致；返回 { valid, code, branch? }）
// ---------------------------------------------------------------------------

export interface ConnectionProblem {
  valid: boolean
  code: string
  branch?: string
}

/** 连接校验：在画布上建立一条连线（sourceHandle → targetHandle）。 */
export function connectionProblem(nodes: CanvasNode[], lines: CanvasLine[], connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string; lineId?: string }): ConnectionProblem {
  if (!connection?.source || !connection?.target) return { valid: false, code: 'invalidConnection' }
  if (connection.source === connection.target) return { valid: false, code: 'selfLoop' }
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target) return { valid: false, code: 'invalidConnection' }
  const sourceKind = nodeKindOf(source)
  const targetKind = nodeKindOf(target)
  const sourceHandle = connection.sourceHandle ?? defaultOutputHandle(sourceKind)
  const targetHandle = connection.targetHandle ?? defaultInputHandle(targetKind)
  const sourceDef = HANDLES[sourceKind] ?? HANDLES.agent
  const targetDef = HANDLES[targetKind] ?? HANDLES.agent
  if (!sourceDef.outputs.includes(sourceHandle)) return { valid: false, code: 'invalidHandle' }
  if (!targetDef.inputs.includes(targetHandle)) return { valid: false, code: 'invalidHandle' }
  const channel = sourceHandle.replace(/-out$/, '')
  if (targetHandle !== `${channel}-in`) return { valid: false, code: 'channelMismatch' }
  // 协作组成员不能连流程线（§4.2.5.2 规则 4）：角色在组内时仅 ctx/db 连接点
  const memberSource = (sourceKind === 'parent' || sourceKind === 'agent') && Boolean((source as { data?: { groupId?: unknown } }).data?.groupId)
  const memberTarget = (targetKind === 'parent' || targetKind === 'agent') && Boolean((target as { data?: { groupId?: unknown } }).data?.groupId)
  if (channel === 'flow' && (memberSource || memberTarget)) return { valid: false, code: 'groupMemberFlow' }
  if (targetKind === 'start') return { valid: false, code: 'startInput' }
  if (sourceKind === 'end') return { valid: false, code: 'endOutput' }
  // 虚拟节点与主节点：同一目标节点的同一连接点不得同时连入（防重复触发，§4.2.3.2 规则 6）
  const relatedOf = (node: CanvasNode): CanvasNode[] => {
    if (node.kind === 'proxy') {
      return nodes.filter((item) => item.id === node.proxySourceId || (item.kind === 'proxy' && item.proxySourceId === node.proxySourceId))
    }
    if (node.kind === 'parent' || node.kind === 'agent') {
      return nodes.filter((item) => item.kind === 'proxy' && item.proxySourceId === node.id)
    }
    return []
  }
  for (const node of [source, target]) {
    for (const other of relatedOf(node)) {
      const blocked = lines.some((line) =>
        (line.source === other.id && line.target === target.id && (line.sourceHandle ?? '') === sourceHandle && (line.targetHandle ?? '') === targetHandle)
        || (line.source === source.id && line.target === other.id && (line.sourceHandle ?? '') === sourceHandle && (line.targetHandle ?? '') === targetHandle)
      )
      if (blocked) return { valid: false, code: 'proxyParallel' }
    }
  }
  if (lines.some((line) =>
    line.source === connection.source && line.target === connection.target
    && (line.sourceHandle ?? '') === sourceHandle
    && (line.targetHandle ?? '') === targetHandle
    && line.id !== connection.lineId
  )) return { valid: false, code: 'duplicateConnection' }
  return { valid: true, code: 'ok', branch: sourceHandle }
}

export function connectionProblemMessage(problem: ConnectionProblem, copy: Record<string, string>): string {
  if (!problem || problem.valid) return ''
  const messages: Record<string, string> = {
    selfLoop: copy.selfLoop ?? '',
    duplicateConnection: copy.duplicateConnection ?? '',
    proxyParallel: copy.proxyParallel ?? copy.invalidConnection ?? '',
    channelMismatch: copy.invalidConnection ?? '',
    groupMemberFlow: copy.groupMemberFlowLine ?? copy.invalidConnection ?? '',
    startInput: copy.invalidConnection ?? '',
    endOutput: copy.invalidConnection ?? '',
    invalidHandle: copy.invalidConnection ?? '',
    invalidConnection: copy.invalidConnection ?? '',
  }
  return messages[problem.code] ?? copy.invalidConnection ?? ''
}

export function graphSnapshot(nodes: CanvasNode[], lines: CanvasLine[]): { nodes: CanvasNode[]; lines: CanvasLine[] } {
  return JSON.parse(JSON.stringify({ nodes, lines }))
}

/**
 * 布局输入的最小结构（仅依赖 id 与 position，兼容各类节点投影）。
 * data 可选：同时兼容「Host 图模型节点（proxy 无 data）」与「studio 画布投影（data 必填）」。
 */
export interface LayoutNodeLike {
  id: string
  position: { x: number; y: number }
  kind?: string
  data?: Record<string, unknown>
}

/**
 * 层次布局（「整理布局」与自动布局的共用入口）：委托给新的分层布局实现（自主编排方案 §7）。
 *
 * 为什么重写（§7.1 旧实现的 7 项缺陷）：proxy 入边计入 indegree 导致主节点被推到引用节点
 * 之后、不看卡片实际尺寸必然重叠、组内成员不参与布局、无层内排序、孤立节点塞进流程最右列、
 * 无长边处理、无环路处理。
 *
 * 新实现落点：
 *   - 算法：src/client/lib/layout.ts（分层 + 层内重心排序 + 按实际尺寸生成坐标）；
 *   - 统一入口：src/client/lib/layout-fit.ts 的 tidyNodes（尺寸解析 + 坐标写回四步收敛）；
 *   - 尺寸口径：src/client/lib/card-geometry.ts 的 groupCardSizeOf。
 * 本函数保持原有签名与「返回含新 position 的新数组」语义：既有调用方与测试零改动。
 */
export function layoutNodes<T extends LayoutNodeLike>(nodes: T[], lines: CanvasLine[]): T[] {
  type SizeInput = Parameters<typeof groupCardSizeOf>[0]
  return tidyNodes(nodes as unknown as LayoutBoxNode[], lines as CanvasLine[], {
    sizeOf: (node) => groupCardSizeOf(node as unknown as SizeInput),
  }).nodes as unknown as T[]
}

/** 运行快照 → 节点状态映射（画布回显用）。 */
export function runStatusMap(snapshot: RunSnapshot | null | undefined): Record<string, { status: string; attempts: number; outputSummary: string }> {
  const map: Record<string, { status: string; attempts: number; outputSummary: string }> = {}
  for (const node of snapshot?.nodes ?? []) {
    if (node?.nodeId) map[node.nodeId] = { status: node.status, attempts: node.attempts, outputSummary: node.outputSummary }
  }
  return map
}

/** 运行中节点 id 列表（需求 §4.5.8「当前运行节点高亮」；画布高亮数据源，防回环只写视图）。 */
export function runningNodeIds(snapshot: RunSnapshot | null | undefined): string[] {
  return (snapshot?.nodes ?? [])
    .filter((node) => node?.nodeId && node.status === 'running')
    .map((node) => node.nodeId as string)
}

// ---------------------------------------------------------------------------
// 协作组成员（需求 §4.2.5.2，用户批注收紧：原子入组 + 一致显示）
// ---------------------------------------------------------------------------

/**
 * 合并重复节点（修复历史数据中协作组节点被重复追加的缺陷）：
 *  - 同 id 的协作组节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
 *  - 每个协作组节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
 * 非协作组节点同 id 直接保留最后出现者。返回合并后的新数组。
 */
export function consolidateGroups<T extends { id: string; data: Record<string, unknown> }>(nodes: T[]): T[] {
  const result: T[] = []
  const indexBy = new Map<string, number>()
  const forEachNode = (node: T): void => {
    const idx = indexBy.get(node.id)
    if (idx === undefined) {
      indexBy.set(node.id, result.length)
      result.push(node)
      return
    }
    const existing = result[idx] as (T & { kind?: unknown })
    const nodeKind = (node as { kind?: unknown }).kind
    if (existing.kind === 'group' && nodeKind === 'group') {
      const union = [...new Set([
        ...(Array.isArray(existing.data.memberIds) ? existing.data.memberIds as string[] : []),
        ...(Array.isArray(node.data.memberIds) ? node.data.memberIds as string[] : []),
      ])]
      result[idx] = { ...node, data: { ...node.data, memberIds: union } } as T
    } else {
      result[idx] = node
    }
  }
  // 第一遍：合并同 id 组；第二遍：给每个协作组节点去重 memberIds（即便单组）
  const merged = (() => { for (const node of nodes) forEachNode(node); return result })()
  return merged.map((n) => ((n as { kind?: unknown }).kind === 'group'
    ? { ...n, data: { ...n.data, memberIds: [...new Set(Array.isArray(n.data.memberIds) ? n.data.memberIds as string[] : [])] } } as T
    : n))
}

/**
 * 原子入组：一次变更同时设置「成员节点 data.groupId」与「协作组 data.memberIds（追加去重）」。
 * 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
 * 先把重复的协作组节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
 * 供左栏模板拖入与画布内节点拖入两条路径共用。
 */
export function joinNodeToGroup<T extends { id: string; data: Record<string, unknown> }>(nodes: T[], nodeId: string, groupId: string): T[] {
  const base = consolidateGroups(nodes)
  const node = base.find((n) => n.id === nodeId)
  const group = base.find((n) => n.id === groupId)
  const nodeKind = (node as { kind?: unknown } | undefined)?.kind
  const groupKind = (group as { kind?: unknown } | undefined)?.kind
  if (!node || !group || groupKind !== 'group') return base
  if (nodeKind !== 'parent' && nodeKind !== 'agent') return base
  const members = Array.isArray(group.data.memberIds) ? (group.data.memberIds as string[]) : []
  const nextMembers = members.includes(nodeId) ? members : [...members, nodeId]
  return base.map((n) => {
    if (n.id === nodeId) return { ...n, data: { ...n.data, groupId } } as T
    if (n.id === groupId) return { ...n, data: { ...n.data, memberIds: nextMembers } } as T
    return n
  })
}

/**
 * 移除指定节点的流程连线（角色拖入协作组后仅保留上下文/数据库线，§4.2.5.2 规则 4）：
 * 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
 */
export function dropNodeFlowLines<T extends { source: string; target: string; sourceHandle?: string; targetHandle?: string }>(lines: T[], nodeId: string): T[] {
  return lines.filter((line) => !(
    (line.source === nodeId && (line.sourceHandle ?? '') === 'flow-out')
    || (line.target === nodeId && (line.targetHandle ?? '') === 'flow-in')
  ))
}

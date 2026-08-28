// src/client/lib/graph-model.ts
//
// Client 图模型（照搬旧项目 src/client/graph-model.js 的算法与结构，TS 化 + 新数据模型适配）：
//   - 节点种类 parent/agent/file/database/start/end/pause/group/proxy（共享类型 GraphNode）；
//   - 连线 lines 携带 condition{type,label}，颜色按连线类型（流程/上下文/数据库/条件）；
//   - 模板 → 节点深拷贝解耦（拖入即快照，无 templateId 引用，需求 §4.2.1）。
// 类型仅引用 src/host/shared/graph-model.ts（纯类型层，零运行时 import）。

import type { GraphNode, Line, NodeKind, WorkflowDocument } from '../../host/shared/graph-model.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, RunSnapshot } from '../../host/shared/types.js'

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

/** 连线颜色 class（flow 默认 / ctx / db / 条件 pass|fail|content）。 */
export function lineColorClass(line: Line): string {
  const sourceHandle = line?.sourceHandle ?? ''
  const targetHandle = line?.targetHandle ?? ''
  if (sourceHandle === 'db-out' || targetHandle === 'db-in') return 'is-db'
  if (sourceHandle === 'ctx-out' || targetHandle === 'ctx-in') return 'is-ctx'
  const condition = line?.condition?.type
  if (condition === 'pass') return 'is-pass'
  if (condition === 'fail') return 'is-fail'
  if (condition === 'content') return 'is-content'
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

/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。 */
export function templateToNodeData(
  kind: TemplateKind,
  template: RoleTemplate | FileTemplate | DatabaseTemplate | null | undefined,
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
      promptFilePath: String(role.promptFilePath ?? '') || undefined,
      groupId: null,
    }
  }
  if (kind === 'file') {
    const file = template as FileTemplate
    const managedPath = String(file.managedPath ?? '')
    return {
      label,
      fileKind: file.fileKind === 'file' ? 'file' : 'text',
      content: String(file.content ?? ''),
      managedPath: managedPath || undefined,
      fileName: String(managedPath ? managedPath.split(/[\\/]/).pop() : ''),
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

/** flow → 画布节点（画布与存储同构：节点 JSON 即事实源；仅补齐视图需要的字段）。 */
export function flowToCanvasNodes(flow: WorkflowDocument | null | undefined): CanvasNode[] {
  return (flow?.nodes ?? []).map((node) => {
    const kind = nodeKindOf(node)
    const data = { ...((node as { data?: Record<string, unknown> }).data ?? {}), kind } as Record<string, unknown>
    return { id: node.id, kind: kind as CanvasNode['kind'], position: node.position ?? { x: 120, y: 80 }, data } as unknown as CanvasNode
  })
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
 * 序列化写回：画布节点 → 存储节点（剔除视图字段；虚拟节点只保留 proxySourceId；
 * 阶段节点只保留 label 硬编码；组节点保留 memberIds/size）。
 */
export function serializeFlow(currentFlow: WorkflowDocument, nodes: CanvasNode[], lines: CanvasLine[]): WorkflowDocument {
  return {
    ...currentFlow,
    nodes: (nodes ?? []).map((node) => {
      const kind = nodeKindOf(node)
      const nodeAny = node as { proxySourceId?: string; data?: Record<string, unknown> }
      if (kind === 'proxy') {
        return { id: node.id, kind, position: node.position, proxySourceId: nodeAny.proxySourceId } as GraphNode
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

/** 布局输入的最小结构（仅依赖 id 与 position，兼容各类节点投影）。 */
export interface LayoutNodeLike {
  id: string
  position: { x: number; y: number }
}

/** 层次布局：按 flow 边拓扑排序分列排布（照搬旧项目 layoutNodes；泛型保留节点形状）。 */
export function layoutNodes<T extends LayoutNodeLike>(nodes: T[], lines: CanvasLine[]): T[] {
  return layoutGraph(nodes, lines, (line) => line.sourceHandle === 'flow-out')
}

/** 布局原语：可传边缘筛选函数。 */
export function layoutGraph<T extends LayoutNodeLike>(
  nodes: T[],
  lines: CanvasLine[],
  channelFilter: (line: Line) => boolean,
): T[] {
  const edges = (lines ?? []).filter((line) => channelFilter(line))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  const level = new Map(queue.map((id) => [id, 0]))
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1))
      indegree.set(next, (indegree.get(next) ?? 0) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  nodes.forEach((node) => {
    if (!level.has(node.id)) {
      const maxLevel = order.length > 0 ? Math.max(...level.values()) : -1
      level.set(node.id, maxLevel + 1)
    }
  })
  const rows = new Map<number, number>()
  const stepX = 270
  const stepY = 180
  return nodes.map((node) => {
    const column = level.get(node.id) ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return { ...node, position: { x: 70 + column * stepX, y: 80 + row * stepY } }
  })
}

/** 运行快照 → 节点状态映射（画布回显用）。 */
export function runStatusMap(snapshot: RunSnapshot | null | undefined): Record<string, { status: string; attempts: number; outputSummary: string }> {
  const map: Record<string, { status: string; attempts: number; outputSummary: string }> = {}
  for (const node of snapshot?.nodes ?? []) {
    if (node?.nodeId) map[node.nodeId] = { status: node.status, attempts: node.attempts, outputSummary: node.outputSummary }
  }
  return map
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

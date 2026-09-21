// src/host/tools/wf-graph-patch/types.ts
//
// wf_graph_patch 的类型契约（自主编排方案 §4.2）：
//   - PatchOp 判别联合：A 组图结构变更 / B 组元参数 / C 组运行状态标记（三分区）；
//   - 每组一个「已应用操作」类型，供执行层按组分别落地（三条代码路径零共享）；
//   - OP_GROUP 工具箱：op → 组名（服务端据此拒绝同一补丁混用不同组）。
// 纯类型 + 常量（无 IO），可在 host 单测与后续客户端角标渲染侧复用。

import type { GraphIssue } from '../../graph/invariants.js'
import type { OrgMeta } from '../../shared/types.js'

/** 补丁作用域：template = 工作流模板（规划期改模板）；instance = 工作流/服务实例（运行期改实例）。 */
export type PatchScope = 'template' | 'instance'

/** 操作组名（三分区）。 */
export type PatchGroup = 'graph' | 'meta' | 'mark'

/**
 * 新建模板说明（wf_graph_patch 的 create 参数）。
 * 语义（用户裁决 2026.09）：规划期的主用例是「按意图产出新模板」，因此
 * `scope='template'` + `create` = 新建；不带 create 仍是「必须已存在」的更新语义。
 * 允许出现的组合只有：scope=template 且 op 组为 graph（其余组合一律拒绝）。
 */
export interface NewTemplateSpec {
  /** 模板名称（人类可读，必填）。 */
  name: string
  /** 模板描述（可选）。 */
  description?: string
  /** 运行模式（缺省 mode1）。 */
  mode?: 'mode1' | 'mode2'
}

/** A 组：图结构变更。 */
export type GraphPatchOp =
  | { op: 'create_node'; node: Record<string, unknown> }
  | { op: 'remove_node'; nodeId: string; cascade?: boolean }
  | { op: 'update_node_data'; nodeId: string; data: Record<string, unknown> }
  | { op: 'connect'; source: string; target: string; sourceHandle: string; targetHandle: string; condition?: { type: string; label?: string } }
  | { op: 'disconnect'; lineId?: string; key?: { source: string; target: string; sourceHandle: string; targetHandle: string } }
  | { op: 'create_group'; groupId: string; label: string; collabPrompt?: string; memberIds?: string[] }
  | { op: 'set_group_members'; groupId: string; memberIds: string[] }

/** B 组：元参数（一次性提交，不与其他组混用）。 */
export interface MetaPatchOp {
  op: 'set_meta'
  meta: Partial<OrgMeta>
}

/**
 * C 组：运行状态标记（闸门节点完成/失败）。
 * 语义约束（D-07）：只能标记**当前仍在运行**的 run 所对应的节点；节点不存在即拒绝。
 * P3 会在此之上追加「必须是当前父代理闸门节点 + 闸门预算」判定。
 */
export interface MarkPatchOp {
  op: 'mark_node'
  nodeId: string
  status: 'ok' | 'fail'
  summary?: string
}

/** 补丁操作（判别联合）。 */
export type PatchOp = GraphPatchOp | MetaPatchOp | MarkPatchOp

/** 图结构变更结果。 */
export interface GraphPatchResult {
  doc: { id: string; sessionId: string; mode: string; name: string; description: string; nodes: unknown[]; lines: unknown[]; revision: number; meta?: OrgMeta }
  createdNodeIds: string[]
  removedNodeIds: string[]
  updatedNodeIds: string[]
  connectedLineIds: string[]
  disconnectedLineIds: string[]
}

/** 元参数变更结果。 */
export interface MetaPatchResult {
  meta: OrgMeta
  /** 归一化时被丢弃/收敛的提示（面向模型可读）。 */
  notes: string[]
}

/** 运行状态标记结果。 */
export interface MarkPatchResult {
  nodeId: string
  status: 'ok' | 'fail'
  runId: string
}

/** op → 组名映射（服务端混组拒绝的唯一依据）。 */
export function opGroupOf(op: unknown): PatchGroup | null {
  const name = String((op as { op?: unknown })?.op ?? '')
  if (name === 'create_node' || name === 'remove_node' || name === 'update_node_data'
    || name === 'connect' || name === 'disconnect' || name === 'create_group' || name === 'set_group_members') {
    return 'graph'
  }
  if (name === 'set_meta') return 'meta'
  if (name === 'mark_node') return 'mark'
  return null
}

/** 补丁中出现的全部组名（按出现顺序去重）。 */
export function groupsOf(ops: unknown[]): PatchGroup[] {
  const out: PatchGroup[] = []
  for (const op of ops ?? []) {
    const group = opGroupOf(op)
    if (group && !out.includes(group)) out.push(group)
  }
  return out
}

/** 未知 op 名（用于错误信息）。 */
export function unknownOpsOf(ops: unknown[]): string[] {
  return (ops ?? []).filter((op) => opGroupOf(op) === null).map((op) => String((op as { op?: unknown })?.op ?? ''))
}

/** 混组错误的可读分组说明（写进错误文本，帮助模型自我修正）。 */
export const GROUP_HINTS: Record<PatchGroup, string> = {
  graph: 'graph structure ops (create_node/remove_node/update_node_data/connect/disconnect/create_group/set_group_members)',
  meta: 'meta parameter op (set_meta)',
  mark: 'run-state marking op (mark_node)',
}

/** 检查器 issue → 稳定错误码（error 阻断，warning 放行）。 */
export function blockingIssuesOf(issues: GraphIssue[]): GraphIssue[] {
  return (issues ?? []).filter((issue) => issue.level === 'error')
}

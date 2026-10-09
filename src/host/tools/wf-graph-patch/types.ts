// src/host/tools/wf-graph-patch/types.ts
//
// wf_graph_patch 的类型契约：
//   - PatchOp 判别联合：图结构变更 / 运行状态标记（两组）；
//   - 每组一个「已应用操作」类型，供执行层按组分别落地（两条代码路径零共享）；
//   - op → 组名映射：服务端据此拒绝同一补丁混用不同组。
// 纯类型 + 常量（无 IO），可在 host 单测与后续客户端角标渲染侧复用。

import type { GraphIssue } from '../../graph/index.js'
import type { OrgMeta } from '../../shared/types.js'

/** 补丁作用域：template = 工作流模板（规划期改模板）；instance = 工作流/服务实例（运行期改实例）。 */
export type PatchScope = 'template' | 'instance'

/**
 * 操作组名（两组）。
 * 元参数（组织预算）不在此列：它是约束改图方的硬护栏，被约束方不得自行调整，
 * 因此没有「改元参数」这一组操作，只能在画布/设置中由用户调整。
 */
export type PatchGroup = 'graph' | 'mark'

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

/** 图结构变更组。 */
export type GraphPatchOp =
  | { op: 'create_node'; node: Record<string, unknown> }
  | { op: 'remove_node'; nodeId: string; cascade?: boolean }
  | { op: 'update_node_data'; nodeId: string; data: Record<string, unknown> }
  | { op: 'connect'; source: string; target: string; sourceHandle?: string; targetHandle?: string; condition?: { type: string; label?: string } }
  | { op: 'disconnect'; lineId?: string; key?: { source: string; target: string; sourceHandle: string; targetHandle: string } }
  | { op: 'create_group'; groupId: string; label: string; collabPrompt?: string; memberIds?: string[] }
  | { op: 'set_group_members'; groupId: string; memberIds: string[] }

/**
 * 运行状态标记组（闸门节点完成/失败）。
 * 语义约束：只能标记**当前仍在运行**的 run 所对应的节点；节点不存在即拒绝。
 * 闸门身份与次数预算由执行层按运行事实判定。
 */
export interface MarkPatchOp {
  op: 'mark_node'
  nodeId: string
  status: 'ok' | 'fail'
  summary?: string
}

/** 补丁操作（判别联合）。 */
export type PatchOp = GraphPatchOp | MarkPatchOp

/** 图结构变更结果。 */
export interface GraphPatchResult {
  doc: { id: string; sessionId: string; mode: string; name: string; description: string; nodes: unknown[]; lines: unknown[]; revision: number; meta?: OrgMeta }
  createdNodeIds: string[]
  removedNodeIds: string[]
  updatedNodeIds: string[]
  connectedLineIds: string[]
  disconnectedLineIds: string[]
  /**
   * 被归一化为「文本型」的文件节点 id（D-07）。
   *
   * 为什么写图只产文本型 file 节点：受管文件（fileKind='file'）必须指向**已存在**的受管副本
   * （检查器 dataNodeIncomplete 强制），而编排要表达的是「未来要产出的交付文件」这一意图——
   * 强制受管会把这类规划直接挡在门外。归一化不静默：工具层据此产出 warning 告知调用方。
   */
  fileNodeTextOnlyIds: string[]
}

/** 运行状态标记结果。 */
export interface MarkPatchResult {
  nodeId: string
  status: 'ok' | 'fail'
  runId: string
}

/**
 * 单条补丁操作失败项（容错收集模式下的一条记录）。
 * 保留每条的稳定错误码，聚合错误文本据此让模型分辨「改入参形状」还是「改图」。
 */
export interface PatchOpFailure {
  /** 该 op 在本批 ops 中的下标（从 0 起；错误文本按 1 起序号展示）。 */
  index: number
  /** op 名（未知 op 时为空串）。 */
  op: string
  /** 稳定错误码。 */
  code: string
  /** 可行动的错误说明（含正确形状或修复建议）。 */
  message: string
}

/** 图结构组的 op 名（op → 组映射、分组提示与契约完整性校验的唯一来源）。 */
export const GRAPH_OP_NAMES = [
  'create_node',
  'remove_node',
  'update_node_data',
  'connect',
  'disconnect',
  'create_group',
  'set_group_members',
] as const

/** 标记组的 op 名。 */
export const MARK_OP_NAMES = ['mark_node'] as const

/** op → 组名映射（服务端混组拒绝的唯一依据）。 */
export function opGroupOf(op: unknown): PatchGroup | null {
  const name = String((op as { op?: unknown })?.op ?? '')
  if ((GRAPH_OP_NAMES as readonly string[]).includes(name)) return 'graph'
  if ((MARK_OP_NAMES as readonly string[]).includes(name)) return 'mark'
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
  graph: `graph structure ops (${GRAPH_OP_NAMES.join('/')})`,
  mark: `run-state marking op (${MARK_OP_NAMES.join('/')})`,
}

/** 检查器 issue → 稳定错误码（error 阻断，warning 放行）。 */
export function blockingIssuesOf(issues: GraphIssue[]): GraphIssue[] {
  return (issues ?? []).filter((issue) => issue.level === 'error')
}

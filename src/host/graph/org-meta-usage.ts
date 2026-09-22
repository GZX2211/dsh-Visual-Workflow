// src/host/graph/org-meta-usage.ts
//
// 元参数「已用量」统计口径（自主编排方案 §6.4）：可执行节点数 / 协作组数 / 最大组内
// 人数 / 单列并行分支数 / 闸门已用次数 / 本批 op 数。
// 独立成文件的原因：口径是本功能最易漂移的部分（检查器、P1 写图工具、客户端预算展示
// 三处必须一致），集中一处便于单测锁定。
// 纯函数：不读时钟/随机源，不改写入参。

import { EXECUTABLE_UNIT_KINDS } from '../shared/protocol.js'
import type { GraphNode, WorkflowDocument } from '../shared/graph-model.js'

/** 已用量（元参数判定的输入；可选维度未提供时不做该维度判定）。 */
export interface OrgUsage {
  /** 可执行节点（agent/parent/group）已用数。 */
  nodeCount: number
  /** 协作组已用数。 */
  groupCount: number
  /** 最大组内人数。 */
  maxGroupMembers: number
  /** 单列最大并行分支数（可选）。 */
  parallelBranchMax?: number
  /** 父代理闸门已用次数（不含首次编排，D-21）。 */
  milestoneUsed: number
  /** 本批改图 op 数（可选）。 */
  patchOps?: number
}

/** 可执行单元计数（agent/parent/group；与检查器、P1 工具、客户端共用同一口径）。 */
export function executableUnitCount(nodes: GraphNode[] | null | undefined): number {
  return (nodes ?? []).filter((node) => EXECUTABLE_UNIT_KINDS.includes(node.kind)).length
}

/** 协作组卡片计数。 */
export function groupCount(nodes: GraphNode[] | null | undefined): number {
  return (nodes ?? []).filter((node) => node.kind === 'group').length
}

/** 单个协作组的最大已配置人数（无组时 0；memberIds 重复 id 只计一次）。 */
export function maxGroupMembers(nodes: GraphNode[] | null | undefined): number {
  let max = 0
  for (const node of nodes ?? []) {
    if (node.kind !== 'group') continue
    const members = Array.isArray(node.data.memberIds) ? node.data.memberIds : []
    max = Math.max(max, new Set(members).size)
  }
  return max
}

/** 由图文档直接推导已用量（检查器/P1 工具的统一入口）。 */
export function orgUsageOf(
  flow: Pick<WorkflowDocument, 'nodes'> | null | undefined,
  options: { milestoneUsed?: number; parallelBranchMax?: number; patchOps?: number } = {},
): OrgUsage {
  const nodes = Array.isArray(flow?.nodes) ? (flow?.nodes as GraphNode[]) : []
  const usage: OrgUsage = {
    nodeCount: executableUnitCount(nodes),
    groupCount: groupCount(nodes),
    maxGroupMembers: maxGroupMembers(nodes),
    milestoneUsed: Math.max(0, Math.floor(Number(options.milestoneUsed) || 0)),
  }
  if (options.parallelBranchMax !== undefined) usage.parallelBranchMax = options.parallelBranchMax
  if (options.patchOps !== undefined) usage.patchOps = options.patchOps
  return usage
}

// src/client/lib/run-locks.ts
//
// Client 运行中实例画布锁定（模式一）纯判定层：实例处于 running 时，已跑完的流程
// 不可变更，未跑完的可以改。本模块只做规则判定，不含任何 React/状态机/端点依赖，
// UI 接入（禁用删除按钮、禁止选中编辑连线、拦截 onConnect）由调用方完成。
//
// 判定语义（需求「运行中实例画布锁定」）：
//   - 已完成节点（ok / react-capped）与执行中节点（running）自身不可删除；
//   - 已完成节点的全部入线 / 出线均锁定；
//   - 执行中节点仅锁定左侧入口线（其右出到后续节点仍可改）；
//   - 新建连线：两端都不得是已完成节点，目标也不得是执行中节点（源为执行中允许）；
//   - 虚拟节点（proxy）先按 proxySourceId 归主，再取主节点状态；
//   - enabled === false（非模式一或实例未运行）时全部解锁。
// 纯函数：不读时钟 / 随机源，不依赖全局状态；除 import type 外零依赖。

import type { CanvasEdge, CanvasNode } from '../studio/studio-state.js'

export interface RunLockInput {
  /** 是否启用锁定（仅模式一 + 实例处于 running 时为 true）；false → 全部解锁。 */
  enabled: boolean
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** 运行快照节点状态（nodeId → status 字符串，如 'pending'|'running'|'ok'|'fail'|'react-capped'|'armed'）。 */
  statusByNode: Record<string, string>
}

export interface RunLockSet {
  /** 被锁节点 id 集合（不可删除）。 */
  readonly lockedNodeIds: ReadonlySet<string>
  /** 被锁连线 id 集合（不可删除、不可选中/编辑）。 */
  readonly lockedEdgeIds: ReadonlySet<string>
  isNodeLocked(nodeId: string): boolean
  isEdgeLocked(edgeId: string): boolean
  /** 是否允许新建 source→target 连线（仅判定锁定规则，不承担既有连通性/通道校验）。 */
  canConnect(sourceNodeId: string, targetNodeId: string): boolean
  /** 节点是否已完成（ok / react-capped）。 */
  isNodeCompleted(nodeId: string): boolean
  /** 节点是否执行中（running）。 */
  isNodeRunning(nodeId: string): boolean
}

/** 已完成状态集合（ok 正常完成 / react-capped 触达 react 轮次上限后收尾）。 */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(['ok', 'react-capped'])
/** 执行中状态。 */
const RUNNING_STATUS = 'running'

/** 已完成判定（未登记状态 / 其他状态一律 false）。 */
function isCompletedStatus(status: string | undefined): boolean {
  return status !== undefined && COMPLETED_STATUSES.has(status)
}

/** 执行中判定。 */
function isRunningStatus(status: string | undefined): boolean {
  return status === RUNNING_STATUS
}

/** enabled === false 时的全解锁结果（空集 + 全 false 谓词 + 恒可连）。 */
function unlockedSet(): RunLockSet {
  const lockedNodeIds: ReadonlySet<string> = new Set<string>()
  const lockedEdgeIds: ReadonlySet<string> = new Set<string>()
  return {
    lockedNodeIds,
    lockedEdgeIds,
    isNodeLocked: () => false,
    isEdgeLocked: () => false,
    canConnect: () => true,
    isNodeCompleted: () => false,
    isNodeRunning: () => false,
  }
}

/**
 * 计算画布运行锁定判定集（纯函数；同一入参恒返回同一判定结果）。
 */
export function computeRunLocks(input: RunLockInput): RunLockSet {
  const { enabled, nodes, edges, statusByNode } = input

  // 规则 7：未启用 → 全部解锁（快照状态一律忽略）。
  if (!enabled) return unlockedSet()

  const byId = new Map<string, CanvasNode>()
  for (const node of nodes) byId.set(node.id, node)

  /** 虚拟节点归主：proxy 取其 proxySourceId（字符串且非空）为主节点 id，否则用自身 id。 */
  const ownerIdOf = (nodeId: string): string => {
    const node = byId.get(nodeId)
    if (!node || node.kind !== 'proxy') return nodeId
    const source = (node as { proxySourceId?: unknown }).proxySourceId
    return typeof source === 'string' && source.length > 0 ? source : nodeId
  }

  /**
   * 取节点（归主后）的运行状态：
   *   1) 主节点 id → statusByNode；2) 主节点未登记状态时退化为虚拟节点自身 id；
   *   3) 仍未登记 → 无状态（undefined，既非 completed 也非 running）。
   * 不在画布中的 id 按规则 6 直接以自身 id 查状态（缺状态不构成拒绝理由）。
   */
  const statusOf = (nodeId: string): string | undefined => {
    const ownerId = ownerIdOf(nodeId)
    const status = statusByNode[ownerId]
    if (status !== undefined) return status
    if (ownerId === nodeId) return undefined
    return statusByNode[nodeId]
  }

  // 规则 4：已完成节点与执行中节点都不可删除（含虚拟节点自身 id）。
  const lockedNodeIds = new Set<string>()
  for (const node of nodes) {
    const status = statusOf(node.id)
    if (isCompletedStatus(status) || isRunningStatus(status)) lockedNodeIds.add(node.id)
  }

  // 规则 5：已完成节点的全部出线 / 入线锁定；执行中节点仅锁定其左侧入口线。
  //        source 为 running 的连线不锁（执行中节点右出到后续全部可改）。
  const lockedEdgeIds = new Set<string>()
  for (const edge of edges) {
    const sourceCompleted = isCompletedStatus(statusOf(edge.source))
    const targetStatus = statusOf(edge.target)
    if (sourceCompleted || isCompletedStatus(targetStatus) || isRunningStatus(targetStatus)) {
      lockedEdgeIds.add(edge.id)
    }
  }

  // 规则 6：源为已完成 → 拒；目标为已完成 / 执行中 → 拒；其余（含源为执行中）允许。
  const canConnect = (sourceNodeId: string, targetNodeId: string): boolean =>
    !isCompletedStatus(statusOf(sourceNodeId)) &&
    !isCompletedStatus(statusOf(targetNodeId)) &&
    !isRunningStatus(statusOf(targetNodeId))

  return {
    lockedNodeIds,
    lockedEdgeIds,
    // 规则 8：id 未知（不在画布中）→ 恒 false。
    isNodeLocked: (nodeId) => lockedNodeIds.has(nodeId),
    isEdgeLocked: (edgeId) => lockedEdgeIds.has(edgeId),
    canConnect,
    isNodeCompleted: (nodeId) => isCompletedStatus(statusOf(nodeId)),
    isNodeRunning: (nodeId) => isRunningStatus(statusOf(nodeId)),
  }
}

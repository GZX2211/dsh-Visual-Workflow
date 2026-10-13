// src/client/lib/run-status-map.ts
//
// 运行快照 → 画布视图投影：节点状态映射与「当前运行节点」高亮清单。
// 纯函数：只读快照，不读时钟与全局状态。

import type { RunSnapshot } from '../../host/shared/types.js'

export interface RunNodeStatusView {
  status: string; attempts: number; outputSummary: string
  executionStatus?: string; taskStatus?: string
  blockedReason?: string; blockedNodeIds?: string[]; sources?: string[]
}

/** 运行快照 → 节点状态映射（画布回显用）。 */
export function runStatusMap(snapshot: RunSnapshot | null | undefined): Record<string, RunNodeStatusView> {
  const map: Record<string, RunNodeStatusView> = {}
  for (const node of snapshot?.nodes ?? []) {
    if (node?.nodeId) map[node.nodeId] = { status: node.taskAcceptance && (snapshot?.executionMode === "dag" || node.taskAcceptance.status !== "accepted") ? `task-${node.taskAcceptance.status}` : snapshot?.dagState?.ready.includes(node.nodeId) ? "ready" : node.status, attempts: node.attempts, outputSummary: node.outputSummary,
      ...(snapshot?.executionMode === "dag" ? { executionStatus: node.status, taskStatus: node.taskAcceptance?.status, blockedReason: snapshot.dagState?.blocked[node.nodeId]?.reason, blockedNodeIds: snapshot.dagState?.blocked[node.nodeId]?.nodeIds, sources: [...(node.attemptHistory?.at(-1)?.flowSources?.map((source) => `${source.nodeId} (${source.runId}, ${source.attempt})`) ?? []), ...(node.attemptHistory?.at(-1)?.inputAttachments?.map((file) => `${file.name} (${file.attachmentId})`) ?? [])] } : {}) }
  }
  return map
}

/** 运行中节点 id 列表（需求 §4.5.8「当前运行节点高亮」；画布高亮数据源，防回环只写视图）。 */
export function runningNodeIds(snapshot: RunSnapshot | null | undefined): string[] {
  return (snapshot?.nodes ?? [])
    .filter((node) => node?.nodeId && node.status === 'running')
    .map((node) => node.nodeId as string)
}

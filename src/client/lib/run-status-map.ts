// src/client/lib/run-status-map.ts
//
// 运行快照 → 画布视图投影：节点状态映射与「当前运行节点」高亮清单。
// 纯函数：只读快照，不读时钟与全局状态。

import type { RunSnapshot } from '../../host/shared/types.js'

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

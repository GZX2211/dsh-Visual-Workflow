// tests/client/lib/run-status-map.test.ts
//
// 运行快照 → 画布视图派生（节点状态映射与运行中节点高亮，§4.5.8）。

import { describe, expect, it } from 'vitest'
import { runStatusMap, runningNodeIds } from '../../../src/client/lib/run-status-map.js'
import type { RunSnapshot } from '../../../src/host/shared/types.js'

function snapshotOf(nodes: RunSnapshot['nodes']): RunSnapshot {
  return {
    id: 'run-1',
    flowId: 'f-1',
    flowName: '示例',
    sessionId: 's-1',
    mode: 'mode1',
    status: 'running',
    startedAt: '2026-08-25T00:00:00.000Z',
    endedAt: null,
    summary: '',
    nodes,
  }
}

describe('运行状态派生（§4.5.8 节点高亮）', () => {
  it('runningNodeIds：仅返回 status=running 的节点 id', () => {
    const snapshot = snapshotOf([
      { nodeId: 'a', status: 'running', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '' },
      { nodeId: 'b', status: 'ok', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '' },
      { nodeId: 'c', status: 'pending', attempts: 0, startedAt: null, endedAt: null, output: '', outputSummary: '' },
    ])
    expect(runningNodeIds(snapshot)).toEqual(['a'])
  })

  it('runningNodeIds：空/无 running 快照返回空数组', () => {
    expect(runningNodeIds(null)).toEqual([])
    const snapshot = snapshotOf([
      { nodeId: 'a', status: 'fail', attempts: 2, startedAt: null, endedAt: null, output: '', outputSummary: '' },
    ])
    expect(runningNodeIds(snapshot)).toEqual([])
  })

  it('runStatusMap：按节点 id 建映射（状态 + 次数 + 输出摘要）', () => {
    const snapshot = snapshotOf([
      { nodeId: 'a', status: 'running', attempts: 2, startedAt: null, endedAt: null, output: '全文', outputSummary: '摘要' },
    ])
    expect(runStatusMap(snapshot)).toEqual({ a: { status: 'running', attempts: 2, outputSummary: '摘要' } })
  })

  it('runStatusMap：缺 nodeId 的条目被跳过；空快照返回空对象', () => {
    const snapshot = snapshotOf([
      { nodeId: '', status: 'ok', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '' },
    ])
    expect(runStatusMap(snapshot)).toEqual({})
    expect(runStatusMap(null)).toEqual({})
  })
})

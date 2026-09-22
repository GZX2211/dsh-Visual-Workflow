// tests/host/orchestrator/snapshot.test.ts
//
// 运行快照纯函数单测：创建/更新/终态化/截断/产出文本提取。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { describe, expect, it } from 'vitest'
import { OUTPUT_SUMMARY_LIMIT, createRunSnapshot, lastAssistantText, setNodeStatus, statusText, terminalizeNodes, truncateText } from '../../../src/host/orchestrator/index.js'
import { makeFlow, start } from './fixtures/harness.js'

describe('snapshot 纯函数', () => {
  it('truncateText：超限截断并追加标记，未超限原样', () => {
    expect(truncateText('abc', 5)).toBe('abc')
    expect(truncateText('abcdef', 3)).toBe('abc…（已截断）')
    expect(truncateText(null, 3)).toBe('')
  })

  it('statusText 覆盖全部 6 种 run 状态', () => {
    expect(statusText('running')).toBe('运行中')
    expect(statusText('paused')).toBe('已暂停')
    expect(statusText('completed')).toBe('完成')
    expect(statusText('failed')).toBe('失败')
    expect(statusText('stopped')).toBe('已停止')
    expect(statusText('interrupted')).toBe('已中断')
  })

  it('createRunSnapshot：全节点 pending、attempts 0、endedAt null、mode/flowName 正确', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    expect(snapshot.id).toBe('run-1')
    expect(snapshot.flowName).toBe('测试流程')
    expect(snapshot.mode).toBe('mode1')
    expect(snapshot.status).toBe('running')
    expect(snapshot.endedAt).toBeNull()
    expect(snapshot.nodes).toHaveLength(6)
    for (const node of snapshot.nodes) {
      expect(node.status).toBe('pending')
      expect(node.attempts).toBe(0)
      expect(node.startedAt).toBeNull()
      expect(node.output).toBe('')
      expect(node.outputSummary).toBe('')
    }
  })

  it('setNodeStatus：ok 写完整输出（截断）与摘要（截断）；running/终态补时间戳；未知节点 no-op', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    const big = 'x'.repeat(7000)
    setNodeStatus(snapshot, 'n-a1', 'ok', { output: big, outputFullLimit: 400, now: 2000 })
    const entry = snapshot.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(entry.status).toBe('ok')
    expect(entry.output).toHaveLength(406)
    expect(entry.output.endsWith('…（已截断）')).toBe(true)
    expect(entry.outputSummary).toHaveLength(OUTPUT_SUMMARY_LIMIT + 6)
    expect(entry.endedAt).toBe(new Date(2000).toISOString())

    setNodeStatus(snapshot, 'n-a2', 'running', { attempts: 2, now: 3000 })
    const running = snapshot.nodes.find((n) => n.nodeId === 'n-a2')!
    expect(running.attempts).toBe(2)
    expect(running.startedAt).toBe(new Date(3000).toISOString())
    // 再次 running 不覆盖 startedAt
    setNodeStatus(snapshot, 'n-a2', 'running', { now: 4000 })
    expect(running.startedAt).toBe(new Date(3000).toISOString())

    setNodeStatus(snapshot, 'no-such', 'ok') // 不存在：静默 no-op
    expect(snapshot.nodes.every((n) => n.nodeId !== 'no-such')).toBe(true)
  })

  it('terminalizeNodes：pending→skipped、running→fail、ok 保留', () => {
    const snapshot = createRunSnapshot({ runId: 'run-1', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    setNodeStatus(snapshot, 'n-a1', 'ok', { now: 1000 })
    setNodeStatus(snapshot, 'n-a2', 'running', { now: 1000 })
    terminalizeNodes(snapshot, 5000)
    const byId = new Map(snapshot.nodes.map((n) => [n.nodeId, n]))
    expect(byId.get('n-a1')!.status).toBe('ok')
    expect(byId.get('n-a2')!.status).toBe('fail')
    expect(byId.get('n-start')!.status).toBe('skipped')
  })

  it('lastAssistantText：text 块拼接、非 text 块忽略、空输入空串、截断保护', () => {
    expect(lastAssistantText([{ type: 'text', text: 'A' }, { type: 'tool', text: 'B' }, { type: 'text', text: 'C' }], 0)).toBe('A\nC')
    expect(lastAssistantText([], 10)).toBe('')
    expect(lastAssistantText(null, 10)).toBe('')
    expect(lastAssistantText([{ type: 'text', text: 'abcdef' }], 3)).toBe('abc…（已截断）')
  })
})

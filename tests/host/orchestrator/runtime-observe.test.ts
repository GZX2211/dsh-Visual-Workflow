// tests/host/orchestrator/runtime-observe.test.ts
//
// 观察回写层单测（subagent/end）：迟到缓冲、节点状态回写、软截停、协作组聚合与 armed。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestratorRuntime, type NodeRunner } from '../../../src/host/orchestrator/index.js'
import { type GraphNode, type RoleNode } from '../../../src/host/shared/graph-model.js'
import { agent, makeFlow, makeHarness, caller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

describe('subagent/end 迟到缓冲（wait:true 死锁回归）', () => {
  it('事件早于 childIndex 登记到达：缓冲重试后 wait 等待器仍被唤醒', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    // 受控 runner：startNodeTask 挂起（模拟官方派发后尚未返回 childId 的窗口）
    let resolveStart!: (value: { childId: string; created: boolean }) => void
    const startGate = new Promise<{ childId: string; created: boolean }>((resolve) => { resolveStart = resolve })
    const gatedRunner: NodeRunner = {
      startNodeTask: async () => startGate,
      interruptChild: (childId, sessionId) => h.runner.interruptChild(childId, sessionId),
      consumeReactCapped: (childId) => h.runner.consumeReactCapped(childId),
    }
    const runtime = new OrchestratorRuntime({
      store: h.store,
      runner: gatedRunner,
      agents: h.agents,
      config: {
        outputFullLimit: 400, documentTextLimit: 200, runIdleTimeoutMs: 500,
        retryLimitDefault: 3, reactIterationLimitDefault: 50, wfAskAgentTimeoutMs: 500,
      },
      logger: { warn: (message) => h.warnings.push(message), info: () => {}, debug: () => {} },
      now: () => h.clock.now,
      newRunId: () => 'run-late',
      uuid: () => 'uuid-late',
    })
    await runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })

    // wait:true 阻塞：挂起在 startNodeTask
    const waitPromise = runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a1', wait: true })

    // 关键场景：subagent/end 在 childIndex 登记前到达（此前实现直接丢弃 → 永久挂起）
    await runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '完成了' }],
    })
    // 随后 runner 才返回 childId 并完成登记
    resolveStart({ childId: 'child-1', created: true })

    // 缓冲重试（10ms × 20 次上限）应最终命中登记并唤醒等待器
    const result = await Promise.race([
      waitPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('waiter 挂起超时')), 2_000)),
    ])
    expect(result.status).toBe('ok')
    expect(result.nodeId).toBe('n-a1')
    expect(result.output).toBe('完成了')
  })
})

describe('subagent/end 观察回写（§8 #21）', () => {
  it('completed/max-tokens → 节点状态区分（Bug 19：截断不再标记 ok）；其他 stopReason → fail；inflight 清空', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(entry.inflight.has('child-1')).toBe(true)

    // Bug 19：max-tokens = 模型输出被硬截断（内容不完整），不能再视为成功
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'max-tokens', lastAssistantMessage: [{ type: 'text', text: '结论' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
    expect(entry.inflight.has('child-1')).toBe(false)

    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    await h.runtime.handleSubagentEnd({ id: 'child-2', stopReason: 'error' })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a2')!.status).toBe('fail')
  })

  it('completed 仍标记 ok（Bug 19 修复不误伤正常完成）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '完成' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
  })

  it('未知 childId / 已终止运行：忽略不回写', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.handleSubagentEnd({ id: 'child-unknown', stopReason: 'completed' })
    expect(entry.snapshot.nodes.every((n) => n.status === 'pending')).toBe(true)

    // 启动后收尾：终态化把 running 收敛 fail；随后到达的 end 事件不得覆盖
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.wfFinish(caller, { status: 'completed' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'X' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
  })

  it('暂停状态下 end 仍回写节点 ok（该节点确实完成）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' }) // paused
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A完成' }] })
    expect(entry.snapshot.status).toBe('paused')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(entry.inflight.size).toBe(0)
  })

  it('软截停（T-022 护栏）：consumeReactCapped 标记 → 节点 react-capped（非失败，正常产出）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    })
    h.runner.capped.add('child-1')
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '软截停结论' }] })
    const result = await pending
    expect(result.status).toBe('ok') // wait 语义：软截停正常产出 → ok
    const node = h.runtime.runSnapshot('run-1')!.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(node.status).toBe('react-capped')
    expect(node.outputSummary).toBe('软截停结论')
    // 标记已消费：二次观察不再判定 react-capped
    expect(h.runner.capped.has('child-1')).toBe(false)
  })

  it('协作组聚合：全部成员完成后组卡片 ok；未完成保持 pending；react-capped 成员算完成', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    // a1/a2 入组（成员无 flow 连线，仅组卡片 flow 出入——校验规则 §4.2.5.2 规则 4）
    flow.nodes = flow.nodes.map((n): GraphNode =>
      n.id === 'n-a1' || n.id === 'n-a2'
        ? { ...n, data: { ...(n as RoleNode).data, groupId: 'n-group' } } as RoleNode
        : n,
    )
    flow.nodes.push({
      id: 'n-group',
      kind: 'group',
      position: { x: 0, y: 0 },
      data: { label: '协作组', collabPrompt: '组内通信', memberIds: ['n-a1', 'n-a2'] },
    })
    flow.lines = [
      { id: 'lg1', source: 'n-start', target: 'n-group', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'lg2', source: 'n-group', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ]
    const { entry } = await start(h, flow)
    // 成员 1 完成 → 组仍 pending
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-group')!.status).toBe('pending')
    // 成员 2 完成（软截停产出）→ 组卡片 ok
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    h.runner.capped.add('child-2')
    await h.runtime.handleSubagentEnd({ id: 'child-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'B' }] })
    const groupNode = entry.snapshot.nodes.find((n) => n.nodeId === 'n-group')!
    expect(groupNode.status).toBe('ok')
    expect(groupNode.output).toContain('协作组')
    // 组卡片 ok 后成员重试失败不回退
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    await h.runtime.handleSubagentEnd({ id: 'child-3', stopReason: 'error' })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-group')!.status).toBe('ok')
  })

  it('P0-1 组成员回合结束落 armed（非终态 ok）；非组内 agent 落 ok；armed 终态化收敛为 ok', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    // a1 入组（协作组成员，组内成员无流程连线——仅组卡片 flow 出入），a2 保持普通 agent
    flow.nodes = flow.nodes.map((n): GraphNode =>
      n.id === 'n-a1'
        ? { ...n, data: { ...(n as RoleNode).data, groupId: 'n-group' } } as RoleNode
        : n,
    )
    flow.nodes.push({
      id: 'n-group',
      kind: 'group',
      position: { x: 0, y: 0 },
      data: { label: '协作组', collabPrompt: '', memberIds: ['n-a1'] },
    })
    // 移除 a1 的流程连线（组内成员不能连流程线），改由组卡片 flow 出入
    flow.lines = flow.lines.filter((l) => l.source !== 'n-a1' && l.target !== 'n-a1')
    flow.lines.push(
      { id: 'lg1', source: 'n-start', target: 'n-group', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'lg2', source: 'n-group', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    )
    const { entry } = await start(h, flow)
    // 组内成员 n-a1 完成 → armed（待命，非终态 ok）
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('armed')
    // 运行收尾终态化：armed → ok（已产出一轮，非失败）
    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完毕' })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
  })
})

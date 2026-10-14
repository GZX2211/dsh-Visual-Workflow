// tests/host/orchestrator/runtime-service.test.ts
//
// 模式二服务运行路径（runtime + FlowStore 服务文档）：
//   - startRun mode2：按 serviceId 经 getServiceAsFlow 加载（非工作流表）；
//   - 用户问题注入输入节点（快照 ok + 产出）；编排指令 dynamic 段含问题；
//   - 输入节点右出 ctx 连线：下游节点任务块显式注入问题（buildNodeBlocks start 源）；
//   - mode1 不受 question 影响；resumeRun mode2（服务断点续跑）。
//
// 归属说明：断言对象是 OrchestratorRuntime 的服务文档运行路径（服务文档由 storage
// 投影），不涉及 service 模块的生命周期/端口/HTTP 适配——故归 orchestrator 测试目录。

import { afterEach, describe, expect, it } from 'vitest'
import type { CallerInfo, OrchestratorRuntime } from '../../../src/host/orchestrator/index.js'
import type { ServiceState } from '../../../src/host/shared/types.js'
import type { GraphNode, RoleNode, StageNode, WorkflowDocument, Line } from '../../../src/host/shared/graph-model.js'
import { stageLabel } from '../../../src/host/graph/index.js'
import {
  cleanupTempDirs,
  makeHarness as makeSharedHarness,
  type FakeAgents,
  type FakeRunner,
  type Harness as SharedHarness,
} from './fixtures/harness.js'

afterEach(cleanupTempDirs)

/** 服务模式会话 id（本文件全部用例以服务拥有者之外的运行会话运行）。 */
const SERVICE_SESSION = 'session-user-1'

function stage(id: string, kind: 'start' | 'end'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode2') } }
}

function parentNode(id: string): RoleNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: {
      label: '父代理',
      systemPrompt: '你是最终回答者',
      provider: 'deepseek',
      model: 'deepseek-chat',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: 'deepseek',
      model: 'deepseek-chat',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

/** 标准模式二服务流：输入 → 父代理 → 子任务 → 输出（含输入右出 ctx 连线）。 */
function serviceFlow(serviceId: string): WorkflowDocument {
  const lines: Line[] = [
    { id: 'l1', source: 'n-in', target: 'n-parent', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l2', source: 'n-parent', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l3', source: 'n-a1', target: 'n-out', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    // 输入节点 ctx-out → 子任务 ctx-in（显式传递用户问题）
    { id: 'c1', source: 'n-in', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
  ]
  return {
    id: serviceId,
    sessionId: 'session-owner',
    mode: 'mode2',
    name: '问答服务',
    description: '回答用户问题',
    revision: 1,
    nodes: [stage('n-in', 'start'), parentNode('n-parent'), agent('n-a1', '子任务'), stage('n-out', 'end')],
    lines,
  }
}

function toService(flow: WorkflowDocument): ServiceState {
  return {
    id: flow.id,
    sessionId: flow.sessionId,
    name: flow.name,
    description: flow.description,
    revision: flow.revision ?? 1,
    nodes: flow.nodes,
    lines: flow.lines,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    status: 'stopped',
  }
}


/** 兼容旧调用点的装配别名：统一走共享夹具（本地不再自建 fake，防「同名不同形状」漂移）。 */
interface Harness {
  runtime: OrchestratorRuntime
  store: SharedHarness['store']
  agents: FakeAgents
  runner: FakeRunner
}

async function makeHarness(): Promise<Harness> {
  const h = await makeSharedHarness({ sessionId: SERVICE_SESSION })
  return { runtime: h.runtime, store: h.store, agents: h.agents, runner: h.runner }
}

const caller: CallerInfo = { isChild: false, sessionId: SERVICE_SESSION }

/** 提取注入父代理的编排指令文本。 */
function lastDirective(h: Harness): string {
  const root = h.agents.roots.get(SERVICE_SESSION)!
  const message = root.messages[root.messages.length - 1]
  const text = message.content?.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
  return text
}

describe('startRun mode2（服务文档加载）', () => {
  it('按 serviceId 经 getServiceAsFlow 加载并运行', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    const result = await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2' })
    expect(result.runId).toBe('run-1')
    const snapshot = h.runtime.runSnapshot('run-1')
    expect(snapshot?.flowId).toBe('svc-1')
    expect(snapshot?.mode).toBe('mode2')
    expect(snapshot?.sessionId).toBe('session-user-1')
  })

  it('服务不存在 → WF_NOT_FOUND', async () => {
    const h = await makeHarness()
    await expect(h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-none', mode: 'mode2' }))
      .rejects.toMatchObject({ code: 'WF_NOT_FOUND' })
  })

  it('mode1 不受影响（question 不注入输入节点）', async () => {
    const h = await makeHarness()
    const flow = serviceFlow('flow-1')
    flow.mode = 'mode1'
    // mode1 阶段节点名称锁定为「启动/结束」；ctx 连线仅模式二输入节点语义
    flow.lines = flow.lines.filter((l) => l.id !== 'c1')
    flow.nodes = [
      { id: 'n-in', kind: 'start', position: { x: 0, y: 0 }, data: { label: stageLabel('start', 'mode1') } },
      parentNode('n-parent'),
      agent('n-a1', '子任务'),
      { id: 'n-out', kind: 'end', position: { x: 0, y: 0 }, data: { label: stageLabel('end', 'mode1') } },
    ]
    await h.store.saveWorkflow(flow, 'session-user-1')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'flow-1', question: '忽略我' })
    const snapshot = h.runtime.runSnapshot('run-1')
    const input = snapshot?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('pending')
  })
})

describe('用户问题注入', () => {
  it('问题写入输入节点产出（快照 ok + output），编排指令含问题', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '今天天气如何' })
    const snapshot = h.runtime.runSnapshot('run-1')
    const input = snapshot?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('ok')
    expect(input?.output).toBe('今天天气如何')
    expect(input?.outputSummary).toBe('今天天气如何')
    // 编排指令 dynamic 段（W-01：不稳定内容仅末段）
    expect(lastDirective(h)).toContain('用户问题（服务模式）：今天天气如何')
  })

  it('空问题不预填输入节点', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2' })
    const input = h.runtime.runSnapshot('run-1')?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('pending')
    expect(lastDirective(h)).not.toContain('User question')
  })

  it('输入节点是子任务的直接流程前驱：任务块自动注入用户问题（无需手动 ctx 连线）', async () => {
    const h = await makeHarness()
    const flow = serviceFlow('svc-1')
    // 输入节点直连子任务（流程线）：自动注入语义下不需要 ctx 连线
    flow.lines = flow.lines.filter((l) => l.id !== 'c1').concat([
      { id: 'l4', source: 'n-in', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ])
    await h.store.saveService(toService(flow), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '帮我查资料' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const input = h.runner.calls[0]
    const blocksText = input.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(blocksText).toContain('帮我查资料')
  })

  it('输入节点不是该子任务的流程前驱：用户问题不注入（且旧 ctx 连线不再生效）', async () => {
    const h = await makeHarness()
    const flow = serviceFlow('svc-1')
    // 保留原 ctx 连线（n-in → n-a1）：角色/输入节点的 ctx 交接线已退役，不再注入
    await h.store.saveService(toService(flow), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '秘密问题' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const blocksText = h.runner.calls[0].blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(blocksText).not.toContain('秘密问题')
  })
})

describe('resumeRun mode2（服务断点续跑）', () => {
  it('paused 服务运行可恢复（flow 从服务文档加载）', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(serviceFlow('svc-1')), 'session-owner')
    await h.runtime.startRun({ sessionId: 'session-user-1', flowId: 'svc-1', mode: 'mode2', question: '问题A' })
    // 模拟暂停门
    await h.runtime.stopRun('run-1') // 先停掉当前锁
    h.runtime.runs.delete('run-1')
    // 造一个磁盘 paused 记录（可恢复断点）
    // stopRun 已写磁盘；这里直接构造 paused 记录
    const prev = await h.store.getRun('run-1')
    expect(prev).toBeTruthy()
    await h.store.saveRun({ ...prev!, status: 'paused', nodes: prev!.nodes.map((n) => n.nodeId === 'n-in' ? { ...n, status: 'ok', output: '问题A', outputSummary: '问题A' } : n) })
    const result = await h.runtime.resumeRun({ sessionId: 'session-user-1', flowId: 'svc-1' })
    expect(result.resumedFromRunId).toBe('run-1')
    // 继承快照：已 ok 输入节点带产出（断点产出回填）
    const resumed = h.runtime.runSnapshot(result.runId)
    const input = resumed?.nodes.find((n) => n.nodeId === 'n-in')
    expect(input?.status).toBe('ok')
    expect(input?.output).toBe('问题A')
    expect(input?.resumed).toBe(true)
    // 断点继续指令
    expect(lastDirective(h)).toContain('正在恢复先前运行')
  })
})

describe('mode2 不支持 Team（用户裁决 2026-10）', () => {
  /** 含 Team 卡片的服务文档：Team 卡片串在流程上，成员节点无流程线（组内成员仅 ctx/db 连接点）。 */
  function teamServiceFlow(serviceId: string): WorkflowDocument {
    const flow = serviceFlow(serviceId)
    const member = flow.nodes.find((n) => n.id === 'n-a1') as RoleNode
    member.data.groupId = 'n-team'
    return {
      ...flow,
      nodes: [
        ...flow.nodes,
        {
          id: 'n-team',
          kind: 'group',
          position: { x: 0, y: 0 },
          data: { label: 'Team', collabPrompt: '', memberIds: ['n-a1'], size: { w: 300, h: 220 } },
        } as GraphNode,
      ],
      // 成员退出流程线：n-parent → Team 卡片 → n-out
      lines: [
        { id: 'l1', source: 'n-in', target: 'n-parent', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2', source: 'n-parent', target: 'n-team', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l3', source: 'n-team', target: 'n-out', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    }
  }

  it('Team 卡片与其成员节点在 wf_run_node_wait 通道下均被拒绝（WF_NODE_KIND）', async () => {
    const h = await makeHarness()
    await h.store.saveService(toService(teamServiceFlow('svc-team')), 'session-owner')
    await h.runtime.startRun({ sessionId: SERVICE_SESSION, flowId: 'svc-team', mode: 'mode2' })

    // Team 卡片：始终不是执行主体
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-team' }, undefined, { expectedMode: 'mode2' }))
      .rejects.toMatchObject({ code: 'WF_NODE_KIND' })
    // 成员节点：模式二完全不支持 Team，阻塞等待通道同样拒绝
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' }, undefined, { expectedMode: 'mode2' }))
      .rejects.toMatchObject({ code: 'WF_NODE_KIND' })
    expect(h.runner.calls).toHaveLength(0)
  })
})

// tests/host/orchestrator/runtime-base.test.ts
//
// 运行时基础层单测：断点自动接续、运行快照读取、双向同步（编排基线更新与编排变更注入）、执行者模式。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import { createRunSnapshot, parentExecutorOf, setNodeStatus, sweepWatchdogOnce } from '../../../src/host/orchestrator/index.js'
import { ORCH_CHANGE_MARKER } from '../../../src/host/prompts/index.js'
import { WF_DB_QUERY } from '../../../src/host/shared/protocol.js'
import { type GraphNode, type RoleNode, type WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { stage, agent, taskNode, parentNode, makeFlow, FakeRoot, type Harness, makeHarness, caller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

describe('运行上下文自动接续（运行锁降权）', () => {
  it('磁盘 stopped 断点：wfRunNode 自动续跑接管（无需工作台点运行）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    // 让 n-a1 产出 ok（模拟子代理已完成），再停止运行
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A 完成' }] })
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    await h.runtime.stopRun('run-1')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(result).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'running', runId: 'run-2' })
    // 续跑继承：已 ok 节点不重跑（状态与产出随断点继承），其余回退 pending
    const snapshot = h.runtime.runSnapshot('run-2')!
    expect(snapshot.resumedFromRunId).toBe('run-1')
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('ok')
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.resumed).toBe(true)
  })

  it('磁盘 interrupted 断点（宿主重启）：wfRunNode 自动续跑，续跑起点为首个未完成节点', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    // 直接构造一条宿主重启遗留的 interrupted 记录（reconcileStaleRuns 只处理 running/paused）
    const stale = createRunSnapshot({ runId: 'run-stale', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    setNodeStatus(stale, 'n-a1', 'ok', { now: 1000, output: 'A 完成' })
    stale.status = 'interrupted'
    stale.endedAt = new Date(2000).toISOString()
    await h.store.saveRun(stale)

    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const snapshot = h.runtime.runSnapshot('run-1')!
    expect(snapshot.resumedFromRunId).toBe('run-stale')
    // 已 ok 节点（n-a1）不重跑；起点推断为首个未完成节点（n-pause）
    expect(snapshot.resumeFromNodeId).toBe('n-pause')
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.resumed).toBe(true)
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.output).toBe('A 完成')
  })

  it('最近断点优先：多条可恢复记录时取 startedAt 最新的一条', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const older = createRunSnapshot({ runId: 'run-old', flow, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    older.status = 'stopped'
    await h.store.saveRun(older)
    const newer = createRunSnapshot({ runId: 'run-new', flow, sessionId: 'session-1', mode: 'mode1', now: 9000 })
    newer.status = 'stopped'
    await h.store.saveRun(newer)

    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect((await h.store.getRun('run-1'))?.resumedFromRunId).toBe('run-new')
  })

  it('并发调度只续跑一次：同 flowId 的并发调用共享同一续跑（不抛 WF_LOCKED）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const [a, b] = await Promise.all([
      h.runtime.wfRunNode(caller, { nodeId: 'n-a2' }),
      h.runtime.wfRunNode(caller, { nodeId: 'n-a1' }),
    ])
    expect(a).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect(b).toMatchObject({ nodeId: 'n-a1', status: 'started' })
    // 只生成一条新 run（run-2），没有第二次续跑
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ runId: 'run-2' })
    expect(await h.store.getRun('run-3')).toBeNull()
  })

  it('终态（completed/failed）不自动续跑：无断点即 WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('续跑失败（工作流已不完整）时向上抛精确错误，不静默', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.stopRun('run-1')
    // 画布被改坏：删掉结束节点 → 续跑校验失败
    const broken = { ...makeFlow(), nodes: makeFlow().nodes.filter((n) => n.kind !== 'end') }
    await h.store.saveWorkflow(broken, 'session-1', { force: true })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_FLOW_INCOMPLETE' })
  })

  it('最新断点不可恢复时回退次新一条（逐条 try，不因一条失败放弃整轮接续）', async () => {
    const h = await makeHarness()
    const good = makeFlow()
    await h.store.saveWorkflow(good, 'session-1', { force: true })
    // 更新的断点属于另一条已被改坏的流程（缺结束节点）：接续必然失败
    const broken = { ...makeFlow(), id: 'flow-broken', name: '坏流程', nodes: makeFlow().nodes.filter((n) => n.kind !== 'end') }
    await h.store.saveWorkflow(broken, 'session-1', { force: true })

    const older = createRunSnapshot({ runId: 'run-good', flow: good, sessionId: 'session-1', mode: 'mode1', now: 1000 })
    older.status = 'stopped'
    await h.store.saveRun(older)
    const newer = createRunSnapshot({ runId: 'run-broken', flow: broken, sessionId: 'session-1', mode: 'mode1', now: 9000 })
    newer.status = 'stopped'
    await h.store.saveRun(newer)

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    expect(result).toMatchObject({ nodeId: 'n-a1', status: 'started' })
    // 次新一条被接管（继承链指向 run-good），坏断点未被误用、也保持原状
    const lock = h.runtime.flowLockInfo('flow-1')
    expect(lock).toMatchObject({ status: 'running' })
    expect((await h.store.getRun(String(lock?.runId)))?.resumedFromRunId).toBe('run-good')
    expect((await h.store.getRun('run-broken'))?.status).toBe('stopped')
  })

  it('全部断点都无法接续：错误列出被跳过的断点与原因（可行动，不静默丢断点）', async () => {
    const h = await makeHarness()
    const nodesOf = (id: string) => ({ ...makeFlow(), id, nodes: makeFlow().nodes.filter((n) => n.kind !== 'end') })
    await h.store.saveWorkflow(nodesOf('flow-bad-a'), 'session-1', { force: true })
    await h.store.saveWorkflow(nodesOf('flow-bad-b'), 'session-1', { force: true })
    const first = createRunSnapshot({ runId: 'run-bad-a', flow: nodesOf('flow-bad-a'), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    first.status = 'stopped'
    await h.store.saveRun(first)
    const second = createRunSnapshot({ runId: 'run-bad-b', flow: nodesOf('flow-bad-b'), sessionId: 'session-1', mode: 'mode1', now: 9000 })
    second.status = 'stopped'
    await h.store.saveRun(second)

    const failure = await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' }).then(() => null, (error: unknown) => error)

    // 错误码取最新一条的恢复类错误（单候选时与旧行为一致），消息里逐条列出被跳过的断点
    expect(failure).toMatchObject({ code: 'WF_FLOW_INCOMPLETE' })
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain('run-bad-b')
    expect(message).toContain('run-bad-a')
  })

  it('wf_finish：无激活运行但有断点时自动续跑后收尾（磁盘旧记录保持原状）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.stopRun('run-1')
    const finish = await h.runtime.wfFinish(caller, { status: 'completed', summary: '确认完成' })
    expect(finish).toMatchObject({ ok: true, status: 'completed', runId: 'run-2' })
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('stopped')
    expect((await h.store.getRun('run-2'))?.status).toBe('completed')
  })
})

describe('工具路径静默接续（父代理在自身回合内自行接管断点）', () => {
  it('内存 paused 断点 + 父代理忙碌：静默接管锁且不注入编排指令', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'paused', runId: 'run-1' })

    // 父代理此刻正在自身回合内调用工具（root.status === 'running'）——这正是
    // 「人工点运行」旧限制成立的场景：续跑若要求父代理空闲，工具路径永远接不上。
    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })

    expect(result).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'running', runId: 'run-2' })
    expect((await h.store.getRun('run-2'))?.resumedFromRunId).toBe('run-1')
    // 静默：不向父代理注入编排指令，父代理在自己的回合里继续调度
    expect(root.messages).toHaveLength(injected)
    expect(root.steered).toHaveLength(0)
    // 旧 paused 内存条目已释放（锁随新 run 接管）
    expect(h.runtime.entryFor('run-1')).toBeNull()
  })

  it('磁盘 stopped 断点 + 父代理忙碌：静默接管锁且不注入编排指令', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A 完成' }] })
    await h.runtime.stopRun('run-1')

    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })

    expect(result).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect((await h.store.getRun('run-2'))?.resumedFromRunId).toBe('run-1')
    // 断点继承语义不变：已 ok 节点不重跑
    expect(h.runtime.runSnapshot('run-2')?.nodes.find((n) => n.nodeId === 'n-a1')?.resumed).toBe(true)
    expect(root.messages).toHaveLength(injected)
  })

  it('父代理忙碌但无任何断点：仍报 WF_NO_ACTIVE_RUN（静默接续不放宽硬边界）', async () => {
    const h = await makeHarness()
    h.agents.roots.get('session-1')!.status = 'running'

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('静默接续仍绑定父代理配置（角色 Prompt/模型），只跳过编排指令', async () => {
    const bound: string[] = []
    const h = await makeHarness({}, {
      promptSetup: { bindParent: (_ctx, state, sessionId) => { bound.push(`${sessionId}:${state.systemPrompt}`) } },
      modelSelection: { bindParent: () => {} },
      resolveRolePrompt: async () => '父代理角色提示词',
    })
    const flow = makeFlow()
    flow.nodes.push(parentNode('n-parent', '父代理'))
    await start(h, flow)
    expect(bound).toEqual(['session-1:父代理角色提示词'])

    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length

    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })

    // 配置绑定照常执行（静默不等于完全跳过注入）；注入到会话的编排指令则不追加
    expect(bound).toEqual(['session-1:父代理角色提示词', 'session-1:父代理角色提示词'])
    expect(root.messages).toHaveLength(injected)
  })

  it('工作台显式续跑（resumeRun）仍要求父代理空闲：忙碌报 WF_ROOT_BUSY 且不接管锁', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length

    await expect(h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_ROOT_BUSY' })

    // 失败无副作用：旧暂停断点与运行锁原样保留
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'paused', runId: 'run-1' })
    expect(root.messages).toHaveLength(injected)
  })
})

describe('currentResolvedFlow 双向同步（§4.7 规则 1 ①）', () => {
  it('运行中画布修改即时生效：新增节点可被调度', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    // 运行中保存新版流程：新增节点 n-a3
    const updated = makeFlow()
    updated.nodes.splice(3, 0, agent('n-a3', '新增任务'))
    updated.lines.push({ id: 'l5', source: 'n-pause', target: 'n-a3', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    await h.store.saveWorkflow(updated, 'session-1', { force: true })

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a3' })
    expect(result.status).toBe('started')
  })

  it('读取失败回退起始快照（baseFlow）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    h.store.getWorkflow = async () => {
      throw new Error('读取失败')
    }
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(result.status).toBe('started') // baseFlow 中 n-a2 存在
  })

  it('Bug 20：mode2 运行中 currentResolvedFlow 读服务文档（修复前回退 baseFlow 读错文档）', async () => {
    const h = await makeHarness()
    const parentNode: RoleNode = {
      id: 'n-p', kind: 'parent', position: { x: 0, y: 0 },
      data: { label: '父代理', systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
    }
    const service = {
      id: 'svc-2',
      sessionId: 'session-1',
      mode: 'mode2',
      name: '服务',
      description: '初始描述',
      revision: 1,
      status: 'stopped',
      nodes: [stage('n-in', 'start', 'mode2'), parentNode, agent('n-a1', '任务'), stage('n-out', 'end', 'mode2')],
      lines: [
        { id: 's1', source: 'n-in', target: 'n-p', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 's2', source: 'n-p', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 's3', source: 'n-a1', target: 'n-out', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    } as never
    await h.store.saveService(service, 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'svc-2', mode: 'mode2' })
    const entry = h.runtime.activeRunForSession('session-1')
    expect(entry).toBeTruthy()

    // 运行中调整服务文档
    const updated = { ...(service as Record<string, unknown>), description: '运行中调整后的描述' } as never
    await h.store.saveService(updated, 'session-1', { force: true })

    const resolved = await h.runtime.currentResolvedFlow(entry!)
    // 修复前：固定读 workflows/ 下文档（svc-2 不存在）→ 回退 baseFlow 旧描述
    expect(resolved.description).toBe('运行中调整后的描述')
  })

  it('runSnapshot 返回深拷贝：修改副本不影响内部状态', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const copy = h.runtime.runSnapshot('run-1')!
    copy.status = 'failed'
    copy.nodes[0].status = 'ok'
    expect(h.runtime.runSnapshot('run-1')!.status).toBe('running')
    expect(h.runtime.runSnapshot('run-1')!.nodes[0].status).toBe('pending')
    expect(h.runtime.runSnapshot('run-none')).toBeNull()
  })
})

describe('refreshActiveDefinitions：画布保存 → 运行编排基线更新（双向同步①）', () => {
  it('运行中保存实例：更新本 run 的编排基线（父代理经工具召回最新拓扑）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    expect(h.runtime.entryFor(result.runId)?.lastSyncedFlow?.nodes).toHaveLength(6) // start/a1/pause/a2/end/proxy

    // 模拟画布保存：新增一个节点后的最新文档
    const updated = { ...flow, revision: 2, nodes: [...flow.nodes, agent('n-a3', '子任务C')] }
    await h.store.saveWorkflow(updated, 'session-1', { force: true })
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)

    // 基线已前进：下一次保存的「编排语义是否变更」以最新拓扑为基准
    expect(h.runtime.entryFor(result.runId)?.lastSyncedFlow?.nodes.map((n) => n.id)).toContain('n-a3')
    // 快照节点状态不受影响（只更新编排基线，不重置节点记录）
    expect(h.runtime.runSnapshot(result.runId)?.nodes).toHaveLength(6)
  })

  it('已结束的 run：空操作（幂等，既不注入也不报错）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    await h.runtime.stopRun(result.runId)
    const root = h.agents.roots.get('session-1') as FakeRoot

    const updated = { ...flow, revision: 3, nodes: [...flow.nodes, agent('n-a4', '新任务')] }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)

    expect(root.steered).toHaveLength(0)
    expect(root.messages).toHaveLength(1)
  })
})

describe('运行中画布保存 → 编排变更注入（新机制）', () => {
  /** 取下该会话的父代理 fake（断言注入通道用）。 */
  function rootOf(h: Harness): FakeRoot {
    const root = h.agents.roots.get('session-1')
    if (!root) throw new Error('缺少父代理 fake')
    return root as FakeRoot
  }

  it('编排语义变更 + 父代理忙碌：steer 插队注入【编排变更】', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    const root = rootOf(h)
    root.status = 'running'
    // 画布新增节点 + 新增连线（编排语义变更）
    const updated: WorkflowDocument = {
      ...flow,
      revision: 2,
      nodes: [...flow.nodes, agent('n-a3', '子任务C')],
      lines: [...flow.lines, { id: 'l5', source: 'n-a2', target: 'n-a3', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
    }
    await h.store.saveWorkflow(updated, 'session-1', { force: true })
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)

    expect(root.steered).toHaveLength(1)
    const text = root.steered[0]?.content[0]?.text ?? ''
    expect(text).toContain(ORCH_CHANGE_MARKER)
    // 安全门禁：注入文本不含宿主路径与数据目录名（父代理无从进入用户私有存储）
    expect(text).not.toContain(h.store.root)
    expect(text).not.toContain('orchestrations')
    expect(text).not.toContain('.json')
    // 未走 followup（父代理忙碌时不新起回合；messages 仅启动注入那一条）
    expect(root.messages).toHaveLength(1)
    // 基线已更新为最新拓扑
    expect(h.runtime.entryFor(result.runId)?.lastSyncedFlow?.nodes.map((n) => n.id)).toContain('n-a3')
  })

  it('纯几何改动（节点坐标）：不注入，但基线照常前进', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    const root = rootOf(h)
    root.status = 'running'
    const moved: WorkflowDocument = {
      ...flow,
      revision: 2,
      nodes: flow.nodes.map((node) => ({ ...node, position: { x: 321, y: 654 } })),
    }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', moved)

    expect(root.steered).toHaveLength(0)
    expect(root.messages).toHaveLength(1)
    // 基线仍前进（几何改动不算编排语义变更，但下次比较应对齐最新文档）
    expect(h.runtime.entryFor(result.runId)?.lastSyncedFlow?.nodes[0]?.position).toEqual({ x: 321, y: 654 })
  })

  it('节点配置变化（systemPrompt）：注入', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    const root = rootOf(h)
    root.status = 'running'
    const patched: WorkflowDocument = {
      ...flow,
      revision: 2,
      nodes: flow.nodes.map((node) => (node.id === 'n-a1'
        ? ({ ...node, data: { ...(node as { data: Record<string, unknown> }).data, systemPrompt: '任务：改后的A' } } as GraphNode)
        : node)),
    }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', patched)
    expect(root.steered).toHaveLength(1)
    expect(result.runId).toBeTruthy()
  })

  it('父代理空闲：followupRoot 兜底注入（不丢通知）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    await start(h, flow)
    const root = rootOf(h)
    root.status = 'idle'
    const updated = { ...flow, revision: 2, nodes: [...flow.nodes, agent('n-a3', '子任务C')] }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)

    expect(root.steered).toHaveLength(0)
    expect(root.messages).toHaveLength(2)
    expect(root.messages[1]?.content[0]?.text ?? '').toContain(ORCH_CHANGE_MARKER)
  })

  it('paused run：只更新基线，不注入（不打断暂停态）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const { result } = await start(h, flow)
    const root = rootOf(h)
    const entry = h.runtime.entryFor(result.runId)
    if (!entry) throw new Error('缺少 run entry')
    entry.snapshot.status = 'paused'
    const updated = { ...flow, revision: 2, nodes: [...flow.nodes, agent('n-a3', '子任务C')] }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)

    expect(root.steered).toHaveLength(0)
    expect(root.messages).toHaveLength(1)
    // 暂停态不注入通知，但基线已对齐：恢复后按最新拓扑续跑
    expect(entry.lastSyncedFlow?.nodes.map((n) => n.id)).toContain('n-a3')
  })

  it('连续两次相同保存：第二次无变更 → 不重复注入', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    await start(h, flow)
    const root = rootOf(h)
    root.status = 'running'
    const updated = { ...flow, revision: 2, nodes: [...flow.nodes, agent('n-a3', '子任务C')] }
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)
    await h.runtime.refreshActiveDefinitions('flow-1', 'session-1', updated)
    expect(root.steered).toHaveLength(1)
  })
})

describe('父代理执行者模式', () => {
  /** 父代理节点（kind='parent'）。 */
  function parentAgent(id: string, label: string, extra: Partial<RoleNode['data']> = {}): RoleNode {
    return { ...agent(id, label, extra), kind: 'parent' }
  }

  /** 父代理节点被流程线连接的流程：start → parent(flow-in) → a1 → parent(flow-out) → end。 */
  function executorFlow(): WorkflowDocument {
    return {
      id: 'flow-exec',
      sessionId: 'session-1',
      mode: 'mode1',
      name: '执行者流程',
      description: '父代理先执行自身任务',
      revision: 1,
      nodes: [
        stage('n-start', 'start', 'mode1'),
        parentAgent('n-parent', '父代理', { presetId: 'standard' }),
        agent('n-a1', '子任务A'),
        stage('n-end', 'end', 'mode1'),
      ],
      lines: [
        { id: 'l1', source: 'n-start', target: 'n-parent', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2', source: 'n-parent', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2c', source: 'n-parent', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
        { id: 'l3', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    }
  }

  it('prepare 前置：parentExecutorOf 仅当存在 flow-in 连线时命中', async () => {
    const h = await makeHarness()
    const flow = executorFlow()
    const executor = parentExecutorOf(flow)
    expect(executor).not.toBeNull()
    expect(executor?.nodeId).toBe('n-parent')
    // 去掉 flow-in 连线：纯调度者
    const plain = { ...flow, lines: flow.lines.filter((l) => !(l.target === 'n-parent' && l.targetHandle === 'flow-in')) }
    expect(parentExecutorOf(plain)).toBeNull()
    void h
  })

  it('startRun 执行者模式：快照父代理节点 running + 指令含执行者措辞与任务块（ctx/db 提示注入）', async () => {
    const h = await makeHarness()
    const flow = executorFlow()
    // 任务节点 ctx-out → 父代理 ctx-in + 数据库 db-out → 父代理 db-in
    flow.nodes.push(taskNode('n-file', '规格', { content: '需求文本' }))
    flow.nodes.push({ id: 'n-db', kind: 'database', position: { x: 0, y: 0 }, data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '' } })
    flow.lines.push(
      { id: 'l-f', source: 'n-file', target: 'n-parent', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'l-d', source: 'n-db', target: 'n-parent', sourceHandle: 'db-out', targetHandle: 'db-in' },
    )
    const { result, entry } = await start(h, flow)
    const parentNode = h.runtime.runSnapshot(result.runId)?.nodes.find((n) => n.nodeId === 'n-parent')
    expect(parentNode?.status).toBe('running')
    expect(entry.executorParentId).toBe('n-parent')
    const directive = h.agents.roots.get('session-1')!.messages[0].content.map((c) => c.text).join('\n')
    expect(directive).toContain('n-parent') // 父代理执行节点身份数据
    expect(directive).toContain('需求文本') // 任务描述经 ctx 连线直通
    expect(directive).toContain(WF_DB_QUERY) // db 提示（工具名取自协议常量）
  })

  it('纯调度者（无 flow-in）：指令不含执行者措辞与任务块，父代理节点保持 pending', async () => {
    const h = await makeHarness()
    const flow = executorFlow()
    const plain = { ...flow, lines: flow.lines.filter((l) => !(l.target === 'n-parent' && l.targetHandle === 'flow-in')) }
    const { result } = await start(h, plain)
    const parentNode = h.runtime.runSnapshot(result.runId)?.nodes.find((n) => n.nodeId === 'n-parent')
    expect(parentNode?.status).toBe('pending')
    const directive = h.agents.roots.get('session-1')!.messages[0].content.map((c) => c.text).join('\n')
    expect(directive).not.toContain('n-parent')
  })

  it('wfRunNode 首次调度：父代理节点标记 ok，输出回写最近 assistant/message 文本', async () => {
    const h = await makeHarness()
    const { result } = await start(h, executorFlow())
    // 父代理产出（官方 session.events 的 assistant/message 块数组形态）
    const root = h.agents.roots.get('session-1')!
    root.session.events.push({
      type: 'assistant/message',
      time: 1_000_100,
      data: { message: { content: [{ type: 'text', text: '我已完成自身任务：分析结论 X' }] } },
    })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const parentNode = h.runtime.runSnapshot(result.runId)?.nodes.find((n) => n.nodeId === 'n-parent')
    expect(parentNode?.status).toBe('ok')
    expect(parentNode?.output).toContain('分析结论 X')
    // 下游 ctx 注入：a1 的任务块应包含父代理产出（上游角色产出注入）
    const a1Call = h.runner.calls.find((call) => call.node.id === 'n-a1')
    expect(a1Call?.blocks[0].text).toContain('分析结论 X')
  })

  it('wfFinish 收尾：父代理节点同步标记 ok（无后续调度的流程）', async () => {
    const h = await makeHarness()
    const flow = executorFlow()
    // 父代理 flow-out 直连 end（无 agent 下游）
    flow.lines = flow.lines.filter((l) => l.id !== 'l2')
    const { result } = await start(h, flow)
    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })
    // 收尾后内存条目释放：查磁盘记录
    const disk = await h.store.getRun(result.runId)
    expect(disk?.nodes.find((n) => n.nodeId === 'n-parent')?.status).toBe('ok')
  })

  it('结束后 stop：父代理节点 running → fail（terminalize 语义）', async () => {
    const h = await makeHarness()
    const { result } = await start(h, executorFlow())
    await h.runtime.stopRun(result.runId)
    // 内存条目 terminated 后已释放：查磁盘记录
    const disk = await h.store.getRun(result.runId)
    expect(disk?.nodes.find((n) => n.nodeId === 'n-parent')?.status).toBe('fail')
  })
})

describe('Experience 最小运行事实 seam（只读语义化查询）', () => {
  it('无活跃 run：seam 全部给出「无」结果，不抛错', async () => {
    const h = await makeHarness()
    expect(h.runtime.activeExperienceRunForSession('session-1')).toBeNull()
    expect(h.runtime.experienceRunForChild('child-1')).toBeNull()
  })

  it('活跃 run：按会话给出 run 归属三元组（runId/flowId/sessionId）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())

    expect(h.runtime.activeExperienceRunForSession('session-1')).toEqual({
      runId: 'run-1',
      flowId: 'flow-1',
      sessionId: 'session-1',
      roleKey: '',
      roleLabel: '',
    })
    expect(h.runtime.activeRunForSession('session-1')).not.toBeNull()
    expect(h.runtime.activeRunForSession('session-2')).toBeNull()
    expect(h.runtime.activeExperienceRunForSession('session-2')).toBeNull()
  })

  it('子代理：按 childId 给出 run 与节点归属；未登记返回 null', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    expect(h.runtime.experienceRunForChild('child-1')).toEqual({
      runId: 'run-1',
      flowId: 'flow-1',
      sessionId: 'session-1',
      nodeId: 'n-a1',
      roleKey: 'label:子任务A',
      roleLabel: '子任务A',
    })
    expect(h.runtime.experienceRunForChild('child-none')).toBeNull()
  })

  it('已退役（被替换）的子代理：不再给出 run 归属', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    // 同节点再次启动且引擎报告替换了旧 child（配置签名变化路径）
    h.runner.nextReplacedChildId = 'child-1'
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    expect(h.runtime.experienceRunForChild('child-1')).toBeNull()
    expect(h.runtime.experienceRunForChild('child-2')).toMatchObject({ runId: 'run-1', nodeId: 'n-a1' })
  })

  it('paused run 不算活跃：activeRunForSession 为 null', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    // 暂停事实经只读快照查询（原 pausedRun 查询入口已退役）
    expect(h.runtime.runSnapshot('run-1')?.status).toBe('paused')
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
  })

  it('run 结束后不再给出归属：终态条目已释放', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.stopRun('run-1')

    expect(h.runtime.activeExperienceRunForSession('session-1')).toBeNull()
    expect(h.runtime.experienceRunForChild('child-1')).toBeNull()
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
  })
})

describe('运行活性基准刷新（touchRunForSession）', () => {
  /** 线性流程：start → a1 → end（无父代理执行单元，父代理为纯调度者）。 */
  function touchFlow(id: string, sessionId: string): WorkflowDocument {
    return {
      id,
      sessionId,
      mode: 'mode1',
      name: `流程-${id}`,
      description: '活性基准测试',
      revision: 1,
      nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-end', 'end')],
      lines: [
        { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    }
  }

  it('running 的本人会话运行：lastActiveAt 前进并返回 true', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, touchFlow('flow-1', 'session-1'))
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-1')).toBe(true)
    expect(entry.lastActiveAt).toBe(before + 30_000)
  })

  it('paused 运行不刷新（看护只扫 running，无需活性基准）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, touchFlow('flow-2', 'session-1'))
    entry.snapshot.status = 'paused'
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-1')).toBe(false)
    expect(entry.lastActiveAt).toBe(before)
  })

  it('其他会话的运行不刷新（子代理/他会话事件不误刷本人运行）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, touchFlow('flow-3', 'session-1'))
    const before = entry.lastActiveAt
    h.clock.now += 30_000
    expect(h.runtime.touchRunForSession('session-2')).toBe(false)
    expect(entry.lastActiveAt).toBe(before)
  })

  it('空会话 id / 无任何运行：返回 false 且不抛错', async () => {
    const h = await makeHarness()
    expect(h.runtime.touchRunForSession('')).toBe(false)
    expect(h.runtime.touchRunForSession('session-1')).toBe(false)
  })

  it('看护联动：父代理持续干活（反复转 running）时不会因空闲超时被自动停止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, touchFlow('flow-4', 'session-1'))
    // 每次扫描都恰好处于「超过空闲门限」的时刻，但每次都被 agent/status 刷新救回
    for (let round = 0; round < 3; round += 1) {
      h.clock.now += 600 // > runIdleTimeoutMs(500)
      h.runtime.touchRunForSession('session-1')
      await sweepWatchdogOnce(h.runtime)
      expect(entry.snapshot.status).toBe('running')
    }
    // 对照组：不再刷新后，超时即被停止（证明前三次确实靠刷新续命）
    h.clock.now += 600
    await sweepWatchdogOnce(h.runtime)
    expect(entry.snapshot.status).toBe('stopped')
  })
})

// ---------------------------------------------------------------------------
// 父代理执行单元的注入文案：重试预算分母必须与运行护栏同源
// ---------------------------------------------------------------------------

/**
 * hybrid 流程（父代理被流程线连接 → 自身也是执行单元）：start → parent → a1 → end。
 * `retryLimit` 由用例给出，用于验证注入文案里的分母随节点配置变化。
 */
function hybridBudgetFlow(parentRetryLimit: number): WorkflowDocument {
  const base = parentNode('n-p', '父代理')
  return {
    id: 'flow-budget',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '父代理执行预算',
    description: '验证注入文案里的重试预算',
    revision: 1,
    nodes: [
      stage('n-start', 'start'),
      { ...base, data: { ...base.data, retryLimit: parentRetryLimit } },
      agent('n-a1', '子任务'),
      stage('n-end', 'end'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-p', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-p', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

describe('父代理执行单元的重试预算文案', () => {
  it('节点 retryLimit=3 → 注入 attempt N/4（与本 run 护栏 attempt > limit + 1 同源）', async () => {
    const h = await makeHarness()
    await start(h, hybridBudgetFlow(3))
    const directive = h.agents.roots.get('session-1')!.messages[0].content.map((c) => c.text).join('\n')
    expect(directive).toContain('attempt 1/4（父代理执行单元）')
    expect(directive).not.toContain('attempt 1/1')
  })

  it('节点 retryLimit=0（不重试）→ 注入 attempt 1/1（预算真实为 1 次）', async () => {
    const h = await makeHarness()
    await start(h, hybridBudgetFlow(0))
    const directive = h.agents.roots.get('session-1')!.messages[0].content.map((c) => c.text).join('\n')
    expect(directive).toContain('attempt 1/1（父代理执行单元）')
  })
})

// ---------------------------------------------------------------------------
// 闸门退役：运行时不再暴露闸门标记能力（遗留 data.role 一律按普通执行入口处理）
// ---------------------------------------------------------------------------

/** 遗留图：父代理虚拟节点仍带退役前的 data.role='milestone'。 */
function legacyMilestoneFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '闸门流程',
    description: '',
    revision: 1,
    nodes: [
      stage('n-start', 'start'),
      parentNode('n-p1', 'CEO'),
      { id: 'n-m1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-p1', data: { role: 'milestone' } } as unknown as GraphNode,
      agent('n-a1', '子任务A'),
      stage('n-end', 'end'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-m1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-m1', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

describe('闸门退役（运行时）', () => {
  it('运行时不再暴露闸门标记能力（facts / writer / 计数）', async () => {
    const h = await makeHarness()
    expect('markMilestoneNode' in h.runtime).toBe(false)
    expect('milestoneFactsFor' in h.runtime).toBe(false)
    expect('milestoneUsedForSession' in h.runtime).toBe(false)
  })

  it('遗留 data.role=milestone：父代理虚拟节点按普通执行入口自动完成（旧数据容错）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, legacyMilestoneFlow())
    expect(entry.executorParentId).toBe('n-p1')
    expect('executorIsMilestone' in entry).toBe(false)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'n-p1')?.status).toBe('ok')
  })
})
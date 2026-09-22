// tests/host/orchestrator/runtime-launch.test.ts
//
// 启动层单测（startRun/resumeRun）：并发运行锁、启动校验、事实源写入、指令注入、运行会话归属。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FlowStore } from '../../../src/host/storage/flow-store.js'
import { OrchestratorRuntime } from '../../../src/host/orchestrator/index.js'
import { HEAD_MARKER, MID_MARKER, ORCH_HARD_CONSTRAINTS, TAIL_MARKER, TAIL_RESTATE_MARKER } from '../../../src/host/prompts/index.js'
import type { ServiceState } from '../../../src/host/shared/types.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { makeFlow, stage, agent, FakeRoot, makeHarness, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

describe('startRun 并发运行锁（TOCTOU 竞态回归）', () => {
  it('并发 startRun 同一 flowId：只允许一个成功，另一个 WF_LOCKED', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    // 受控闸门：让两个并发 startRun 都在运行锁首查之后、登记之前交错
    // （两请求都读到「无锁」，制造 check-then-act 竞态窗口）。
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let inGate = 0
    // Object.create 保留 FlowStore 原型链方法（spread 会丢失），仅覆盖 getWorkflow
    const slowStore = Object.create(h.store) as FlowStore
    slowStore.getWorkflow = async (sessionId: string, flowId: string) => {
      inGate += 1
      if (inGate === 1 || inGate === 2) await gate
      return h.store.getWorkflow(sessionId, flowId)
    }
    const slowRuntime = new OrchestratorRuntime({
      store: slowStore,
      runner: h.runner,
      agents: h.agents,
      config: {
        outputFullLimit: 400, documentTextLimit: 200, runIdleTimeoutMs: 500,
        retryLimitDefault: 3, reactIterationLimitDefault: 50, wfAskAgentTimeoutMs: 500,
      },
      logger: { warn: (message) => h.warnings.push(message), info: () => {}, debug: () => {} },
      now: () => h.clock.now,
      newRunId: () => 'run-race',
      uuid: () => 'uuid-race',
    })

    const p1 = slowRuntime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const p2 = slowRuntime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    // 等两个请求都进入闸门（都已完成锁首查且看到 null）
    await new Promise<void>((resolve) => {
      const tick = (): void => { if (inGate >= 2) resolve(); else setTimeout(tick, 5) }
      tick()
    })
    release()

    const results = await Promise.allSettled([p1, p2])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string }
    expect(reason.code).toBe('WF_LOCKED')
    // 内存中只登记了一个激活 run
    expect(slowRuntime.activeRunForSession('session-1')).not.toBeNull()
    // 磁盘 orchestration 只写了一份（后写者未走到事实源写入）
    const dir = join(h.store.root, 'orchestrations')
    const files = await import('node:fs/promises').then((fs) => fs.readdir(dir))
    expect(files.length).toBe(1)
  })
})

describe('startRun 启动与运行锁', () => {
  it('成功：锁建立、快照 running、事实源写入、指令注入、开始即落盘', async () => {
    const h = await makeHarness()
    const { result, entry } = await start(h, makeFlow())

    expect(result.runId).toBe('run-1')
    expect(result.defPath).toContain('orchestrations')
    expect(entry.snapshot.status).toBe('running')
    expect(entry.snapshot.flowName).toBe('测试流程')

    // 运行锁：flowLockInfo 返回本运行
    const lock = h.runtime.flowLockInfo('flow-1')
    expect(lock).toEqual({ flowId: 'flow-1', sessionId: 'session-1', runId: 'run-1', flowName: '测试流程', status: 'running' })

    // 注入消息契约：id + source 齐备（缺 source 父回合 UNKNOWN 失败——旧项目根因）
    const root = h.agents.roots.get('session-1')!
    expect(root.messages).toHaveLength(1)
    const msg = root.messages[0]
    expect(msg.id).toBe('uuid-1')
    expect(msg.role).toBe('user')
    expect(msg.source).toEqual({ kind: 'user' })
    expect(typeof msg.content[0].text).toBe('string')

    // 事实源文件已写（父代理只读）
    const def = await h.store.readOrchestration('run-1')
    expect(def?.id).toBe('flow-1')

    // 开始即落盘（§4.7：崩溃后历史可追溯）
    const persisted = await h.store.getRun('run-1')
    expect(persisted?.status).toBe('running')
  })

  it('编排指令模板满足 W-01/W-02：marker 顺序、硬约束双位机制、动态值仅在末段', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const text = h.agents.roots.get('session-1')!.messages[0].content[0].text

    // W-01 前缀稳定三段布局：head < mid < tail
    const headAt = text.indexOf(HEAD_MARKER)
    const midAt = text.indexOf(MID_MARKER)
    const tailAt = text.indexOf(TAIL_MARKER)
    expect(headAt).toBeGreaterThanOrEqual(0)
    expect(midAt).toBeGreaterThan(headAt)
    expect(tailAt).toBeGreaterThan(midAt)

    // W-02 关键约束双位机制：首段含硬约束、末段重申（TAIL_RESTATE_MARKER + 至少一条导出常量）
    // 仅验证「双位机制」，不绑定具体文案条目（提示词文案可随版本润色）
    const headSection = text.slice(0, midAt)
    const tailSection = text.slice(tailAt)
    expect(headSection).toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(Object.values(ORCH_HARD_CONSTRAINTS).some((v) => tailSection.includes(v))).toBe(true)
    expect(tailSection).toContain(TAIL_RESTATE_MARKER)

    // 动态值（暂停节点 id）仅注入末段且只出现一次
    expect(text.indexOf('n-pause')).toBe(text.lastIndexOf('n-pause'))
    expect(text.indexOf('n-pause')).toBeGreaterThan(tailAt)
  })

  it('组织预算注入（P2 §6.4）：冻结元参数 → 剩余量文本，且只在末段', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.meta = { nodeMax: 5, groupMax: 2, membersMax: 4, milestoneMax: 3, patchOpsMax: 10 }
    await start(h, flow)
    const text = h.agents.roots.get('session-1')!.messages[0].content[0].text
    const tailAt = text.indexOf(TAIL_MARKER)
    expect(tailAt).toBeGreaterThan(0)
    expect(text.slice(0, tailAt)).not.toContain('本次组织预算：')
    expect(text.slice(tailAt)).toContain('本次组织预算：')
    expect(text.slice(tailAt)).toContain('剩余')
  })

  it('运行锁：同会话重复运行 WF_LOCKED；跨会话 WF_LOCKED 且携带 lockedSessionId', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_LOCKED',
      message: expect.stringContaining('本会话'),
    })
    await expect(h.runtime.startRun({ sessionId: 'session-2', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_LOCKED',
      lockedSessionId: 'session-1',
    })
  })

  it('参数缺失 WF_BAD_ARGS；工作流不存在 WF_NOT_FOUND', async () => {
    const h = await makeHarness()
    await expect(h.runtime.startRun({ sessionId: '', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-none' })).rejects.toMatchObject({ code: 'WF_NOT_FOUND' })
  })

  it('运行前完整性：缺启动/结束节点 WF_FLOW_INCOMPLETE（中文名按模式渲染）', async () => {
    const h = await makeHarness()
    const noStart = makeFlow()
    noStart.nodes = noStart.nodes.filter((n) => n.kind !== 'start')
    await h.store.saveWorkflow(noStart, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_FLOW_INCOMPLETE',
      message: expect.stringContaining('启动'),
    })

    const noEnd = makeFlow()
    noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end')
    await h.store.saveWorkflow(noEnd, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_FLOW_INCOMPLETE',
      message: expect.stringContaining('结束'),
    })
  })

  it('运行前校验：非法流程（自环）WF_FLOW_INVALID', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.lines.push({ id: 'l-loop', source: 'n-a1', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_FLOW_INVALID' })
  })

  it('Agent 能力不可用 / 根 Agent 未激活 / 父代理忙碌 分别报对应错误码', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    h.agents.availableFlag = false
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_AGENT_UNAVAILABLE' })
    h.agents.availableFlag = true

    h.agents.roots.delete('session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_ROOT_INACTIVE' })
    h.agents.roots.set('session-1', new FakeRoot('session-1'))

    h.agents.roots.get('session-1')!.status = 'running'
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_ROOT_BUSY' })
  })

  it('事实源写入失败：清理 run 并报 WF_DEF_WRITE_FAILED', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    h.store.saveOrchestration = async () => {
      throw new Error('磁盘错误')
    }
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_DEF_WRITE_FAILED' })
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
  })

  it('指令注入失败：清理 run 并报 WF_INJECT_FAILED', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    h.agents.injectFail = new Error('注入失败')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_INJECT_FAILED' })
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()
  })
})

describe('运行会话归属（工作台全局化）', () => {
  it('startRun 在新逻辑下运行会话恒等于实例绑定的会话（无运行期新会话）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id })
    expect(result.sessionId).toBe('session-1')
    const snapshot = h.runtime.runSnapshot(result.runId)
    expect(snapshot?.sessionId).toBe('session-1')
    // 指令注入实例绑定的会话根代理
    expect(h.agents.roots.get('session-1')!.messages).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 元参数冻结与落盘链路（自主编排方案 §6.4 / D-13）
//   - startRun：把「有效元参数（实例 meta）」冻结进 run 快照，并随运行记录落盘；
//   - resumeRun：继承旧 run 的冻结值（不重读文档 meta）——「冻结即冻结」；
//   - 文档无 meta：不写 snapshot.meta（既有快照形状与旧数据零行为变化）；
//   - 链路一致性：getServiceAsFlow（模式二服务文档 → 工作流视图）转发 meta。
// ---------------------------------------------------------------------------

/** 线性流程：start → a1 → end（可覆盖文档字段，如 meta）。 */
function metaFlow(id: string, sessionId: string, extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id,
    sessionId,
    mode: 'mode1',
    name: `流程-${id}`,
    description: '',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
    ...extra,
  }
}

/** 直读磁盘运行记录（绕过 store 缓存语义，验证真实落盘）。 */
async function readRunFile(dir: string, runId: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'runs', `${runId}.json`), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

describe('startRun：元参数冻结与落盘', () => {
  it('实例 meta → snapshot.meta（规范化后）并随运行记录落盘', async () => {
    const h = await makeHarness()
    const flow = metaFlow('flow-1', 'session-1', { meta: { nodeMax: 12, groupMax: 3, forbiddenShapes: ['flowCycle'] } })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const snapshot = h.runtime.runSnapshot(result.runId)
    expect(snapshot?.meta).toEqual({ nodeMax: 12, groupMax: 3, forbiddenShapes: ['flowCycle'] })

    const persisted = await readRunFile(h.dir, result.runId)
    expect((persisted?.meta as Record<string, unknown>)?.nodeMax).toBe(12)
  })

  it('文档无 meta：不写 snapshot.meta（旧快照形状不变）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(metaFlow('flow-2', 'session-1'), 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-2' })
    const snapshot = h.runtime.runSnapshot(result.runId)
    expect(snapshot && 'meta' in snapshot).toBe(false)
  })

  it('非法 meta 字段被规范化丢弃后冻结（不抛错）', async () => {
    const h = await makeHarness()
    const flow = metaFlow('flow-3', 'session-1', {
      meta: { nodeMax: -5, planFreedom: '乱写', 未知: 1 } as never,
    })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-3' })
    expect(h.runtime.runSnapshot(result.runId)?.meta).toBeUndefined()
  })
})

describe('resumeRun：冻结值继承（不重读文档 meta）', () => {
  it('续跑继承旧 run 的冻结值，且忽略文档中新增的 meta', async () => {
    const h = await makeHarness()
    const flow = metaFlow('flow-4', 'session-1', { meta: { nodeMax: 5 } })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    const first = await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-4' })
    const entry = h.runtime.activeRunForSession('session-1')
    expect(entry?.snapshot.meta).toEqual({ nodeMax: 5 })

    // 文档 meta 在运行中被改写（模拟画布改了实例预算）：冻结值不随之变化
    await h.store.saveWorkflow(metaFlow('flow-4', 'session-1', { meta: { nodeMax: 99 } }), 'session-1', { force: true })
    expect(entry?.snapshot.meta).toEqual({ nodeMax: 5 })

    // 停止后续跑：新 run 继承旧冻结值（磁盘断点需真实落盘，续跑查找读的是磁盘记录）
    entry!.snapshot.status = 'stopped'
    entry!.snapshot.endedAt = new Date(h.clock.now).toISOString()
    await h.store.saveRun(entry!.snapshot)
    entry!.controller.abort('stopped')
    const resumed = await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-4' })
    const resumedSnapshot = h.runtime.runSnapshot(resumed.runId)
    expect(resumedSnapshot?.resumedFromRunId).toBe(first.runId)
    expect(resumedSnapshot?.meta).toEqual({ nodeMax: 5 })
    const persisted = await readRunFile(h.dir, resumed.runId)
    expect((persisted?.meta as Record<string, unknown>)?.nodeMax).toBe(5)
  })
})

describe('模式二链路：服务文档 meta → 工作流视图', () => {
  it('getServiceAsFlow 转发实例 meta（不静默丢弃）', async () => {
    const h = await makeHarness()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      name: '服务',
      description: '',
      revision: 0,
      nodes: metaFlow('svc-1', 'session-1').nodes,
      lines: metaFlow('svc-1', 'session-1').lines,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'stopped',
      meta: { nodeMax: 7, milestoneMax: 2 },
    } as unknown as ServiceState
    await h.store.saveService(service, 'session-1', { force: true })
    const flow = await h.store.getServiceAsFlow('svc-1')
    expect(flow?.mode).toBe('mode2')
    expect(flow?.meta).toEqual({ nodeMax: 7, milestoneMax: 2 })
  })
})
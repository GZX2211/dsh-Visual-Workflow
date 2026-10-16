// tests/host/orchestrator/runtime-execute.test.ts
//
// 节点执行层单测（wf_run_node/wf_finish）：异步启动、护栏、任务块注入、暂停门、wait 阻塞、收尾幂等。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GLOBAL_RUN_CALL_LIMIT, OUTPUT_SUMMARY_LIMIT, buildNodeBlocks, createRunSnapshot } from '../../../src/host/orchestrator/index.js'
import { DEFAULT_SYSTEM_LANGUAGE } from '../../../src/host/system-language.js'
import { WF_SEND_MESSAGE } from '../../../src/host/shared/protocol.js'
import type { RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { agent, fileNode, groupNode, makeFlow, stage, type Harness, makeHarness, caller, childCaller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

describe('wfRunNode 异步路径与护栏', () => {
  it('异步启动：立即返回 started、节点 running、inflight 与 childIndex 登记', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    expect(result).toEqual({ nodeId: 'n-a1', status: 'started', childId: 'child-1' })
    const node = entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(node.status).toBe('running')
    expect(node.attempts).toBe(1)
    expect(entry.inflight.has('child-1')).toBe(true)
    expect(h.runtime.childMetaFor('child-1')).toEqual({ sessionId: 'session-1', flowId: 'flow-1', nodeId: 'n-a1' })
  })

  it('任务块注入：节点身份数据透传（不断言提示词文案）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text

    // 数据透传：画布节点 label 出现在任务块中
    expect(text).toContain('子任务A')
  })
  it('文档 ctx-in：文本内容注入（超限截断）+ 受管文件路径索引', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.nodes.splice(1, 0, fileNode('n-file-text', '文档A', { fileKind: 'text', content: '长'.repeat(300) }))
    flow.nodes.splice(1, 0, fileNode('n-file-managed', '受管B', { fileKind: 'file', managedPath: 'data/files/b.pdf' }))
    flow.lines.push(
      { id: 'l-ctx-1', source: 'n-file-text', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'l-ctx-2', source: 'n-file-managed', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    )
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text
    expect(text).toContain('文档A')
    expect(text).toContain('…（已截断）') // documentTextLimit 200 截断
    expect(text).toContain('data/files/b.pdf')
  })

  it('文档 ctx-in 多选 files：全部受管路径注入任务块（不因 managedPath 为空而丢失，§4.2.4.1）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.nodes.splice(1, 0, fileNode('n-file-multi', '多选文档', {
      fileKind: 'file',
      files: [
        { fileName: 'a.pdf', managedPath: 'data/files/a.pdf' },
        { fileName: 'b.pdf', managedPath: 'data/files/b.pdf' },
      ],
    }))
    flow.lines.push({ id: 'l-ctx-multi', source: 'n-file-multi', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text
    expect(text).toContain('data/files/a.pdf')
    expect(text).toContain('data/files/b.pdf')
    // 单选 managedPath 与多选重复时不重复列出（去重）
    expect(text.match(/data\/files\/a\.pdf/g)).toHaveLength(1)
  })

  it('流程前驱产出自动注入：a1 → pause → a2 跳过暂停节点取上游产出（截断），来源标签正确', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    // 先完成 a1（产出为超长文本，验证截断）
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: `上游总结${'详'.repeat(300)}` }],
    })
    // 再启动 a2：任务块应包含 a1 的产出（截断）与来源标签
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    const text = h.runner.calls[1].blocks[0].text
    expect(text).toContain('上游总结')
    expect(text).toContain('…（已截断）')
    expect(text).toContain('子任务A') // 来源标签（labelOf）
  })

  it('流程前驱无产出不注入；没有流程前驱产出语义的节点不注入', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    // a1 未完成（pending）→ a2 启动时不注入任何上游内容
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    const first = h.runner.calls[0].blocks[0].text
    expect(first).not.toContain('子任务A') // 不出现 a1 的来源标签
    // a1 失败（stopReason=error）→ 无产出可注入
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-2', stopReason: 'error', lastAssistantMessage: [] })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    const second = h.runner.calls[2].blocks[0].text
    expect(second).not.toContain('子任务A')
    // n-a1 的流程前驱只有启动节点（模式一无产出）→ 不注入任何上游内容
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const third = h.runner.calls[3].blocks[0].text
    expect(third).not.toContain('子任务B')
  })

  it('流程前驱为虚拟节点：解析主节点产出注入（共享执行实例语义）', async () => {
    const h = await makeHarness()
    // 单独构造：proxy(n-main) → n-target，避免与标准流程成环
    const flow: WorkflowDocument = {
      id: 'flow-1',
      sessionId: 'session-1',
      mode: 'mode1',
      name: '虚拟节点前驱流程',
      description: '测试目标',
      revision: 1,
      nodes: [
        stage('n-start', 'start', 'mode1'),
        agent('n-main', '主节点'),
        { id: 'n-proxy-main', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-main' },
        agent('n-target', '下游节点'),
        stage('n-end', 'end', 'mode1'),
      ],
      lines: [
        { id: 'l1', source: 'n-start', target: 'n-main', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2', source: 'n-proxy-main', target: 'n-target', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l3', source: 'n-target', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    }
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-proxy-main' }) // 解析为 n-main
    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '虚拟节点上游产出' }],
    })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-target' })
    expect(h.runner.calls[1].blocks[0].text).toContain('虚拟节点上游产出')
  })

  it('虚拟节点解析：按主节点 key 共享子代理（§4.2.3.2 规则 7）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-proxy-a2' })
    expect(result).toEqual({ nodeId: 'n-a2', status: 'started', childId: 'child-1' })
    expect(h.runtime.childMetaFor('child-1')!.nodeId).toBe('n-a2')
  })

  it('节点级参数：retryLimit/iterationLimit/thinking 只作引擎层透传，不写入任务块', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1', retryLimit: 5, iterationLimit: 7, thinking: 'high' })
    const input = h.runner.calls[0]
    expect(input.iterationLimit).toBe(7)
    expect(input.thinking).toBe('high')
    // retryLimit 参与引擎护栏计数（重试上限）；iterationLimit 透传 runner 层。
    // 引擎层护栏不再写入任务块（用户裁决：AI 无选择权，写入无用）。
    const text = input.blocks[0].text
    expect(text).not.toContain('重试上限')
    expect(text).not.toContain('ReAct 迭代上限')
  })

  it('迭代上限缺省不设限：节点未配置且配置默认为 0 时，不向引擎透传 iterationLimit', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    // 不设限 = 引擎层收到 undefined（护栏完全旁路），迭代交由官方运行时行为约束。
    expect(h.runner.calls[0].iterationLimit).toBeUndefined()
  })

  it('护栏：nodeId 缺失 WF_BAD_ARGS；节点不存在 WF_NODE_MISSING；非 agent 节点 WF_NODE_KIND', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await expect(h.runtime.wfRunNode(caller, {})).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-none' })).rejects.toMatchObject({ code: 'WF_NODE_MISSING' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-start' })).rejects.toMatchObject({ code: 'WF_NODE_KIND' })
  })

  it('护栏：全局调用上限 WF_GLOBAL_LIMIT；单节点重试上限 WF_RETRY_LIMIT', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    entry.callCount = GLOBAL_RUN_CALL_LIMIT
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_GLOBAL_LIMIT' })

    entry.callCount = 0
    entry.attempts.set('n-a1', 4) // retryLimit 3 → 最多 4 次
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_RETRY_LIMIT' })
  })

  it('子代理启动失败：抛原错误且节点标记 fail', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.runner.nextFail = new Error('子代理启动失败')
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toThrow('子代理启动失败')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
  })

  it('归属校验：子代理 WF_NOT_ROOT；无运行 WF_NO_ACTIVE_RUN；已结束 WF_NO_ACTIVE_RUN（终态条目已释放内存）', async () => {
    const h = await makeHarness()
    await expect(h.runtime.wfRunNode(childCaller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })

    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed' })
    // 终态条目已从内存释放（防内存膨胀）→ 无法区分「已结束」与「从未运行」，
    // 统一 WF_NO_ACTIVE_RUN（wf_finish 幂等路径仍可返回终态详情）
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('运行控制器已中止：WF_CANCELLED', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    entry.controller.abort()
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})

describe('暂停门（§4.4.2 规则 3 / §4.7 规则 4）', () => {
  it('wfRunNode(暂停节点)：run=paused + 断点持久化 + 锁保留', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    expect(result).toEqual({ nodeId: 'n-pause', status: 'paused' })
    expect(entry.snapshot.status).toBe('paused')
    expect(entry.snapshot.resumeFromNodeId).toBe('n-pause')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-pause')!.status).toBe('ok')

    // 断点已持久化
    const persisted = await h.store.getRun('run-1')
    expect(persisted?.status).toBe('paused')
    expect(persisted?.resumeFromNodeId).toBe('n-pause')

    // 运行锁保留（§4.7 规则 4）
    expect(h.runtime.flowLockInfo('flow-1')?.status).toBe('paused')
    // 暂停条目仍在内存且 id 一致（经只读快照查询；原 pausedRun 入口已退役）
    expect(h.runtime.runSnapshot('run-1')?.status).toBe('paused')
  })

  it('暂停后：同会话调度静默续跑（新 run 接管锁，不注入编排指令）；startRun 仍 WF_PAUSED；跨会话 WF_LOCKED', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    // 运行锁降权 + 静默接续：父代理在自身回合内（busy）直接调度即可接管断点——
    // 不再要求父代理空闲让位给「编排指令注入」，人工点运行不再是必需动作
    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length
    const resumed = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(resumed).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'running', runId: 'run-2' })
    expect((await h.store.getRun('run-2'))?.resumedFromRunId).toBe('run-1')
    expect(root.messages).toHaveLength(injected) // 静默：不注入编排指令

    // 显式 startRun（工作台「运行」按钮语义）仍按原锁语义拒绝暂停态，避免绕过续跑语义
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_PAUSED',
      pausedRunId: 'run-2',
    })
    await expect(h.runtime.startRun({ sessionId: 'session-2', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_LOCKED' })
  })

  it('wait:true 作用于暂停节点：仍立即返回 paused（不阻塞）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-pause', wait: true })
    expect(result.status).toBe('paused')
  })

  it('暂停状态下 wfFinish：自动续跑接管后收尾为新 run（旧断点记录保持 paused）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    // 运行锁降权（用户裁决）：收尾也走自动续跑，不再幂等返回 paused——父代理确认流程已走完后收尾
    const finish = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(finish).toMatchObject({ ok: true, status: 'completed', runId: 'run-2' })
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    // 旧断点记录不被改写（历史可追溯）
    expect((await h.store.getRun('run-1'))?.status).toBe('paused')
  })

  it('暂停状态下父代理忙碌：wfFinish 静默续跑后收尾（不注入编排指令）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })
    const root = h.agents.roots.get('session-1')!
    root.status = 'running'
    const injected = root.messages.length

    const finish = await h.runtime.wfFinish(caller, { status: 'completed' })

    expect(finish).toMatchObject({ ok: true, status: 'completed', runId: 'run-2' })
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect(root.messages).toHaveLength(injected)
  })
})

describe('wait 阻塞（§4.4.2 规则 1，模式二调度）', () => {
  /** 等 wfRunNode 内部 fs 读取完成、启动调用已发出（waiter 已注册）。 */
  async function waitStarted(h: Harness): Promise<void> {
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    }, { timeout: 5000 })
  }

  it('wait:true 挂起等待；subagent/end completed 唤醒 → ok + output', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await waitStarted(h)
    expect(settled).toBe(false) // 未完成前不返回

    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '产出摘要' }],
    })
    await expect(pending).resolves.toEqual({ nodeId: 'n-a1', status: 'ok', childId: 'child-1', output: '产出摘要' })
  })

  it('wait:true 节点输出：完整输出按 outputFullLimit 截断、摘要按 6000 字截断并持久化', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const big = 'y'.repeat(1000)
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: big }] })
    await pending

    const persisted = await h.store.getRun('run-1')
    const node = persisted!.nodes.find((n) => n.nodeId === 'n-a1')!
    expect(node.status).toBe('ok')
    expect(node.output).toHaveLength(406) // 400 + 截断标记
    expect(node.outputSummary).toBe(big) // 1000 < 6000 不截断
  })

  // 回归：outputFullLimit 曾因回写路径先用 OUTPUT_SUMMARY_LIMIT(6000) 截断而形同虚设，
  // 导致完整产出（断点回填与下游 ctx 注入的读取源）实际卡在 6000 字。
  it('节点产出超过摘要上限时：完整输出按 outputFullLimit 保留、摘要才按 6000 字截断', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const big = 'z'.repeat(OUTPUT_SUMMARY_LIMIT + 500)
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: big }] })
    await pending

    const persisted = await h.store.getRun('run-1')
    const node = persisted!.nodes.find((n) => n.nodeId === 'n-a1')!
    // 完整输出取全量后再按 outputFullLimit(400) 截断 → 400 + 标记（不是被 6000 先砍过）
    expect(node.output).toHaveLength(406)
    expect(node.output.startsWith('z'.repeat(400))).toBe(true)
    // 摘要按 OUTPUT_SUMMARY_LIMIT 截断
    expect(node.outputSummary).toHaveLength(OUTPUT_SUMMARY_LIMIT + 6)
  })

  it('wait:true 子代理失败：stopReason=error → fail', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'error' })
    await expect(pending).resolves.toEqual({ nodeId: 'n-a1', status: 'fail', childId: 'child-1', output: '' })
  })

  it('wait:true 重复调用：WF_BUSY', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    void h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    await waitStarted(h)
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })).rejects.toMatchObject({ code: 'WF_BUSY' })
  })

  it('wait:true 运行终止：waiter 以 WF_CANCELLED 拒绝', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' }) // 先挂断言，避免未处理拒绝
    await waitStarted(h)
    await h.runtime.stopRun('run-1')
    await assertion
  })

  it('wait:true 调用方取消信号：waiter 以 WF_CANCELLED 拒绝', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const controller = new AbortController()
    const pending = h.runtime.wfRunNode(caller, { nodeId: 'n-a1', wait: true }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})

describe('wfRunNode Team 卡片与成员路径', () => {
  /** Team 流程：start → g1（成员 dev/rev）→ end。Team 卡片是包裹层，成员节点才是执行主体。 */
  function teamFlow(memberIds: string[] = ['n-dev', 'n-rev']): WorkflowDocument {
    const labels: Record<string, string> = { 'n-dev': '后端开发工程师', 'n-rev': '后端代码审查专家' }
    return {
      id: 'flow-g',
      sessionId: 'session-1',
      mode: 'mode1',
      name: 'Team 流程',
      description: '协作目标',
      revision: 1,
      nodes: [
        stage('n-start', 'start', 'mode1'),
        groupNode('n-g1', '后端开发组', memberIds),
        ...memberIds.map((id) => agent(id, labels[id] ?? id, { groupId: 'n-g1' })),
        stage('n-end', 'end', 'mode1'),
      ],
      lines: [
        { id: 'l1', source: 'n-start', target: 'n-g1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
        { id: 'l2', source: 'n-g1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      ],
    }
  }

  it('Team 卡片不是执行主体：wf_run_node(组 id) 明确拒绝并给出成员清单', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    const { entry } = await start(h, teamFlow())

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })).rejects.toMatchObject({ code: 'WF_NODE_KIND' })
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })).rejects.toThrow(/n-dev, n-rev/)
    // Team 卡片不参与运行事实：既不被置为 running，也不发起任何子代理
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-g1')!.status).toBe('pending')
    expect(h.runner.calls).toHaveLength(0)
  })

  it('成员节点启动：单节点路径 + teamMember 标记（官方可用 → 官方 teammate）', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    const { entry } = await start(h, teamFlow())

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    expect(result).toMatchObject({ nodeId: 'n-dev', status: 'started', childId: 'child-1' })
    expect(h.runner.calls[0].teamMember).toBe(true)
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-dev')!.status).toBe('running')
    expect(h.runtime.childMetaFor('child-1')).toEqual({ sessionId: 'session-1', flowId: 'flow-g', nodeId: 'n-dev' })
  })

  it('非成员节点：不携带 teamMember 标记（普通子代理路径）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(h.runner.calls[0]?.teamMember).toBeUndefined()
  })

  it('成员任务块注入可通信对象清单（父代理 + 组内其他成员；不再按官方可用性分叉）', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    const text = h.runner.calls[0]!.blocks[0]!.text
    expect(text).toContain(WF_SEND_MESSAGE)
    expect(text).toContain('n-rev')
    expect(text).toContain('parent')
    expect(text).not.toContain('wf_ask_agent')
  })

  it('官方 Team 不可用（降级）：任务块结构不变（通道分叉已删除）', async () => {
    const h = await makeHarness()
    await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    const text = h.runner.calls[0]!.blocks[0]!.text
    expect(text).toContain(WF_SEND_MESSAGE)
    expect(text).toContain('n-rev')
    // 编排器仍按图标记成员身份，是否降级由引擎按官方可用性裁决
    expect(h.runner.calls[0]!.teamMember).toBe(true)
  })

  it('成员任务块与 buildNodeBlocks 结构等价（无额外追加段）', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    const { entry } = await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    // 实现读的是落盘后的最新画布：以同一份事实为基准重算，保证「结构等价」是真的同输入比较
    const saved = (await h.store.getWorkflow('session-1', 'flow-g'))!
    const node = saved.nodes.find((n): n is RoleNode => n.id === 'n-dev')!
    const expected = buildNodeBlocks({
      flow: saved,
      node,
      snapshot: entry.snapshot,
      // 与 harness 装配的 config.documentTextLimit 同值（makeHarness 默认 200）
      documentTextLimit: 200,
      systemLanguage: DEFAULT_SYSTEM_LANGUAGE,
    })
    expect(h.runner.calls[0]!.blocks).toEqual(expected)
    expect(h.runner.calls[0]!.blocks).toHaveLength(1)
  })

  it('成员完成回写：官方 roster 显示 inactive（回合结束待命）→ 落 armed', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    h.runner.teamMemberStatus.set('n-dev', 'inactive')
    const { entry } = await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '开发完成' }] })

    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-dev')!.status).toBe('armed')
    // Team 卡片不参与运行事实：不存在聚合写入，始终保持 pending
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-g1')!.status).toBe('pending')
  })

  it('成员完成回写：官方成员仍在运行（running）时不落待命', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    h.runner.teamMemberStatus.set('n-dev', 'running')
    const { entry } = await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '开发完成' }] })

    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-dev')!.status).toBe('ok')
  })

  it('降级（官方不可用）：成员仍按图判定落 armed，保持既有链路', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, teamFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-dev' })

    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '开发完成' }] })

    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-dev')!.status).toBe('armed')
  })

  it('子代理调用成员节点：WF_NOT_ROOT（调度仍仅限会话根 Agent）', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, teamFlow())
    await expect(h.runtime.wfRunNode(childCaller, { nodeId: 'n-dev' })).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })
})
describe('wfFinish 收尾', () => {
  it('completed：终态、summary、pending→skipped、持久化、锁释放', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const result = await h.runtime.wfFinish(caller, { status: 'completed', summary: '全部完成' })

    expect(result).toEqual({ ok: true, runId: 'run-1', status: 'completed' })
    expect(entry.snapshot.endedAt).not.toBeNull()
    expect(entry.snapshot.summary).toBe('全部完成')
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-start')!.status).toBe('skipped')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect((await h.store.getRun('run-1'))?.status).toBe('completed')
  })

  it('failed：status=failed 分支', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    const result = await h.runtime.wfFinish(caller, { status: 'failed', summary: '无法继续' })
    expect(result.status).toBe('failed')
  })

  it('幂等：重复收尾/已终止运行静默返回 idempotent', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: 'completed' })
    const second = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(second).toMatchObject({ ok: true, status: 'completed', idempotent: true })
  })

  it('幂等判定取本会话最新一条：不把无关的旧终态运行当成本次收尾结果', async () => {
    const h = await makeHarness()
    const older = createRunSnapshot({ runId: 'run-a-old', flow: makeFlow(), sessionId: 'session-1', mode: 'mode1', now: 1000 })
    older.status = 'completed'
    await h.store.saveRun(older)
    const newer = createRunSnapshot({
      runId: 'run-b-new',
      flow: { ...makeFlow(), id: 'flow-2', name: '另一条流程' },
      sessionId: 'session-1',
      mode: 'mode1',
      now: 9000,
    })
    newer.status = 'failed'
    await h.store.saveRun(newer)
    // 其它会话的更新记录必须被会话隔离挡掉（否则会串会话返回别人的运行）
    const otherSession = createRunSnapshot({ runId: 'run-c-other', flow: makeFlow(), sessionId: 'session-9', mode: 'mode1', now: 99999 })
    otherSession.status = 'completed'
    await h.store.saveRun(otherSession)

    const result = await h.runtime.wfFinish(caller, { status: 'completed' })

    // 磁盘路径按 startedAt 倒序取最新一条本会话记录（run-a-old 的文件名更靠前，
    // 旧实现按目录顺序取第一条会误报它为本次收尾结果）
    expect(result).toEqual({ ok: true, runId: 'run-b-new', status: 'failed', idempotent: true })
  })

  it('归属：子代理 WF_NOT_ROOT；无运行 WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await expect(h.runtime.wfFinish(childCaller, {})).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
    await expect(h.runtime.wfFinish(caller, {})).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('failed：终止节点全部落 fail 并写盘，锁释放', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })

    await h.runtime.wfFinish(caller, { status: 'failed', summary: '无法继续' })

    expect(entry.snapshot.endedAt).not.toBeNull()
    expect(entry.snapshot.nodes.filter((n) => n.status === 'running').length).toBe(0)
    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-a1')!.status).toBe('fail')
    expect((await h.store.getRun('run-1'))?.status).toBe('failed')
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    expect(h.runtime.entryFor('run-1')).toBeNull()
  })

  it('收尾不再注入终态复盘指令：父代理既无插队消息也无新回合', async () => {
    const h = await makeHarness()
    const root = h.agents.roots.get('session-1')!
    await start(h, makeFlow())
    // startRun 本身注入一条编排指令；parent 忙碌以覆盖 steer 通道
    root.status = 'running'
    const before = { steered: root.steered.length, messages: root.messages.length }

    await h.runtime.wfFinish(caller, { status: 'completed', summary: '完成' })

    expect(root.steered).toHaveLength(before.steered)
    expect(root.messages).toHaveLength(before.messages)
  })
})

// tests/host/orchestrator/runtime-execute.test.ts
//
// 节点执行层单测（wf_run_node/wf_finish）：异步启动、护栏、任务块注入、暂停门、wait 阻塞、收尾幂等。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GLOBAL_RUN_CALL_LIMIT, OUTPUT_SUMMARY_LIMIT } from '../../../src/host/orchestrator/index.js'
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER } from '../../../src/host/prompts/markers.js'
import { agent, fileNode, makeFlow, type Harness, makeHarness, caller, childCaller, start, cleanupTempDirs } from './fixtures/harness.js'

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

  it('任务块注入：marker 三段布局 + 节点身份数据透传（不绑定提示词文案）', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const text = h.runner.calls[0].blocks[0].text

    // W-01 三段布局：head < mid < tail
    const headAt = text.indexOf(HEAD_MARKER)
    const midAt = text.indexOf(MID_MARKER)
    const tailAt = text.indexOf(TAIL_MARKER)
    expect(headAt).toBeGreaterThanOrEqual(0)
    expect(midAt).toBeGreaterThan(headAt)
    expect(tailAt).toBeGreaterThan(midAt)
    // 数据透传：节点身份（画布节点 label）出现在首段
    expect(text.slice(0, midAt)).toContain('子任务A')
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

  it('ctx-in 角色节点：上游 ok/react-capped 产出注入下游（截断），来源标签正确', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    // a1 ctx-out → a2 ctx-in：显式连线传递上游最终产出（需求 §4.1.2 规则 5）
    flow.lines.push({ id: 'l-ctx-agent', source: 'n-a1', target: 'n-a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
    await start(h, flow)
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

  it('ctx-in 角色节点：上游 fail/pending 无产出不注入；无连线完全不传', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.lines.push({ id: 'l-ctx-agent', source: 'n-a1', target: 'n-a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
    await start(h, flow)
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
    // 无 ctx 连线的节点（n-pause 后的常规 a1 启动）不注入上游内容
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const third = h.runner.calls[3].blocks[0].text
    expect(third).not.toContain('子任务B')
  })

  it('ctx-in 虚拟节点：解析主节点产出注入（共享执行实例语义）', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    // a2 的虚拟节点 n-proxy-a2 作为上游：产出 = a2 的产出（快照按主节点记账）
    flow.lines.push({ id: 'l-ctx-proxy', source: 'n-proxy-a2', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-proxy-a2' }) // 解析为 n-a2
    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '虚拟节点上游产出' }],
    })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
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
    expect(h.runtime.pausedRun('session-1', 'flow-1')?.snapshot.id).toBe('run-1')
  })

  it('暂停后：同会话调度自动续跑（新 run 接管锁）；startRun 仍 WF_PAUSED；跨会话 WF_LOCKED', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-pause' })

    // 运行锁降权（用户裁决）：父代理在暂停后直接调度不再 WF_PAUSED，而是自动续跑接管
    const resumed = await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(resumed).toMatchObject({ nodeId: 'n-a2', status: 'started' })
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'running', runId: 'run-2' })
    expect((await h.store.getRun('run-2'))?.resumedFromRunId).toBe('run-1')
    // 续跑指令注入父代理（断点起点 = 暂停节点，已 ok 节点不重跑）
    const directive = h.agents.roots.get('session-1')!.messages.at(-1)!.content[0].text
    expect(directive).toContain('正在恢复先前运行')
    expect(directive).toContain('n-pause')

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
    // 运行锁降权（用户裁决）：收尾也走自动续跑，不再幂等返回 paused——父代理在续跑
    // 指令下重新确认流程已走完后收尾，运行锁随之释放
    const finish = await h.runtime.wfFinish(caller, { status: 'completed' })
    expect(finish).toMatchObject({ ok: true, status: 'completed', runId: 'run-2' })
    expect(h.runtime.flowLockInfo('flow-1')).toBeNull()
    // 旧断点记录不被改写（历史可追溯）
    expect((await h.store.getRun('run-1'))?.status).toBe('paused')
  })
})

describe('wait 阻塞（§4.4.2 规则 1，模式二调度）', () => {
  /** 等 wfRunNode 内部 fs 读取完成、启动调用已发出（waiter 已注册）。 */
  async function waitStarted(h: Harness): Promise<void> {
    await vi.waitFor(() => {
      expect(h.runner.calls).toHaveLength(1)
    })
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

  it('归属：子代理 WF_NOT_ROOT；无运行 WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await expect(h.runtime.wfFinish(childCaller, {})).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
    await expect(h.runtime.wfFinish(caller, {})).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})

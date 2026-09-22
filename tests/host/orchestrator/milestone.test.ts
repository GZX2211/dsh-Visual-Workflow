// tests/host/orchestrator/milestone.test.ts
//
// P3 里程碑闸门运行时单测：闸门识别、不自动 ok、显式 mark_node（快照写入经运行时唯一写者）与闸门预算。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import { executeGraphPatch, type GraphPatchHost } from '../../../src/host/tools/wf-graph-patch/tool.js'
import { type WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { stage, agent, parentNode, type Harness, makeHarness, caller, start, cleanupTempDirs } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

/** 含闸门的流程：start → m1(→p1) → a1 → end；role 缺省 = 普通执行入口。 */
function makeGateFlow(role?: 'executor' | 'milestone'): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '闸门流程',
    description: '里程碑闸门测试',
    revision: 1,
    nodes: [
      stage('n-start', 'start', 'mode1'),
      parentNode('n-p1', 'CEO'),
      {
        id: 'n-m1',
        kind: 'proxy',
        position: { x: 0, y: 0 },
        proxySourceId: 'n-p1',
        ...(role ? { data: { role } } : {}),
      },
      agent('n-a1', '子任务A'),
      stage('n-end', 'end', 'mode1'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-m1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-m1', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}
/** 把真实运行时适配成 wf_graph_patch 需要的宿主缝（与 visual-workflow-host 同口径）。 */
function patchHost(h: Harness): GraphPatchHost {
  return {
    store: {
      getFlowTemplate: (id) => h.store.getFlowTemplate(id),
      saveFlowTemplate: (t, o) => h.store.saveFlowTemplate(t, o),
      getWorkflow: (sid, id) => h.store.getWorkflow(sid, id),
      saveWorkflow: (d, sid, o) => h.store.saveWorkflow(d, sid, o),
      getServiceAsFlow: (id) => h.store.getServiceAsFlow(id),
      getRun: (id) => h.store.getRun(id),
      listRuns: (id) => h.store.listRuns(id),
    },
    orchestrator: {
      activeRunForSession: (sid) => h.runtime.activeRunForSession(sid),
      flowLockInfo: (fid) => h.runtime.flowLockInfo(fid),
      currentResolvedFlow: (e) => h.runtime.currentResolvedFlow(e),
      touchRunForSession: (sid) => h.runtime.touchRunForSession(sid),
      refreshActiveDefinitions: (fid, sid, flow) => h.runtime.refreshActiveDefinitions(fid, sid, flow),
      milestoneFactsFor: (sid) => h.runtime.milestoneFactsFor(sid),
      markMilestoneNode: (sid, input) => h.runtime.markMilestoneNode(sid, input),
    },
    persistRun: async (runId) => {
      const entry = h.runtime.entryFor(runId)
      if (entry) await h.runtime.persistRunSnapshot(entry)
    },
  }
}
describe('P3 里程碑闸门（运行时）', () => {
  it('startRun 识别闸门：登记 executorIsMilestone/milestoneProxyId，父代理节点置 running 并注入执行单元任务', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeGateFlow('milestone'))
    expect(entry.executorParentId).toBe('n-p1')
    expect(entry.executorIsMilestone).toBe(true)
    expect(entry.milestoneProxyId).toBe('n-m1')
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'n-p1')?.status).toBe('running')
    const text = h.agents.roots.get('session-1')!.messages[0].content[0].text
    expect(text).toContain('【你的节点任务】')
  })

  it('闸门轮不自动 ok：开始调度（wf_run_node）后父代理节点仍为 running（验收项）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeGateFlow('milestone'))
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'n-p1')?.status).toBe('running')
  })

  it('回归：普通执行入口（无 data.role）仍由引擎自动 ok（markParentExecutorDone 不受影响）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeGateFlow())
    expect(entry.executorIsMilestone).toBeFalsy()
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(entry.snapshot.nodes.find((node) => node.nodeId === 'n-p1')?.status).toBe('ok')
  })

  it('显式标记生效（端到端）：mark_node 接受闸门虚拟节点 id，写 ok + milestone + 快照预算 1', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeGateFlow('milestone'))
    const result = await executeGraphPatch(patchHost(h), 'session-1', {
      scope: 'instance',
      targetId: 'flow-1',
      ops: [{ op: 'mark_node', nodeId: 'n-m1', status: 'ok', summary: '复核通过' }],
    })
    expect(result.marked).toEqual({ nodeId: 'n-p1', status: 'ok', runId: 'run-1' })
    expect(result.milestoneUsed).toBe(1)
    const node = entry.snapshot.nodes.find((item) => item.nodeId === 'n-p1')
    expect(node?.status).toBe('ok')
    expect(node?.stopReason).toBe('milestone')
    expect(entry.snapshot.milestoneUsed).toBe(1)
    const persisted = await h.store.getRun('run-1')
    expect((persisted as { milestoneUsed?: number } | null)?.milestoneUsed).toBe(1)
  })

  it('闸门预算：meta.milestoneMax=1 时第二次 mark_node(ok) 被拒（D-21 不含首次编排）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeGateFlow('milestone'))
    entry.snapshot.meta = { milestoneMax: 1 }
    const host = patchHost(h)
    const first = await executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'flow-1', ops: [{ op: 'mark_node', nodeId: 'n-p1', status: 'ok' }],
    })
    expect(first.milestoneUsed).toBe(1)
    await expect(executeGraphPatch(host, 'session-1', {
      scope: 'instance', targetId: 'flow-1', ops: [{ op: 'mark_node', nodeId: 'n-p1', status: 'ok' }],
    })).rejects.toMatchObject({ code: 'WF_MILESTONE_INVALID' })
  })

  it('非闸门轮标记被拒：普通执行入口流程内 mark_node → WF_MILESTONE_INVALID', async () => {
    const h = await makeHarness()
    await start(h, makeGateFlow())
    await expect(executeGraphPatch(patchHost(h), 'session-1', {
      scope: 'instance', targetId: 'flow-1', ops: [{ op: 'mark_node', nodeId: 'n-p1', status: 'ok' }],
    })).rejects.toMatchObject({ code: 'WF_MILESTONE_INVALID' })
  })
})

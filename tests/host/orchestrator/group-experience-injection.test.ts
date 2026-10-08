// tests/host/orchestrator/group-experience-injection.test.ts
//
// 协作组启动前的 Team 经验共享上下文注入单测：同一份内容追加给每个成员（独立文本块）、
// 未注入缝时行为与既有完全一致、缝抛错只告警不阻断组启动、用后标记本 run 启动过协作组。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_EXPERIENCE_MARKER } from '../../../src/host/prompts/index.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { agent, cleanupTempDirs, groupNode, makeHarness, stage, start, caller, type Harness } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

/** 协作组流程：start → g1（成员 dev/rev）→ end。 */
function groupFlow(): WorkflowDocument {
  return {
    id: 'flow-g',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '协作流程',
    description: '协作目标',
    revision: 1,
    nodes: [
      stage('n-start', 'start', 'mode1'),
      groupNode('n-g1', '后端开发组', ['n-dev', 'n-rev']),
      agent('n-dev', '后端开发工程师', { groupId: 'n-g1' }),
      agent('n-rev', '后端代码审查专家', { groupId: 'n-g1' }),
      stage('n-end', 'end', 'mode1'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-g1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-g1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 带注入缝的装配（缝记录入参并回放固定经验文本）。 */
async function makeInjectingHarness(result: string | null = '历史经验正文'): Promise<{
  h: Harness
  calls: Array<{ sessionId: string; flowId: string; groupId: string; query: string }>
}> {
  const calls: Array<{ sessionId: string; flowId: string; groupId: string; query: string }> = []
  const h = await makeHarness(undefined, {
    teamExperienceContext: async (context) => {
      calls.push(context)
      return result
    },
  })
  h.runner.teamEnabled = true
  return { h, calls }
}describe('协作组成员任务的经验共享上下文注入', () => {
  it('注入缝返回文本：每个成员的 blocks 追加同一份独立文本块', async () => {
    const { h, calls } = await makeInjectingHarness('历史经验正文')
    await start(h, groupFlow())

    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    const members = h.runner.groupCalls[0].members
    expect(members).toHaveLength(2)
    for (const member of members) {
      expect(member.blocks).toHaveLength(2)
      expect(member.blocks[1].type).toBe('text')
      expect(member.blocks[1].text).toContain(TEAM_EXPERIENCE_MARKER)
      expect(member.blocks[1].text).toContain('历史经验正文')
    }
    // 同一份内容：成员间字节相同
    expect(members[0].blocks[1].text).toBe(members[1].blocks[1].text)
    // 原有任务块（含协作块）保持不变，注入不修改既有语义
    expect(members[0].blocks[0].text).not.toContain(TEAM_EXPERIENCE_MARKER)
    // 召回只执行一次
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ sessionId: 'session-1', flowId: 'flow-g', groupId: 'n-g1' })
    expect(calls[0].query).toContain('后端开发组')
  })

  it('注入缝返回 null：不追加任何文本块', async () => {
    const { h } = await makeInjectingHarness(null)
    await start(h, groupFlow())

    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    for (const member of h.runner.groupCalls[0].members) {
      expect(member.blocks).toHaveLength(1)
    }
  })

  it('未注入缝：行为与既有完全一致（不追加、不报错）', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, groupFlow())

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    expect(result.status).toBe('started')
    for (const member of h.runner.groupCalls[0].members) {
      expect(member.blocks).toHaveLength(1)
      expect(member.blocks[0].text).not.toContain(TEAM_EXPERIENCE_MARKER)
    }
    expect(h.warnings.filter((message) => message.includes(TEAM_EXPERIENCE_MARKER))).toHaveLength(0)
  })

  it('注入缝抛错：只告警，协作组照常启动（best-effort 辅助路径）', async () => {
    const h = await makeHarness(undefined, {
      teamExperienceContext: async () => {
        throw new Error('召回答不可用')
      },
    })
    h.runner.teamEnabled = true
    await start(h, groupFlow())

    const result = await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    expect(result.status).toBe('started')
    expect(result.members).toHaveLength(2)
    for (const member of h.runner.groupCalls[0].members) {
      expect(member.blocks).toHaveLength(1)
    }
    expect(h.warnings.some((message) => message.includes('团队经验上下文') && message.includes('召回答不可用'))).toBe(true)
  })

  it('启动失败（官方 Team 瞬间不可用）：不向成员派发任务，标记回滚为本 run 未建立过 Team', async () => {
    const { h } = await makeInjectingHarness()
    h.runner.groupStartUnavailable = true
    await start(h, groupFlow())

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })).rejects.toMatchObject({ code: 'WF_TEAM_UNAVAILABLE' })

    expect(h.runner.groupCalls).toHaveLength(1)
    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(false)
  })

  it('启动抛错：同样回滚标记（事实只在确实建立过 Team 时为真）', async () => {
    const { h } = await makeInjectingHarness()
    h.runner.groupStartFail = new Error('启动通道不可用')
    await start(h, groupFlow())

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })).rejects.toThrow('启动通道不可用')

    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(false)
  })

  it('成员校验失败（组未启动）：不置位 Team Leader 事实', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    const flow = groupFlow()
    await start(h, flow)
    // 运行中改图绕过保存期校验：把成员换成阶段节点 id
    const mutated = groupFlow()
    ;(mutated.nodes.find((n) => n.id === 'n-g1')!.data as { memberIds: string[] }).memberIds = ['n-start']
    await h.store.saveWorkflow(mutated, 'session-1', { force: true })

    await expect(h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })).rejects.toMatchObject({ code: 'WF_NODE_KIND' })

    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(false)
  })
})

describe('Team 经验可用性判定（hasTeamInCurrentRun）', () => {
  it('本组召回时已置位：注入缝内查询为 true（父代理当前正建立团队）', async () => {
    const seen: boolean[] = []
    const h = await makeHarness(undefined, {
      teamExperienceContext: async () => {
        seen.push(h.runtime.hasTeamInCurrentRun('session-1'))
        return '历史经验正文'
      },
    })
    h.runner.teamEnabled = true
    await start(h, groupFlow())

    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    expect(seen).toEqual([true])
  })

  it('组启动成功后为 true；未启动过协作组为 false', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, groupFlow())
    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(false)

    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(true)
  })

  it('组结束后（成员全部产出、组卡片 ok）本 run 内仍为 true', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    const { entry } = await start(h, groupFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })
    await h.runtime.handleSubagentEnd({ id: 'g-child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '开发完成' }] })
    await h.runtime.handleSubagentEnd({ id: 'g-child-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '审查完成' }] })

    expect(entry.snapshot.nodes.find((n) => n.nodeId === 'n-g1')!.status).toBe('ok')
    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(true)
  })

  it('run 结束（内存条目释放）后不再为 true：标记随 run 生命周期回收', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, groupFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })
    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(true)

    await h.runtime.stopRun('run-1')

    expect(h.runtime.hasTeamInCurrentRun('session-1')).toBe(false)
  })

  it('其他会话不受影响：只认本会话当前 run', async () => {
    const h = await makeHarness()
    h.runner.teamEnabled = true
    await start(h, groupFlow())
    await h.runtime.wfRunNode(caller, { nodeId: 'n-g1' })

    expect(h.runtime.hasTeamInCurrentRun('session-2')).toBe(false)
    expect(h.runtime.hasTeamInCurrentRun('')).toBe(false)
  })
})

// tests/host/prompts/builders.test.ts
//
// 提示词构建器的**结构测试**：只断言「数据是否进入输出」与「模式/通道差异」，
// 不断言任何提示词正文字句、段落标题或文案常量——正文属可随时修改的内容，
// 改文案不应触发测试失败（渲染机制见 ./render.test.ts）。

import { describe, expect, it } from 'vitest'
import {
  buildCollabBlock,
  buildHybridPrompt,
  buildNodeTaskBlock,
  buildOrgPlanPrompt,
  buildOrchestratorPrompt,
  buildParentExecutorPrompt,
  buildParentTaskSpec,
} from '../../../src/host/prompts/index.js'
import { TEAM_SEND_MESSAGE, WF_ASK_AGENT, WF_FINISH, WF_RUN_NODE } from '../../../src/host/shared/protocol.js'
import { nodeFacts, orchFacts } from './fixtures/prompt-facts.js'

describe('父代理提示词构建器（三模式结构）', () => {
  it('情况1 纯编排：注入工作流名与目标数据，无父代理执行身份', () => {
    const out = buildOrchestratorPrompt({ facts: orchFacts, dynamic: {} })
    expect(out).toContain(orchFacts.workflowName)
    expect(out).toContain(orchFacts.workflowGoal)
    expect(out).not.toContain('parent-1')
  })

  it('情况2 编排+自执行：注入父代理节点身份与自执行任务块数据', () => {
    const taskBlock = buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-2', systemLanguage: '中文' })
    const out = buildHybridPrompt({
      facts: { ...orchFacts, parentNode: { nodeId: 'parent-1', nodeLabel: '调度执行节点' } },
      dynamic: { parentTaskBlock: taskBlock },
    })
    expect(out).toContain('parent-1')
    expect(out).toContain('调度执行节点')
    expect(out).toContain('runId=run-2')
  })

  it('情况3 纯执行：注入节点身份与运行上下文，无编排启动工具名', () => {
    const out = buildParentExecutorPrompt({
      workflowName: orchFacts.workflowName,
      facts: nodeFacts,
      runContextText: 'runId=run-3',
      systemLanguage: '中文',
    })
    expect(out).toContain(nodeFacts.nodeLabel)
    expect(out).toContain('runId=run-3')
    expect(out).toContain(WF_FINISH)
    expect(out).not.toContain(WF_RUN_NODE)
  })

  it('Team 段随 collabGroups 与通道变化（official 走官方通信工具，legacy 走自建工具）', () => {
    const official = buildOrchestratorPrompt({ facts: { ...orchFacts, collabChannel: 'official' }, dynamic: {} })
    const legacy = buildOrchestratorPrompt({ facts: { ...orchFacts, collabChannel: 'legacy' }, dynamic: {} })
    const withoutTeam = buildOrchestratorPrompt({ facts: { ...orchFacts, collabGroups: [] }, dynamic: {} })

    expect(official).toContain(TEAM_SEND_MESSAGE)
    expect(official).not.toContain(WF_ASK_AGENT)
    expect(legacy).toContain(WF_ASK_AGENT)
    expect(legacy).not.toContain(TEAM_SEND_MESSAGE)
    expect(withoutTeam).not.toContain(orchFacts.collabGroups[0].groupId)
  })

  it('同入参两次构建字节相同（纯函数）', () => {
    const params = { facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } }
    expect(buildOrchestratorPrompt(params)).toBe(buildOrchestratorPrompt(params))
  })
})

describe('子代理任务块与协作块（数据与通道结构）', () => {
  it('节点 label、上游产出与文件路径数据进入任务块', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts })
    expect(out).toContain(nodeFacts.nodeLabel)
    expect(out).toContain(nodeFacts.upstreamContext[0].content)
    expect(out).toContain(nodeFacts.filePaths[0])
  })

  it('输入/输出契约按节点配置注入；未配置则输出中不出现该数据', () => {
    const configured = buildNodeTaskBlock({
      facts: { ...nodeFacts, inputContract: '上游交付的纪要', outputContract: '结论 / 置信度' },
    })
    expect(configured).toContain('上游交付的纪要')
    expect(configured).toContain('结论 / 置信度')

    const empty = buildNodeTaskBlock({ facts: nodeFacts })
    expect(empty).not.toContain('结论 / 置信度')
  })

  it('legacy 通道的组内成员注入自建协作工具名；official 通道不注入', () => {
    const legacy = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true, collabChannel: 'legacy' } })
    const official = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true, collabChannel: 'official' } })
    expect(legacy).toContain(WF_ASK_AGENT)
    expect(official).not.toContain(WF_ASK_AGENT)
  })

  it('协作块列出全部成员的可寻址标识，自定义说明追加在成员清单之后', () => {
    const members = [
      { id: 'node-a', label: '分析节点' },
      { id: 'node-b', label: '总结节点' },
    ]
    const block = buildCollabBlock({ members, custom: '组内互相质询' })
    for (const member of members) {
      expect(block).toContain(member.id)
      expect(block).toContain(member.label)
    }
    expect(block.indexOf(members[1].id)).toBeLessThan(block.indexOf('组内互相质询'))
    expect(block).toContain(WF_ASK_AGENT)
  })

  it('official 通道以成员名寻址（target 数据出现在协作块中）', () => {
    const block = buildCollabBlock({
      members: [{ id: 'n-x', label: 'X', target: 'm-x' }],
      custom: '',
      channel: 'official',
    })
    expect(block).toContain('m-x')
    expect(block).not.toContain(WF_ASK_AGENT)
  })
})

describe('规划期提示词（三目标只差数据）', () => {
  it('template/instance 注入既有目标 id；create 不注入其他目标的 id', () => {
    const template = buildOrgPlanPrompt({
      facts: { target: 'template', targetId: 'tpl-9', targetName: '流水线', systemLanguage: '中文' },
      dynamic: { userIntent: '改进' },
    })
    expect(template).toContain('tpl-9')

    const instance = buildOrgPlanPrompt({
      facts: { target: 'instance', targetId: 'inst-3', systemLanguage: '中文' },
      dynamic: { userIntent: '改进' },
    })
    expect(instance).toContain('inst-3')

    const create = buildOrgPlanPrompt({
      facts: { target: 'create', targetName: '新流水线' },
      dynamic: { userIntent: '新建' },
    })
    expect(create).toContain('新流水线')
    expect(create).not.toContain('tpl-9')
  })

  it('用户意图与用户 SOP 数据注入；未提供 SOP 时不出现该数据', () => {
    const withSop = buildOrgPlanPrompt({
      facts: { target: 'create' },
      dynamic: { userIntent: '做一个流水线', userSop: '先做调研' },
    })
    expect(withSop).toContain('做一个流水线')
    expect(withSop).toContain('先做调研')

    const withoutSop = buildOrgPlanPrompt({ facts: { target: 'create' }, dynamic: { userIntent: '做一个流水线' } })
    expect(withoutSop).not.toContain('先做调研')
  })
})

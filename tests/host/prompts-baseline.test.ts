// T-005 提示词模板基线测试：验证三类构建器（编排系 / 父代理执行单元 / 节点任务块）
// 满足 W-01（前缀字节稳定）与 W-02（关键约束双位 / 注意力位置），以及无随机/时钟依赖。
//
// 三情况组装（用户评审后）：情况1=buildOrchestratorPrompt、情况2=buildHybridPrompt、
// 情况3=buildParentExecutorPrompt；变体互斥与画布判定见 parent-prompt-variants.test.ts。
//
// 运行环境：node（host 测试默认，不引入 jsdom）。
import { describe, expect, it } from 'vitest'
import {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  ORCH_HARD_CONSTRAINTS,
  NODE_HARD_CONSTRAINTS,
  buildCollabBlock,
  buildHybridPrompt,
  buildNodeTaskBlock,
  buildOrchestratorPrompt,
  buildParentExecutorPrompt,
  buildParentTaskSpec,
} from '../../src/host/prompts/index.js'

// —— 测试用稳定 facts（同一 run 内字节稳定的静态事实）——
const orchFacts = {
  workflowName: '示例工作流',
  workflowGoal: '演示编排指令基线',
  definitionPath: 'orchestrations/run-abc123.json',
  nodes: [
    { id: 'node-a', label: '分析节点' },
    { id: 'node-b', label: '总结节点' },
  ],
  collabGroups: [{ groupId: 'group-1', label: '协作组一', memberIds: ['node-a', 'node-b'] }],
}

const nodeFacts = {
  task: '总结上游产出并给出结论',
  nodeLabel: '总结节点',
  upstreamContext: [{ source: 'node-a', content: '这是上游节点产出的一段很长的摘要内容。' }],
  filePaths: ['data/files/example.pdf'],
  dbToolHint: '已连接数据库节点：d1（产品库）。只可通过 wf_db_query 访问。',
  isGroupMember: false,
}

describe('T-005 编排父代理提示词（情况1 纯编排）', () => {
  it('同一 params 两次构建字节相同', () => {
    const params = { facts: orchFacts, dynamic: {} }
    expect(buildOrchestratorPrompt(params)).toBe(buildOrchestratorPrompt(params))
  })

  it('关键约束短语同时出现在输出首段与末段（W-02 双位）', () => {
    const params = { facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } }
    const out = buildOrchestratorPrompt(params)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    for (const phrase of ['仅编排', 'wf_finish', ORCH_HARD_CONSTRAINTS.nodeSettledSignal]) {
      expect(head).toContain(phrase)
      expect(tail).toContain(phrase)
    }
  })

  it('仅改动态 param 时，尾段标记之前的前缀字节不变、差异仅在尾段', () => {
    const a = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { isResume: false } })
    const b = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } })
    expect(a.slice(0, a.indexOf(TAIL_MARKER))).toBe(b.slice(0, b.indexOf(TAIL_MARKER)))
    expect(a).not.toBe(b)
  })

  it('协作组段仅在存在协作组时组装；无协作组时不输出该段', () => {
    const withGroup = buildOrchestratorPrompt({ facts: orchFacts, dynamic: {} })
    expect(withGroup).toContain('协作组（并行成员）：')
    const without = buildOrchestratorPrompt({ facts: { ...orchFacts, collabGroups: [] }, dynamic: {} })
    expect(without).not.toContain('协作组（并行成员）：')
    expect(without).not.toContain('无协作组')
  })

  it('模板不含 Date.now / 随机值标识；构建器为纯函数（无副作用源）', () => {
    const out = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { isResume: true } })
    expect(out).not.toContain('Date.now')
    expect(out).not.toContain('Math.random')
  })
})

describe('T-005 编排父代理提示词（情况2 编排+自执行）', () => {
  const hybridFacts = {
    ...orchFacts,
    parentNode: { nodeId: 'parent-1', nodeLabel: '调度与执行节点' },
  }

  it('含执行者模式与【你的节点任务】小节，且不含「仅编排」措辞（身份互斥）', () => {
    const out = buildHybridPrompt({
      facts: hybridFacts,
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1' }) },
    })
    expect(out).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(out).toContain('【你的节点任务】')
    expect(out).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('同一 params 两次构建字节相同；执行者模式首段出现、末段重申重读事实源', () => {
    const params = {
      facts: hybridFacts,
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts }) },
    }
    const out = buildHybridPrompt(params)
    expect(buildHybridPrompt(params)).toBe(out)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    // 执行者身份由首段固化（用户裁决：末段不再重复身份，改为重申「每次调度前重新读取事实源」）
    expect(head).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(tail).toContain('每次调度前重新读取事实源')
    expect(tail).toContain(ORCH_HARD_CONSTRAINTS.nodeSettledSignal)
  })
})

describe('T-005 父代理执行单元（情况3 纯执行 / 情况2 任务块正文）', () => {
  const executorParams = {
    workflowName: '示例工作流',
    facts: nodeFacts,
    runContextText: 'runId=run-1; attempt 1/1（父代理执行单元）',
  }

  it('情况3：无任何编排/调度措辞，含身份、收尾协议与运行上下文', () => {
    const out = buildParentExecutorPrompt(executorParams)
    for (const forbidden of ['仅编排', 'wf_run_node', '待编排节点', '工作流事实源', '协作组', '调用协议']) {
      expect(out).not.toContain(forbidden)
    }
    expect(out).toContain('执行节点「总结节点」')
    expect(out).toContain('wf_finish')
  })

  it('情况3：收尾协议双位出现（首段 + 末段重申）', () => {
    const out = buildParentExecutorPrompt(executorParams)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain('wf_finish')
    expect(tail).toContain('wf_finish')
  })

  it('情况2 任务块正文：不含块级标记标题，只含过程信息与运行上下文', () => {
    const spec = buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1; attempt 1/1' })
    expect(spec).not.toContain(HEAD_MARKER)
    expect(spec).not.toContain(TAIL_MARKER)
    expect(spec).toContain('上游产出（经 ctx 连线注入）：')
    expect(spec).toContain('data/files/example.pdf')
    expect(spec).toContain('运行上下文：runId=run-1')
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildParentExecutorPrompt(executorParams)).toBe(buildParentExecutorPrompt(executorParams))
    const specParams = { facts: nodeFacts }
    expect(buildParentTaskSpec(specParams)).toBe(buildParentTaskSpec(specParams))
  })
})

describe('T-005 节点任务块模板（软约束双位 + 过程性信息中段）', () => {
  it('report 软禁用短语同时出现在首段与末段（W-02 双位）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain(NODE_HARD_CONSTRAINTS.noReportTool)
    expect(tail).toContain(NODE_HARD_CONSTRAINTS.noReportTool)
  })

  it('协作组成员才注入 wf_ask_agent 软约束；非组成员不注入', () => {
    const member = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true }, dynamic: {} })
    expect(member).toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
    const plain = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    expect(plain).not.toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
  })

  it('不再输出引擎层代码约束（System Prompt 指代/allow-list/重试与 React 上限）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: { runContextText: 'runId=run-1; attempt 1/1' } })
    for (const forbidden of ['allow-list', '重试上限', 'ReAct 迭代上限', 'wf_run_node / wf_finish 对你始终不可用']) {
      expect(out).not.toContain(forbidden)
    }
  })

  it('上游产出出现在中段（首段约束之后、末段重申之前）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    const headEnd = out.indexOf(MID_MARKER)
    const tailStart = out.indexOf(TAIL_MARKER)
    const mid = out.slice(headEnd, tailStart)
    const upstreamText = nodeFacts.upstreamContext[0].content
    expect(out.slice(0, headEnd)).not.toContain(upstreamText)
    expect(mid).toContain(upstreamText)
    expect(out.slice(tailStart)).not.toContain(upstreamText)
  })

  it('同一 params 两次构建字节相同；仅改动态 param 时前缀不变', () => {
    const params = { facts: nodeFacts, dynamic: { runContextText: 'runId=run-1' } }
    expect(buildNodeTaskBlock(params)).toBe(buildNodeTaskBlock(params))
    const a = buildNodeTaskBlock({ facts: nodeFacts, dynamic: { runContextText: 'runId=run-1' } })
    const b = buildNodeTaskBlock({ facts: nodeFacts, dynamic: { runContextText: 'runId=run-2' } })
    expect(a.slice(0, a.indexOf(TAIL_MARKER))).toBe(b.slice(0, b.indexOf(TAIL_MARKER)))
    expect(a).not.toBe(b)
  })
})

describe('T-005 协作成员清单块模板（始终含成员 ID+角色名 + 自定义说明）', () => {
  const members = [
    { id: 'node-a', label: '分析节点' },
    { id: 'node-b', label: '总结节点' },
  ]

  it('无论 custom 是否为空，都默认列出组内全部成员的 ID 与角色名', () => {
    const block = buildCollabBlock({ members, custom: '' })
    for (const member of members) {
      expect(block).toContain(member.label)
      expect(block).toContain(member.id)
    }
  })

  it('custom 非空时追加组内说明段（追加式，位于成员清单之后）', () => {
    const block = buildCollabBlock({ members, custom: '成员 A 与 B 互相质询' })
    expect(block).toContain('组内说明：')
    expect(block).toContain('成员 A 与 B 互相质询')
    expect(block.indexOf(members[0].label)).toBeLessThan(block.indexOf('组内说明：'))
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildCollabBlock({ members, custom: '并行通信' })).toBe(buildCollabBlock({ members, custom: '并行通信' }))
  })
})

describe('T-005 共享段落标记常量（供测试与后续组装引用）', () => {
  it('导出 TAIL_MARKER / HEAD_MARKER / MID_MARKER / TAIL_RESTATE_MARKER', () => {
    expect(typeof TAIL_MARKER).toBe('string')
    expect(typeof HEAD_MARKER).toBe('string')
    expect(typeof MID_MARKER).toBe('string')
    expect(typeof TAIL_RESTATE_MARKER).toBe('string')
  })
})
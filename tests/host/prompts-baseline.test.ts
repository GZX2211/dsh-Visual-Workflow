// T-005 提示词模板基线测试：验证三类构建器（编排系 / 父代理执行单元 / 节点任务块）
// 满足 W-01（前缀字节稳定）与 W-02（关键约束双位 / 注意力位置），以及无随机/时钟依赖。
//
// 三情况组装（用户评审后）：情况1=buildOrchestratorPrompt、情况2=buildHybridPrompt、
// 情况3=buildParentExecutorPrompt；变体互斥与画布判定见 parent-prompt-variants.test.ts。
//
// 断言策略（2026.09.08 迁移评审修订）：**不对提示词做硬编码文案断言**——提示词文案
// 属可润色内容，改动不应破坏基线测试。本文件只保留：
//   1. 字节稳定 / 纯函数（同参数两次构建字节相同；仅改动态参数时 TAIL_MARKER 之前不变）；
//   2. 结构化约束（导出约束常量在首段/末段的双位、身份互斥、协作条件注入）——
//      一律经 ORCH_/NODE_HARD_CONSTRAINTS 导出常量引用，文案修订时常量随源码自洽；
//   3. 数据透传与段位定位（上游上下文/文件路径等输入数据出现在由 MARKER 切分的正确区段）；
//   4. 无 Date.now / Math.random（构建器为纯函数，无副作用源）。
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

  it('收尾判定约束短语双位出现（首段 + 末段；经导出常量引用，W-02）', () => {
    const params = { facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } }
    const out = buildOrchestratorPrompt(params)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain(ORCH_HARD_CONSTRAINTS.nodeSettledSignal)
    expect(tail).toContain(ORCH_HARD_CONSTRAINTS.nodeSettledSignal)
  })

  it('仅改动态 param 时，尾段标记之前的前缀字节不变、差异仅在尾段', () => {
    const a = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { isResume: false } })
    const b = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } })
    expect(a.slice(0, a.indexOf(TAIL_MARKER))).toBe(b.slice(0, b.indexOf(TAIL_MARKER)))
    expect(a).not.toBe(b)
  })

  it('协作组存在与否改变输出（结构差异，不对文案断言）', () => {
    const withGroup = buildOrchestratorPrompt({ facts: orchFacts, dynamic: {} })
    const without = buildOrchestratorPrompt({ facts: { ...orchFacts, collabGroups: [] }, dynamic: {} })
    expect(withGroup.length).toBeGreaterThan(0)
    expect(without.length).toBeGreaterThan(0)
    expect(withGroup).not.toBe(without)
  })

  it('模板不含 Date.now / Math.random；构建器为纯函数（无副作用源）', () => {
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

  it('身份互斥：含执行者角色常量、不含纯编排措辞常量（情况2 与 情况1 区分）', () => {
    const out = buildHybridPrompt({
      facts: hybridFacts,
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1' }) },
    })
    expect(out).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(out).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('同一 params 两次构建字节相同；首段与末段各自包含导出的约束常量', () => {
    const params = {
      facts: hybridFacts,
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts }) },
    }
    const out = buildHybridPrompt(params)
    expect(buildHybridPrompt(params)).toBe(out)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(tail).toContain(ORCH_HARD_CONSTRAINTS.nodeSettledSignal)
  })
})

describe('T-005 父代理执行单元（情况3 纯执行 / 情况2 任务块正文）', () => {
  const executorParams = {
    workflowName: '示例工作流',
    facts: nodeFacts,
    runContextText: 'runId=run-1; attempt 1/1（父代理执行单元）',
  }

  it('情况3：纯执行身份——不含「纯编排」措辞常量，输出非空', () => {
    const out = buildParentExecutorPrompt(executorParams)
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('情况2 任务块正文：不含块级标记标题，透传运行上下文与上游文件路径', () => {
    const spec = buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1; attempt 1/1' })
    // 结构：任务块正文不经 HEAD/TAIL 标记包裹
    expect(spec).not.toContain(HEAD_MARKER)
    expect(spec).not.toContain(TAIL_MARKER)
    // 数据透传：上游文件路径与运行上下文确实进入正文（上游全文由节点任务块中段覆盖）
    expect(spec).toContain('data/files/example.pdf')
    expect(spec).toContain('runId=run-1')
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildParentExecutorPrompt(executorParams)).toBe(buildParentExecutorPrompt(executorParams))
    const specParams = { facts: nodeFacts }
    expect(buildParentTaskSpec(specParams)).toBe(buildParentTaskSpec(specParams))
  })
})

describe('T-005 节点任务块模板（软约束双位 + 过程性信息中段）', () => {
  it('协作软约束常量双位出现（首段 + 末段；经导出常量引用，W-02）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain(NODE_HARD_CONSTRAINTS.noReportTool)
    expect(tail).toContain(NODE_HARD_CONSTRAINTS.noReportTool)
  })

  it('协作组成员才注入 wf_ask_agent 软约束；非组成员不注入（经导出常量引用）', () => {
    const member = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true }, dynamic: {} })
    expect(member).toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
    const plain = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    expect(plain).not.toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
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

  it('custom 非空时追加到成员清单之后（追加式结构，以成员 id 为锚定位）', () => {
    const block = buildCollabBlock({ members, custom: '成员 A 与 B 互相质询' })
    expect(block).toContain('成员 A 与 B 互相质询')
    expect(block.indexOf(members[1].id)).toBeLessThan(block.indexOf('成员 A 与 B 互相质询'))
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

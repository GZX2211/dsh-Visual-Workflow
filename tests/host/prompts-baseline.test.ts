// T-005 提示词模板基线测试：验证三个构建器满足 W-01（前缀字节稳定）与
// W-02（关键约束双位 / 注意力位置），以及协作 Prompt 追加位置、无随机/时钟依赖。
//
// 运行环境：node（host 测试默认，不引入 jsdom）。
import { describe, expect, it } from 'vitest'
import {
  COLLAB_PREFIX,
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  buildCollabPrompt,
  buildNodeTaskBlock,
  buildOrchestrationDirective,
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
  dbToolHint: 'wf_db_query 只读三模式：search / query / schema。',
  toolAllowlistNote: 'read, write, edit',
}

describe('T-005 编排指令模板（W-01 前缀稳定 + W-02 关键约束双位）', () => {
  it('同一 params 两次构建字节相同', () => {
    const params = { facts: orchFacts, dynamic: {} }
    expect(buildOrchestrationDirective(params)).toBe(buildOrchestrationDirective(params))
  })

  it('关键约束短语同时出现在输出首段与末段', () => {
    const params = { facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } }
    const out = buildOrchestrationDirective(params)
    // 首段（TAIL_MARKER 之前）与末段（TAIL_MARKER 之后）都包含「仅调度不执行」短语。
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    for (const phrase of ['orchestrate only', 'wf_finish']) {
      expect(head).toContain(phrase)
      expect(tail).toContain(phrase)
    }
  })

  it('仅改动态 param 时，尾段标记之前的前缀字节不变、差异仅在尾段', () => {
    const a = buildOrchestrationDirective({ facts: orchFacts, dynamic: { isResume: false } })
    const b = buildOrchestrationDirective({ facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } })
    const prefixA = a.slice(0, a.indexOf(TAIL_MARKER))
    const prefixB = b.slice(0, b.indexOf(TAIL_MARKER))
    expect(prefixA).toBe(prefixB)
    expect(a).not.toBe(b) // 尾段确有差异（动态状态不同）
  })

  it('模板不含 Date.now / 随机值标识；构建器为纯函数（无副作用源）', () => {
    const out = buildOrchestrationDirective({ facts: orchFacts, dynamic: { isResume: true } })
    expect(out).not.toContain('Date.now')
    expect(out).not.toContain('Math.random')
  })
})

describe('T-005 节点任务块模板（关键约束双位 + 上游产出置于中段）', () => {
  it('关键约束短语同时出现在首段与末段', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    for (const phrase of ['own System Prompt', 'allow-list', 'report']) {
      expect(head).toContain(phrase)
      expect(tail).toContain(phrase)
    }
  })

  it('上游产出出现在中段（首段约束之后、末段重申之前）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts, dynamic: {} })
    const headEnd = out.indexOf(MID_MARKER)
    const tailStart = out.indexOf(TAIL_MARKER)
    const mid = out.slice(headEnd, tailStart)
    const upstreamText = nodeFacts.upstreamContext[0].content

    // 首段（MID_MARKER 之前）不含上游产出内容。
    expect(out.slice(0, headEnd)).not.toContain(upstreamText)
    // 中段包含上游产出内容。
    expect(mid).toContain(upstreamText)
    // 末段（TAIL_MARKER 之后）不含上游产出内容。
    expect(out.slice(tailStart)).not.toContain(upstreamText)
  })

  it('同一 params 两次构建字节相同；模板不含 Date.now / 随机值', () => {
    const params = { facts: nodeFacts, dynamic: { retryLimit: 3, reactLimit: 50 } }
    expect(buildNodeTaskBlock(params)).toBe(buildNodeTaskBlock(params))
    const out = buildNodeTaskBlock(params)
    expect(out).not.toContain('Date.now')
    expect(out).not.toContain('Math.random')
  })

  it('仅改动态 param 时，尾段标记之前的前缀字节不变', () => {
    const a = buildNodeTaskBlock({ facts: nodeFacts, dynamic: { retryLimit: 3 } })
    const b = buildNodeTaskBlock({ facts: nodeFacts, dynamic: { retryLimit: 5, reactLimit: 10 } })
    expect(a.slice(0, a.indexOf(TAIL_MARKER))).toBe(b.slice(0, b.indexOf(TAIL_MARKER)))
  })
})

describe('T-005 协作 Prompt 模板（collab: 前缀 + 末尾追加零失效）', () => {
  it('输出以 collab: 开头', () => {
    expect(buildCollabPrompt('').startsWith(`${COLLAB_PREFIX} `)).toBe(true)
  })

  it('以 collab: 起段且位于输入文本之后（追加式，对既有前缀零失效）', () => {
    const persona = '你是组内成员。执行 task: 总结数据。'
    const collab = buildCollabPrompt('成员 A 与 B 互相质询')
    const appended = `${persona}\n\n${collab}`
    // collab 块以 collab: 开头。
    expect(collab.startsWith(`${COLLAB_PREFIX} `)).toBe(true)
    // 输入文本在下，collab 块在后（追加位置）。
    expect(appended.indexOf(persona)).toBeLessThan(appended.indexOf(collab))
    // 输入文本原样保留（未被重排）。
    expect(appended.startsWith(persona)).toBe(true)
  })

  it('同一 text 两次构建字节相同', () => {
    expect(buildCollabPrompt('并行通信')).toBe(buildCollabPrompt('并行通信'))
  })
})

describe('T-005 共享段落标记常量（供测试与后续组装引用）', () => {
  it('导出 TAIL_MARKER / HEAD_MARKER / MID_MARKER / TAIL_RESTATE_MARKER / COLLAB_PREFIX', () => {
    expect(typeof TAIL_MARKER).toBe('string')
    expect(typeof HEAD_MARKER).toBe('string')
    expect(typeof MID_MARKER).toBe('string')
    expect(typeof TAIL_RESTATE_MARKER).toBe('string')
    expect(COLLAB_PREFIX).toBe('collab:')
  })
})

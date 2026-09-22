// tests/host/prompts/node-task.test.ts
//
// T-005 节点任务块模板基线（软约束双位 + 过程性信息中段 + 条件注入）。
//
// 断言策略：只断言段落归属（HEAD/MID/TAIL 标记切分）、条件注入（经导出常量引用）
// 与纯函数字节稳定，不对文案做硬编码断言。

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OUTPUT_CONTRACT,
  MID_MARKER,
  NODE_HARD_CONSTRAINTS,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  buildNodeTaskBlock,
} from '../../../src/host/prompts/index.js'
import { nodeFacts } from './fixtures/prompt-facts.js'

describe('T-005 节点任务块模板（软约束双位 + 过程性信息中段 + 条件注入）', () => {
  it('协作组成员才注入 wf_ask_agent 软约束；非组成员不注入（经导出常量引用）', () => {
    const member = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true } })
    expect(member).toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
    const plain = buildNodeTaskBlock({ facts: nodeFacts })
    expect(plain).not.toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
  })

  it('上游产出出现在中段（首段约束之后、末段重申之前）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts })
    const headEnd = out.indexOf(MID_MARKER)
    const tailStart = out.indexOf(TAIL_MARKER)
    const mid = out.slice(headEnd, tailStart)
    const upstreamText = nodeFacts.upstreamContext[0].content
    expect(out.slice(0, headEnd)).not.toContain(upstreamText)
    expect(mid).toContain(upstreamText)
    expect(out.slice(tailStart)).not.toContain(upstreamText)
  })

  it('同一 params 两次构建字节相同（纯函数）', () => {
    const params = { facts: nodeFacts }
    expect(buildNodeTaskBlock(params)).toBe(buildNodeTaskBlock(params))
  })

  it('输入结构注入中段；缺省时不组装该段', () => {
    const withInput = buildNodeTaskBlock({
      facts: { ...nodeFacts, inputContract: '上游交付的调研纪要（markdown）' },
    })
    const midStart = withInput.indexOf(MID_MARKER)
    const tailStart = withInput.indexOf(TAIL_MARKER)
    expect(withInput.slice(midStart, tailStart)).toContain('上游交付的调研纪要（markdown）')
    expect(withInput.slice(0, midStart)).not.toContain('上游交付的调研纪要（markdown）')
    expect(buildNodeTaskBlock({ facts: nodeFacts })).not.toContain('输入结构')
  })

  it('交接契约注入末段（注意力末位），且经导出常量引用默认结构', () => {
    const out = buildNodeTaskBlock({
      facts: { ...nodeFacts, outputContract: DEFAULT_OUTPUT_CONTRACT, outputContractDefaulted: true },
    })
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(tail).toContain(TAIL_RESTATE_MARKER)
    expect(tail).toContain('下游节点直接读取')
    expect(tail).toContain(DEFAULT_OUTPUT_CONTRACT)
    // 前缀（首段+中段）不出现契约正文——契约属末段提醒，不污染稳定前缀
    expect(out.slice(0, out.indexOf(TAIL_MARKER))).not.toContain(DEFAULT_OUTPUT_CONTRACT)
  })

  it('自定义交接契约逐字使用（仍带「下游直接读取」声明）', () => {
    const custom = '{结论, 数据表路径, 置信度}'
    const out = buildNodeTaskBlock({
      facts: { ...nodeFacts, outputContract: custom, outputContractDefaulted: false },
    })
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(tail).toContain(custom)
    expect(tail).toContain('下游节点直接读取')
  })

  it('未提供交接契约时不组装该段（终端节点不受无关约束）', () => {
    const out = buildNodeTaskBlock({ facts: nodeFacts })
    expect(out).not.toContain('下游节点直接读取')
  })
})

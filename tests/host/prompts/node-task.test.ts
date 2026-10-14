// tests/host/prompts/node-task.test.ts
//
// T-005 节点任务块模板基线（软约束双位 + 过程性信息中段 + 条件注入）。
//
// 断言策略：只断言段落归属（HEAD/MID/TAIL 标记切分）、条件注入（经导出常量引用）
// 与纯函数字节稳定，不对文案做硬编码断言。

import { describe, expect, it } from 'vitest'
import {
  MID_MARKER,
  NODE_HARD_CONSTRAINTS,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  buildNodeTaskBlock,
} from '../../../src/host/prompts/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../src/host/shared/protocol.js'
import { nodeFacts } from './fixtures/prompt-facts.js'

describe('T-005 节点任务块模板（软约束双位 + 过程性信息中段 + 条件注入）', () => {
  it('协作组成员才注入 wf_ask_agent 软约束；非组成员不注入（经导出常量引用）', () => {
    const member = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true } })
    expect(member).toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
    const plain = buildNodeTaskBlock({ facts: nodeFacts })
    expect(plain).not.toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
  })

  it('official 通道：组内成员注入官方 send_message 约束，且不再注入自建协作约束（双位一致）', () => {
    const member = buildNodeTaskBlock({ facts: { ...nodeFacts, isGroupMember: true, collabChannel: 'official' } })
    const head = member.slice(0, member.indexOf(MID_MARKER))
    const tail = member.slice(member.indexOf(TAIL_MARKER))
    // 双位机制：首段与末段都用官方通道约束
    expect(head).toContain(NODE_HARD_CONSTRAINTS.collabSendOnly)
    expect(tail).toContain(NODE_HARD_CONSTRAINTS.collabSendOnly)
    // 通道互斥：官方通道下不得出现自建协作工具约束（否则成员收到两条互相矛盾的通信指令）
    expect(member).not.toContain(NODE_HARD_CONSTRAINTS.collabAskOnly)
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

  it('输入契约注入中段；缺省时不组装该段', () => {
    const withInput = buildNodeTaskBlock({
      facts: { ...nodeFacts, inputContract: '上游交付的调研纪要（markdown）' },
    })
    const midStart = withInput.indexOf(MID_MARKER)
    const tailStart = withInput.indexOf(TAIL_MARKER)
    expect(withInput.slice(midStart, tailStart)).toContain('上游交付的调研纪要（markdown）')
    expect(withInput.slice(0, midStart)).not.toContain('上游交付的调研纪要（markdown）')
    expect(buildNodeTaskBlock({ facts: nodeFacts })).not.toContain('输入契约')
  })

  it('输出契约注入末段（注意力末位），且不与默认文本叠加', () => {
    const out = buildNodeTaskBlock({
      facts: { ...nodeFacts, outputContract: DEFAULT_OUTPUT_CONTRACT_TEXT },
    })
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(tail).toContain(TAIL_RESTATE_MARKER)
    expect(tail).toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
    // 前缀（首段+中段）不出现契约正文——契约属末段提醒，不污染稳定前缀
    expect(out.slice(0, out.indexOf(TAIL_MARKER))).not.toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
  })

  it('自定义输出契约逐字使用（不叠加默认文本）', () => {
    const custom = '{结论, 数据表路径, 置信度}'
    const out = buildNodeTaskBlock({ facts: { ...nodeFacts, outputContract: custom } })
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(tail).toContain(custom)
    expect(tail).not.toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
  })

  it('未提供输出契约时不组装该段（清空即无契约）', () => {
    expect(buildNodeTaskBlock({ facts: nodeFacts })).not.toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
  })
})

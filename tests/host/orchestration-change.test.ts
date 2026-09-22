// tests/host/orchestration-change.test.ts
//
// 「编排变更」注入通知文案单测（prompts/orchestration-change）：
// 标记/事实源路径/语言规则/纯函数字节稳定。
// 编排语义变更判定（flow-diff）见 tests/host/orchestrator/flow-diff.test.ts。

import { describe, expect, it } from 'vitest'
import { ORCH_CHANGE_MARKER, buildOrchestrationChangeText } from '../../src/host/prompts/index.js'

describe('orchestration-change 注入文案', () => {
  it('含【编排变更】标记、事实源路径与「不是新指令」澄清', () => {
    const text = buildOrchestrationChangeText({
      workflowName: '测试流程',
      definitionPath: 'D:/ws/orchestrations/run-1.json',
      systemLanguage: '中文',
    })
    expect(text).toContain(ORCH_CHANGE_MARKER)
    expect(text).toContain('D:/ws/orchestrations/run-1.json')
    expect(text).toContain('不是用户的新指令')
    expect(text).toContain('已完成的节点不要重跑')
    expect(text).toContain('所有对话回复、注释、思考过程必须使用中文')
  })

  it('系统语言缺省：不注入语言规则；纯函数字节稳定', () => {
    const params = { workflowName: '测试流程', definitionPath: 'p.json' }
    const first = buildOrchestrationChangeText(params)
    const second = buildOrchestrationChangeText(params)
    expect(first).toBe(second)
    expect(first).not.toContain('所有对话回复')
  })
})


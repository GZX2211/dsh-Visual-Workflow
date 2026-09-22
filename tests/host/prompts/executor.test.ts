// tests/host/prompts/executor.test.ts
//
// T-005 父代理执行单元基线（情况3 纯执行完整提示词 / 情况2 末段任务块正文）。
//
// 断言策略：只断言身份互斥（经 ORCH_HARD_CONSTRAINTS 导出常量引用）、
// 任务块正文不含块级标记、数据透传与纯函数字节稳定，不对文案做硬编码断言。

import { describe, expect, it } from 'vitest'
import {
  HEAD_MARKER,
  ORCH_HARD_CONSTRAINTS,
  TAIL_MARKER,
  buildParentExecutorPrompt,
  buildParentTaskSpec,
} from '../../../src/host/prompts/index.js'
import { nodeFacts } from './fixtures/prompt-facts.js'

describe('T-005 父代理执行单元（情况3 纯执行 / 情况2 任务块正文）', () => {
  const executorParams = {
    workflowName: '示例工作流',
    facts: nodeFacts,
    runContextText: 'runId=run-1; attempt 1/1（父代理执行单元）',
    systemLanguage: '中文',
  }

  it('情况3：纯执行身份——不含「纯编排」措辞常量，输出非空', () => {
    const out = buildParentExecutorPrompt(executorParams)
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('情况2 任务块正文：不含块级标记标题，透传运行上下文与上游文件路径', () => {
    const spec = buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1; attempt 1/1', systemLanguage: '中文' })
    // 结构：任务块正文不经 HEAD/TAIL 标记包裹
    expect(spec).not.toContain(HEAD_MARKER)
    expect(spec).not.toContain(TAIL_MARKER)
    // 数据透传：上游文件路径与运行上下文确实进入正文（上游全文由节点任务块中段覆盖）
    expect(spec).toContain('data/files/example.pdf')
    expect(spec).toContain('runId=run-1')
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildParentExecutorPrompt(executorParams)).toBe(buildParentExecutorPrompt(executorParams))
    const specParams = { facts: nodeFacts, systemLanguage: '中文' }
    expect(buildParentTaskSpec(specParams)).toBe(buildParentTaskSpec(specParams))
  })
})

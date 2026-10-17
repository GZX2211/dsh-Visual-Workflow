// tests/host/prompts/orchestration-change.test.ts
//
// 「编排变更」注入通知文案单测（prompts/orchestration-change）：
// 一句话形态、召回入口、系统通知语义，以及**不泄漏宿主路径**的安全门禁。
// 编排语义变更判定（flow-diff）见 tests/host/orchestrator/flow-diff.test.ts。

import { describe, expect, it } from 'vitest'
import { ORCH_CHANGE_MARKER, ORCH_CHANGE_TEXT } from '../../../src/host/prompts/index.js'

describe('orchestration-change 注入文案', () => {
  it('含【编排变更】标记与实例召回入口（父代理据此重新取骨架）', () => {
    expect(ORCH_CHANGE_TEXT).toContain(ORCH_CHANGE_MARKER)
    expect(ORCH_CHANGE_TEXT).toContain('wf_org_catalog')
    expect(ORCH_CHANGE_TEXT).toContain('instance')
  })

  it('安全门禁：不出现任何文件系统线索（盘符 / 目录名 / 文件扩展名）', () => {
    expect(ORCH_CHANGE_TEXT).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(ORCH_CHANGE_TEXT).not.toContain('orchestrations')
    expect(ORCH_CHANGE_TEXT).not.toContain('dataDir')
    expect(ORCH_CHANGE_TEXT).not.toContain('.json')
  })

  it('保留「系统通知」语义：不与用户的新指令混淆', () => {
    expect(ORCH_CHANGE_TEXT).toContain('系统通知')
  })

  it('单句形态：不含换行（不再复述操作细则）', () => {
    expect(ORCH_CHANGE_TEXT).not.toContain('\n')
  })
})

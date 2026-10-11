// tests/host/prompts/orchestration.test.ts
//
// T-005 编排父代理提示词基线（情况1 纯编排 / 情况2 编排+自执行）。
//
// 断言策略（2026.09.08 迁移评审修订）：**不对提示词做硬编码文案断言**——提示词文案
// 属可润色内容，改动不应破坏基线测试。本文件只保留：
//   1. 字节稳定 / 纯函数（同参数两次构建字节相同；仅改动态参数时 TAIL_MARKER 之前不变）；
//   2. 结构化约束（导出约束常量在首段/末段的双位、身份互斥）——一律经 ORCH_HARD_CONSTRAINTS
//      导出常量引用，文案修订时常量随源码自洽；
//   3. 组织预算文本仅在末段注入；
//   4. 无 Date.now / Math.random（构建器为纯函数，无副作用源）。
//
// 画布形态分类（parentPromptVariantOf）见 tests/host/orchestrator/directive.test.ts；
// 情况3 纯执行与任务块正文见 ./executor.test.ts；节点任务块见 ./node-task.test.ts。

import { describe, expect, it } from 'vitest'
import {
  ORCH_HARD_CONSTRAINTS,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  buildHybridPrompt,
  buildOrchestratorPrompt,
  buildParentTaskSpec,
  buildResumeOrchestrationPrompt,
} from '../../../src/host/prompts/index.js'
import { TEAM_SPAWN_TEAMMATE, WF_RUN_NODE } from '../../../src/host/shared/protocol.js'
import { nodeFacts, orchFacts } from './fixtures/prompt-facts.js'

describe('T-005 编排父代理提示词（情况1 纯编排）', () => {
  it('同一 params 两次构建字节相同', () => {
    const params = { facts: orchFacts, dynamic: {} }
    expect(buildOrchestratorPrompt(params)).toBe(buildOrchestratorPrompt(params))
  })

  it('关键约束双位出现（首段 + 末段重申；W-02 机制，经导出常量引用，不绑定具体文案）', () => {
    const params = { facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: 'node-b' } }
    const out = buildOrchestratorPrompt(params)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    // 只验证「双位机制」：首段与末段都至少出现一条导出硬约束常量；具体条目随源码自洽
    expect(Object.values(ORCH_HARD_CONSTRAINTS).some((v) => head.includes(v))).toBe(true)
    expect(Object.values(ORCH_HARD_CONSTRAINTS).some((v) => tail.includes(v))).toBe(true)
    expect(tail).toContain(TAIL_RESTATE_MARKER)
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

  it('协作通道决定协作组段：official 指示整组启动官方团队并禁止自行拉人；legacy 指示逐节点并行启动', () => {
    const official = buildOrchestratorPrompt({ facts: { ...orchFacts, collabChannel: 'official' as const }, dynamic: {} })
    const legacy = buildOrchestratorPrompt({ facts: { ...orchFacts, collabChannel: 'legacy' as const }, dynamic: {} })
    expect(official).not.toBe(legacy)
    // official：整组启动入口（wf_run_node）+ 官方成员创建工具名（作为「禁止自行调用」的锚点）
    expect(official).toContain(WF_RUN_NODE)
    expect(official).toContain(TEAM_SPAWN_TEAMMATE)
    // legacy：不出现官方成员创建工具名（沿用既有语义）
    expect(legacy).not.toContain(TEAM_SPAWN_TEAMMATE)
  })

  it('组织预算文本仅在末段注入（P2 接入；改预算不改前缀字节）', () => {
    const base = buildOrchestratorPrompt({ facts: orchFacts, dynamic: {} })
    const withBudget = buildOrchestratorPrompt({ facts: orchFacts, dynamic: { orgBudgetText: '本次组织预算：\n- 可执行节点 3/5（剩余 2）' } })
    expect(base).not.toContain('本次组织预算：')
    expect(withBudget.slice(0, withBudget.indexOf(TAIL_MARKER))).toBe(base.slice(0, base.indexOf(TAIL_MARKER)))
    expect(withBudget.slice(withBudget.indexOf(TAIL_MARKER))).toContain('本次组织预算：')
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
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts, runContextText: 'runId=run-1', systemLanguage: '中文' }) },
    })
    expect(out).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(out).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('同一 params 两次构建字节相同；首段与末段各自包含导出的约束常量', () => {
    const params = {
      facts: hybridFacts,
      dynamic: { parentTaskBlock: buildParentTaskSpec({ facts: nodeFacts, systemLanguage: '中文' }) },
    }
    const out = buildHybridPrompt(params)
    expect(buildHybridPrompt(params)).toBe(out)
    const head = out.slice(0, out.indexOf(TAIL_MARKER))
    const tail = out.slice(out.indexOf(TAIL_MARKER))
    expect(head).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(Object.values(ORCH_HARD_CONSTRAINTS).some((v) => tail.includes(v))).toBe(true)
  })
})

describe("输入缺失与业务结算约束", () => {
  it("test_input_binding_constraint_uses_runtime_confirmation_and_existing_error_codes", () => {
    for (const code of ["WF_INPUT_REQUIRED", "WF_BUSY", "WF_INPUT_STATE_CONFLICT", "WF_INPUT_REVISION_CONFLICT"]) expect(ORCH_HARD_CONSTRAINTS.inputBindings).toContain(code)
    expect(ORCH_HARD_CONSTRAINTS.inputBindings).toContain("inputRevision")
  })
  it.each([buildOrchestratorPrompt, buildHybridPrompt])("test_prompt_input_settlement_and_termination_constraints_head_and_tail", (build) => {
    const output = build({ facts: orchFacts, dynamic: {} })
    const head = output.slice(0, output.indexOf(TAIL_MARKER))
    const tail = output.slice(output.indexOf(TAIL_MARKER))
    for (const constraint of [ORCH_HARD_CONSTRAINTS.inputBindings, ORCH_HARD_CONSTRAINTS.nodeSettledSignal, ORCH_HARD_CONSTRAINTS.safeTermination]) {
      expect(head).toContain(constraint)
      expect(tail).toContain(constraint)
    }
  })

  it.each([buildOrchestratorPrompt, buildHybridPrompt, buildResumeOrchestrationPrompt])("test_prompt_retry_and_failed_finish_keep_existing_constraints_and_anchors", (build) => {
    const output = build({ facts: orchFacts, dynamic: { isResume: true, resumeFromNodeId: "node-b" } })
    const head = output.slice(0, output.indexOf(TAIL_MARKER))
    const tail = output.slice(output.indexOf(TAIL_MARKER))
    for (const constraint of [ORCH_HARD_CONSTRAINTS.nodeSettledSignal, ORCH_HARD_CONSTRAINTS.failureSemantics, ORCH_HARD_CONSTRAINTS.conditionSemantics]) expect(head).toContain(constraint)
    expect(tail).toContain(ORCH_HARD_CONSTRAINTS.safeTermination)
    expect(tail).toContain(ORCH_HARD_CONSTRAINTS.finishIdempotent)
    if (build !== buildResumeOrchestrationPrompt) expect(tail).toContain(TAIL_RESTATE_MARKER)
    expect(output).toContain(WF_RUN_NODE)
    expect(output).toContain("retryLimit")
    expect(output).toContain("wf_finish(status=failed)")
  })
})

// 自主编排 P2：规划期提示词变体与三层 SOP 注入测试（自主编排实施方案 §10 P2）。
//
// 断言策略与 prompts-baseline.test.ts 一致：**不对提示词做硬编码文案断言**，只断言
//   1. 字节稳定 / 纯函数（同参数两次构建字节相同；仅改动态参数时 TAIL_MARKER 之前不变）；
//   2. 段落位置（HEAD → MID → TAIL → 重申 的顺序与区段归属）；
//   3. 三层 SOP：L1/L2 稳定段落在中段且与动态值无关；L3 注入点默认不组装、给出时仅出现在末段；
//   4. 组织预算文本仅在末段注入（与 buildOrgBudgetText 联调）；
//   5. 关键约束双位（首段 + 末段重申），经 ORG_PLAN_HARD_CONSTRAINTS 常量引用；
//   6. 目标三态（create 新建 / template 改模板 / instance 改实例）的身份与语法指引互斥；
//   7. 无 Date.now / Math.random（纯函数）。
import { describe, expect, it } from 'vitest'
import {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  ORG_PLAN_HARD_CONSTRAINTS,
  ORG_SOP_L1_GRAPH_SEMANTICS,
  ORG_SOP_L2_PATTERN_LIBRARY,
  buildOrgBudgetText,
  buildOrgPlanPrompt,
} from '../../src/host/prompts/index.js'
import type { OrgBudget } from '../../src/host/shared/types.js'

// —— 测试用稳定 facts（默认：按意图新建模板，规划期主用例） ——
const facts = {
  target: 'create' as const,
  targetName: '内容生产流水线',
  systemLanguage: '中文',
}

// L3 注入点标记（与源码 renderPlanDynamicState 一致；测试据此断言段落归属）
const USER_SOP_HEADING = '【用户 SOP】'

/** 构造一份完整 OrgBudget（buildOrgBudgetText 入参）。 */
function budget(overrides: Partial<OrgBudget> = {}): OrgBudget {
  return {
    nodeUsed: 3,
    nodeMax: 12,
    nodeRemaining: 9,
    groupUsed: 1,
    groupMax: 3,
    groupRemaining: 2,
    membersMax: 4,
    parallelBranchMax: 3,
    milestoneUsed: 1,
    milestoneMax: 5,
    milestoneRemaining: 4,
    patchOpsMax: 20,
    patchOpsRemaining: 20,
    forbiddenShapes: [],
    namingConvention: null,
    ...overrides,
  }
}

/** 按 TAIL_MARKER 切分前缀/末段。 */
function splitTail(out: string): { prefix: string; tail: string } {
  const at = out.indexOf(TAIL_MARKER)
  return { prefix: out.slice(0, at), tail: out.slice(at) }
}

describe('P2 规划提示词（buildOrgPlanPrompt）', () => {
  it('同一 params 两次构建字节相同（纯函数）', () => {
    const params = { facts, dynamic: { userIntent: '做一个内容生产流水线' } }
    expect(buildOrgPlanPrompt(params)).toBe(buildOrgPlanPrompt(params))
  })

  it('段落顺序：HEAD 先于 MID，MID 先于 TAIL，重申标题在 TAIL 之后', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    const head = out.indexOf(HEAD_MARKER)
    const mid = out.indexOf(MID_MARKER)
    const tail = out.indexOf(TAIL_MARKER)
    const restate = out.indexOf(TAIL_RESTATE_MARKER)
    expect(head).toBeGreaterThanOrEqual(0)
    expect(head).toBeLessThan(mid)
    expect(mid).toBeLessThan(tail)
    expect(tail).toBeLessThan(restate)
  })

  it('仅改动态参数时 TAIL_MARKER 之前的前缀字节不变、整体输出不同', () => {
    const a = buildOrgPlanPrompt({ facts, dynamic: { userIntent: '甲' } })
    const b = buildOrgPlanPrompt({ facts, dynamic: { userIntent: '乙', userSop: '必须先做风控' } })
    expect(splitTail(a).prefix).toBe(splitTail(b).prefix)
    expect(a).not.toBe(b)
  })

  it('关键约束双位：首段与末段重申各至少命中一条 ORG_PLAN_HARD_CONSTRAINTS', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    const { prefix, tail } = splitTail(out)
    const values = Object.values(ORG_PLAN_HARD_CONSTRAINTS)
    expect(values.some((v) => prefix.includes(v))).toBe(true)
    expect(values.some((v) => tail.includes(v))).toBe(true)
    expect(tail).toContain(TAIL_RESTATE_MARKER)
  })

  it('首段不出现动态值（用户意图），仅末段注入', () => {
    const intent = '把评审环节放到最后'
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: intent } })
    const { prefix, tail } = splitTail(out)
    expect(prefix).not.toContain(intent)
    expect(tail).toContain(intent)
    expect(tail).toContain('当前规划任务：')
  })

  it('用户意图缺省时给出兜底提示（不产出空行）', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: '   ' } })
    expect(splitTail(out).tail).toContain('用户意图：')
    expect(splitTail(out).tail).not.toContain('用户意图：\n')
  })

  it('L1 图语义与 L2 模式库位于中段（MID 之后、TAIL 之前），且不在首段/末段重复', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    const mid = out.indexOf(MID_MARKER)
    const tail = out.indexOf(TAIL_MARKER)
    const middle = out.slice(mid, tail)
    expect(middle).toContain(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(middle).toContain(ORG_SOP_L2_PATTERN_LIBRARY)
    expect(out.slice(0, mid)).not.toContain(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(out.slice(0, mid)).not.toContain(ORG_SOP_L2_PATTERN_LIBRARY)
    expect(out.slice(tail)).not.toContain(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(out.slice(tail)).not.toContain(ORG_SOP_L2_PATTERN_LIBRARY)
    expect(middle.indexOf(ORG_SOP_L1_GRAPH_SEMANTICS)).toBeLessThan(middle.indexOf(ORG_SOP_L2_PATTERN_LIBRARY))
  })

  it('L3 用户 SOP 注入点默认不组装；给出时标题与正文仅出现在末段', () => {
    const plain = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    expect(plain).not.toContain(USER_SOP_HEADING)
    const sop = '任何扩张前必须先补充验收标准'
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x', userSop: sop } })
    const { prefix, tail } = splitTail(out)
    expect(prefix).not.toContain(USER_SOP_HEADING)
    expect(tail).toContain(USER_SOP_HEADING)
    expect(tail).toContain(sop)
  })

  it('空白 userSop 视为未提供（不组装 L3 段）', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x', userSop: '   ' } })
    expect(out).not.toContain(USER_SOP_HEADING)
  })

  it('组织预算文本仅注入末段（buildOrgBudgetText 联调，给剩余量口径）', () => {
    const text = buildOrgBudgetText(budget())
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x', orgBudgetText: text } })
    const { prefix, tail } = splitTail(out)
    expect(prefix).not.toContain(text)
    expect(tail).toContain(text)
    expect(tail).toContain('剩余')
    const none = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    expect(none).not.toContain('本次组织预算：')
  })

  it('语言规则：给出 systemLanguage 时注入首段与末段；缺省时不注入', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    expect(out).toContain('必须使用中文')
    const noLang = buildOrgPlanPrompt({
      facts: { target: 'create' as const },
      dynamic: { userIntent: 'x' },
    })
    expect(noLang).not.toContain('必须使用')
  })

  it('模板不含 Date.now / Math.random（纯函数，无副作用源）', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    expect(out).not.toContain('Date.now')
    expect(out).not.toContain('Math.random')
  })
})

describe('P2 规划目标三态（create / template / instance）', () => {
  it('create：指引走 create 通路（新建），不出现「改既有目标」的措辞常量', () => {
    const out = buildOrgPlanPrompt({ facts, dynamic: { userIntent: 'x' } })
    expect(out).toContain(ORG_PLAN_HARD_CONSTRAINTS.createTemplate)
    expect(out).not.toContain(ORG_PLAN_HARD_CONSTRAINTS.updateTarget)
    expect(out).toContain('新建一个工作流模板')
  })

  it('template：身份与目标行给出既有模板 id，指引走更新语义（targetId + expectRevision）', () => {
    const out = buildOrgPlanPrompt({
      facts: { target: 'template', targetId: 'tpl-9', targetName: '既有模板', systemLanguage: '中文' },
      dynamic: { userIntent: 'x' },
    })
    expect(out).toContain(ORG_PLAN_HARD_CONSTRAINTS.updateTarget)
    expect(out).not.toContain(ORG_PLAN_HARD_CONSTRAINTS.createTemplate)
    expect(out).toContain('tpl-9')
    expect(out).toContain('既有模板')
    expect(out.split('tpl-9').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('instance：身份行说明是工作流/服务实例（不是模板）', () => {
    const out = buildOrgPlanPrompt({
      facts: { target: 'instance', targetId: 'wf-1' },
      dynamic: { userIntent: 'x' },
    })
    expect(out).toContain('实例')
    expect(out).toContain(ORG_PLAN_HARD_CONSTRAINTS.updateTarget)
    expect(out).not.toContain(ORG_PLAN_HARD_CONSTRAINTS.createTemplate)
  })

  it('targetName 缺省时用 targetId 指代（既有目标）', () => {
    const out = buildOrgPlanPrompt({
      facts: { target: 'template', targetId: 'tpl-9' },
      dynamic: { userIntent: 'x' },
    })
    expect(out.split('tpl-9').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('三态两两输出不同（身份/语法指引互斥）', () => {
    const dynamic = { userIntent: 'x' }
    const create = buildOrgPlanPrompt({ facts: { target: 'create' }, dynamic })
    const template = buildOrgPlanPrompt({ facts: { target: 'template', targetId: 'tpl-1' }, dynamic })
    const instance = buildOrgPlanPrompt({ facts: { target: 'instance', targetId: 'wf-1' }, dynamic })
    expect(create).not.toBe(template)
    expect(template).not.toBe(instance)
    expect(create).not.toBe(instance)
  })
})

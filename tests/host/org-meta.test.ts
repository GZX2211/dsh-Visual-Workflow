// tests/host/org-meta.test.ts
//
// 元参数纯函数单测（自主编排方案 §6.4 / 决策 D-04、D-13、D-21）：
//   - normalizeOrgMeta：未知字段丢弃、数值夹取、区间自洽、枚举白名单、数组去重；
//   - effectiveOrgMeta / metaOfDocument：三层装配前两层的覆盖语义；
//   - 已用量口径（executableUnitCount / groupCount / maxGroupMembers / orgUsageOf）；
//   - orgBudgetOf：剩余量口径（上限 0 = 不限制 → 剩余 null）；
//   - metaLimitIssues：每类上限超限与下限提示；
//   - freezeOrgMeta：冻结副本、缺省不写、幂等；
//   - buildOrgBudgetText：剩余量/不限文案、确定性（不读时钟/随机源）。

import { describe, expect, it } from 'vitest'
import {
  effectiveOrgMeta,
  freezeOrgMeta,
  metaOfDocument,
  normalizeOrgMeta,
  ORG_META_LIMIT_DEFAULTS,
  ORG_META_NORMALIZE_CAPS,
  orgBudgetOf,
} from '../../src/host/graph/org-meta.js'
import {
  executableUnitCount,
  groupCount,
  maxGroupMembers,
  orgUsageOf,
} from '../../src/host/graph/org-meta-usage.js'
import { META_BELOW_MIN_CODE, META_LIMIT_CODE, metaLimitIssues } from '../../src/host/graph/org-meta-limits.js'
import { buildOrgBudgetText } from '../../src/host/prompts/index.js'
import type { GraphNode } from '../../src/host/shared/graph-model.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'

/** 可执行节点（agent/parent/group 三类各一）。 */
function agent(id: string): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label: id, systemPrompt: '', provider: '', model: '', presetId: null,
      retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
    },
  }
}
function parent(id: string): GraphNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: {
      label: id, systemPrompt: '', provider: '', model: '', presetId: null,
      retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
    },
  }
}
function group(id: string, memberIds: string[]): GraphNode {
  return { id, kind: 'group', position: { x: 0, y: 0 }, data: { label: id, collabPrompt: '', memberIds } }
}
function stage(id: string, kind: 'start' | 'end'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: kind === 'start' ? '启动' : '结束' } }
}

describe('normalizeOrgMeta：规范化与防御', () => {
  it('缺省/非法输入 → 空对象（零约束，零行为变化）', () => {
    expect(normalizeOrgMeta(undefined)).toEqual({})
    expect(normalizeOrgMeta(null)).toEqual({})
    expect(normalizeOrgMeta('不是对象')).toEqual({})
    expect(normalizeOrgMeta({ 未知字段: 1, nodeMax: 'abc', groupMax: -3 })).toEqual({})
  })

  it('数值：取整、非正数视为未配置、超安全网夹取', () => {
    const meta = normalizeOrgMeta({ nodeMax: 12.7, groupMax: 0, milestoneMax: -1, patchOpsMax: 99999 })
    expect(meta.nodeMax).toBe(12)
    expect(meta.groupMax).toBeUndefined()
    expect(meta.milestoneMax).toBeUndefined()
    expect(meta.patchOpsMax).toBe(ORG_META_NORMALIZE_CAPS.patchOpsMax)
  })

  it('区间自洽：min > max 时丢弃 min（保留上限）', () => {
    expect(normalizeOrgMeta({ nodeMin: 10, nodeMax: 3 })).toEqual({ nodeMax: 3 })
    expect(normalizeOrgMeta({ membersMin: 9, membersMax: 2 })).toEqual({ membersMax: 2 })
    expect(normalizeOrgMeta({ nodeMin: 2, nodeMax: 8 })).toEqual({ nodeMin: 2, nodeMax: 8 })
  })

  it('枚举白名单：非法取值丢弃', () => {
    const meta = normalizeOrgMeta({
      planFreedom: '随便',
      promptSource: 'agent-generated',
      roleGranularity: 'narrow',
      roleReuse: 'allow',
      crossGroupPolicy: 'forbid',
    })
    expect(meta).toEqual({
      promptSource: 'agent-generated',
      roleGranularity: 'narrow',
      roleReuse: 'allow',
      crossGroupPolicy: 'forbid',
    })
  })

  it('数组：interveneTrigger 白名单过滤 + 去重；forbiddenShapes 去空去重', () => {
    const meta = normalizeOrgMeta({
      interveneTrigger: ['user', 'nope', 'user', 'milestone'],
      forbiddenShapes: ['flowCycle', ' ', 'flowCycle', 'orphanNode'],
    })
    expect(meta.interveneTrigger).toEqual(['user', 'milestone'])
    expect(meta.forbiddenShapes).toEqual(['flowCycle', 'orphanNode'])
  })

  it('failurePolicy：语义固定形状（retry=1 + 升级 + 无法解决问用户）', () => {
    expect(normalizeOrgMeta({ failurePolicy: { retry: 1, thenEscalate: true, askUserOnUnresolved: true } }).failurePolicy)
      .toEqual({ retry: 1, thenEscalate: true, askUserOnUnresolved: true })
    expect(normalizeOrgMeta({ failurePolicy: { retry: 3 } }).failurePolicy).toBeUndefined()
  })

  it('namingConvention：空串收敛为 null（显式声明「无约定」）', () => {
    expect(normalizeOrgMeta({ namingConvention: '  ' })).toEqual({ namingConvention: null })
    expect(normalizeOrgMeta({ namingConvention: '阶段' })).toEqual({ namingConvention: '阶段' })
  })

  it('评估/重组占位字段：对象原样保留（本轮不解析）', () => {
    const meta = normalizeOrgMeta({ eval: { metric: 'token' }, restructure: { maxRounds: 2 } })
    expect(meta.eval).toEqual({ metric: 'token' })
    expect(meta.restructure).toEqual({ maxRounds: 2 })
  })
})

describe('三层装配（D-13）', () => {
  it('effectiveOrgMeta：后者覆盖前者（浅合并）', () => {
    const merged = effectiveOrgMeta({ nodeMax: 12, groupMax: 3 }, { nodeMax: 20 })
    expect(merged).toEqual({ nodeMax: 20, groupMax: 3 })
  })

  it('effectiveOrgMeta：空/undefined 来源跳过', () => {
    expect(effectiveOrgMeta(undefined, null, { nodeMax: 5 }, undefined)).toEqual({ nodeMax: 5 })
    expect(effectiveOrgMeta()).toEqual({})
  })

  it('metaOfDocument：文档缺 meta / meta 非法按空对象（旧数据零行为变化）', () => {
    expect(metaOfDocument(undefined)).toEqual({})
    expect(metaOfDocument({})).toEqual({})
    expect(metaOfDocument({ meta: { nodeMax: 6 } })).toEqual({ nodeMax: 6 })
  })

  it('缺省上限常量：仅在「上限类」字段给缺省（下限/软约束不设默认）', () => {
    expect(ORG_META_LIMIT_DEFAULTS.nodeMax).toBeGreaterThan(0)
    expect(ORG_META_LIMIT_DEFAULTS.groupMax).toBeGreaterThan(0)
    expect(ORG_META_LIMIT_DEFAULTS.membersMax).toBeGreaterThan(0)
  })
})

describe('已用量口径（与检查器/P1 工具共用）', () => {
  const nodes = [
    stage('s', 'start'),
    agent('a1'),
    parent('p1'),
    group('g1', ['a1', 'a1', 'm2']),
    agent('m2'),
    stage('e', 'end'),
  ]

  it('executableUnitCount：只计 agent/parent/group（阶段节点不计入规模）', () => {
    expect(executableUnitCount(nodes)).toBe(4)
    expect(executableUnitCount(null)).toBe(0)
  })

  it('groupCount / maxGroupMembers：去重后计人数', () => {
    expect(groupCount(nodes)).toBe(1)
    expect(maxGroupMembers(nodes)).toBe(2)
  })

  it('orgUsageOf：由图推导已用量，可选维度按传入决定是否判定', () => {
    const base = orgUsageOf({ nodes })
    expect(base).toEqual({ nodeCount: 4, groupCount: 1, maxGroupMembers: 2, milestoneUsed: 0 })
    const withOptions = orgUsageOf({ nodes }, { milestoneUsed: 2, parallelBranchMax: 3, patchOps: 4 })
    expect(withOptions.milestoneUsed).toBe(2)
    expect(withOptions.parallelBranchMax).toBe(3)
    expect(withOptions.patchOps).toBe(4)
  })
})

describe('orgBudgetOf：剩余量口径', () => {
  const usage = orgUsageOf({ nodes: [agent('a1'), agent('a2'), group('g1', ['a1', 'b', 'c'])] }, { milestoneUsed: 1, patchOps: 2 })

  it('上限已配置 → 剩余 = 上限 - 已用', () => {
    const budget = orgBudgetOf({ nodeMax: 5, groupMax: 2, milestoneMax: 3, patchOpsMax: 6 }, usage)
    expect(budget.nodeUsed).toBe(3)
    expect(budget.nodeRemaining).toBe(2)
    expect(budget.groupRemaining).toBe(1)
    expect(budget.milestoneRemaining).toBe(2)
    expect(budget.patchOpsRemaining).toBe(4)
  })

  it('上限未配置（0） → 剩余为 null（提示词渲染「不限」）', () => {
    const budget = orgBudgetOf({}, usage)
    expect(budget.nodeMax).toBe(0)
    expect(budget.nodeRemaining).toBeNull()
    expect(budget.milestoneRemaining).toBeNull()
    expect(budget.patchOpsRemaining).toBeNull()
    expect(budget.forbiddenShapes).toEqual([])
    expect(budget.namingConvention).toBeNull()
  })

  it('禁用拓扑与命名约定透传（副本，不共享引用）', () => {
    const budget = orgBudgetOf({ forbiddenShapes: ['flowCycle'], namingConvention: '阶段' }, usage)
    expect(budget.forbiddenShapes).toEqual(['flowCycle'])
    budget.forbiddenShapes.push('orphanNode')
    expect(budget.forbiddenShapes).toHaveLength(2)
    expect(budget.namingConvention).toBe('阶段')
  })
})

describe('metaLimitIssues：硬护栏与下限提示', () => {
  const usage = { nodeCount: 5, groupCount: 2, maxGroupMembers: 4, milestoneUsed: 0 }
  const codes = (issues: ReturnType<typeof metaLimitIssues>): string[] => issues.map((issue) => issue.code)

  it('全部上限未配置 → 无任何 issue', () => {
    expect(metaLimitIssues({}, usage)).toEqual([])
  })

  it('节点数超限：error + 修复建议', () => {
    const issues = metaLimitIssues({ nodeMax: 4 }, usage)
    expect(codes(issues)).toEqual([META_LIMIT_CODE])
    expect(issues[0].level).toBe('error')
    expect(String(issues[0].suggestion ?? '').length).toBeGreaterThan(0)
  })

  it('组数/组内人数超限：各一例', () => {
    expect(codes(metaLimitIssues({ groupMax: 1 }, usage))).toEqual([META_LIMIT_CODE])
    expect(codes(metaLimitIssues({ membersMax: 3 }, usage))).toEqual([META_LIMIT_CODE])
  })

  it('并行分支/单轮 op：仅在维度提供时判定', () => {
    expect(codes(metaLimitIssues({ parallelBranchMax: 2 }, usage))).toEqual([])
    expect(codes(metaLimitIssues({ parallelBranchMax: 2 }, { ...usage, parallelBranchMax: 3 }))).toEqual([META_LIMIT_CODE])
    expect(codes(metaLimitIssues({ patchOpsMax: 1 }, { ...usage, patchOps: 4 }))).toEqual([META_LIMIT_CODE])
  })

  it('下限：只提示（warning），不阻断', () => {
    const issues = metaLimitIssues({ nodeMin: 9, membersMin: 6 }, usage)
    expect(codes(issues)).toEqual([META_BELOW_MIN_CODE, META_BELOW_MIN_CODE])
    expect(issues.every((issue) => issue.level === 'warning')).toBe(true)
  })
})

describe('freezeOrgMeta：快照冻结（D-13 第三层）', () => {
  function snapshot(): RunSnapshot {
    return {
      id: 'run-1', flowId: 'wf-1', flowName: 'n', sessionId: 's', mode: 'mode1',
      status: 'running', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, summary: '', nodes: [],
    }
  }

  it('有效值写入快照（规范化后的副本；未知字段被丢弃）', () => {
    const snap = snapshot()
    freezeOrgMeta(snap, { nodeMax: 12.9, 未知: 1 } as unknown as Parameters<typeof freezeOrgMeta>[1])
    expect(snap.meta).toEqual({ nodeMax: 12 })
  })

  it('缺省 / 空对象：不写字段（保持既有快照形状）', () => {
    const empty = snapshot()
    freezeOrgMeta(empty, {})
    expect('meta' in empty).toBe(false)
    const undef = snapshot()
    freezeOrgMeta(undef, undefined)
    expect('meta' in undef).toBe(false)
  })

  it('冻结的是副本：后续修改来源 meta 不影响快照', () => {
    const source = { nodeMax: 12 }
    const snap = snapshot()
    freezeOrgMeta(snap, source)
    source.nodeMax = 99
    expect(snap.meta?.nodeMax).toBe(12)
  })

  it('幂等：重复冻结结果一致', () => {
    const snap = snapshot()
    freezeOrgMeta(snap, { groupMax: 2 })
    const first = structuredClone(snap.meta)
    freezeOrgMeta(snap, { groupMax: 2 })
    expect(snap.meta).toEqual(first)
  })
})

describe('buildOrgBudgetText：末段动态文本（纯函数）', () => {
  const budget = orgBudgetOf(
    { nodeMax: 12, groupMax: 3, membersMax: 5, milestoneMax: 2, patchOpsMax: 6, forbiddenShapes: ['flowCycle', 'orphanNode'] },
    { nodeCount: 4, groupCount: 1, maxGroupMembers: 2, milestoneUsed: 1, patchOps: 0 },
  )

  it('输出含剩余量口径与禁用拓扑清单', () => {
    const text = buildOrgBudgetText(budget)
    expect(text).toContain('本次组织预算')
    expect(text).toContain('4/12')
    expect(text).toContain('剩余 8')
    expect(text).toContain('1/2')
    expect(text).toContain('flowCycle / orphanNode')
  })

  it('上限未配置：渲染「不限」而不是 0', () => {
    const text = buildOrgBudgetText(orgBudgetOf({}, { nodeCount: 2, groupCount: 0, maxGroupMembers: 0, milestoneUsed: 0 }))
    expect(text).toContain('不限')
    expect(text).not.toContain('/0')
    expect(text).toContain('禁用拓扑：无')
  })

  it('确定性：同输入两次输出字节相同（不读时钟/随机源）', () => {
    expect(buildOrgBudgetText(budget)).toBe(buildOrgBudgetText(budget))
    expect(buildOrgBudgetText(budget)).not.toContain('Date.now')
  })

  it('命名约定：配置时出现在预算文本中', () => {
    const text = buildOrgBudgetText(orgBudgetOf({ namingConvention: '阶段' }, { nodeCount: 0, groupCount: 0, maxGroupMembers: 0, milestoneUsed: 0 }))
    expect(text).toContain('命名约定：阶段')
  })
})

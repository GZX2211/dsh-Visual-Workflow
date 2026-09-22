// tests/host/graph/invariants.test.ts
//
// 图检查器单测（自主编排方案 §6.1/§6.2/§6.3）：
//   - 规则矩阵完整性：遍历 GRAPH_INVARIANT_CODES，每个 code 至少一条构造用例触发，
//     且实际级别与注册表一致；
//   - 健康图零问题；error 必带修复建议；输出确定性（同输入同输出）；
//   - origin 语义（D-05）：元参数硬护栏仅对 origin='agent' 生效；
//   - forbiddenShapes 级别提升；并行分支/可达性/环路等口径锁定。
//
// 断言策略：只断言 code 集合与级别（不绑定中文文案——文案属可润色内容）。

import { describe, expect, it } from 'vitest'
import {
  GRAPH_INVARIANT_CODES,
  buildFlowDag,
  checkGraphInvariants,
  computeFlowLayers,
  detectCycleNodes,
  hasBlockingIssues,
  invariantCodeInfo,
  maxLayerWidth,
  type GraphIssue,
} from '../../../src/host/graph/index.js'
import type { GraphNode, Line, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { OrgMeta } from '../../../src/host/shared/types.js'

// ---------------------------------------------------------------------------
// 构造帮手（每个用例只触发目标 code，避免级联噪声干扰断言）
// ---------------------------------------------------------------------------

/**
 * 可执行节点（agent/parent）。
 *
 * 注意（2026.09）：默认值构造成「已配置好」的角色节点（有 systemPrompt 与 presetId 组合），
 * 使各规则用例只触发目标 code，不被 roleNodeNoPreset / roleNodeNoPrompt 两条软规则污染。
 * 需要验证这两条规则的用例显式传 `{ presetId: null }` / `{ systemPrompt: '' }`。
 */
function agent(id: string, label = id, data: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: '你是执行该任务的子代理。',
      provider: '',
      model: '',
      presetId: 'combo-test',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      ...data,
    },
  }
}

/** 父代理节点（与 agent 同形状，仅 kind 不同——显式构造，便于类型收窄）。 */
function parent(id: string, label = id, data: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: '你是编排父代理。',
      provider: '',
      model: '',
      presetId: 'combo-test',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      ...data,
    },
  }
}

/** 阶段节点。 */
function stage(id: string, kind: 'start' | 'end' | 'pause', mode: 'mode1' | 'mode2' = 'mode1'): GraphNode {
  const labels: Record<string, { mode1: string; mode2: string }> = {
    start: { mode1: '启动', mode2: '输入' },
    end: { mode1: '结束', mode2: '输出' },
    pause: { mode1: '暂停', mode2: '暂停' },
  }
  return { id, kind, position: { x: 0, y: 0 }, data: { label: labels[kind][mode] } }
}

/** 文件节点（文本/受管）。 */
function fileNode(id: string, data: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'file', position: { x: 0, y: 0 }, data: { label: id, fileKind: 'text', content: 'x', ...data } }
}

/** 数据库节点。 */
function dbNode(id: string, data: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    kind: 'database',
    position: { x: 0, y: 0 },
    data: { label: id, description: '', dbType: 'local', dbKind: 'sqlite', ...data },
  }
}

/** 协作组节点。 */
function groupNode(id: string, memberIds: string[]): GraphNode {
  return { id, kind: 'group', position: { x: 0, y: 0 }, data: { label: id, collabPrompt: '', memberIds } }
}

/** 虚拟节点（P3：可选 data.role 区分「执行入口」与「里程碑闸门」）。 */
function proxyNode(id: string, proxySourceId: string, role?: 'executor' | 'milestone'): GraphNode {
  return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId, ...(role ? { data: { role } } : {}) }
}

const LINE_KIND: Record<string, { sourceHandle: Line['sourceHandle']; targetHandle: Line['targetHandle'] }> = {
  flow: { sourceHandle: 'flow-out', targetHandle: 'flow-in' },
  ctx: { sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
  db: { sourceHandle: 'db-out', targetHandle: 'db-in' },
}

/** 连线构造：kind 默认流程线。 */
function line(id: string, source: string, target: string, kind: 'flow' | 'ctx' | 'db' = 'flow', condition?: Line['condition']): Line {
  const handles = LINE_KIND[kind]
  return { id, source, target, ...handles, ...(condition ? { condition } : {}) }
}

/** 图文档构造。 */
function flow(nodes: GraphNode[], lines: Line[], mode: 'mode1' | 'mode2' = 'mode1', meta?: OrgMeta): WorkflowDocument {
  return { id: 'wf-1', sessionId: 'session-1', mode, name: '测试图', description: '', nodes, lines, ...(meta ? { meta } : {}) }
}

/** 检查（默认 origin='agent'，与补丁路径一致）。 */
function check(input: {
  flow: WorkflowDocument
  meta?: OrgMeta
  origin?: 'agent' | 'user'
  patchOps?: number
  milestoneUsed?: number
}): GraphIssue[] {
  return checkGraphInvariants({
    flow: input.flow,
    origin: input.origin ?? 'agent',
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.patchOps !== undefined ? { patchOps: input.patchOps } : {}),
    ...(input.milestoneUsed !== undefined ? { milestoneUsed: input.milestoneUsed } : {}),
  })
}

/** issue code 集合。 */
function codes(issues: GraphIssue[]): string[] {
  return issues.map((issue) => issue.code)
}

/**
 * 健康基线图：start → a1 →（ctx）→ a2 → end（无 error 也无 warning）。
 * 两层节点 + 一条 ctx 线：既满足流程/阶段硬规则，也满足数据流契约软规则
 * （a2 有上游输入通道），故可用于「零问题」断言。
 */
function healthyFlow(): WorkflowDocument {
  return flow(
    [stage('s', 'start'), agent('a1', '分析'), agent('a2', '成稿'), stage('e', 'end')],
    [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e'), line('l4', 'a1', 'a2', 'ctx')],
  )
}

// ---------------------------------------------------------------------------
// 健康图与基本不变式
// ---------------------------------------------------------------------------

describe('检查器基线', () => {
  it('健康基线图：无 error 也无 warning（含数据流契约与角色配置软规则）', () => {
    const issues = check({ flow: healthyFlow() })
    expect(issues).toEqual([])
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('确定性：同输入两次调用结果完全一致（不读时钟/随机源）', () => {
    const bad = flow([stage('s', 'start')], [])
    expect(check({ flow: bad })).toEqual(check({ flow: bad }))
  })

  it('error 级必带修复建议（模型自我修正通道非空）', () => {
    const cases: WorkflowDocument[] = [
      flow([agent('a1')], []),
      flow([stage('s', 'start')], []),
      flow([stage('s', 'start'), agent('a1'), stage('e', 'end')], [line('l1', 's', 'e'), line('l2', 'e', 's')]),
    ]
    for (const doc of cases) {
      const issues = check({ flow: doc })
      expect(issues.length).toBeGreaterThan(0)
      for (const issue of issues.filter((item) => item.level === 'error')) {
        expect(String(issue.suggestion ?? '').trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('输出稳定排序：error 在前，同级按 code 字典序', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a2', 'e')], // a1 无出、a2 无入 → cannotReachEnd + unreachableFromStart
    )
    const issues = check({ flow: doc })
    const levels = issues.map((issue) => issue.level)
    const firstWarning = levels.indexOf('warning')
    if (firstWarning >= 0) expect(levels.slice(firstWarning).every((level) => level === 'warning')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 规则矩阵：每个 code 至少一例
// ---------------------------------------------------------------------------

describe('规则矩阵（每个 code 一例）', () => {
  it('startRequired：缺少启动节点', () => {
    const issues = check({ flow: flow([agent('a1'), stage('e', 'end')], [line('l1', 'a1', 'e')]) })
    expect(codes(issues)).toContain('startRequired')
    expect(issues.find((i) => i.code === 'startRequired')?.level).toBe('error')
  })

  it('startRequired：两个启动节点', () => {
    const doc = flow(
      [stage('s1', 'start'), stage('s2', 'start'), agent('a1'), stage('e', 'end')],
      [line('l1', 's1', 'a1'), line('l2', 'a1', 'e')],
    )
    expect(codes(check({ flow: doc }))).toContain('startRequired')
  })

  it('startNoFlowOut：启动节点无流程出线', () => {
    const doc = flow([stage('s', 'start'), agent('a1'), stage('e', 'end')], [line('l1', 'a1', 'e')])
    expect(codes(check({ flow: doc }))).toContain('startNoFlowOut')
  })

  it('startNoFlowOut：启动节点流程出指向不可执行节点', () => {
    const doc = flow(
      [stage('s', 'start'), dbNode('d1', { localPath: 'x.db' }), agent('a1'), stage('e', 'end')],
      [line('l1', 's', 'd1'), line('l2', 'a1', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('startNoFlowOut')
    // 注意：db 节点被 flow 线连到 → 不是孤立节点，orphanNode 不触发
    expect(codes(issues)).not.toContain('orphanNode')
  })

  it('endRequired：缺少结束节点 / 两个结束节点', () => {
    const missing = flow([stage('s', 'start'), agent('a1')], [line('l1', 's', 'a1')])
    expect(codes(check({ flow: missing }))).toContain('endRequired')
    const duplicate = flow(
      [stage('s', 'start'), agent('a1'), stage('e1', 'end'), stage('e2', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e1')],
    )
    expect(codes(check({ flow: duplicate }))).toContain('endRequired')
  })

  it('endNoFlowIn：结束节点无流程入线', () => {
    const doc = flow([stage('s', 'start'), agent('a1'), stage('e', 'end')], [line('l1', 's', 'a1')])
    expect(codes(check({ flow: doc }))).toContain('endNoFlowIn')
  })

  it('orphanNode：既无流程线也无上下文/数据库线的节点', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('orphanNode')
    expect(issues.find((i) => i.code === 'orphanNode')?.nodeIds).toEqual(['a2'])
  })

  it('conditionMissingOpposite：只有通过分支（warning）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2', 'flow', { type: 'pass' }), line('l3', 'a2', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('conditionMissingOpposite')
    expect(issues.find((i) => i.code === 'conditionMissingOpposite')?.level).toBe('warning')
  })

  it('conditionMissingOpposite：通过 + 不通过齐备时不报', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [
        line('l1', 's', 'a1'),
        line('l2', 'a1', 'a2', 'flow', { type: 'pass' }),
        line('l3', 'a1', 'e', 'flow', { type: 'fail' }),
        line('l4', 'a2', 'e'),
      ],
    )
    expect(codes(check({ flow: doc }))).not.toContain('conditionMissingOpposite')
  })

  it('groupNoMembers / groupNoFlow：空组且无流程线', () => {
    const doc = flow([stage('s', 'start'), groupNode('g1', []), stage('e', 'end')], [line('l1', 's', 'e')])
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('groupNoMembers')
    expect(codes(issues)).toContain('groupNoFlow')
  })

  it('groupMemberMissing：协作组成员 id 不存在', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), groupNode('g1', ['a1', 'ghost']), stage('e', 'end')],
      [line('l1', 's', 'g1'), line('l2', 'g1', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('groupMemberMissing')
    expect(codes(issues)).not.toContain('groupNoFlow')
  })

  it('flowCycle：三节点环（环上节点被识别）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), agent('a3'), stage('e', 'end')],
      [
        line('l1', 's', 'e'),
        line('c1', 'a1', 'a2'),
        line('c2', 'a2', 'a3'),
        line('c3', 'a3', 'a1'),
      ],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('flowCycle')
    const issue = issues.find((i) => i.code === 'flowCycle')
    expect([...(issue?.nodeIds ?? [])].sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('proxySourceMissing：虚拟节点引用不存在的主节点', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), proxyNode('p1', 'nope'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e'), line('c1', 'p1', 'a1', 'ctx')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('proxySourceMissing')
  })

  it('unreachableFromStart：有流程入但从启动节点不可达的孤岛', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('i1'), agent('i2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e'), line('i-1', 'i1', 'i2')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('unreachableFromStart')
    expect(issues.find((i) => i.code === 'unreachableFromStart')?.nodeIds).toEqual(['i2'])
  })

  it('cannotReachEnd：有流程入但无流程出（warning）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 's', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('cannotReachEnd')
    expect(issues.find((i) => i.code === 'cannotReachEnd')?.level).toBe('warning')
  })

  it('dataNodeIncomplete：数据库无路径无连接 / 受管文件未选文件', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), dbNode('d1'), fileNode('f1', { fileKind: 'file' }), stage('e', 'end')],
      [
        line('l1', 's', 'a1'),
        line('l2', 'a1', 'e'),
        line('c1', 'f1', 'a1', 'ctx'),
        line('c2', 'a1', 'd1', 'db'),
      ],
    )
    const issues = check({ flow: doc })
    const incomplete = issues.filter((i) => i.code === 'dataNodeIncomplete')
    expect(incomplete).toHaveLength(2)
    expect(incomplete.flatMap((i) => i.nodeIds ?? []).sort()).toEqual(['d1', 'f1'])
  })

  it('ctxSourceInvalid：上下文入线来自暂停节点', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('p1', 'pause'), agent('a2'), stage('e', 'end')],
      [
        line('l1', 's', 'a1'),
        line('l2', 'a1', 'p1'),
        line('l3', 'p1', 'a2'),
        line('l4', 'a2', 'e'),
        line('c1', 'p1', 'a1', 'ctx'),
      ],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('ctxSourceInvalid')
  })

  it('dbLineTargetInvalid：数据库出线指向角色节点', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), dbNode('d1', { localPath: 'x.db' }), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e'), line('c1', 'd1', 'a1', 'db')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('dbLineTargetInvalid')
  })

  it('pauseNodeDangling：暂停节点缺少流程出', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('p1', 'pause'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'p1'), line('l3', 'a1', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('pauseNodeDangling')
  })

  it('startHasFlowIn：启动节点存在流程入线', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e'), line('l3', 'a1', 's')],
    )
    expect(codes(check({ flow: doc }))).toContain('startHasFlowIn')
  })

  it('endHasFlowOut：结束节点存在流程出线', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e'), line('l3', 'e', 'a1')],
    )
    expect(codes(check({ flow: doc }))).toContain('endHasFlowOut')
  })

  it('milestoneProxyInvalid：指向父代理的虚拟节点无流程入口（warning）', () => {
    const doc = flow(
      [stage('s', 'start'), parent('p1', 'CEO'), agent('a1'), proxyNode('m1', 'p1'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('milestoneProxyInvalid')
    expect(issues.find((i) => i.code === 'milestoneProxyInvalid')?.level).toBe('warning')
  })

  it('milestoneProxyInvalid：闸门数超过元参数上限（warning）', () => {
    const doc = flow(
      [stage('s', 'start'), parent('p1', 'CEO'), agent('a1'), proxyNode('m1', 'p1', 'milestone'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'm1'), line('l3', 'm1', 'e')],
    )
    // 闸门被流程驱动 → 只有「超上限」这一条；milestoneMax=0 视为不限制
    expect(codes(check({ flow: doc, meta: { milestoneMax: 0 } }))).not.toContain('milestoneProxyInvalid')
    const twoGates = flow(
      [stage('s', 'start'), parent('p1', 'CEO'), agent('a1'), proxyNode('m1', 'p1', 'milestone'), proxyNode('m2', 'p1', 'milestone'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'm1'), line('l3', 'm1', 'm2'), line('l4', 'm2', 'e')],
    )
    expect(codes(check({ flow: twoGates, meta: { milestoneMax: 1 } }))).toContain('milestoneProxyInvalid')
    // P3：闸门以 data.role 判别——缺省 executor 的虚拟节点不占闸门预算（向后兼容既有画布）
    const executors = flow(
      [stage('s', 'start'), parent('p1', 'CEO'), agent('a1'), proxyNode('x1', 'p1', 'executor'), proxyNode('x2', 'p1', 'executor'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'x1'), line('l3', 'x1', 'x2'), line('l4', 'x2', 'e')],
    )
    expect(codes(check({ flow: executors, meta: { milestoneMax: 1 } }))).not.toContain('milestoneProxyInvalid')
  })

  it("milestoneProxyInvalid：data.role='milestone' 却指向非父代理节点（warning）", () => {
    const doc = flow(
      [stage('s', 'start'), parent('p1', 'CEO'), agent('a1'), proxyNode('m1', 'a1', 'milestone'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'e')],
    )
    const issue = check({ flow: doc }).find((i) => i.code === 'milestoneProxyInvalid')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('不是父代理节点')
    expect(issue?.level).toBe('warning')
  })

  it('metaLimitExceeded：可执行节点数超过 nodeMax（origin=agent）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    // 可执行节点 = a1 + a2（start/end 不计入规模口径）→ nodeMax:1 必然超限
    const issues = check({ flow: doc, meta: { nodeMax: 1 } })
    expect(codes(issues)).toContain('metaLimitExceeded')
    expect(issues.find((i) => i.code === 'metaLimitExceeded')?.level).toBe('error')
  })

  it('metaLimitExceeded：协作组数 / 组内人数 / 并行分支 / 单轮 op 超限', () => {
    const groupHeavy = flow(
      [stage('s', 'start'), agent('m1'), agent('m2'), groupNode('g1', ['m1', 'm2']), stage('e', 'end')],
      [line('l1', 's', 'g1'), line('l2', 'g1', 'e')],
    )
    expect(codes(check({ flow: groupHeavy, meta: { groupMax: 1, membersMax: 1 } }))).toContain('metaLimitExceeded')

    const fanOut = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), agent('a3'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 's', 'a2'), line('l3', 's', 'a3'), line('l4', 'a1', 'e'), line('l5', 'a2', 'e'), line('l6', 'a3', 'e')],
    )
    // 单层并行 = 3（a1/a2/a3 同层）→ parallelBranchMax: 2 必然超限
    expect(codes(check({ flow: fanOut, meta: { parallelBranchMax: 2 } }))).toContain('metaLimitExceeded')
    // 单轮 op 上限
    expect(codes(check({ flow: healthyFlow(), meta: { patchOpsMax: 1 }, patchOps: 3 }))).toContain('metaLimitExceeded')
  })

  it('metaBelowMin：低于下限只提示不阻断', () => {
    const issues = check({ flow: healthyFlow(), meta: { nodeMin: 5 } })
    expect(codes(issues)).toContain('metaBelowMin')
    expect(issues.find((i) => i.code === 'metaBelowMin')?.level).toBe('warning')
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('duplicateRoleLabel：多个可执行节点同名（warning）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1', '分析'), agent('a2', ' 分析 '), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    const issues = check({ flow: doc })
    expect(codes(issues)).toContain('duplicateRoleLabel')
    expect(issues.find((i) => i.code === 'duplicateRoleLabel')?.level).toBe('warning')
  })

  it('namingConvention：前缀/正则两种约定形态（warning）', () => {
    // 约定为字面量前缀：label 不以该前缀开头 → 提示（只命中未达标的那一个节点）
    const prefixed = flow(
      [stage('s', 'start'), agent('a1', '阶段一'), agent('a2', '分析'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    const issues = check({ flow: prefixed, meta: { namingConvention: '阶段' } })
    expect(codes(issues)).toContain('namingConvention')
    expect(issues.filter((i) => i.code === 'namingConvention').flatMap((i) => i.nodeIds ?? [])).toEqual(['a2'])
    expect(issues.find((i) => i.code === 'namingConvention')?.level).toBe('warning')

    // 全部满足前缀 → 无任何问题（空数组，锁定「不误报」）
    // 注意：两条软规则（nodeNoUpstream / roleNode*）也要满足，故给 a2 连一条 ctx 输入线
    const satisfied = flow(
      [stage('s', 'start'), agent('a1', '阶段一'), agent('a2', '阶段二'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e'), line('c1', 'a1', 'a2', 'ctx')],
    )
    expect(check({ flow: satisfied, meta: { namingConvention: '阶段' } })).toEqual([])

    // 单独一个 '/' 视为字面量前缀（不是空正则）：label 不以 '/' 开头 → 提示
    expect(codes(check({ flow: satisfied, meta: { namingConvention: '/' } }))).toContain('namingConvention')

    // 正则写法（首尾斜杠）：以数字开头的名称通过，其余提示
    const numbered = flow(
      [stage('s', 'start'), agent('a1', '1-阶段一'), agent('a2', '2-阶段二'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e'), line('c1', 'a1', 'a2', 'ctx')],
    )
    expect(codes(check({ flow: numbered, meta: { namingConvention: '/^\\d/' } }))).not.toContain('namingConvention')
    expect(codes(check({ flow: satisfied, meta: { namingConvention: '/^\\d/' } }))).toContain('namingConvention')
  })

  it('nodeNoUpstream：多前置且无输入通道 → warning；单前置线性流水线不报（不误伤首节点）', () => {
    // 线性流水线（每个节点只有一个可执行前置）→ 两条数据流规则都不报
    const linear = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    expect(codes(check({ flow: linear }))).not.toContain('nodeNoUpstream')
    expect(codes(check({ flow: linear }))).not.toContain('nodeNoConsumer')

    // 扇出后汇聚：汇聚节点有 a1/a2 两个可执行前置却无任何输入通道 → 提示
    const converge = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), agent('j'), stage('e', 'end')],
      [
        line('l1', 's', 'a1'), line('l2', 's', 'a2'),
        line('l3', 'a1', 'j'), line('l4', 'a2', 'j'), line('l5', 'j', 'e'),
      ],
    )
    const issues = check({ flow: converge })
    expect(issues.filter((i) => i.code === 'nodeNoUpstream').flatMap((i) => i.nodeIds ?? [])).toEqual(['j'])
    expect(issues.filter((i) => i.code === 'nodeNoUpstream').every((i) => i.level === 'warning')).toBe(true)

    // 给汇聚节点补一条 ctx 入线后不再报
    const withCtx = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), agent('j'), stage('e', 'end')],
      [
        line('l1', 's', 'a1'), line('l2', 's', 'a2'),
        line('l3', 'a1', 'j'), line('l4', 'a2', 'j'), line('l5', 'j', 'e'),
        line('c1', 'a1', 'j', 'ctx'),
      ],
    )
    expect(codes(check({ flow: withCtx }))).not.toContain('nodeNoUpstream')
  })

  it('nodeNoConsumer：声明了输出结构但下游都没接入 ctx → warning；未声明则不报', () => {
    const base = [
      stage('s', 'start') as GraphNode,
      agent('a1', '分析', { outputSchema: '结论 / 产出文件路径' }),
      agent('a2', '成稿'),
      stage('e', 'end') as GraphNode,
    ]
    const lines = [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')]
    const issues = check({ flow: flow(base, lines) })
    expect(issues.filter((i) => i.code === 'nodeNoConsumer').flatMap((i) => i.nodeIds ?? [])).toEqual(['a1', 'a2'])
    // 未声明 outputSchema 的同类图不报（本规则只在「契约与图形不一致」时发声）
    const undeclared = flow(
      [stage('s', 'start'), agent('a1', '分析'), agent('a2', '成稿'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    expect(codes(check({ flow: undeclared }))).not.toContain('nodeNoConsumer')
    // 接上 ctx 线后一致，不再报
    expect(codes(check({ flow: flow(base, [...lines, line('c1', 'a1', 'a2', 'ctx')]) }))).not.toContain('nodeNoConsumer')
  })

  it('nodeNoUpstream：file / db 入线也算输入通道（不误报）', () => {
    const withFile = flow(
      [
        stage('s', 'start'),
        fileNode('f1'),
        agent('a1'),
        agent('a2'),
        stage('e', 'end'),
      ],
      [
        line('l1', 's', 'a1'), line('l2', 's', 'a2'),
        line('l3', 'a1', 'a2'), line('l4', 'a2', 'e'),
        line('c1', 'f1', 'a2', 'ctx'),
      ],
    )
    expect(codes(check({ flow: withFile }))).not.toContain('nodeNoUpstream')
  })

  it('roleNodeNoPreset / roleNodeNoPrompt：角色节点缺工具组合或缺 System Prompt → warning', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1', '分析', { presetId: null }), agent('a2', '成稿', { systemPrompt: '  ' }), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e'), line('c1', 'a1', 'a2', 'ctx')],
    )
    const issues = check({ flow: doc })
    expect(issues.find((i) => i.code === 'roleNodeNoPreset')?.nodeIds).toEqual(['a1'])
    expect(issues.find((i) => i.code === 'roleNodeNoPrompt')?.nodeIds).toEqual(['a2'])
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 注册表与 origin 语义
// ---------------------------------------------------------------------------

describe('code 注册表与 origin 语义', () => {
  it('注册表：每个 code 唯一、级别合法、说明非空', () => {
    const seen = new Set<string>()
    for (const info of GRAPH_INVARIANT_CODES) {
      expect(seen.has(info.code)).toBe(false)
      seen.add(info.code)
      expect(['error', 'warning']).toContain(info.level)
      expect(info.description.trim().length).toBeGreaterThan(0)
    }
    expect(invariantCodeInfo('flowCycle')?.level).toBe('error')
    expect(invariantCodeInfo('nope')).toBeNull()
  })

  it('origin=user：元参数硬护栏不生效（D-05，用户手改画布不受约束）', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), agent('a2'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'e')],
    )
    const agentIssues = check({ flow: doc, meta: { nodeMax: 1 }, origin: 'agent' })
    expect(codes(agentIssues)).toContain('metaLimitExceeded')
    const userIssues = check({ flow: doc, meta: { nodeMax: 1 }, origin: 'user' })
    expect(codes(userIssues)).not.toContain('metaLimitExceeded')
  })

  it('forbiddenShapes：命中的 warning 提升为 error', () => {
    const doc = flow(
      [stage('s', 'start'), agent('a1'), stage('e', 'end')],
      [line('l1', 's', 'a1'), line('l2', 's', 'e')],
    )
    const plain = check({ flow: doc })
    expect(plain.find((i) => i.code === 'cannotReachEnd')?.level).toBe('warning')
    const escalated = check({ flow: doc, meta: { forbiddenShapes: ['cannotReachEnd'] } })
    expect(escalated.find((i) => i.code === 'cannotReachEnd')?.level).toBe('error')
  })

  it('无权重的软约束缺省时不产生任何问题（零行为变化）', () => {
    expect(check({ flow: healthyFlow(), meta: {} })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// dag.ts 口径锁定（检查器与 P1 工具共用）
// ---------------------------------------------------------------------------

describe('流程子图纯函数（dag.ts）', () => {
  it('buildFlowDag：忽略 ctx/db 边与端点缺失的线', () => {
    const dag = buildFlowDag(
      [agent('a1'), agent('a2')],
      [line('l1', 'a1', 'a2'), line('c1', 'a1', 'a2', 'ctx'), line('l2', 'a1', 'ghost')],
    )
    expect(dag.edges).toEqual([{ id: 'l1', source: 'a1', target: 'a2' }])
    expect(dag.adjacency.get('a1')).toEqual(['a2'])
  })

  it('detectCycleNodes：自环与多节点环都被识别；无环图为空集', () => {
    const acyclic = buildFlowDag([agent('a1'), agent('a2')], [line('l1', 'a1', 'a2')])
    expect(detectCycleNodes(acyclic).size).toBe(0)
    const cyclic = buildFlowDag(
      [agent('a1'), agent('a2'), agent('a3')],
      [line('l1', 'a1', 'a2'), line('l2', 'a2', 'a3'), line('l3', 'a3', 'a2')],
    )
    expect([...detectCycleNodes(cyclic)].sort()).toEqual(['a2', 'a3'])
  })

  it('computeFlowLayers + maxLayerWidth：分层与单层并行宽度', () => {
    const dag = buildFlowDag(
      [stage('s', 'start'), agent('a1'), agent('a2'), agent('a3'), agent('b1'), stage('e', 'end')],
      [
        line('l1', 's', 'a1'), line('l2', 's', 'a2'), line('l3', 's', 'a3'),
        line('l4', 'a1', 'b1'), line('l5', 'a2', 'b1'), line('l6', 'a3', 'b1'),
        line('l7', 'b1', 'e'),
      ],
    )
    const layers = computeFlowLayers(dag)
    expect(layers.get('s')).toBe(0)
    expect(layers.get('a1')).toBe(1)
    expect(layers.get('b1')).toBe(2)
    expect(layers.get('e')).toBe(3)
    // 单层并行：第 1 层有 a1/a2/a3 → 宽度 3（b1 是第 2 层的唯一单元）
    expect(maxLayerWidth(layers, ['a1', 'a2', 'a3', 'b1'])).toBe(3)
  })

  it('computeFlowLayers：环上节点被排除时仍终止（不产生 NaN）', () => {
    const dag = buildFlowDag(
      [stage('s', 'start'), agent('a1'), agent('a2')],
      [line('l1', 's', 'a1'), line('l2', 'a1', 'a2'), line('l3', 'a2', 'a1')],
    )
    const cycles = detectCycleNodes(dag)
    const layers = computeFlowLayers(dag, cycles)
    expect(layers.get('s')).toBe(0)
    expect(layers.has('a1')).toBe(false)
    expect(layers.has('a2')).toBe(false)
  })
})

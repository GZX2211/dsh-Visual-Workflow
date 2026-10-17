// tests/host/orchestrator/graph-facts.test.ts
//
// 数据库连线提示注入测试：验证 dbToolHintOf 携带所连数据节点 id/label，
// 且 buildNodeBlocks 将该提示注入节点任务块（子代理据此向 wf_db_query 传正确 dataId）。
//
// BUG 修复回归：此前 DB_TOOL_HINT 只描述三模式、不携带 dataId，子代理只能凭猜测
// 的 id 调用 → WF_DB_BAD_DATA「数据节点不存在或已从画布移除」。
//
// 上游产出自动注入（buildNodeContextFacts）：手动 ctx 交接线退役后，下游节点自动接收
// **直接流程前驱**的最终产出；无产出的阶段节点（pause）被跳过继续向前找；Team 与
// 上下游解耦（既不作来源也不回溯）；file 节点的 ctx 注入（文本/受管路径）保留；
// 组装格式固定为「名称（id：节点ID）：产出」，多前驱时据此区分产出归属。
import { describe, expect, it } from 'vitest'
import { buildNodeBlocks, buildNodeContextFacts, dbToolHintOf, missingStageLabels, validateFlowForRun } from '../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../src/host/graph/index.js'
import type { DatabaseNode, GraphNode, Line, RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { NodeRunStatus, RunSnapshot } from '../../../src/host/shared/types.js'

/** 数据库节点。 */
function dbNode(id: string, label: string): DatabaseNode {
  return { id, kind: 'database', position: { x: 0, y: 0 }, data: { label, description: '', dbType: 'local', dbKind: 'sqlite', localPath: 'x.sqlite' } }
}

/** 角色节点。 */
function role(id: string, kind: 'parent' | 'agent', label: string): RoleNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: `任务：${label}`, provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

/** 流程：d1(db) —db-in→ a1；a2 无 db 连线。 */
function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '数据流程',
    description: '',
    revision: 1,
    nodes: [dbNode('d1', '产品库'), role('a1', 'agent', '查询代理'), role('a2', 'agent', '无连线代理')],
    lines: [{ id: 'l1', source: 'd1', target: 'a1', sourceHandle: 'db-out', targetHandle: 'db-in' }],
  }
}

const emptySnapshot: RunSnapshot = {
  id: 'run-1',
  flowId: 'flow-1',
  flowName: '数据流程',
  sessionId: 'session-1',
  mode: 'mode1',
  status: 'running',
  startedAt: new Date(0).toISOString(),
  endedAt: null,
  summary: '',
  nodes: [],
}

describe('dbToolHintOf 数据库连线提示', () => {
  it('有 db-in 连线时携带所连数据节点 id 与 label，并说明 wf_db_query 三模式', () => {
    const hint = dbToolHintOf(makeFlow(), 'a1')
    expect(hint).toContain('d1')
    expect(hint).toContain('产品库')
    expect(hint).toContain('wf_db_query')
    expect(hint).toContain('mode "search"')
    expect(hint).toContain('mode "query"')
    expect(hint).toContain('mode "schema"')
  })

  it('无 db-in 连线时返回空串', () => {
    expect(dbToolHintOf(makeFlow(), 'a2')).toBe('')
    expect(dbToolHintOf(makeFlow(), 'no-such-node')).toBe('')
  })

  it('buildNodeBlocks 将携带 dataId 的数据库提示注入节点任务块（子代理可据此传参）', () => {
    const flow = makeFlow()
    const blocks = buildNodeBlocks({
      flow,
      node: role('a1', 'agent', '查询代理'),
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })
    const text = blocks[0].text
    expect(text).toContain('数据库工具说明：')
    expect(text).toContain('d1')
    expect(text).toContain('产品库')
    expect(text).toContain('wf_db_query')
  })

  it('同一 flow 两次构建 dbToolHintOf 字节相同（纯函数）', () => {
    expect(dbToolHintOf(makeFlow(), 'a1')).toBe(dbToolHintOf(makeFlow(), 'a1'))
  })
})

// ---------------------------------------------------------------------------
// 运行前完整性（missingStageLabels / validateFlowForRun）
// ---------------------------------------------------------------------------
// 为什么收敛在此：graph/validate.ts 曾另有 missingStageNodes（返回 'start'/'end' 英文键），
// 但生产代码零调用、实际运行入口用的是本文件的 missingStageLabels（按模式渲染中文标签），
// 两者是同一判定的两份实现——2026.10 治理中删除前者，其断言口径迁到此处。

describe('运行前完整性检查（missingStageLabels / validateFlowForRun）', () => {
  const withStages = (kinds: Array<'start' | 'end' | 'agent'>, mode: 'mode1' | 'mode2' = 'mode1'): WorkflowDocument => ({
    id: 'flow-s',
    sessionId: 'session-1',
    mode,
    name: '阶段流程',
    description: '',
    revision: 1,
    nodes: kinds.map((kind, index) => (
      kind === 'agent'
        ? role(`a${index}`, 'agent', `节点${index}`)
        : { id: `s${index}`, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, mode) } }
    )),
    lines: [],
  })

  it('缺启动/结束逐项报告（mode1：启动/结束）', () => {
    expect(missingStageLabels(withStages(['agent']))).toEqual(['启动', '结束'])
    expect(missingStageLabels(withStages(['start', 'agent']))).toEqual(['结束'])
    expect(missingStageLabels(withStages(['start', 'end', 'agent']))).toEqual([])
  })

  it('mode2 按输入/输出渲染（与画布阶段节点命名一致）', () => {
    expect(missingStageLabels(withStages(['agent'], 'mode2'))).toEqual(['输入', '输出'])
  })

  it('validateFlowForRun：结构非法返回 WF_FLOW_INVALID（运行前拦截非法快照）', () => {
    const invalid = withStages(['start', 'end'])
    invalid.lines = [{ id: 'l-bad', source: 's0', target: 'no-such', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const error = validateFlowForRun(invalid)
    expect(error?.code).toBe('WF_FLOW_INVALID')
    expect(validateFlowForRun(withStages(['start', 'end']))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 上游产出自动注入（buildNodeContextFacts）
// ---------------------------------------------------------------------------

describe('上游产出自动注入（buildNodeContextFacts）', () => {
  /** 阶段节点（启动/结束/暂停）。 */
  function stage(id: string, kind: 'start' | 'end' | 'pause', label = id): GraphNode {
    return { id, kind, position: { x: 0, y: 0 }, data: { label } }
  }

  /** Team 节点（成员仅登记 id，不参与流程线）。 */
  function group(id: string, label: string, memberIds: string[] = []): GraphNode {
    return { id, kind: 'group', position: { x: 0, y: 0 }, data: { label, collabPrompt: '', memberIds } }
  }

  /** 虚拟节点（引用主节点）。 */
  function proxy(id: string, proxySourceId: string): GraphNode {
    return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId }
  }

  /** 文本型文件节点。 */
  function fileNode(id: string, label: string, content: string): GraphNode {
    return { id, kind: 'file', position: { x: 0, y: 0 }, data: { fileKind: 'text', label, content, fileName: '' } }
  }

  /** 受管文件节点（注入路径索引）。 */
  function managedFileNode(id: string, label: string, managedPath: string): GraphNode {
    return { id, kind: 'file', position: { x: 0, y: 0 }, data: { fileKind: 'file', label, managedPath, fileName: '需求.md' } }
  }

  function flowLine(id: string, source: string, target: string): Line {
    return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
  }

  function ctxLine(id: string, source: string, target: string): Line {
    return { id, source, target, sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }
  }

  function baseFlow(nodes: GraphNode[], lines: Line[], mode: 'mode1' | 'mode2' = 'mode1'): WorkflowDocument {
    return { id: 'flow-auto', sessionId: 'session-1', mode, name: '自动注入流程', description: '', revision: 1, nodes, lines }
  }

  /** 带产出的快照（仅注入判定相关字段）。 */
  function snapshotOf(entries: Array<{ nodeId: string; status: NodeRunStatus; output: string }>): RunSnapshot {
    return {
      ...emptySnapshot,
      nodes: entries.map((entry) => ({
        nodeId: entry.nodeId,
        status: entry.status,
        attempts: 1,
        startedAt: null,
        endedAt: null,
        output: entry.output,
        outputSummary: entry.output,
      })),
    }
  }

  /** 取某角色节点的上下文事实。 */
  function factsOf(flow: WorkflowDocument, nodeId: string, snapshot: RunSnapshot) {
    const node = flow.nodes.find((item) => item.id === nodeId) as RoleNode
    return buildNodeContextFacts({ flow, node, snapshot, documentTextLimit: 20000 })
  }

  it('单前驱：下游自动注入上游最终产出（携带节点名称与节点 ID）', () => {
    const flow = baseFlow(
      [stage('s1', 'start', '启动'), role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计'), stage('e1', 'end', '结束')],
      [flowLine('l1', 's1', 'a1'), flowLine('l2', 'a1', 'a2'), flowLine('l3', 'a2', 'e1')],
    )
    const context = factsOf(flow, 'a2', snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }]))
    expect(context.upstreamContext).toEqual([{ nodeId: 'a1', source: '需求分析', content: '需求结论' }])
  })

  it('多前驱：按流程线声明顺序分别注入各自产出（不汇聚合并）', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '数据校验'), role('a3', 'agent', '风险评估'), role('b1', 'agent', '方案汇总')],
      [flowLine('l1', 'a2', 'b1'), flowLine('l2', 'a1', 'b1'), flowLine('l3', 'a3', 'b1')],
    )
    const context = factsOf(flow, 'b1', snapshotOf([
      { nodeId: 'a1', status: 'ok', output: '需求结论' },
      { nodeId: 'a2', status: 'ok', output: '校验结论' },
      { nodeId: 'a3', status: 'ok', output: '风险清单' },
    ]))
    expect(context.upstreamContext).toEqual([
      { nodeId: 'a2', source: '数据校验', content: '校验结论' },
      { nodeId: 'a1', source: '需求分析', content: '需求结论' },
      { nodeId: 'a3', source: '风险评估', content: '风险清单' },
    ])
  })

  it('分叉：同一上游产出注入它驱动的每一个下游节点', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('b1', 'agent', '前端设计'), role('b2', 'agent', '后端设计')],
      [flowLine('l1', 'a1', 'b1'), flowLine('l2', 'a1', 'b2')],
    )
    const snapshot = snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }])
    expect(factsOf(flow, 'b1', snapshot).upstreamContext).toEqual([{ nodeId: 'a1', source: '需求分析', content: '需求结论' }])
    expect(factsOf(flow, 'b2', snapshot).upstreamContext).toEqual([{ nodeId: 'a1', source: '需求分析', content: '需求结论' }])
  })

  it('暂停节点无产出：跳过它继续向前取最近的可执行前驱', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), stage('p1', 'pause', '检查点'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'p1'), flowLine('l2', 'p1', 'a2')],
    )
    const context = factsOf(flow, 'a2', snapshotOf([
      { nodeId: 'a1', status: 'ok', output: '需求结论' },
      { nodeId: 'p1', status: 'ok', output: '(pause gate) run paused' },
    ]))
    expect(context.upstreamContext).toEqual([{ nodeId: 'a1', source: '需求分析', content: '需求结论' }])
  })

  it('Team 与上下游解耦：组前驱不注入，也不回溯到组的上游', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), group('g1', '评审组', ['m1']), role('m1', 'agent', '评审员'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'g1'), flowLine('l2', 'g1', 'a2')],
    )
    const context = factsOf(flow, 'a2', snapshotOf([
      { nodeId: 'a1', status: 'ok', output: '需求结论' },
      { nodeId: 'g1', status: 'ok', output: '（Team）全部成员已完成' },
      { nodeId: 'm1', status: 'armed', output: '评审意见' },
    ]))
    expect(context.upstreamContext).toEqual([])
  })

  it('组内成员（无流程线）不注入上游产出', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), group('g1', '评审组', ['m1']), role('m1', 'agent', '评审员')],
      [flowLine('l1', 'a1', 'g1')],
    )
    const context = factsOf(flow, 'm1', snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }]))
    expect(context.upstreamContext).toEqual([])
  })

  it('虚拟节点前驱：解析到主节点产出（快照按主节点记账）', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计'), proxy('p2', 'a2'), role('a3', 'agent', '实现')],
      [flowLine('l1', 'a1', 'a2'), flowLine('l2', 'p2', 'a3'), flowLine('l3', 'a2', 'a3')],
    )
    const context = factsOf(flow, 'a3', snapshotOf([
      { nodeId: 'a1', status: 'ok', output: '需求结论' },
      { nodeId: 'a2', status: 'ok', output: '方案正文' },
    ]))
    // 只取直接前驱 a2：a1 是 a2 的上游，不属直接前驱（除无产出阶段节点外不做二级回溯）
    expect(context.upstreamContext).toEqual([{ nodeId: 'a2', source: '方案设计', content: '方案正文' }])
  })

  it('虚拟节点归属：流程线接在虚拟节点上时，主节点同样获得其上游产出', () => {
    const flow = baseFlow(
      [role('a0', 'agent', '前置分析'), role('a1', 'agent', '复用角色'), proxy('p1', 'a1')],
      [flowLine('l1', 'a0', 'p1')],
    )
    const context = factsOf(flow, 'a1', snapshotOf([{ nodeId: 'a0', status: 'ok', output: '前置结论' }]))
    expect(context.upstreamContext).toEqual([{ nodeId: 'a0', source: '前置分析', content: '前置结论' }])
  })

  it('角色 ctx 交接线已退役：不再作为注入来源（旧线静默忽略）', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计')],
      [ctxLine('c1', 'a1', 'a2')],
    )
    const context = factsOf(flow, 'a2', snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }]))
    expect(context.upstreamContext).toEqual([])
  })

  it('file 节点 ctx 注入保留：文本直通（携带节点名称与节点 ID）', () => {
    const flow = baseFlow(
      [fileNode('f1', '需求文档', '正文内容'), role('a1', 'agent', '方案设计')],
      [ctxLine('c1', 'f1', 'a1')],
    )
    const context = factsOf(flow, 'a1', snapshotOf([]))
    expect(context.upstreamContext).toEqual([{ nodeId: 'f1', source: '需求文档', content: '正文内容' }])
    expect(context.filePaths).toEqual([])
  })

  it('file 节点 ctx 注入保留：受管文件注入路径索引（不进上下文正文）', () => {
    const flow = baseFlow(
      [managedFileNode('f1', '需求文件', 'D:/ws/需求.md'), role('a1', 'agent', '方案设计')],
      [ctxLine('c1', 'f1', 'a1')],
    )
    const context = factsOf(flow, 'a1', snapshotOf([]))
    expect(context.upstreamContext).toEqual([])
    expect(context.filePaths).toEqual(['D:/ws/需求.md'])
  })

  it('mode2 输入节点（start）产出自动注入首个节点（用户问题）', () => {
    const flow = baseFlow(
      [stage('s1', 'start', '输入'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 's1', 'a2')],
      'mode2',
    )
    const context = factsOf(flow, 'a2', snapshotOf([{ nodeId: 's1', status: 'ok', output: '请设计一套方案' }]))
    expect(context.upstreamContext).toEqual([{ nodeId: 's1', source: '输入', content: '请设计一套方案' }])
  })

  it('mode1 启动节点即使有产出也不注入（不是输入节点语义）', () => {
    const flow = baseFlow(
      [stage('s1', 'start', '启动'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 's1', 'a2')],
    )
    const context = factsOf(flow, 'a2', snapshotOf([{ nodeId: 's1', status: 'ok', output: '不该注入' }]))
    expect(context.upstreamContext).toEqual([])
  })

  it('上游未产出（pending/running/fail/skipped）：不注入', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'a2')],
    )
    for (const status of ['pending', 'running', 'fail', 'skipped'] as const) {
      expect(factsOf(flow, 'a2', snapshotOf([{ nodeId: 'a1', status, output: '不该注入的文本' }])).upstreamContext).toEqual([])
    }
  })

  it('上游产出为空白串：不注入（有状态但无内容不构成上下文）', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'a2')],
    )
    expect(factsOf(flow, 'a2', snapshotOf([{ nodeId: 'a1', status: 'armed', output: '   ' }])).upstreamContext).toEqual([])
  })

  it('buildNodeBlocks 任务块按固定格式渲染上游产出（名称 + 节点 ID + 内容）', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'a2')],
    )
    const node = flow.nodes.find((item) => item.id === 'a2') as RoleNode
    const text = buildNodeBlocks({
      flow,
      node,
      snapshot: snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }]),
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).toContain('- 需求分析（id：a1）：需求结论')
  })

  it('纯函数：同一 flow 两次组装字节相同', () => {
    const flow = baseFlow(
      [role('a1', 'agent', '需求分析'), role('a2', 'agent', '方案设计')],
      [flowLine('l1', 'a1', 'a2')],
    )
    const snapshot = snapshotOf([{ nodeId: 'a1', status: 'ok', output: '需求结论' }])
    expect(factsOf(flow, 'a2', snapshot)).toEqual(factsOf(flow, 'a2', snapshot))
  })
})

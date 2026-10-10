// tests/host/orchestrator/graph-facts.test.ts
//
// 数据库连线提示注入测试：验证 dbToolHintOf 携带所连数据节点 id/label，
// 且 buildNodeBlocks 将该提示注入节点任务块（子代理据此向 wf_db_query 传正确 dataId）。
//
// BUG 修复回归：此前 DB_TOOL_HINT 只描述三模式、不携带 dataId，子代理只能凭猜测
// 的 id 调用 → WF_DB_BAD_DATA「数据节点不存在或已从画布移除」。
import { describe, expect, it } from 'vitest'
import { buildNodeBlocks, buildNodeContextFacts, dbToolHintOf, missingStageLabels, validateFlowForRun } from '../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../src/host/graph/index.js'
import type { DatabaseNode, RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
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
// 上游产出注入（buildNodeContextFacts）
// ---------------------------------------------------------------------------
// 为什么锁定此处：协作组成员的回合结束落 armed（仍可被唤醒，非终态）。若注入谓词只认
// ok/react-capped，成员产出永远传不到下游——实验 run 中分诊节点有 3 条成员 ctx 入线，
// 却一条都没注入（静默信息断链，父代理据此在缺输入的情况下继续推进）。

describe('上游产出注入（buildNodeContextFacts）', () => {
  /** 流程：成员节点 a1 —ctx-out→ a2。 */
  function ctxFlow(): WorkflowDocument {
    return {
      id: 'flow-ctx',
      sessionId: 'session-1',
      mode: 'mode1',
      name: '上下文流程',
      description: '',
      revision: 1,
      nodes: [role('a1', 'agent', '成员一'), role('a2', 'agent', '下游节点')],
      lines: [{ id: 'l-ctx', source: 'a1', target: 'a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }],
    }
  }

  /** 只含上游 a1 记录的快照。 */
  function snapshotWithA1(status: NodeRunStatus, output: string): RunSnapshot {
    return {
      ...emptySnapshot,
      nodes: [{ nodeId: 'a1', status, attempts: 1, startedAt: null, endedAt: null, output, outputSummary: output }],
    }
  }

  /** 取 a2 的上游注入内容。 */
  function upstreamOf(status: NodeRunStatus, output: string): Array<{ source: string; content: string }> {
    const flow = ctxFlow()
    return buildNodeContextFacts({
      flow,
      node: role('a2', 'agent', '下游节点'),
      snapshot: snapshotWithA1(status, output),
      documentTextLimit: 20000,
    }).upstreamContext
  }

  it('上游为 armed（协作组成员待命）且已产出：注入其产出（组内信息不断链）', () => {
    expect(upstreamOf('armed', '成员产出B')).toEqual([{ source: '成员一', content: '成员产出B' }])
  })

  it('上游为 ok / react-capped：注入其产出（既有行为不变）', () => {
    expect(upstreamOf('ok', '正常产出')).toEqual([{ source: '成员一', content: '正常产出' }])
    expect(upstreamOf('react-capped', '软截停产出')).toEqual([{ source: '成员一', content: '软截停产出' }])
  })

  it('上游未产出（pending/running/fail/skipped）：不注入（无产出即无上下文）', () => {
    for (const status of ['pending', 'running', 'fail', 'skipped'] as const) {
      expect(upstreamOf(status, '不该被注入的文本')).toEqual([])
    }
  })

  it('上游产出为空白串：不注入（有状态但无内容不构成上下文）', () => {
    expect(upstreamOf('armed', '   ')).toEqual([])
  })
})

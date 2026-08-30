// T-005b 数据库连线提示注入测试：验证 dbToolHintOf 携带所连数据节点 id/label，
// 且 buildNodeBlocks 将该提示注入节点任务块（子代理据此向 wf_db_query 传正确 dataId）。
//
// BUG 修复回归：此前 DB_TOOL_HINT 只描述三模式、不携带 dataId，子代理只能凭猜测
// 的 id 调用 → WF_DB_BAD_DATA「数据节点不存在或已从画布移除」。
import { describe, expect, it } from 'vitest'
import { buildNodeBlocks, dbToolHintOf } from '../../src/host/orchestrator/helpers.js'
import type { DatabaseNode, RoleNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'

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
      pauseNodeIds: [],
      retryLimit: 3,
      reactLimit: undefined,
      runContextText: '',
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

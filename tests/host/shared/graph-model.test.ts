// tests/host/shared/graph-model.test.ts
//
// 共享契约：graph-model 纯形状层测试。
//   1. 编译期：节点判别联合的最小形状（对象字面量可赋值给对应接口即证明形状成立）；
//   2. 运行期：各判别分支、连接点/条件/节点种类字面量齐全；
//   3. 回归守卫：RoleNode.data 不得混入 proxySourceId（虚拟节点引用只由 ProxyNode 顶层承载）。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import type {
  ConditionType,
  DatabaseNode,
  FileNode,
  GraphNode,
  GroupNode,
  Handle,
  Line,
  NodeKind,
  ProxyNode,
  RoleNode,
  StageNode,
  WorkflowDocument,
} from '../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 编译期类型守卫：以下对象字面量若不能赋给对应接口，typecheck 即失败。
// 运行期无实际断言（仅通过 TypeScript 编译即为「满足最小形状」的证明）。
// ---------------------------------------------------------------------------

/** 各节点类型的最小合法对象字面量（编译期验证判别联合）。 */
const _minRoleParent: RoleNode = {
  id: 'n1',
  kind: 'parent',
  position: { x: 0, y: 0 },
  data: { label: '父', systemPrompt: 'p', provider: 'deepseek', model: 'chat', retryLimit: 3 },
}
const _minRoleAgent: RoleNode = {
  id: 'n2',
  kind: 'agent',
  position: { x: 1, y: 1 },
  data: { label: '子', systemPrompt: '', provider: 'deepseek', model: 'chat', retryLimit: 3 },
}
const _minFile: FileNode = { id: 'n3', kind: 'file', position: { x: 2, y: 2 }, data: { label: 'f', fileKind: 'text', content: 'hi' } }
const _minDatabase: DatabaseNode = {
  id: 'n4',
  kind: 'database',
  position: { x: 3, y: 3 },
  data: { label: 'd', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/a.db' },
}
const _minStageStart: StageNode = { id: 'n5', kind: 'start', position: { x: 4, y: 4 }, data: { label: '启动' } }
const _minStageEnd: StageNode = { id: 'n6', kind: 'end', position: { x: 5, y: 5 }, data: { label: '结束' } }
const _minStagePause: StageNode = { id: 'n7', kind: 'pause', position: { x: 6, y: 6 }, data: { label: '暂停' } }
const _minGroup: GroupNode = {
  id: 'n8',
  kind: 'group',
  position: { x: 7, y: 7 },
  data: { label: '组', collabPrompt: '协作', memberIds: ['n2'] },
}
const _minProxy: ProxyNode = { id: 'n9', kind: 'proxy', position: { x: 8, y: 8 }, proxySourceId: 'n2' }

/** 判别联合：上述任意节点均可赋给 GraphNode。 */
const _graphNodes: GraphNode[] = [
  _minRoleParent,
  _minRoleAgent,
  _minFile,
  _minDatabase,
  _minStageStart,
  _minStageEnd,
  _minStagePause,
  _minGroup,
  _minProxy,
]

/** 连线最小对象（含条件）。 */
const _minLine: Line = {
  id: 'l1',
  source: 'n5',
  target: 'n2',
  sourceHandle: 'flow-out',
  targetHandle: 'flow-in',
  condition: { type: 'pass', label: '通过' },
}

/** 工作流文档最小对象。 */
const _minDoc: WorkflowDocument = {
  id: 'w1',
  sessionId: 's1',
  mode: 'mode1',
  name: 'wf',
  description: '',
  nodes: _graphNodes,
  lines: [_minLine],
}

describe('shared/graph-model 纯形状层', () => {
  it('GraphNode 判别联合各分支均能通过对象字面量 + 类型断言编译（最小形状）', () => {
    // 运行期仅验证字面量对象非空且 kind 唯一（编译期已证明判别联合成立）。
    const kinds = _graphNodes.map((n) => n.kind)
    expect(kinds).toHaveLength(9)
    expect(new Set(kinds).size).toBe(9)
  })

  it('NodeKind 九类字面量齐全（parent/agent/file/database/start/end/pause/group/proxy）', () => {
    const expected: NodeKind[] = [
      'parent',
      'agent',
      'file',
      'database',
      'start',
      'end',
      'pause',
      'group',
      'proxy',
    ]
    // 通过 _graphNodes 的 kind 覆盖全部 9 类（编译期已收窄字面量，运行期重复确认）。
    expect(expected).toHaveLength(9)
    for (const k of expected) {
      expect(_graphNodes.some((n) => n.kind === k), `缺少节点种类 ${k}`).toBe(true)
    }
  })

  it('Handle 六类字面量齐全（flow-in/ctx-in/db-in/flow-out/ctx-out/db-out）', () => {
    const handles: Handle[] = ['flow-in', 'ctx-in', 'db-in', 'flow-out', 'ctx-out', 'db-out']
    expect(new Set(handles).size).toBe(6)
  })

  it('ConditionType 三类字面量齐全（pass/fail/content）', () => {
    const conditions: ConditionType[] = ['pass', 'fail', 'content']
    expect(conditions).toEqual(['pass', 'fail', 'content'])
  })

  it('RoleNode 收窄判别 kind 为 parent|agent，代理节点带完整 data 字段', () => {
    expect(_minRoleParent.kind).toBe('parent')
    expect(_minRoleAgent.data.retryLimit).toBe(3)
    // 虚拟节点 proxySourceId 引用主节点（ProxyNode 无独立 data 配置）。
    expect(_minProxy.proxySourceId).toBe('n2')
  })

  it('RoleNode.data 不含冗余 proxySourceId（虚拟节点引用仅由 ProxyNode 顶层承载，Bug 2）', () => {
    // 编译期守卫：若 RoleNode.data 再次混入 proxySourceId，ValidRoleData 收缩为 false，
    // 赋值即编译失败（typecheck 回归），防止冗余字段回潮误导实现。
    type ValidRoleData = 'proxySourceId' extends keyof RoleNode['data'] ? false : true
    const guard: ValidRoleData = true
    expect(guard).toBe(true)
    // 虚拟节点顶层 proxySourceId 为唯一承载处（运行期人工确认）。
    expect(_minProxy.proxySourceId).toBe('n2')
  })

  it('WorkflowDocument 最小形状成立（nodes 为判别联合全量内联）', () => {
    expect(_minDoc.mode).toBe('mode1')
    expect(_minDoc.nodes).toHaveLength(9)
    expect(_minDoc.lines[0].condition?.type).toBe('pass')
  })
})

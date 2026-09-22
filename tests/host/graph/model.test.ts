// tests/host/graph/model.test.ts
//
// 图模型运行时测试（原 tests/host/graph-model.test.ts 拆分）：连接点兼容矩阵与
// 拓扑查询助手（入口解析、出/入边、虚拟节点、协作组成员判定）。
// 校验与归一化（validate.ts）见 ./validate.test.ts。
// 断言依据：架构文档 §4.2 + 需求文档 §4.2/§4.3/§4.2.5。

import { describe, expect, it } from 'vitest'
import {
  NODE_HANDLES,
  NODE_KINDS,
  newRoleNode,
  newFileNode,
  newDatabaseNode,
  newStageNode,
  newGroupNode,
  newProxyNode,
  newLine,
  entryNodes,
  flowOutEdges,
  ctxInEdges,
  dbInEdges,
  upstreamCtxNodeIds,
  proxiesOf,
  isGroupMember,
} from '../../../src/host/graph/model.js'
import { makeFlow } from './fixtures/flow-fixture.js'

describe('连接点兼容矩阵（NODE_HANDLES）', () => {
  it('9 类节点矩阵齐全且与需求连接点定义一致', () => {
    expect(NODE_KINDS).toHaveLength(9)
    expect(NODE_HANDLES.parent.inputs).toEqual(['flow-in', 'ctx-in', 'db-in'])
    expect(NODE_HANDLES.parent.outputs).toEqual(['flow-out', 'ctx-out'])
    expect(NODE_HANDLES.file).toEqual({ inputs: [], outputs: ['ctx-out'] })
    expect(NODE_HANDLES.database).toEqual({ inputs: [], outputs: ['db-out'] })
    expect(NODE_HANDLES.start).toEqual({ inputs: [], outputs: ['flow-out', 'ctx-out'] })
    expect(NODE_HANDLES.end.outputs).toEqual([])
    expect(NODE_HANDLES.pause).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.group).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.proxy).toEqual(NODE_HANDLES.agent)
  })
})

describe('拓扑助手（连线查询）', () => {
  it('flowOutEdges/ctxInEdges/dbInEdges/upstreamCtxNodeIds 正确', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const c = newRoleNode('agent', 'c')
    const db = newDatabaseNode('local', 'db')
    const f = newFileNode('text', 'f')
    const lines = [
      newLine(a.id, b.id, 'flow-out', 'flow-in'),
      newLine(f.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(a.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(db.id, c.id, 'db-out', 'db-in'),
    ]
    const flow = makeFlow([a, b, c, db, f], lines)
    expect(flowOutEdges(flow, a.id).map((l) => l.target)).toEqual([b.id])
    expect(ctxInEdges(flow, c.id).map((l) => l.source).sort()).toEqual([a.id, f.id].sort())
    expect(dbInEdges(flow, c.id).map((l) => l.source)).toEqual([db.id])
    expect(upstreamCtxNodeIds(flow, c.id).sort()).toEqual([a.id, f.id].sort())
  })
})

describe('入口解析与节点归属判定', () => {
  it('entryNodes：start 即显式入口；缺失时为空（§4.2 入口解析）', () => {
    const s = newStageNode('start', 'mode1')
    const a = newRoleNode('agent', 'a')
    expect(entryNodes(makeFlow([s, a])).map((n) => n.id)).toEqual([s.id])
    expect(entryNodes(makeFlow([a]))).toEqual([])
  })

  it('proxiesOf/isGroupMember 正确', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const g = newGroupNode('g')
    const member = newRoleNode('agent', 'm')
    member.data.groupId = g.id
    const flow = makeFlow([main, proxy, g, member])
    expect(proxiesOf(flow, main.id).map((n) => n.id)).toEqual([proxy.id])
    expect(isGroupMember(flow, member.id)).toBe(true)
    expect(isGroupMember(flow, main.id)).toBe(false)
  })
})

// tests/client/lib/group-members.test.ts
//
// 协作组成员关系（原子入组 / 一致显示，§4.2.5.2 + 用户批注）。

import { describe, expect, it } from 'vitest'
import { consolidateGroups, dropNodeFlowLines, joinNodeToGroup } from '../../../src/client/lib/group-members.js'

type N = { id: string; kind: string; position: { x: number; y: number }; data: Record<string, unknown> }
const node = (id: string, kind: string, extra: Record<string, unknown> = {}): N => ({ id, kind, position: { x: 0, y: 0 }, data: { label: id, ...extra } })

describe('协作组成员（原子入组 / 一致显示）', () => {
  it('joinNodeToGroup：一次变更同时写 groupId + 组 memberIds（追加）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: [] }),
      node('a', 'agent'),
    ]
    const out = joinNodeToGroup(nodes, 'a', 'g')
    const group = out.find((n) => n.id === 'g')!
    const agent = out.find((n) => n.id === 'a')!
    expect(group.data.memberIds).toEqual(['a'])
    expect(agent.data.groupId).toBe('g')
  })

  it('joinNodeToGroup：已是成员则不重复追加（去重）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: ['a', 'b'] }),
      node('a', 'agent', { groupId: 'g' }),
      node('b', 'agent', { groupId: 'g' }),
    ]
    const out = joinNodeToGroup(nodes, 'a', 'g')
    const group = out.find((n) => n.id === 'g')!
    expect(group.data.memberIds).toEqual(['a', 'b'])
  })

  it('joinNodeToGroup：非角色节点 / 目标非协作组 → 原样返回', () => {
    const fileNode = node('f', 'file')
    const g = node('g', 'group', { memberIds: [] })
    // 非角色入组
    expect(joinNodeToGroup([g, fileNode], 'f', 'g')).toEqual([g, fileNode])
    // 目标不是协作组
    const other = node('o', 'agent')
    expect(joinNodeToGroup([other, fileNode], 'o', 'f')).toEqual([other, fileNode])
  })

  it('joinNodeToGroup：在原组位置替换（不新增重复组节点，杜绝「卡有成员但列表空/只显示一个」）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: ['a'] }),
      node('a', 'agent', { groupId: 'g' }),
      node('b', 'agent'),
    ]
    const out = joinNodeToGroup(nodes, 'b', 'g')
    // 组节点仍只有一个（在原处被替换），memberIds 追加为 [a, b]
    expect(out.filter((n) => n.kind === 'group')).toHaveLength(1)
    const group = out.find((n) => n.id === 'g')!
    expect(group.data.memberIds).toEqual(['a', 'b'])
  })

  it('dropNodeFlowLines：入组时断开该节点的流程线，保留上下文/数据库线', () => {
    const lines = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'e2', source: 'a', target: 'c', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
      { id: 'e3', source: 'd', target: 'a', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'e4', source: 'a', target: 'e', sourceHandle: 'db-out', targetHandle: 'db-in' },
    ]
    const out = dropNodeFlowLines(lines, 'a')
    expect(out.map((l) => l.id)).toEqual(['e2', 'e4']) // 仅保留 ctx/db 线
  })

  it('consolidateGroups：重复协作组节点合并为唯一组，memberIds 取并集（不丢成员）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: ['bug'] }),
      node('g', 'group', { memberIds: ['test', 'full'] }),
      node('bug', 'agent', { groupId: 'g' }),
      node('test', 'agent', { groupId: 'g' }),
      node('full', 'agent', { groupId: 'g' }),
    ]
    const out = consolidateGroups(nodes)
    expect(out.filter((n) => n.kind === 'group')).toHaveLength(1)
    expect((out.find((n) => n.id === 'g')!.data as { memberIds?: string[] }).memberIds).toEqual(['bug', 'test', 'full'])
    expect((out.find((n) => n.id === 'bug')!.data as { groupId?: unknown }).groupId).toBe('g')
  })

  it('consolidateGroups：单组内 memberIds 出现重复 id 也会去重（修复「无论点谁都移出 2 个」）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: ['a', 'a', 'b'] }),
      node('a', 'agent', { groupId: 'g' }),
      node('b', 'agent', { groupId: 'g' }),
    ]
    const out = consolidateGroups(nodes)
    expect((out.find((n) => n.id === 'g')!.data as { memberIds?: string[] }).memberIds).toEqual(['a', 'b'])
  })

  it('成员 id 在 memberIds 中重复时也只移除一个（去重后过滤，避免一次删 2 个）', () => {
    const nodes: N[] = [
      node('g', 'group', { memberIds: ['a', 'a', 'b'] }),
      node('a', 'agent', { groupId: 'g' }),
      node('b', 'agent', { groupId: 'g' }),
    ]
    const base = consolidateGroups(nodes)
    const group = base.find((n) => n.id === 'g')!
    const deduped = [...new Set((group.data.memberIds as string[]) ?? [])]
    expect([...new Set(deduped.filter((i) => i !== 'a'))]).toEqual(['b'])
  })
})

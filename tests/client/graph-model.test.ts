// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/graph-model.test.ts
//
// Client 图模型纯函数单测：模板→节点深拷贝、连接校验矩阵、条件标签/颜色分类、
// 布局（拓扑分层 + 环兜底）、序列化写回归一化、阶段标签模式差异。

import { describe, expect, it } from 'vitest'
import {
  templatesToMaps,
  templateToNodeData,
  conditionLabel,
  lineColorClass,
  connectionProblem,
  connectionProblemMessage,
  consolidateGroups,
  dropNodeFlowLines,
  joinNodeToGroup,
  layoutNodes,
  serializeFlow,
  stageLabels,
  stageTemplateKinds,
  flowToCanvasLines,
} from '../../src/client/lib/graph-model.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate } from '../../src/host/shared/types.js'

const roleTemplate: RoleTemplate = {
  id: 'r-1', kind: 'agent', name: '研究', systemPrompt: '你是研究员', provider: 'deepseek', model: 'deepseek-chat',
  presetId: 'standard', retryLimit: 3,
}
const fileTemplate: FileTemplate = { id: 'f-1', name: '资料', fileKind: 'text', content: '内容' }
const dbTemplate: DatabaseTemplate = {
  id: 'd-1', name: '知识库', description: '', dbType: 'local', dbKind: 'sqlite', vectorSource: 'embedding',
}

describe('模板 → 节点深拷贝（§4.2.1）', () => {
  it('templatesToMaps：三类映射', () => {
    const maps = templatesToMaps([roleTemplate], [fileTemplate], [dbTemplate])
    expect(maps.role.get('r-1')?.name).toBe('研究')
    expect((maps.file.get('f-1') as FileTemplate).fileKind).toBe('text')
    expect((maps.database.get('d-1') as DatabaseTemplate).dbType).toBe('local')
  })

  it('role 模板 → 节点 data（name→label；presetId 保留）', () => {
    const data = templateToNodeData('role', roleTemplate) as Record<string, unknown>
    expect(data.label).toBe('研究')
    expect(data.systemPrompt).toBe('你是研究员')
    expect(data.presetId).toBe('standard')
    expect(data.groupId).toBeNull()
  })

  it('file 模板 → 节点 data（managedPath 推导 fileName）', () => {
    const data = templateToNodeData('file', { ...fileTemplate, fileKind: 'file', managedPath: 'data/files/a.pdf' }) as Record<string, unknown>
    expect(data.fileKind).toBe('file')
    expect(data.managedPath).toBe('data/files/a.pdf')
    expect(data.fileName).toBe('a.pdf')
  })

  it('database 模板 → 节点 data', () => {
    const data = templateToNodeData('database', dbTemplate) as Record<string, unknown>
    expect(data.dbType).toBe('local')
    expect(data.vectorSource).toBe('embedding')
  })
})

describe('连线标签与颜色', () => {
  it('conditionLabel：通过/不通过/内容', () => {
    expect(conditionLabel({ type: 'pass', label: '' })).toBe('[通过]')
    expect(conditionLabel({ type: 'fail', label: '' })).toBe('[不通过]')
    expect(conditionLabel({ type: 'content', label: '路由' })).toBe('[路由]')
    expect(conditionLabel(null)).toBe('')
  })

  it('lineColorClass：db/ctx/条件/默认', () => {
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'db-out', targetHandle: 'db-in' })).toBe('is-db')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })).toBe('is-ctx')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } })).toBe('is-pass')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })).toBe('')
  })
})

describe('连接校验', () => {
  const nodes = [
    { id: 'a', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: 'A' } },
    { id: 'b', kind: 'agent' as const, position: { x: 300, y: 0 }, data: { label: 'B' } },
    { id: 's', kind: 'start' as const, position: { x: 0, y: 200 }, data: { label: '启动' } },
    { id: 'e', kind: 'end' as const, position: { x: 300, y: 200 }, data: { label: '结束' } },
  ]
  const lines: Array<{ id: string; source: string; target: string; sourceHandle: 'flow-out'; targetHandle: 'flow-in' }> = []

  it('合法：flow-out → flow-in', () => {
    const problem = connectionProblem(nodes as never, lines as never, { source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    expect(problem.valid).toBe(true)
  })

  it('非法：自环', () => {
    const problem = connectionProblem(nodes as never, lines as never, { source: 'a', target: 'a' })
    expect(problem.code).toBe('selfLoop')
  })

  it('非法：通道不匹配（ctx × flow）', () => {
    const problem = connectionProblem(nodes as never, lines as never, { source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'flow-in' })
    expect(problem.code).toBe('channelMismatch')
  })

  it('非法：协作组成员不可连流程线（仅 ctx/db）', () => {
    const groupNodes = [
      { id: 'g', kind: 'group' as const, position: { x: 0, y: 0 }, data: { label: '组', memberIds: ['m'] } },
      { id: 'm', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: '成员', groupId: 'g' } },
      { id: 'b', kind: 'agent' as const, position: { x: 300, y: 0 }, data: { label: 'B' } },
    ]
    expect(connectionProblem(groupNodes as never, [], { source: 'b', target: 'm', sourceHandle: 'flow-out', targetHandle: 'flow-in' }).code).toBe('groupMemberFlow')
    expect(connectionProblem(groupNodes as never, [], { source: 'm', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }).code).toBe('groupMemberFlow')
    expect(connectionProblem(groupNodes as never, [], { source: 'm', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }).valid).toBe(true)
  })

  it('非法：目标为启动节点（无入点）', () => {
    const problem = connectionProblem(nodes as never, lines as never, { source: 'a', target: 's' })
    expect(problem.code).toBe('invalidHandle')
  })

  it('非法：重复连线', () => {
    const withLine = [{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const problem = connectionProblem(nodes as never, withLine as never, { source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    expect(problem.code).toBe('duplicateConnection')
  })

  it('非法：主节点与虚拟节点连入同一连接点（防并行）', () => {
    const withProxy = [
      { id: 'm', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: '主' } },
      { id: 'x', kind: 'proxy' as const, position: { x: 0, y: 100 }, data: {}, proxySourceId: 'm' },
      { id: 'b', kind: 'agent' as const, position: { x: 300, y: 0 }, data: { label: 'B' } },
    ]
    const withLine = [{ id: 'e-0', source: 'm', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const problem = connectionProblem(withProxy as never, withLine as never, { source: 'x', target: 'b' })
    expect(problem.code).toBe('proxyParallel')
  })

  it('错误文案映射', () => {
    const copy = { selfLoop: 'no', invalidConnection: 'bad', duplicateConnection: 'dup' }
    expect(connectionProblemMessage({ valid: false, code: 'selfLoop' }, copy)).toBe('no')
    expect(connectionProblemMessage({ valid: false, code: 'unknown' }, copy)).toBe('bad')
  })
})

describe('布局与序列化', () => {
  it('layoutNodes：flow 边拓扑分层', () => {
    const nodes = [
      { id: 'a', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: 'B' } },
    ]
    const lines = [{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    const layout = layoutNodes(nodes as never, lines as never)
    const ax = layout.find((item) => item.id === 'a')?.position.x ?? 0
    const bx = layout.find((item) => item.id === 'b')?.position.x ?? 0
    expect(bx).toBeGreaterThan(ax)
  })

  it('serializeFlow：代理/阶段节点归一化（剔除视图字段）', () => {
    const flow = {
      id: 'wf-1', sessionId: 's-1', mode: 'mode1' as const, name: 'n', description: '',
      nodes: [
        { id: 'x', kind: 'proxy' as const, position: { x: 1, y: 2 }, proxySourceId: 'm' },
        { id: 's', kind: 'start' as const, position: { x: 3, y: 4 }, data: { label: '启动' } },
      ],
      lines: [],
    }
    const out = serializeFlow(flow as never, flow.nodes as never, [])
    expect(out.nodes[0]).toEqual({ id: 'x', kind: 'proxy', position: { x: 1, y: 2 }, proxySourceId: 'm' })
    expect(out.nodes[1]).toEqual({ id: 's', kind: 'start', position: { x: 3, y: 4 }, data: { label: '启动' } })
  })
})

describe('阶段节点模式差异（§4.2.5.1）', () => {
  it('mode1：启动/结束/暂停', () => {
    expect(stageTemplateKinds('mode1').map((item) => item.label)).toEqual(['启动', '结束', '暂停'])
  })

  it('mode2：输入/输出（无暂停）', () => {
    expect(stageTemplateKinds('mode2').map((item) => item.label)).toEqual(['输入', '输出'])
    expect(stageLabels('mode2').pause).toBe('暂停')
  })
})

describe('flowToCanvasLines', () => {
  it('补充显示标签与颜色 class', () => {
    const lines = flowToCanvasLines([{ id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'content', label: '审批' } }])
    expect(lines[0]?.label).toBe('[审批]')
    expect(lines[0]?.lineType).toBe('is-content')
  })
})

describe('协作组成员（原子入组 / 一致显示，§4.2.5.2 + 用户批注）', () => {
  type N = { id: string; kind: string; position: { x: number; y: number }; data: Record<string, unknown> }
  const node = (id: string, kind: string, extra: Record<string, unknown> = {}): N => ({ id, kind, position: { x: 0, y: 0 }, data: { label: id, ...extra } })

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

  it('removeGroupMember：成员 id 在 memberIds 中重复时也只移除一个（去重后过滤，避免一次删 2 个）', () => {
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

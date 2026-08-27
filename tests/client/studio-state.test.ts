// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio-state.test.ts
//
// 状态机纯函数单测（照搬/适配旧项目行为 + 新数据模型）：
// 画布投影、增删改、编辑器数据（角色/文件/数据库/阶段/协作组/虚拟节点）、
// 撤销重做、面板几何与打开文档的选中/编辑器重置。

import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  studioReducer,
  editorDataOf,
  flowToCanvas,
  graphSnapshotOf,
  type StudioState,
  type CanvasNode,
} from '../../src/client/studio/studio-state.js'

function baseState(): StudioState {
  return createInitialState('s-1')
}

function node(partial: Partial<CanvasNode> & { id: string; kind: CanvasNode['kind'] }): CanvasNode {
  return { position: { x: 10, y: 10 }, data: {}, ...partial }
}

describe('studioReducer', () => {
  it('初始状态：会话绑定 + 默认模式一 + 四列表面板', () => {
    const state = baseState()
    expect(state.sessionId).toBe('s-1')
    expect(state.mode).toBe('mode1')
    expect(state.libTab).toBe('workflow')
    expect(state.templates).toEqual({ role: [], file: [], database: [] })
    expect(state.canvas).toEqual({ nodes: [], edges: [] })
  })

  it('OPEN_FLOW：投影节点/连线并重置选中与编辑器', () => {
    let state = baseState()
    state = studioReducer(state, {
      type: 'OPEN_FLOW',
      flow: {
        id: 'wf-1',
        sessionId: 's-1',
        mode: 'mode1',
        name: '流程',
        description: '',
        nodes: [node({ id: 'a1', kind: 'start', data: { label: '启动' } }) as unknown as import('../../src/host/shared/graph-model.js').GraphNode],
        lines: [],
      },
    })
    expect(state.currentId).toBe('wf-1')
    expect(state.currentKind).toBe('workflow')
    expect(state.canvas.nodes).toHaveLength(1)
    expect(state.editor).toEqual({ source: 'workflow', id: 'wf-1' })
    expect(state.dirty).toBe(false)
  })

  it('NODE_ADDED / NODE_MOVED / NODE_REMOVED：增删改 + 脏标记', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: {
      id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', nodes: [], lines: [],
    } })
    state = studioReducer(state, {
      type: 'NODE_ADDED',
      node: node({ id: 'n1', kind: 'agent', data: { label: 'A' } }),
    })
    expect(state.dirty).toBe(true)
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1'])
    state = studioReducer(state, { type: 'NODE_MOVED', id: 'n1', position: { x: 50, y: 60 } })
    expect(state.canvas.nodes[0]?.position).toEqual({ x: 50, y: 60 })
    // 删除连线连带
    state = studioReducer(state, { type: 'EDGE_ADDED', edge: {
      id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in',
    } })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node({ id: 'n2', kind: 'end', data: { label: '结束' } }) })
    const before = studioReducer(state, { type: 'NODE_REMOVED', id: 'n1' })
    expect(before.canvas.edges).toHaveLength(0)
  })

  it('NODE_DATA_PATCH / EDGE_PATCH：局部补丁注入（脏标记）', () => {
    let state = baseState()
    state = studioReducer(state, {
      type: 'GRAPH_REPLACED',
      nodes: [node({ id: 'n1', kind: 'agent', data: { label: 'A', systemPrompt: '' } })],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
      dirty: false,
    })
    state = studioReducer(state, { type: 'NODE_DATA_PATCH', id: 'n1', patch: { systemPrompt: 'hi' } })
    expect(state.canvas.nodes[0]?.data.systemPrompt).toBe('hi')
    expect(state.dirty).toBe(true)
    state = studioReducer(state, { type: 'EDGE_PATCH', id: 'e1', patch: { condition: { type: 'content', label: '路由' } } })
    const edge = state.canvas.edges[0] as { condition?: { type: string; label: string } }
    expect(edge.condition).toEqual({ type: 'content', label: '路由' })
  })

  it('DOC_PATCH：工作流/服务名称描述更新', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: {
      id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '旧', description: '', nodes: [], lines: [],
    } })
    state = studioReducer(state, { type: 'DOC_PATCH', patch: { name: '新名', description: '描述' } })
    expect(state.workflows[0]?.name).toBe('新名')
    expect(state.workflows[0]?.description).toBe('描述')
  })

  it('撤销/重做：图快照进出栈', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [node({ id: 'n1', kind: 'agent' })], edges: [], dirty: false })
    const snapshot = graphSnapshotOf(state)
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node({ id: 'n2', kind: 'end' }) })
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1'])
    state = studioReducer(state, { type: 'REDO' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1', 'n2'])
  })

  it('撤销/重做快照独立性：graphSnapshotOf 深拷贝，canvas 后续变更不污染历史', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [node({ id: 'n1', kind: 'agent', data: { label: 'A' } })], edges: [], dirty: false })
    const snapshot = graphSnapshotOf(state)
    // 快照必须是与 canvas 断开引用的独立副本（别名会让 undo/redo 退化为覆盖式恢复）
    expect(snapshot.nodes).not.toBe(state.canvas.nodes)
    expect(snapshot.nodes[0]).not.toBe(state.canvas.nodes[0])
    expect(snapshot.nodes[0]!.data).not.toBe(state.canvas.nodes[0]!.data)
    expect(snapshot.nodes[0]!.position).not.toBe(state.canvas.nodes[0]!.position)

    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot })
    // 模拟组件对 canvas 节点对象的原地修改（拖拽缓存等副作用路径）
    const initialPos = { ...state.canvas.nodes[0]!.position }
    state.canvas.nodes[0]!.data.label = '已污染'
    state.canvas.nodes[0]!.position.x = 999
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes[0]!.data.label).toBe('A')
    expect(state.canvas.nodes[0]!.position).toEqual(initialPos)
  })

  it('Bug 2：flowToCanvas 投影保留虚拟节点顶层 proxySourceId（打开工作流不丢引用）', () => {
    const state = studioReducer(baseState(), {
      type: 'OPEN_FLOW',
      flow: {
        id: 'wf-p', sessionId: 's-1', mode: 'mode1', name: '', description: '',
        nodes: [
          node({ id: 'n1', kind: 'agent', data: { label: 'A' } }),
          { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' } as never,
        ],
        lines: [],
      } as never,
    })
    const proxy = state.canvas.nodes.find((item) => item.kind === 'proxy') as { proxySourceId?: unknown }
    expect(proxy?.proxySourceId).toBe('n1')
  })

  it('Bug 4：删除角色主节点时级联删除全部关联虚拟节点（§4.2.3.2 规则 5）', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: {
      id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '',
      nodes: [node({ id: 'n1', kind: 'agent', data: { label: 'A' } })], lines: [],
    } as never })
    state = studioReducer(state, { type: 'NODE_ADDED', node: { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' } as CanvasNode })
    state = studioReducer(state, { type: 'NODE_ADDED', node: { id: 'p2', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' } as CanvasNode })
    // 删除主节点 → 两个虚拟引用一并删除
    state = studioReducer(state, { type: 'NODE_REMOVED', id: 'n1' })
    expect(state.canvas.nodes.map((n) => n.id).sort()).toEqual([])
  })

  it('Bug 8：UNDO/REDO 后选中与编辑器引用失效时被清空', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [node({ id: 'n1', kind: 'agent' })], edges: [], dirty: false })
    // 记录含 n1 的快照 → 删除 n1（画布空）→ 模拟「选中已删除节点」的残留状态
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_REMOVED', id: 'n1' })
    state = studioReducer(state, { type: 'SELECT_NODE', id: 'n1' })
    // UNDO 恢复含 n1 的画布：n1 重新存在 → 选中保持有效
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.selection.nodeId).toBe('n1')
    // REDO 恢复删除后的空画布：选中/编辑器引用失效 → 清空，不再指向幽灵节点
    state = studioReducer(state, { type: 'REDO' })
    expect(state.selection.nodeId).toBeNull()
    expect(state.editor).toBeNull()
  })

  it('Bug 17：撤销/重做回到已保存状态时 dirty=false（不误弹未保存守卫）', () => {
    // 场景 A：打开后编辑、撤销回打开初始态（从未保存过）→ dirty=false
    let state = baseState()
    state = studioReducer(state, {
      type: 'OPEN_FLOW',
      flow: { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', nodes: [node({ id: 'n1', kind: 'agent' })], lines: [] } as never,
    })
    expect(state.dirty).toBe(false)
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node({ id: 'n2', kind: 'end' }) })
    expect(state.dirty).toBe(true)
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes.map((n) => n.id)).toEqual(['n1'])
    expect(state.dirty).toBe(false) // 回到初始保存状态 → 不再误判未保存

    // 场景 B：保存后编辑再撤销回保存态 → dirty=false；重做离开 → dirty=true
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node({ id: 'n2', kind: 'end' }) })
    state = studioReducer(state, { type: 'MARK_SAVED' })
    expect(state.dirty).toBe(false)
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_DATA_PATCH', id: 'n1', patch: { label: '改名' } })
    expect(state.dirty).toBe(true)
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.dirty).toBe(false) // 撤销回保存时状态 = 磁盘态
    state = studioReducer(state, { type: 'REDO' })
    expect(state.dirty).toBe(true) // 重做离开保存态 → 未保存
  })

  it('SELECT_LIB：父代理模板选择（右侧面板无显示）', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'SELECT_LIB', kind: 'parentTemplate', id: 'p-1' })
    expect(state.selection.lib).toEqual({ kind: 'parentTemplate', id: 'p-1' })
    expect(state.editor).toBeNull()
  })
})

describe('editorDataOf', () => {
  function openWith(state: StudioState, nodes: CanvasNode[]): StudioState {
    return studioReducer(state, {
      type: 'GRAPH_REPLACED', nodes, edges: [], dirty: false,
    })
  }

  it('角色节点 → kind role（子代理）', () => {
    const state = openWith(baseState(), [node({ id: 'n1', kind: 'agent', data: { label: 'A', presetId: 'standard' } })])
    const selected = studioReducer(state, { type: 'SELECT_NODE', id: 'n1' })
    const data = editorDataOf(selected)
    expect(data?.kind).toBe('role')
    expect(data?.isParent).toBe(false)
    expect(data?.nodeId).toBe('n1')
  })

  it('父代理节点 → kind role + isParent', () => {
    const state = openWith(baseState(), [node({ id: 'p1', kind: 'parent', data: { label: '父' } })])
    const selected = studioReducer(state, { type: 'SELECT_NODE', id: 'p1' })
    expect(editorDataOf(selected)?.isParent).toBe(true)
  })

  it('阶段/虚拟节点 → 只读形态（stage/proxy）', () => {
    const state = openWith(baseState(), [
      node({ id: 's1', kind: 'start', data: { label: '启动' } }),
      node({ id: 'm1', kind: 'agent', data: { label: '主' } }),
      { ...node({ id: 'x1', kind: 'proxy', data: {} }), proxySourceId: 'm1' } as CanvasNode,
    ])
    const stage = studioReducer(state, { type: 'SELECT_NODE', id: 's1' })
    expect(editorDataOf(stage)?.kind).toBe('stage')
    const proxy = studioReducer(state, { type: 'SELECT_NODE', id: 'x1' })
    const proxyData = editorDataOf(proxy)
    expect(proxyData?.kind).toBe('proxy')
    expect(proxyData?.mainLabel).toBe('主')
  })

  it('协作组 → kind group + members 解析', () => {
    const state = openWith(baseState(), [
      node({ id: 'g1', kind: 'group', data: { label: '组', memberIds: ['a1'] } }),
      node({ id: 'a1', kind: 'agent', data: { label: '成员' } }),
    ])
    const selected = studioReducer(state, { type: 'SELECT_NODE', id: 'g1' })
    const data = editorDataOf(selected)
    expect(data?.kind).toBe('group')
    expect(data?.members).toEqual([{ id: 'a1', label: '成员' }])
  })

  it('连线 → kind edge', () => {
    let state = baseState()
    state = studioReducer(state, {
      type: 'GRAPH_REPLACED',
      nodes: [],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
      dirty: false,
    })
    const selected = studioReducer(state, { type: 'SELECT_EDGE', id: 'e1' })
    expect(editorDataOf(selected)?.kind).toBe('edge')
  })

  it('flowToCanvas：重复节点 id 去重（保留最后出现者，修复历史协作组重复追加缺陷）', () => {
    const projected = flowToCanvas({
      id: 'f', sessionId: 's', mode: 'mode1', name: 'f', description: '',
      nodes: [
        { id: 'g', kind: 'group', position: { x: 0, y: 0 }, data: { label: '空组', memberIds: [] } },
        { id: 'g', kind: 'group', position: { x: 0, y: 0 }, data: { label: '有成员', memberIds: ['a'] } },
        { id: 'a', kind: 'agent', position: { x: 1, y: 1 }, data: { label: '成员', groupId: 'g' } },
      ],
      lines: [],
    } as never)
    // 只保留最后出现的 g（有成员那个），避免「删成员误删全部」
    expect(projected.nodes.filter((n) => n.id === 'g')).toHaveLength(1)
    expect((projected.nodes.find((n) => n.id === 'g')?.data as { memberIds?: string[] }).memberIds).toEqual(['a'])
  })

  it('协作组成员移除：仅移除目标成员（模拟 removeGroupMember 的两次 patch）', () => {
    let state = baseState()
    state = studioReducer(state, {
      type: 'GRAPH_REPLACED',
      nodes: [
        node({ id: 'g', kind: 'group', data: { memberIds: ['a', 'b', 'c'] } }),
        node({ id: 'a', kind: 'agent', data: { groupId: 'g' } }),
        node({ id: 'b', kind: 'agent', data: { groupId: 'g' } }),
        node({ id: 'c', kind: 'agent', data: { groupId: 'g' } }),
      ],
      edges: [],
      dirty: false,
    })
    state = studioReducer(state, { type: 'SELECT_NODE', id: 'g' })
    // removeGroupMember('b')
    const group = state.canvas.nodes.find((n) => n.id === 'g')!
    state = studioReducer(state, { type: 'NODE_DATA_PATCH', id: group.id, patch: { memberIds: (group.data.memberIds as string[]).filter((i) => i !== 'b') } })
    state = studioReducer(state, { type: 'NODE_DATA_PATCH', id: 'b', patch: { groupId: null } })
    expect((state.canvas.nodes.find((n) => n.id === 'g')?.data as { memberIds?: string[] }).memberIds).toEqual(['a', 'c'])
    expect((state.canvas.nodes.find((n) => n.id === 'b')?.data as { groupId?: unknown }).groupId).toBeNull()
  })
})

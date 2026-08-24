// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/studio-state.test.ts
//
// 状态机单测（T-042）：reducer 纯函数——打开工作流/服务（nodes/lines 投影）、
// 画布变更 dirty、撤销重做、选中与编辑器、模板/工作流列表、运行快照、
// 轻提示、面板几何、选择器派生。

import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  studioReducer,
  flowToCanvas,
  serviceToCanvas,
  editorDataOf,
  currentFlowOf,
  isRunningOf,
  graphSnapshotOf,
  HISTORY_LIMIT,
  type StudioState,
} from '../../src/client/studio/studio-state.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../src/host/shared/types.js'

function baseFlow(): WorkflowDocument {
  return {
    id: 'wf-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '',
    revision: 2,
    nodes: [
      { id: 'n-start', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      { id: 'n-a1', kind: 'agent', position: { x: 200, y: 0 }, data: { label: '子任务' } as never },
      { id: 'n-end', kind: 'end', position: { x: 400, y: 0 }, data: { label: '结束' } },
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
    ],
  }
}

function baseService(): ServiceState {
  return {
    id: 'svc-1',
    sessionId: 'session-1',
    name: '问答服务',
    description: '',
    revision: 1,
    nodes: [
      { id: 'n-in', kind: 'start', position: { x: 0, y: 0 }, data: { label: '输入' } },
      { id: 'n-parent', kind: 'parent', position: { x: 200, y: 0 }, data: { label: '父代理' } as never },
      { id: 'n-out', kind: 'end', position: { x: 400, y: 0 }, data: { label: '输出' } },
    ],
    lines: [
      { id: 'l1', source: 'n-in', target: 'n-parent', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    status: 'stopped',
  }
}

describe('画布投影', () => {
  it('flowToCanvas：节点/连线全量映射（含条件）', () => {
    const { nodes, edges } = flowToCanvas(baseFlow())
    expect(nodes).toHaveLength(3)
    expect(nodes[1]).toMatchObject({ id: 'n-a1', kind: 'agent', position: { x: 200, y: 0 } })
    expect(edges[1].condition).toEqual({ type: 'pass' })
    expect(edges[1].sourceHandle).toBe('flow-out')
  })

  it('serviceToCanvas：服务文档同构投影', () => {
    const { nodes, edges } = serviceToCanvas(baseService())
    expect(nodes.map((n) => n.id)).toEqual(['n-in', 'n-parent', 'n-out'])
    expect(edges).toHaveLength(1)
  })

  it('缺省位置落默认格点', () => {
    const flow = baseFlow()
    flow.nodes[0] = { id: 'n-x', kind: 'start', data: { label: 'x' } } as never
    const { nodes } = flowToCanvas(flow)
    expect(nodes[0].position).toEqual({ x: 120, y: 80 })
  })
})

describe('打开文档与选中', () => {
  it('OPEN_FLOW：画布投影 + 编辑器/库选中 + 清运行状态 + 非 dirty', () => {
    const state = studioReducer(createInitialState('session-1'), { type: 'OPEN_FLOW', flow: baseFlow() })
    expect(state.currentKind).toBe('workflow')
    expect(state.currentId).toBe('wf-1')
    expect(state.canvas.nodes).toHaveLength(3)
    expect(state.dirty).toBe(false)
    expect(state.editor).toEqual({ source: 'workflow', id: 'wf-1' })
    expect(state.selection.lib).toEqual({ kind: 'workflow', id: 'wf-1' })
  })

  it('OPEN_SERVICE：服务文档打开', () => {
    const state = studioReducer(createInitialState('session-1'), { type: 'OPEN_SERVICE', service: baseService() })
    expect(state.currentKind).toBe('service')
    expect(state.currentId).toBe('svc-1')
    expect(state.canvas.nodes.map((n) => n.id)).toContain('n-parent')
  })

  it('SELECT_NODE 联动编辑器；CLEAR_SELECTION 全清', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'SELECT_NODE', id: 'n-a1' })
    expect(state.selection.nodeId).toBe('n-a1')
    expect(state.editor).toEqual({ source: 'node', id: 'n-a1' })
    state = studioReducer(state, { type: 'CLEAR_SELECTION' })
    expect(state.selection.nodeId).toBeNull()
    expect(state.editor).toBeNull()
  })

  it('SELECT_EDGE / SELECT_LIB / SELECT_EDITOR', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'SELECT_EDGE', id: 'l1' })
    expect(state.selection.edgeId).toBe('l1')
    state = studioReducer(state, { type: 'SELECT_LIB', kind: 'role', id: 'r-1' })
    expect(state.selection.lib).toEqual({ kind: 'role', id: 'r-1' })
    state = studioReducer(state, { type: 'SELECT_EDITOR', editor: { source: 'template', kind: 'file', id: 'f-1' } })
    expect(state.editor).toEqual({ source: 'template', kind: 'file', id: 'f-1' })
  })
})

describe('画布变更与撤销重做', () => {
  it('NODE_ADDED/NODE_MOVED/NODE_REMOVED 置 dirty', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'NODE_ADDED', node: { id: 'n-1', kind: 'agent', position: { x: 0, y: 0 }, data: {} } })
    expect(state.dirty).toBe(true)
    state = studioReducer(state, { type: 'NODE_MOVED', id: 'n-1', position: { x: 9, y: 9 } })
    expect(state.canvas.nodes[0].position).toEqual({ x: 9, y: 9 })
    state = studioReducer(state, { type: 'EDGE_ADDED', edge: { id: 'e-1', source: 'n-1', target: 'n-2', sourceHandle: 'flow-out', targetHandle: 'flow-in' } })
    expect(state.canvas.edges).toHaveLength(1)
    state = studioReducer(state, { type: 'NODE_REMOVED', id: 'n-1' })
    // 删除节点级联删除相关连线
    expect(state.canvas.nodes).toHaveLength(0)
    expect(state.canvas.edges).toHaveLength(0)
  })

  it('撤销/重做：HISTORY_PUSH 后 UNDO/REDO 恢复图快照', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'NODE_ADDED', node: { id: 'n-1', kind: 'agent', position: { x: 0, y: 0 }, data: {} } })
    const snapshot = graphSnapshotOf(state)
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot })
    state = studioReducer(state, { type: 'NODE_ADDED', node: { id: 'n-2', kind: 'agent', position: { x: 1, y: 1 }, data: {} } })
    expect(state.canvas.nodes).toHaveLength(2)
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes).toHaveLength(1)
    expect(state.dirty).toBe(true)
    state = studioReducer(state, { type: 'REDO' })
    expect(state.canvas.nodes).toHaveLength(2)
  })

  it('HISTORY_PUSH 超限裁剪（60）', () => {
    let state = createInitialState('s')
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) {
      state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: { nodes: [], edges: [] } })
    }
    expect(state.history.past.length).toBe(HISTORY_LIMIT)
  })

  it('GRAPH_REPLACED：恢复快照（dirty 可控）', () => {
    const state = studioReducer(createInitialState('s'), {
      type: 'GRAPH_REPLACED',
      nodes: [{ id: 'n-x', kind: 'agent', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
      dirty: false,
    })
    expect(state.canvas.nodes[0].id).toBe('n-x')
    expect(state.dirty).toBe(false)
  })
})

describe('列表与运行', () => {
  it('工作流列表增删改', () => {
    let state = createInitialState('s')
    const flow = baseFlow()
    state = studioReducer(state, { type: 'WORKFLOWS_LOADED', items: [flow] })
    expect(state.workflows).toHaveLength(1)
    state = studioReducer(state, { type: 'WORKFLOW_REMOVED', id: 'wf-1' })
    expect(state.workflows).toHaveLength(0)
    state = studioReducer(state, { type: 'WORKFLOW_ADDED', flow: { ...flow, id: 'wf-2' } })
    expect(state.workflows[0].id).toBe('wf-2')
  })

  it('模板列表加载/更新/删除（三类隔离）', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'TEMPLATES_LOADED', kind: 'role', items: [{ id: 'r-1', name: '角色' } as never] })
    state = studioReducer(state, { type: 'TEMPLATES_LOADED', kind: 'database', items: [] })
    expect(state.templates.role).toHaveLength(1)
    expect(state.templates.database).toHaveLength(0)
    state = studioReducer(state, { type: 'TEMPLATE_ADDED', kind: 'file', template: { id: 'f-1', name: '文件' } as never })
    expect(state.templates.file[0].id).toBe('f-1')
    state = studioReducer(state, { type: 'TEMPLATE_REMOVED', kind: 'role', id: 'r-1' })
    expect(state.templates.role).toHaveLength(0)
  })

  it('运行：RUN_STARTED/RUN_SNAPSHOT/RUN_CLEARED', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'RUN_STARTED', runId: 'run-1' })
    expect(state.run.runId).toBe('run-1')
    expect(isRunningOf(state)).toBe(true)
    state = studioReducer(state, { type: 'RUN_SNAPSHOT', snapshot: { status: 'completed' } as never })
    expect(isRunningOf(state)).toBe(false)
    state = studioReducer(state, { type: 'RUN_CLEARED' })
    expect(state.run.runId).toBeNull()
  })

  it('轻提示与面板几何', () => {
    let state = createInitialState('s')
    state = studioReducer(state, { type: 'TOAST_PUSH', toast: { id: 't-1', kind: 'error', text: 'boom' } })
    expect(state.toasts).toHaveLength(1)
    state = studioReducer(state, { type: 'TOAST_DROP', id: 't-1' })
    expect(state.toasts).toHaveLength(0)
    state = studioReducer(state, { type: 'PANELS_SET', panels: { leftWidth: 300 } })
    expect(state.panels.leftWidth).toBe(300)
    expect(state.panels.rightOpen).toBe(true)
  })

  it('会话绑定：SET_SESSION', () => {
    const state = studioReducer(createInitialState('s-1'), { type: 'SET_SESSION', sessionId: 's-2' })
    expect(state.sessionId).toBe('s-2')
  })
})

describe('选择器', () => {
  it('currentFlowOf / editorDataOf / isRunningOf 派生', () => {
    let state: StudioState = createInitialState('s')
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: baseFlow() })
    expect(currentFlowOf(state)?.id).toBe('wf-1')
    const editor = editorDataOf(state)
    expect(editor?.kind).toBe('workflow')
    expect(editor?.name).toBe('测试流程')
    expect(isRunningOf(state)).toBe(false)
  })

  it('editorDataOf：节点/模板/连线', () => {
    let state: StudioState = createInitialState('s')
    state = studioReducer(state, { type: 'SELECT_NODE', id: 'n-a1' })
    state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [{ id: 'n-a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '子任务' } }], edges: [], dirty: false })
    const nodeEditor = editorDataOf(state)
    expect(nodeEditor?.kind).toBe('role')
    expect(nodeEditor?.name).toBe('子任务')
    state = studioReducer(state, { type: 'SELECT_EDITOR', editor: { source: 'template', kind: 'file', id: 'f-1' } })
    state = studioReducer(state, { type: 'TEMPLATES_LOADED', kind: 'file', items: [{ id: 'f-1', name: '手册' } as never] })
    const templateEditor = editorDataOf(state)
    expect(templateEditor?.kind).toBe('file')
    expect(templateEditor?.template).toBe(true)
  })
})

// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/studio-state.test.ts
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
  currentFlowAssetOf,
  inspectorOpenOf,
  isInstanceSourceKind,
  type StudioState,
  type StudioAction,
  type CanvasNode,
} from '../../../src/client/studio/studio-state.js'
import type { ExperienceEntry, RoleAssetDetail, WorkflowAssetDetail } from '../../../src/host/shared/asset-types.js'

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
    expect(state.templates).toEqual({ role: [], file: [], database: [], group: [] })
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
        nodes: [node({ id: 'a1', kind: 'start', data: { label: '启动' } }) as unknown as import('../../../src/host/shared/graph-model.js').GraphNode],
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

  // -------------------------------------------------------------------------
  // P0「撤销历史跨文档污染」：历史栈必须严格绑定当前文档（施工依据 VERIFY-ROUND2 §2）
  // -------------------------------------------------------------------------

  const flowDoc = (id: string, nodes: CanvasNode[]): never =>
    ({ id, sessionId: 's-1', mode: 'mode1', name: id, description: '', nodes, lines: [] }) as never

  it('P0：编辑 A 后打开 B，撤销不得把 A 的图写进 B 的画布', () => {
    let state = baseState()
    // A：打开并编辑（入栈一份 A 的画布快照）
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('A', [node({ id: 'a1', kind: 'agent', data: { label: 'A 的节点' } })]) })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    // 切到 B（B 是空画布）
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('B', []) })
    // 历史必须随文档切换清空，撤销在 B 上不可用
    expect(state.history.past).toEqual([])
    expect(state.history.future).toEqual([])
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes).toEqual([])
    expect(state.currentId).toBe('B')
  })

  it('P0：清空画布后撤销不得恢复幽灵图', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [node({ id: 'n1', kind: 'agent' })], edges: [], dirty: false })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'CLEAR_CANVAS' })
    expect(state.history.past).toEqual([])
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes).toEqual([])
    expect(state.currentId).toBeNull()
  })

  it('P0：关闭资产（清空画布分支）后撤销不得恢复已关闭文档的图', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'ASSET_CLOSED', assetId: 'a-1' })
    expect(state.history.past).toEqual([])
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes).toEqual([])
    expect(state.currentId).toBeNull()
  })

  it('P0 第四处入口：打开工作流资产后撤销，不得把上一个文档的图写进资产画布', () => {
    let state = baseState()
    // 先编辑文档 A（入栈一份 A 的画布快照）
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('A', [node({ id: 'a1', kind: 'agent', data: { label: 'A 的节点' } })]) })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    // 再从左侧栏打开工作流资产（第四处切换画布入口）
    state = studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    // 历史必须随画布切换清空
    expect(state.history.past).toEqual([])
    expect(state.history.future).toEqual([])
    state = studioReducer(state, { type: 'UNDO' })
    // 资产画布仍是资产文档的图（s1），未被 A 的 a1 替换
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['s1'])
    expect(state.currentKind).toBe('flowAsset')
    expect(state.currentId).toBe('a-1')
  })

  it('P0 根因锁定：切换文档后画布归属唯一——撤销不再产出其它文档的图，自动保存快照恒等于当前文档', () => {
    // 自动保存（几何防抖）写入的是 state.canvas + 当前文档 id，本用例锁定其**前提**：
    // 清栈后 canvas 不可能再变成另一份文档的图，故自动保存落库的内容必属当前文档。
    let state = baseState()
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('A', [node({ id: 'a1', kind: 'agent' })]) })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('B', [node({ id: 'b1', kind: 'end' })]) })
    state = studioReducer(state, { type: 'UNDO' })
    // canvas 始终是 B 打开时的图（未被 A 的快照替换），因此自动保存写回的也是 B
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['b1'])
    expect(state.currentId).toBe('B')
    expect(state.history.past.length + state.history.future.length).toBe(0)
  })

  /**
   * 文档/画布身份切换入口登记表：键必须覆盖 StudioAction 联合的**全部** type 字面量。
   *
   * 为什么用 Record 而不是手工数组：reducer 新增任一 action 时，此表缺键（或删 action 后多键）
   * 都会让本文件的类型检查失败（tsconfig.test.client.json 覆盖 tests/client），因此「新增第五个
   * 身份切换入口却忘了同步清单」不再能静默通过；值为 true 的入口必须在下方的场景表里受测，
   * 由运行期断言逐一核对——登记表与场景表互为闭环。
   */
  const IDENTITY_SWITCH_ENTRIES: Readonly<Record<StudioAction['type'], boolean>> = {
    SET_SESSION: false,
    SET_MODE: false,
    SET_LIB_TAB: false,
    SET_LIBRARY_SOURCE: false,
    SET_LIB_SEARCH: false,
    ASSETS_LOADED: false,
    ASSET_DOC_LOADED: false,
    ROLE_ASSET_LOADED: false,
    EXPERIENCES_LOADED: false,
    EXPERIENCE_LOADED: false,
    OPEN_EXPERIENCE: false,
    EXPERIENCE_PATCH: false,
    // 第四处入口：装载资产详情后把画布切到该资产文档（不走 openDocument）
    OPEN_FLOW_ASSET: true,
    OPEN_ROLE_ASSET: false,
    ROLE_ASSET_PATCH: false,
    ASSET_VERSIONS_LOADED: false,
    ASSET_VERSIONS_CLOSED: false,
    // 条件性切换：仅当被关闭的正是画布上打开的资产时清栈（场景表按该条件布置现场）
    ASSET_CLOSED: true,
    WORKFLOWS_LOADED: false,
    WORKFLOW_ADDED: false,
    WORKFLOW_UPDATED: false,
    WORKFLOW_REMOVED: false,
    FLOW_TEMPLATES_LOADED: false,
    FLOW_TEMPLATES_SYNCED: false,
    FLOW_TEMPLATE_ADDED: false,
    FLOW_TEMPLATE_UPDATED: false,
    FLOW_TEMPLATE_REMOVED: false,
    SERVICES_LOADED: false,
    SERVICE_UPDATED: false,
    SERVICE_REMOVED: false,
    ACTIVE_RUNS_LOADED: false,
    INSTANCE_OPTIONS_SET: false,
    TEMPLATES_LOADED: false,
    TEMPLATE_ADDED: false,
    TEMPLATE_UPDATED: false,
    TEMPLATE_REMOVED: false,
    COMBOS_LOADED: false,
    PRESETS_LOADED: false,
    MODELS_LOADED: false,
    OPEN_FLOW: true,
    OPEN_SERVICE: true,
    OPEN_FLOW_TEMPLATE: true,
    CLEAR_CANVAS: true,
    GRAPH_REPLACED: false,
    NODE_ADDED: false,
    NODE_MOVED: false,
    NODE_REMOVED: false,
    EDGE_ADDED: false,
    EDGE_REMOVED: false,
    SELECT_NODE: false,
    SELECT_EDGE: false,
    SELECT_LIB: false,
    SELECT_EDITOR: false,
    CLEAR_SELECTION: false,
    NODE_DATA_PATCH: false,
    EDGE_PATCH: false,
    DOC_PATCH: false,
    SET_DIRTY: false,
    MARK_SAVED: false,
    RUN_STARTED: false,
    RUN_SNAPSHOT: false,
    RUN_CLEARED: false,
    TOAST_PUSH: false,
    TOAST_DROP: false,
    HISTORY_PUSH: false,
    UNDO: false,
    REDO: false,
    PANELS_SET: false,
    CONFIRM_SET: false,
    HISTORY_OPEN: false,
    RUN_HISTORY_LOADED: false,
    RUN_HISTORY_SELECT: false,
    COMBO_OPEN: false,
    SCHEDULER_OPEN: false,
  }

  /** 身份切换入口的受测场景：键集必须恰好等于登记表中为 true 的集合。 */
  const IDENTITY_SWITCH_SCENARIOS: Readonly<Record<string, {
    /** 前置：把状态摆到「该入口确实会切换身份」的现场（在压入历史栈之前执行）。 */
    arrange?: (state: StudioState) => StudioState
    /** 触发入口本身。 */
    act: (state: StudioState) => StudioState
    /** 清栈之外的身份结果补充断言。 */
    after?: (state: StudioState) => void
  }>> = {
    OPEN_FLOW: {
      act: (state) => studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('X', [node({ id: 'x1', kind: 'agent' })]) }),
      after: (state) => expect(state.currentId).toBe('X'),
    },
    OPEN_SERVICE: {
      act: (state) => studioReducer(state, {
        type: 'OPEN_SERVICE',
        service: { id: 'sv', sessionId: 's-1', mode: 'mode2', name: 'sv', description: '', nodes: [], lines: [], createdAt: '', updatedAt: '', status: 'stopped' } as never,
      }),
      after: (state) => expect(state.currentId).toBe('sv'),
    },
    OPEN_FLOW_TEMPLATE: {
      act: (state) => studioReducer(state, {
        type: 'OPEN_FLOW_TEMPLATE',
        template: { id: 'T', mode: 'mode1', name: 'T', description: '', nodes: [], lines: [] } as never,
      }),
      after: (state) => expect(state.currentId).toBe('T'),
    },
    OPEN_FLOW_ASSET: {
      arrange: (state) => studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail }),
      act: (state) => studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' }),
      after: (state) => {
        // 资产画布必须是资产文档的图（未被前一份文档的图替换）
        expect(state.canvas.nodes.map((item) => item.id)).toEqual(['s1'])
        expect(state.currentId).toBe('a-1')
      },
    },
    CLEAR_CANVAS: {
      act: (state) => studioReducer(state, { type: 'CLEAR_CANVAS' }),
      after: (state) => {
        expect(state.currentId).toBeNull()
        expect(state.canvas).toEqual({ nodes: [], edges: [] })
      },
    },
    ASSET_CLOSED: {
      arrange: (state) => studioReducer(
        studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail }),
        { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' },
      ),
      act: (state) => studioReducer(state, { type: 'ASSET_CLOSED', assetId: 'a-1' }),
      after: (state) => {
        expect(state.currentId).toBeNull()
        expect(state.canvas).toEqual({ nodes: [], edges: [] })
      },
    },
  }

  it('P0 对齐：身份切换入口清单与受测场景闭环（reducer 新增入口即转红）', () => {
    const switching = (Object.keys(IDENTITY_SWITCH_ENTRIES) as Array<StudioAction['type']>)
      .filter((type) => IDENTITY_SWITCH_ENTRIES[type])
    // 登记表说「切换身份」的入口必须有场景：漏测即失败，且新增入口在类型层就已失败
    expect(Object.keys(IDENTITY_SWITCH_SCENARIOS).sort()).toEqual([...switching].sort())

    for (const [type, scenario] of Object.entries(IDENTITY_SWITCH_SCENARIOS)) {
      let state = baseState()
      state = studioReducer(state, { type: 'GRAPH_REPLACED', nodes: [node({ id: 'n1', kind: 'agent' })], edges: [], dirty: false })
      if (scenario.arrange) state = scenario.arrange(state)
      state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
      // 前置非空守卫：否则「清空历史栈」断言会退化成恒真
      expect(state.history.past.length, `${type} 前置历史栈为空`).toBeGreaterThan(0)
      state = scenario.act(state)
      expect(state.history.past, `${type} 未清空历史栈`).toEqual([])
      expect(state.history.future, `${type} 未清空重做栈`).toEqual([])
      scenario.after?.(state)
    }
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

  it('SCHEDULER_OPEN：定时任务弹层开关（默认关闭 → 打开 → 关闭）', () => {
    const state = baseState()
    expect(state.schedulerOpen).toBe(false)
    const opened = studioReducer(state, { type: 'SCHEDULER_OPEN', open: true })
    expect(opened.schedulerOpen).toBe(true)
    expect(opened.comboOpen).toBe(false) // 与组合管理开关独立
    const closed = studioReducer(opened, { type: 'SCHEDULER_OPEN', open: false })
    expect(closed.schedulerOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 资产态（模版 / 资产来源）：库来源、搜索、资产列表/详情/版本与画布投影
// ---------------------------------------------------------------------------

const assetDetail: WorkflowAssetDetail = {
  assetId: 'a-1',
  versionId: 2,
  rowId: 'row-2',
  mode: 'mode1',
  name: '资产一',
  description: '描述一',
  nodes: [{ id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } }] as WorkflowAssetDetail['nodes'],
  lines: [],
  roleVersionIds: [],
  createdAt: 1,
}

const roleAssetDetail: RoleAssetDetail = {
  assetId: 'a-r1',
  versionId: 1,
  rowId: 'row-1',
  kind: 'agent',
  roleAssetType: 'standalone',
  name: '资产角色',
  systemPrompt: '你是资产角色',
  provider: 'deepseek',
  model: 'deepseek-chat',
  retryLimit: 3,
  referenceWorkflowIds: [],
  createdAt: 1,
}

/** 经验条目构造器（无版本控制：只有 active 两态，缺省活跃）。 */
function experienceEntry(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: 'ex-1',
    active: true,
    experienceType: 'agent',
    responsibility: '重构旧模块',
    taskType: '软件开发',
    decisionDomain: '重构顺序',
    situation: '旧模块缺少测试',
    trigger: '再次重构旧模块',
    principle: '先补测试再重构',
    recommendedAction: '先补测试',
    exclusions: [],
    evidence: [],
    taskRetrievalText: '任务侧投影',
    decisionRetrievalText: '决策侧投影',
    sourceRunId: 'run-1',
    generationPromptId: 'prompt-1',
    generationPromptVersion: 'v1',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }
}

describe('资产态状态机', () => {
  it('初始状态：库来源默认模版、搜索为空、资产列表/详情/版本为空', () => {
    const state = baseState()
    expect(state.librarySource).toBe('template')
    expect(state.libSearch).toBe('')
    expect(state.assets).toEqual({ workflows: [], roles: [], retiredWorkflows: [], retiredRoles: [] })
    expect(state.assetDoc).toBeNull()
    expect(state.assetRoleDoc).toBeNull()
    expect(state.assetVersions).toBeNull()
  })

  it('SET_LIBRARY_SOURCE / SET_LIB_SEARCH：单字段赋值', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'SET_LIBRARY_SOURCE', source: 'asset' })
    state = studioReducer(state, { type: 'SET_LIB_SEARCH', query: '研究' })
    expect(state.librarySource).toBe('asset')
    expect(state.libSearch).toBe('研究')
  })

  it('ASSETS_LOADED：写入活跃与历史（已归档）四类资产列表', () => {
    const state = studioReducer(baseState(), {
      type: 'ASSETS_LOADED',
      workflows: [{ assetId: 'a-1', versionId: 1, name: '资产一', description: '', updatedAt: 1 }],
      roles: [{ assetId: 'a-r1', versionId: 1, name: '角色资产', kind: 'agent', roleAssetType: 'standalone', updatedAt: 1 }],
      retiredWorkflows: [{ assetId: 'a-old', versionId: 1, name: '归档流程', description: '', updatedAt: 1 }],
      retiredRoles: [{ assetId: 'a-rold', versionId: 1, name: '归档角色', kind: 'agent', roleAssetType: 'standalone', updatedAt: 1 }],
    })
    expect(state.assets.workflows.map((item) => item.assetId)).toEqual(['a-1'])
    expect(state.assets.roles.map((item) => item.assetId)).toEqual(['a-r1'])
    // 归档资产与活跃资产分开持有：召回面（活跃列表）不会被历史资产污染
    expect(state.assets.retiredWorkflows.map((item) => item.assetId)).toEqual(['a-old'])
    expect(state.assets.retiredRoles.map((item) => item.assetId)).toEqual(['a-rold'])
  })

  it('OPEN_FLOW_ASSET：画布 = 资产详情投影，切到资产态并重置选中/编辑器/未保存标记', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    expect(state.currentKind).toBe('flowAsset')
    expect(state.currentId).toBe('a-1')
    expect(state.canvas.nodes.map((node) => node.id)).toEqual(['s1'])
    expect(state.editor).toEqual({ source: 'flowAsset', id: 'a-1' })
    expect(state.selection.lib).toEqual({ kind: 'flowAsset', id: 'a-1' })
    expect(state.dirty).toBe(false)
    expect(state.savedGraph).not.toBeNull()
  })

  it('OPEN_FLOW_ASSET：assetId 与已装载详情不一致 → 保持原状态（丢弃陈旧装载）', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    const next = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-2' })
    expect(next.currentKind).toBeNull()
    expect(next.currentId).toBeNull()
  })

  it('DOC_PATCH：资产态名称/描述落在 assetDoc 上并标记未保存', () => {
    let state = baseState()
    state = studioReducer(state, { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    state = studioReducer(state, { type: 'DOC_PATCH', patch: { name: '改名后' } })
    expect(state.assetDoc?.name).toBe('改名后')
    expect(state.assetDoc?.description).toBe('描述一')
    expect(state.dirty).toBe(true)
  })

  it('OPEN_ROLE_ASSET：属性栏编辑角色资产（选中 + 编辑器引用）', () => {
    let state = studioReducer(baseState(), { type: 'ROLE_ASSET_LOADED', detail: roleAssetDetail })
    state = studioReducer(state, { type: 'OPEN_ROLE_ASSET', assetId: 'a-r1' })
    expect(state.assetRoleDoc?.assetId).toBe('a-r1')
    expect(state.editor).toEqual({ source: 'roleAsset', id: 'a-r1' })
    expect(state.selection.lib).toEqual({ kind: 'roleAsset', id: 'a-r1' })
  })

  it('ASSET_VERSIONS_LOADED / ASSET_VERSIONS_CLOSED：回滚上拉列表数据面', () => {
    const items = [{ versionId: 2, rowId: 'row-2', name: 'v2', createdAt: 2, source: 'human' as const, active: true }]
    let state = studioReducer(baseState(), { type: 'ASSET_VERSIONS_LOADED', kind: 'workflow', assetId: 'a-1', items })
    expect(state.assetVersions).toEqual({ kind: 'workflow', assetId: 'a-1', items })
    state = studioReducer(state, { type: 'ASSET_VERSIONS_CLOSED' })
    expect(state.assetVersions).toBeNull()
  })

  it('ROLE_ASSET_PATCH：属性栏字段写回 assetRoleDoc；未装载详情时不改状态', () => {
    let state = studioReducer(baseState(), { type: 'ROLE_ASSET_LOADED', detail: roleAssetDetail })
    state = studioReducer(state, { type: 'ROLE_ASSET_PATCH', patch: { name: '改名后', systemPrompt: '新提示词' } })
    expect(state.assetRoleDoc?.name).toBe('改名后')
    expect(state.assetRoleDoc?.systemPrompt).toBe('新提示词')
    expect(state.assetRoleDoc?.provider).toBe('deepseek')

    const untouched = studioReducer(baseState(), { type: 'ROLE_ASSET_PATCH', patch: { name: '改名后' } })
    expect(untouched.assetRoleDoc).toBeNull()
  })

  it('ASSET_CLOSED：清空该资产详情槽；正打开在画布时一并清空画布与编辑器', () => {
    let state = studioReducer(baseState(), { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    state = studioReducer(state, { type: 'ROLE_ASSET_LOADED', detail: roleAssetDetail })
    state = studioReducer(state, { type: 'ASSET_VERSIONS_LOADED', kind: 'workflow', assetId: 'a-1', items: [] })
    state = studioReducer(state, { type: 'ASSET_CLOSED', assetId: 'a-1' })

    expect(state.assetDoc).toBeNull()
    expect(state.assetVersions).toBeNull()
    expect(state.currentId).toBeNull()
    expect(state.currentKind).toBeNull()
    expect(state.canvas.nodes).toEqual([])
    expect(state.dirty).toBe(false)
    expect(state.editor).toBeNull()
    // 其他资产的已装载详情不受影响（退役只影响目标资产）
    expect(state.assetRoleDoc?.assetId).toBe('a-r1')
  })

  it('ASSET_CLOSED：角色资产在属性栏编辑时清空编辑器与选中，画布文档保持不动', () => {
    let state = studioReducer(baseState(), { type: 'ROLE_ASSET_LOADED', detail: roleAssetDetail })
    state = studioReducer(state, { type: 'OPEN_ROLE_ASSET', assetId: 'a-r1' })
    state = studioReducer(state, { type: 'ASSET_CLOSED', assetId: 'a-r1' })

    expect(state.assetRoleDoc).toBeNull()
    expect(state.editor).toBeNull()
    expect(state.selection).toEqual({ nodeId: null, edgeId: null, lib: null })
    expect(state.currentKind).toBeNull()
  })

  it('EXPERIENCES_LOADED / EXPERIENCE_LOADED：列表写入，详情装载同步列表项', () => {
    const items = [experienceEntry(), experienceEntry({ id: 'ex-2', active: false })]
    let state = studioReducer(baseState(), { type: 'EXPERIENCES_LOADED', items })
    expect(state.experiences).toEqual(items)

    const updated = experienceEntry({ principle: '改写后的原则', updatedAt: 20 })
    state = studioReducer(state, { type: 'EXPERIENCE_LOADED', entry: updated })
    expect(state.experienceDoc).toEqual(updated)
    // 列表与详情同源：装载详情时同步列表里对应条目，避免两处各留一份旧内容
    expect(state.experiences.find((item) => item.id === 'ex-1')).toEqual(updated)
    expect(state.experiences.find((item) => item.id === 'ex-2')?.active).toBe(false)
  })

  it('EXPERIENCE_LOADED：列表里没有该条目时不新增列表项（只更新详情槽）', () => {
    const state = studioReducer(baseState(), { type: 'EXPERIENCE_LOADED', entry: experienceEntry({ id: 'ex-新' }) })

    expect(state.experiences).toEqual([])
    expect(state.experienceDoc?.id).toBe('ex-新')
  })

  it('OPEN_EXPERIENCE：属性栏编辑经验（选中 + 编辑器引用）', () => {
    let state = studioReducer(baseState(), { type: 'EXPERIENCES_LOADED', items: [experienceEntry()] })
    state = studioReducer(state, { type: 'OPEN_EXPERIENCE', experienceId: 'ex-1' })

    expect(state.editor).toEqual({ source: 'experience', id: 'ex-1' })
    expect(state.selection.lib).toEqual({ kind: 'experience', id: 'ex-1' })
  })

  it('EXPERIENCE_PATCH：属性栏字段写回 experienceDoc；未装载详情时不改状态', () => {
    let state = studioReducer(baseState(), { type: 'EXPERIENCE_LOADED', entry: experienceEntry() })
    state = studioReducer(state, { type: 'EXPERIENCE_PATCH', patch: { principle: '改写后的原则', evidence: ['新证据'] } })

    expect(state.experienceDoc?.principle).toBe('改写后的原则')
    expect(state.experienceDoc?.evidence).toEqual(['新证据'])
    expect(state.experienceDoc?.taskType).toBe('软件开发')

    const untouched = studioReducer(baseState(), { type: 'EXPERIENCE_PATCH', patch: { principle: '改写后的原则' } })
    expect(untouched.experienceDoc).toBeNull()
  })
})

describe('资产态选择器（editorDataOf / currentFlowAssetOf / isInstanceSourceKind）', () => {
  it('editorDataOf：flowAsset → workflow 表单数据 + 资产标记', () => {
    let state = studioReducer(baseState(), { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    const data = editorDataOf(state)
    expect(data?.kind).toBe('workflow')
    expect(data?.name).toBe('资产一')
    expect(data?.data).toEqual({ name: '资产一', description: '描述一' })
    expect(data?.asset).toBe(true)
    expect(data?.assetId).toBe('a-1')
  })

  it('editorDataOf：roleAsset → role 表单数据（详情投影）+ 资产标记', () => {
    let state = studioReducer(baseState(), { type: 'ROLE_ASSET_LOADED', detail: roleAssetDetail })
    state = studioReducer(state, { type: 'OPEN_ROLE_ASSET', assetId: 'a-r1' })
    const data = editorDataOf(state)
    expect(data?.kind).toBe('role')
    expect(data?.name).toBe('资产角色')
    expect((data?.data as { systemPrompt?: string }).systemPrompt).toBe('你是资产角色')
    expect(data?.roleAsset).toBe(true)
    expect(data?.assetId).toBe('a-r1')
    expect(inspectorOpenOf(state)).toBe(true)
  })

  it('editorDataOf：详情未装载 / 引用不匹配 → null（不渲染空表单）', () => {
    const state = studioReducer(baseState(), { type: 'OPEN_ROLE_ASSET', assetId: 'a-r1' })
    expect(editorDataOf(state)).toBeNull()
    expect(inspectorOpenOf(state)).toBe(false)
  })

  it('editorDataOf：experience → 经验表单数据（条目投影）+ 经验标记与状态', () => {
    let state = studioReducer(baseState(), { type: 'EXPERIENCE_LOADED', entry: experienceEntry() })
    state = studioReducer(state, { type: 'OPEN_EXPERIENCE', experienceId: 'ex-1' })
    const active = editorDataOf(state)
    expect(active?.kind).toBe('experience')
    expect(active?.name).toBe('重构旧模块')
    expect((active?.data as { principle?: string }).principle).toBe('先补测试再重构')
    expect(active?.experience).toBe(true)
    expect(active?.experienceId).toBe('ex-1')
    expect(active?.retired).toBeUndefined()
    expect(inspectorOpenOf(state)).toBe(true)
    // 归档经验：同一投影带上 retired（属性栏据此把「归档」换成「恢复」）
    const retiredState = studioReducer(
      studioReducer(baseState(), { type: 'EXPERIENCE_LOADED', entry: experienceEntry({ active: false }) }),
      { type: 'OPEN_EXPERIENCE', experienceId: 'ex-1' },
    )
    expect(editorDataOf(retiredState)?.retired).toBe(true)
  })

  it('editorDataOf：经验详情未装载 / 引用不匹配 → null（不渲染空表单）', () => {
    const state = studioReducer(baseState(), { type: 'OPEN_EXPERIENCE', experienceId: 'ex-1' })
    expect(editorDataOf(state)).toBeNull()
    expect(inspectorOpenOf(state)).toBe(false)
  })

  it('currentFlowAssetOf：仅在资产态且详情同源时返回文档', () => {
    let state = studioReducer(baseState(), { type: 'ASSET_DOC_LOADED', detail: assetDetail })
    expect(currentFlowAssetOf(state)).toBeNull()
    state = studioReducer(state, { type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
    expect(currentFlowAssetOf(state)?.assetId).toBe('a-1')
  })

  it('isInstanceSourceKind：模版态与资产态都是「实例来源」，其余不是', () => {
    expect(isInstanceSourceKind('flowTemplate')).toBe(true)
    expect(isInstanceSourceKind('flowAsset')).toBe(true)
    expect(isInstanceSourceKind('workflow')).toBe(false)
    expect(isInstanceSourceKind('service')).toBe(false)
    expect(isInstanceSourceKind(null)).toBe(false)
  })
})

// src/client/studio/studio-reducer.ts
//
// 工作台状态机主体（纯 reducer，可独立单测）：studioReducer 依
// StudioAction 单向流转状态；openDocument 打开文档（重置选中/编辑器/
// 已保存图快照）；sanitizeSelectionAfterCanvas 校验画布恢复后的选中与
// 编辑器引用（Bug 8）。所有变更经 dispatch(action) 流入。

import type { StudioState, CanvasNode, CanvasEdge, EditorRef, LibSelKind } from './studio-types.js'
import type { StudioAction } from './studio-actions.js'
import { flowToCanvas, serviceToCanvas } from './studio-projection.js'
import { graphSnapshotOf, graphSnapshotsEqual } from './studio-snapshot.js'
import { HISTORY_LIMIT } from './studio-initial.js'

/** 打开工作流/服务/模板时的选中与编辑器重置（可选保留画布选择）。 */
function openDocument(state: StudioState, canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] }, kind: 'workflow' | 'service' | 'flowTemplate', id: string): StudioState {
  const libKind: LibSelKind = kind === 'workflow' ? 'workflow' : kind === 'service' ? 'service' : 'workflowTemplate'
  const editor: EditorRef = kind === 'workflow' ? { source: 'workflow', id } : kind === 'service' ? { source: 'service', id } : { source: 'flowTemplate', id }
  const opened: StudioState = {
    ...state,
    currentKind: kind,
    currentId: id,
    canvas,
    dirty: false,
    savedGraph: graphSnapshotOf({ ...state, canvas }),
    run: { runId: null, snapshot: null },
    selection: { nodeId: null, edgeId: null, lib: { kind: libKind, id } },
    editor,
  }
  return opened
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'SET_SESSION':
      return { ...state, sessionId: action.sessionId }
    case 'SET_MODE':
      return { ...state, mode: action.mode }
    case 'SET_LIB_TAB':
      return { ...state, libTab: action.tab }
    case 'WORKFLOWS_LOADED':
      return { ...state, workflows: action.items }
    case 'WORKFLOW_ADDED':
      return { ...state, workflows: [action.flow, ...state.workflows] }
    case 'WORKFLOW_UPDATED':
      return { ...state, workflows: state.workflows.map((flow) => (flow.id === action.flow.id ? action.flow : flow)) }
    case 'WORKFLOW_REMOVED':
      return { ...state, workflows: state.workflows.filter((flow) => flow.id !== action.id) }
    case 'FLOW_TEMPLATES_LOADED':
      return { ...state, flowTemplates: action.items }
    case 'FLOW_TEMPLATE_ADDED':
      return { ...state, flowTemplates: [action.template, ...state.flowTemplates] }
    case 'FLOW_TEMPLATE_UPDATED':
      return { ...state, flowTemplates: state.flowTemplates.map((template) => (template.id === action.template.id ? action.template : template)) }
    case 'FLOW_TEMPLATE_REMOVED':
      return { ...state, flowTemplates: state.flowTemplates.filter((template) => template.id !== action.id) }
    case 'SERVICES_LOADED':
      return { ...state, services: action.items }
    case 'SERVICE_UPDATED':
      return { ...state, services: state.services.map((service) => (service.id === action.service.id ? action.service : service)) }
    case 'SERVICE_REMOVED':
      return { ...state, services: state.services.filter((service) => service.id !== action.id) }
    case 'TEMPLATES_LOADED':
      return { ...state, templates: { ...state.templates, [action.kind]: action.items } }
    case 'TEMPLATE_ADDED':
      return { ...state, templates: { ...state.templates, [action.kind]: [action.template, ...state.templates[action.kind]] } }
    case 'TEMPLATE_UPDATED':
      return { ...state, templates: { ...state.templates, [action.kind]: state.templates[action.kind].map((item) => (item.id === action.template.id ? action.template : item)) } }
    case 'TEMPLATE_REMOVED':
      return { ...state, templates: { ...state.templates, [action.kind]: state.templates[action.kind].filter((item) => item.id !== action.id) } }
    case 'COMBOS_LOADED':
      return { ...state, combos: action.items }
    case 'PRESETS_LOADED':
      return { ...state, presets: action.items }
    case 'TOOLS_LOADED':
      return { ...state, tools: action.items }
    case 'MODELS_LOADED':
      return { ...state, models: action.items }
    case 'OPEN_FLOW': {
      const exists = state.workflows.some((flow) => flow.id === action.flow.id)
      const workflows = exists
        ? state.workflows.map((flow) => (flow.id === action.flow.id ? action.flow : flow))
        : [action.flow, ...state.workflows]
      return openDocument({ ...state, workflows }, flowToCanvas(action.flow), 'workflow', action.flow.id)
    }
    case 'OPEN_SERVICE': {
      const exists = state.services.some((service) => service.id === action.service.id)
      const services = exists
        ? state.services.map((service) => (service.id === action.service.id ? action.service : service))
        : [action.service, ...state.services]
      return openDocument({ ...state, services }, serviceToCanvas(action.service), 'service', action.service.id)
    }
    case 'OPEN_FLOW_TEMPLATE': {
      // 模板打开 = 画布显示模板流程图（编辑态）；「创建实例」后转为实例态。
      const exists = state.flowTemplates.some((template) => template.id === action.template.id)
      const flowTemplates = exists
        ? state.flowTemplates.map((template) => (template.id === action.template.id ? action.template : template))
        : [action.template, ...state.flowTemplates]
      return openDocument({ ...state, flowTemplates }, flowToCanvas(action.template), 'flowTemplate', action.template.id)
    }
    case 'CLEAR_CANVAS':
      return {
        ...state,
        currentId: null,
        currentKind: null,
        canvas: { nodes: [], edges: [] },
        selection: { nodeId: null, edgeId: null, lib: null },
        editor: null,
        dirty: false,
        run: { runId: null, snapshot: null },
      }
    case 'GRAPH_REPLACED':
      return { ...state, canvas: { nodes: action.nodes, edges: action.edges }, dirty: action.dirty }
    case 'NODE_ADDED':
      return { ...state, canvas: { ...state.canvas, nodes: [...state.canvas.nodes, action.node] }, dirty: true }
    case 'NODE_MOVED':
      return {
        ...state,
        canvas: { ...state.canvas, nodes: state.canvas.nodes.map((node) => (node.id === action.id ? { ...node, position: action.position } : node)) },
        dirty: true,
      }
    case 'NODE_REMOVED': {
      // 级联删除（需求 §4.2.3.2 规则 5）：删除角色主节点时同时删除其全部
      // 虚拟引用节点，避免画布残留孤儿虚拟节点（Bug 4）。
      const removed = new Set<string>([action.id])
      const main = state.canvas.nodes.find((node) => node.id === action.id)
      if (main && (main.kind === 'parent' || main.kind === 'agent')) {
        for (const node of state.canvas.nodes) {
          if (node.kind === 'proxy' && (node as { proxySourceId?: unknown }).proxySourceId === action.id) removed.add(node.id)
        }
      }
      return {
        ...state,
        canvas: {
          nodes: state.canvas.nodes.filter((node) => !removed.has(node.id)),
          edges: state.canvas.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        },
        dirty: true,
      }
    }
    case 'EDGE_ADDED':
      return { ...state, canvas: { ...state.canvas, edges: [...state.canvas.edges, action.edge] }, dirty: true }
    case 'EDGE_REMOVED':
      return { ...state, canvas: { ...state.canvas, edges: state.canvas.edges.filter((edge) => edge.id !== action.id) }, dirty: true }
    case 'SELECT_NODE':
      return { ...state, selection: { nodeId: action.id, edgeId: null, lib: null }, editor: { source: 'node', id: action.id } }
    case 'SELECT_EDGE':
      return { ...state, selection: { nodeId: null, edgeId: action.id, lib: null }, editor: { source: 'edge', id: action.id } }
    case 'SELECT_LIB':
      return { ...state, selection: { nodeId: null, edgeId: null, lib: { kind: action.kind, id: action.id } } }
    case 'SELECT_EDITOR':
      return { ...state, editor: action.editor }
    case 'CLEAR_SELECTION':
      return { ...state, selection: { nodeId: null, edgeId: null, lib: null }, editor: null }
    case 'NODE_DATA_PATCH':
      return {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: state.canvas.nodes.map((node) => (node.id === action.id ? { ...node, data: { ...node.data, ...action.patch } } : node)),
        },
        dirty: true,
      }
    case 'EDGE_PATCH':
      return {
        ...state,
        canvas: {
          ...state.canvas,
          edges: state.canvas.edges.map((edge) => (edge.id === action.id ? { ...edge, ...action.patch } : edge)),
        },
        dirty: true,
      }
    case 'DOC_PATCH':
      return state.currentKind === 'workflow'
        ? {
            ...state,
            workflows: state.workflows.map((flow) => (flow.id === state.currentId
              ? { ...flow, ...(action.patch.name !== undefined ? { name: action.patch.name } : {}), ...(action.patch.description !== undefined ? { description: action.patch.description } : {}) }
              : flow)),
            dirty: true,
          }
        : state.currentKind === 'flowTemplate'
          ? {
              ...state,
              flowTemplates: state.flowTemplates.map((template) => (template.id === state.currentId
                ? { ...template, ...(action.patch.name !== undefined ? { name: action.patch.name } : {}), ...(action.patch.description !== undefined ? { description: action.patch.description } : {}) }
                : template)),
              dirty: true,
            }
          : state.currentKind === 'service'
            ? {
                ...state,
                services: state.services.map((service) => (service.id === state.currentId
                  ? { ...service, ...(action.patch.name !== undefined ? { name: action.patch.name } : {}), ...(action.patch.description !== undefined ? { description: action.patch.description } : {}) }
                  : service)),
                dirty: true,
              }
            : state
    case 'SET_DIRTY':
      return { ...state, dirty: action.dirty }
    case 'MARK_SAVED':
      return { ...state, dirty: false, savedGraph: graphSnapshotOf(state) }
    case 'RUN_STARTED':
      return { ...state, run: { runId: action.runId, snapshot: null } }
    case 'RUN_SNAPSHOT':
      return { ...state, run: { ...state.run, snapshot: action.snapshot } }
    case 'RUN_CLEARED':
      return { ...state, run: { runId: null, snapshot: null } }
    case 'TOAST_PUSH':
      return { ...state, toasts: [...state.toasts, action.toast] }
    case 'TOAST_DROP':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) }
    case 'SET_MESSAGE':
      return { ...state, message: action.message }
    case 'HISTORY_PUSH': {
      const past = [...state.history.past, action.snapshot]
      if (past.length > HISTORY_LIMIT) past.shift()
      return { ...state, history: { past, future: [] } }
    }
    case 'UNDO': {
      const previous = state.history.past.at(-1)
      if (!previous) return state
      const next: StudioState = {
        ...state,
        canvas: { nodes: previous.nodes, edges: previous.edges },
        history: { past: state.history.past.slice(0, -1), future: [...state.history.future, graphSnapshotOf(state)] },
      }
      // BP（Bug 17）：撤销后是否「未保存」取决于是否回到已保存快照，
      // 而非一律 true——连续撤销回初始保存状态时不应再弹未保存确认。
      // BP（Bug 8）：canvas 变化后校验选中/编辑器引用存在性。
      return { ...next, ...sanitizeSelectionAfterCanvas(next), dirty: !graphSnapshotsEqual(next.canvas, state.savedGraph) }
    }
    case 'REDO': {
      const next = state.history.future.at(-1)
      if (!next) return state
      const applied: StudioState = {
        ...state,
        canvas: { nodes: next.nodes, edges: next.edges },
        history: { past: [...state.history.past, graphSnapshotOf(state)], future: state.history.future.slice(0, -1) },
      }
      // 同 UNDO：重做后同样按「是否回到已保存状态」判定（Bug 17）与
      // 选中/编辑器校验（Bug 8）。
      return { ...applied, ...sanitizeSelectionAfterCanvas(applied), dirty: !graphSnapshotsEqual(applied.canvas, state.savedGraph) }
    }
    case 'PANELS_SET':
      return { ...state, panels: { ...state.panels, ...action.panels } }
    case 'CONFIRM_SET':
      return { ...state, confirm: action.confirm }
    case 'HISTORY_OPEN':
      return { ...state, historyOpen: action.open }
    case 'RUN_HISTORY_LOADED':
      return { ...state, runHistory: action.items, selectedRunId: action.items[0]?.id ?? state.selectedRunId }
    case 'RUN_HISTORY_SELECT':
      return { ...state, selectedRunId: action.id }
    case 'COMBO_OPEN':
      return { ...state, comboOpen: action.open }
    case 'SCHEDULER_OPEN':
      return { ...state, schedulerOpen: action.open }
    default:
      return state
  }
}

/**
 * 画布变化后的选中/编辑器校验（Bug 8）：UNDO/REDO 恢复画布后，selection 与
 * editor 可能仍指向已不存在的节点/连线（如 REDO 一个删除操作后选中残留），
 * 返回清理后的 selection/editor —— 引用失效的项置空，避免键盘删除误删与
 * Inspector 渲染空数据。
 */
function sanitizeSelectionAfterCanvas(state: StudioState): Pick<StudioState, 'selection' | 'editor'> {
  const nodeExists = (id: string | null | undefined): boolean => id != null && state.canvas.nodes.some((node) => node.id === id)
  const edgeExists = (id: string | null | undefined): boolean => id != null && state.canvas.edges.some((edge) => edge.id === id)
  const selection: StudioState['selection'] = {
    nodeId: nodeExists(state.selection.nodeId) ? state.selection.nodeId : null,
    edgeId: edgeExists(state.selection.edgeId) ? state.selection.edgeId : null,
    lib: state.selection.lib,
  }
  let editor = state.editor
  if (editor) {
    if (editor.source === 'node' && !nodeExists(editor.id)) editor = null
    else if (editor.source === 'edge' && !edgeExists(editor.id)) editor = null
  }
  return { selection, editor }
}

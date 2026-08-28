// src/client/studio/studio-state.ts
//
// 工作台状态机（纯 reducer，可独立单测）：工作流/服务/模板/组合列表、当前
// 画布图（节点/连线）、选中与编辑器、未保存标记、运行快照、撤销重做栈、
// 面板几何、轻提示与对话框。所有变更经 dispatch(action) 单向流转；
// 数据加载/远端调用在 hooks 层完成后再 dispatch 结果。
//
// 数据模型对齐后端共享契约：工作流文档 { nodes, lines }（全量内联，无模板
// 引用）；模板 role/file/database 三类；模式 mode1/mode2。

import type { WorkflowDocument, GraphNode, Line, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, ToolCombo, RunSnapshot } from '../../host/shared/types.js'
import { consolidateGroups } from '../lib/graph-model.js'

/** 左侧栏 Tab（需求 §4.5.4：工作流 / 角色 / 数据（文件+数据库）/ 其他（阶段+协作组））。 */
export type LibTab = 'workflow' | 'role' | 'data' | 'other'
/** 左侧库选中种类（模板 kind + 固定卡片 + 工作流模板）。 */
export type LibSelKind = 'workflow' | 'service' | 'workflowTemplate' | 'role' | 'file' | 'database' | 'parentTemplate' | 'stage' | 'groupTemplate'
/** 模板种类（与后端 listTemplates 契约一致）。 */
export type TemplateKind = 'role' | 'file' | 'database'

/** 画布节点投影（位置/数据全量内联）。 */
export interface CanvasNode {
  id: string
  kind: GraphNode['kind']
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** 画布连线投影（条件标签由条件类型生成）。 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle: Line['sourceHandle']
  targetHandle: Line['targetHandle']
  condition?: Line['condition']
}

/** 图快照（撤销重做栈元素）。 */
export interface GraphSnapshot {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** 生态枚举条目（对齐后端 presets 端点返回结构）。 */
export interface PresetItem { id: string; name?: string; description?: string; trust?: string }
/** 生态枚举条目（对齐后端 tools 端点返回结构）。 */
export interface ToolItem { name: string; description: string }
/** 生态模型条目（对齐后端 models 端点返回结构：provider/model + 思考强度档位）。 */
export interface ModelItem { provider: string; model: string; efforts?: Array<{ id: string; name: string }> }

/**
 * 本地草稿标记（前端 UI 状态，绝不落盘——后端 put* 端点经 stripClientMeta 剥除）。
 * 以交叉类型表达「带草稿标记的持久化对象」，替代旧实现
 * `...({ _draft: true } as object)` + `as unknown as X` 的双重类型逃逸
 * （后者完全绕过类型检查，掩盖数据模型不一致）。
 */
export type Drafted<T> = T & { _draft: true }

/** 编辑器引用（右侧面板编辑对象）。 */
export type EditorRef =
  | { source: 'workflow'; id: string }
  | { source: 'service'; id: string }
  | { source: 'flowTemplate'; id: string }
  | { source: 'template'; kind: TemplateKind; id: string }
  | { source: 'node'; id: string }
  | { source: 'edge'; id: string }
  | null

/** 对话框状态（未保存守卫/确认/导入冲突）。 */
export interface ConfirmState {
  kind: 'unsaved' | 'confirmText' | 'importConflict'
  title?: string
  message?: string
  /** 确认后的回调（未保存守卫：保存/放弃后继续执行）。 */
  proceed?: () => void
  /** 确认回调（confirmText）。 */
  onConfirm?: () => void
  /** 确认按钮文案（confirmText 定制；缺省"删除"）。 */
  confirmLabel?: string
  /** 导入冲突补充：导入类型（workflow/agent）。 */
  kind2?: string
  /** 导入冲突补充：原始 JSON 文本。 */
  json?: string
  /** 导入冲突补充：已存在名称。 */
  name?: string
}

/** 轻提示。 */
export interface ToastItem {
  id: string
  kind: 'info' | 'success' | 'error'
  text: string
}

/** 面板几何（localStorage 持久化由 usePanelLayout 负责）。 */
export interface PanelLayout {
  leftOpen: boolean
  leftWidth: number
  rightOpen: boolean
  rightWidth: number
}

export interface StudioState {
  /** 绑定的会话 id（T-042：会话绑定，不提供下拉）。 */
  sessionId: string
  /** 左侧栏 Tab。 */
  libTab: LibTab
  /** 当前编辑对象模式（新建草稿的默认模式）。 */
  mode: 'mode1' | 'mode2'
  workflows: WorkflowDocument[]
  services: ServiceState[]
  /** 工作流模板列表（全局共享；部分仅含当前 mode 的模板，模板拖入画布后经「创建实例」转实例）。 */
  flowTemplates: WorkflowTemplate[]
  templates: Record<TemplateKind, Array<RoleTemplate | FileTemplate | DatabaseTemplate>>
  combos: ToolCombo[]
  presets: PresetItem[]
  tools: ToolItem[]
  models: ModelItem[]
  /** 当前画布对象（工作流/服务实例，或工作流模板）。 */
  currentId: string | null
  currentKind: 'workflow' | 'service' | 'flowTemplate' | null
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] }
  selection: { nodeId: string | null; edgeId: string | null; lib: { kind: LibSelKind; id: string } | null }
  editor: EditorRef
  /** 未保存修改标记（§4.5.9 未保存守卫）。 */
  dirty: boolean
  /** 最近一次「已保存」的画布图快照：打开文档/保存成功时更新；
   *  UNDO/REDO 用它精确判定是否回到已保存状态（Bug 17——避免撤销回初始
   *  保存状态仍被误判为未保存而弹确认框）。 */
  savedGraph: GraphSnapshot | null
  run: { runId: string | null; snapshot: RunSnapshot | null }
  toasts: ToastItem[]
  message: string
  history: { past: GraphSnapshot[]; future: GraphSnapshot[] }
  panels: PanelLayout
  confirm: ConfirmState | null
  historyOpen: boolean
  runHistory: RunSnapshot[]
  selectedRunId: string | null
  comboOpen: boolean
}

/** 撤销重做栈上限（旧项目 HISTORY_LIMIT）。 */
export const HISTORY_LIMIT = 60

/** 初始面板几何。 */
export function defaultPanels(): PanelLayout {
  return { leftOpen: true, leftWidth: 236, rightOpen: true, rightWidth: 300 }
}

/** 初始状态（会话 id 由调用方注入）。 */
export function createInitialState(sessionId: string): StudioState {
  return {
    sessionId,
    libTab: 'workflow',
    mode: 'mode1',
    workflows: [],
    services: [],
    flowTemplates: [],
    templates: { role: [], file: [], database: [] },
    combos: [],
    presets: [],
    tools: [],
    models: [],
    currentId: null,
    currentKind: null,
    canvas: { nodes: [], edges: [] },
    selection: { nodeId: null, edgeId: null, lib: null },
    editor: null,
    dirty: false,
    savedGraph: null,
    run: { runId: null, snapshot: null },
    toasts: [],
    message: '',
    history: { past: [], future: [] },
    panels: defaultPanels(),
    confirm: null,
    historyOpen: false,
    runHistory: [],
    selectedRunId: null,
    comboOpen: false,
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type StudioAction =
  | { type: 'SET_SESSION'; sessionId: string }
  | { type: 'SET_MODE'; mode: 'mode1' | 'mode2' }
  | { type: 'SET_LIB_TAB'; tab: LibTab }
  | { type: 'WORKFLOWS_LOADED'; items: WorkflowDocument[] }
  | { type: 'WORKFLOW_ADDED'; flow: WorkflowDocument }
  | { type: 'WORKFLOW_UPDATED'; flow: WorkflowDocument }
  | { type: 'WORKFLOW_REMOVED'; id: string }
  | { type: 'FLOW_TEMPLATES_LOADED'; items: WorkflowTemplate[] }
  | { type: 'FLOW_TEMPLATE_ADDED'; template: WorkflowTemplate }
  | { type: 'FLOW_TEMPLATE_UPDATED'; template: WorkflowTemplate }
  | { type: 'FLOW_TEMPLATE_REMOVED'; id: string }
  | { type: 'SERVICES_LOADED'; items: ServiceState[] }
  | { type: 'SERVICE_UPDATED'; service: ServiceState }
  | { type: 'SERVICE_REMOVED'; id: string }
  | { type: 'TEMPLATES_LOADED'; kind: TemplateKind; items: Array<RoleTemplate | FileTemplate | DatabaseTemplate> }
  | { type: 'TEMPLATE_ADDED'; kind: TemplateKind; template: RoleTemplate | FileTemplate | DatabaseTemplate }
  | { type: 'TEMPLATE_UPDATED'; kind: TemplateKind; template: RoleTemplate | FileTemplate | DatabaseTemplate }
  | { type: 'TEMPLATE_REMOVED'; kind: TemplateKind; id: string }
  | { type: 'COMBOS_LOADED'; items: ToolCombo[] }
  | { type: 'PRESETS_LOADED'; items: PresetItem[] }
  | { type: 'TOOLS_LOADED'; items: ToolItem[] }
  | { type: 'MODELS_LOADED'; items: ModelItem[] }
  | { type: 'OPEN_FLOW'; flow: WorkflowDocument }
  | { type: 'OPEN_SERVICE'; service: ServiceState }
  | { type: 'OPEN_FLOW_TEMPLATE'; template: WorkflowTemplate }
  | { type: 'CLEAR_CANVAS' }
  | { type: 'GRAPH_REPLACED'; nodes: CanvasNode[]; edges: CanvasEdge[]; dirty: boolean }
  | { type: 'NODE_ADDED'; node: CanvasNode }
  | { type: 'NODE_MOVED'; id: string; position: { x: number; y: number } }
  | { type: 'NODE_REMOVED'; id: string }
  | { type: 'EDGE_ADDED'; edge: CanvasEdge }
  | { type: 'EDGE_REMOVED'; id: string }
  | { type: 'SELECT_NODE'; id: string }
  | { type: 'SELECT_EDGE'; id: string }
  | { type: 'SELECT_LIB'; kind: LibSelKind; id: string }
  | { type: 'SELECT_EDITOR'; editor: EditorRef }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'NODE_DATA_PATCH'; id: string; patch: Record<string, unknown> }
  | { type: 'EDGE_PATCH'; id: string; patch: Record<string, unknown> }
  | { type: 'DOC_PATCH'; patch: { name?: string; description?: string } }
  | { type: 'SET_DIRTY'; dirty: boolean }
  | { type: 'MARK_SAVED' }
  | { type: 'RUN_STARTED'; runId: string }
  | { type: 'RUN_SNAPSHOT'; snapshot: RunSnapshot }
  | { type: 'RUN_CLEARED' }
  | { type: 'TOAST_PUSH'; toast: ToastItem }
  | { type: 'TOAST_DROP'; id: string }
  | { type: 'SET_MESSAGE'; message: string }
  | { type: 'HISTORY_PUSH'; snapshot: GraphSnapshot }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PANELS_SET'; panels: Partial<PanelLayout> }
  | { type: 'CONFIRM_SET'; confirm: ConfirmState | null }
  | { type: 'HISTORY_OPEN'; open: boolean }
  | { type: 'RUN_HISTORY_LOADED'; items: RunSnapshot[] }
  | { type: 'RUN_HISTORY_SELECT'; id: string }
  | { type: 'COMBO_OPEN'; open: boolean }

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** 工作流文档/模板 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
export function flowToCanvas(flow: Pick<WorkflowDocument, 'nodes' | 'lines'>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    // 合并重复协作组节点（memberIds 并集），治愈历史数据的重复组节点，避免「删成员误删多个」
    nodes: consolidateGroups((flow.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position ?? { x: 120, y: 80 },
      data: (node as { data?: Record<string, unknown> }).data ?? {},
      // 虚拟节点顶层 proxySourceId 必须保留（Bug 2）：否则打开工作流后
      // 虚拟节点退化为孤儿，保存时后端校验报缺主引用。
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    }))),
    edges: (flow.lines ?? []).map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition ? { condition: line.condition } : {}),
    })),
  }
}

/** 服务文档 → 画布投影（与工作流同构）。 */
export function serviceToCanvas(service: ServiceState): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: consolidateGroups((service.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position ?? { x: 120, y: 80 },
      data: (node as { data?: Record<string, unknown> }).data ?? {},
      // 虚拟节点顶层 proxySourceId 保留（Bug 2，同 flowToCanvas）
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    }))),
    edges: (service.lines ?? []).map((line) => ({
      id: line.id,
      source: line.source,
      target: line.target,
      sourceHandle: line.sourceHandle,
      targetHandle: line.targetHandle,
      ...(line.condition ? { condition: line.condition } : {}),
    })),
  }
}

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
    default:
      return state
  }
}

/**
 * 当前图快照（撤销重做栈元素构造）。
 * 必须产出与 state.canvas 完全独立的副本：历史栈（past/future）保存的是
 * 「图标量」而非引用——若直接返回数组/对象引用，任何后续对 canvas 节点的
 * 原地修改（拖拽缓存、组件副作用）都会污染历史记录，undo/redo 退化为
 * 同一对象的覆盖式恢复（撤销失效）。考虑 node.data/edge.condition 为嵌套
 * 对象，逐层浅拷贝断开引用即可（元素内容不可变约定下即快照语义）。
 */
export function graphSnapshotOf(state: StudioState): GraphSnapshot {
  return {
    nodes: state.canvas.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })),
    edges: state.canvas.edges.map((edge) => ({
      ...edge,
      ...(edge.condition ? { condition: { ...edge.condition } } : {}),
    })),
  }
}

/**
 * 图快照是否一致（Bug 17 的 dirty 精确判定用）。
 * 快照元素均为「内容不可变」结构（节点位置/数据、连线/条件），
 * 直接序列化比较即可（节点/连线顺序即文档事实源顺序）。
 */
export function graphSnapshotsEqual(a: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null, b: GraphSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
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

// ---------------------------------------------------------------------------
// 选择器（派生数据；组件与 hooks 消费）
// ---------------------------------------------------------------------------

/** 当前工作流文档（内存列表优先；草稿回退）。 */
export function currentFlowOf(state: StudioState): WorkflowDocument | null {
  if (state.currentKind !== 'workflow' || !state.currentId) return null
  return state.workflows.find((flow) => flow.id === state.currentId) ?? null
}

/** 当前工作流模板文档（模板态画布）。 */
export function currentFlowTemplateOf(state: StudioState): WorkflowTemplate | null {
  if (state.currentKind !== 'flowTemplate' || !state.currentId) return null
  return state.flowTemplates.find((template) => template.id === state.currentId) ?? null
}

/** 当前服务文档。 */
export function currentServiceOf(state: StudioState): ServiceState | null {
  if (state.currentKind !== 'service' || !state.currentId) return null
  return state.services.find((service) => service.id === state.currentId) ?? null
}

/** 当前运行状态（running 判定）。 */
export function isRunningOf(state: StudioState): boolean {
  return state.run.snapshot?.status === 'running' || (state.run.runId !== null && state.run.snapshot === null)
}

/** 编辑器数据（右侧面板渲染源；Inspector 按 kind 分发表单）。 */
export interface EditorData {
  kind: 'workflow' | 'service' | 'role' | 'file' | 'database' | 'group' | 'stage' | 'proxy' | 'edge'
  data: Record<string, unknown>
  name: string
  template?: boolean
  templateId?: string
  /** 角色模板/节点是否为父代理（模式仅 preset + 高级项裁剪，§4.2.3.1）。 */
  isParent?: boolean
  /** 画布节点 id（node 来源编辑器）。 */
  nodeId?: string
  /** 虚拟节点主节点名称。 */
  mainLabel?: string
  /** 协作组成员（画布节点解析）。 */
  members?: Array<{ id: string; label: string }>
}

/** 编辑器数据（右侧面板渲染源）。 */
export function editorDataOf(state: StudioState): EditorData | null {
  const editor = state.editor
  if (!editor) return null
  if (editor.source === 'workflow') {
    const flow = state.workflows.find((item) => item.id === editor.id)
    return flow
      ? { kind: 'workflow', data: { name: flow.name, description: flow.description }, name: flow.name }
      : null
  }
  if (editor.source === 'flowTemplate') {
    const template = state.flowTemplates.find((item) => item.id === editor.id)
    return template
      ? { kind: 'workflow', data: { name: template.name, description: template.description }, name: template.name, template: true, templateId: template.id }
      : null
  }
  if (editor.source === 'service') {
    const service = state.services.find((item) => item.id === editor.id)
    return service
      ? { kind: 'service', data: { name: service.name, description: service.description }, name: service.name }
      : null
  }
  if (editor.source === 'template') {
    const template = state.templates[editor.kind].find((item) => item.id === editor.id)
    if (!template) return null
    const kind0 = editor.kind
    return {
      kind: kind0,
      data: template as unknown as Record<string, unknown>,
      name: String((template as { name?: unknown }).name ?? ''),
      templateId: template.id,
      template: true,
      isParent: kind0 === 'role' && (template as { kind?: unknown }).kind === 'parent',
    }
  }
  if (editor.source === 'node') {
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    if (!node) return null
    const data = node.data
    if (node.kind === 'parent' || node.kind === 'agent') {
      return { kind: 'role', data, name: String(data.label ?? ''), nodeId: node.id, isParent: node.kind === 'parent' }
    }
    if (node.kind === 'file') return { kind: 'file', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'database') return { kind: 'database', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'group') {
      // 去重展示（历史数据可能残留重复 memberIds），与删除逻辑保持一致，避免出现「重复成员行/计数虚高」
      const memberIds = [...new Set((data.memberIds as string[] | undefined) ?? [])]
      const members = memberIds.map((memberId) => {
        const member = state.canvas.nodes.find((item) => item.id === memberId)
        return { id: memberId, label: String((member?.data as { label?: unknown } | undefined)?.label ?? memberId) }
      })
      return { kind: 'group', data, name: String(data.label ?? ''), nodeId: node.id, members }
    }
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') return { kind: 'stage', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'proxy') {
      const sourceId = String((node as { proxySourceId?: unknown }).proxySourceId ?? '')
      const main = state.canvas.nodes.find((item) => item.id === sourceId)
      return {
        kind: 'proxy',
        data,
        name: '',
        nodeId: node.id,
        mainLabel: String((main?.data as { label?: unknown } | undefined)?.label ?? ''),
      }
    }
    return { kind: 'role', data, name: String(data.label ?? ''), nodeId: node.id }
  }
  if (editor.source === 'edge') {
    const edge = state.canvas.edges.find((item) => item.id === editor.id)
    return edge ? { kind: 'edge', data: edge as unknown as Record<string, unknown>, name: '' } : null
  }
  return null
}

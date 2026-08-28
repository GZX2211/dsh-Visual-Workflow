// src/client/studio/studio-actions.ts
//
// 工作台状态机的动作判别联合：数据加载、画布增删改、选中/编辑器、
// 运行/服务、撤销重做、面板/对话框/历史/组合等全部动作形态。仅类型，
// 无运行时值；由 studio-reducer 消费，hooks 层在 dispatch(action) 时构造。

import type {
  LibTab, LibSelKind, TemplateKind, CanvasNode, CanvasEdge, EditorRef,
  PanelLayout, ToastItem, PresetItem, ToolItem, ModelItem, GraphSnapshot, ConfirmState,
} from './studio-types.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type {
  ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, ToolCombo, RunSnapshot,
} from '../../host/shared/types.js'

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

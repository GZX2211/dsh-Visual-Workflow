import type { WorkflowDocument, GraphNode, Line } from '../../host/shared/graph-model.js';
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, ToolCombo, RunSnapshot } from '../../host/shared/types.js';
/** 左侧栏 Tab。 */
export type LibTab = 'workflow' | 'role' | 'file' | 'database';
/** 模板种类（与后端 listTemplates 契约一致）。 */
export type TemplateKind = 'role' | 'file' | 'database';
/** 画布节点投影（位置/数据全量内联）。 */
export interface CanvasNode {
    id: string;
    kind: GraphNode['kind'];
    position: {
        x: number;
        y: number;
    };
    data: Record<string, unknown>;
}
/** 画布连线投影（条件标签由条件类型生成）。 */
export interface CanvasEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle: Line['sourceHandle'];
    targetHandle: Line['targetHandle'];
    condition?: Line['condition'];
}
/** 图快照（撤销重做栈元素）。 */
export interface GraphSnapshot {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}
/** 编辑器引用（右侧面板编辑对象）。 */
export type EditorRef = {
    source: 'workflow';
    id: string;
} | {
    source: 'service';
    id: string;
} | {
    source: 'template';
    kind: TemplateKind;
    id: string;
} | {
    source: 'node';
    id: string;
} | {
    source: 'edge';
    id: string;
} | null;
/** 对话框状态（未保存守卫/确认/导入冲突）。 */
export interface ConfirmState {
    kind: 'unsaved' | 'confirmText' | 'importConflict';
    title?: string;
    message?: string;
    /** 确认后的回调（未保存守卫：保存/放弃后继续执行）。 */
    proceed?: () => void;
    /** 确认回调（confirmText）。 */
    onConfirm?: () => void;
}
/** 轻提示。 */
export interface ToastItem {
    id: string;
    kind: 'info' | 'success' | 'error';
    text: string;
}
/** 面板几何（localStorage 持久化由 usePanelLayout 负责）。 */
export interface PanelLayout {
    leftOpen: boolean;
    leftWidth: number;
    rightOpen: boolean;
    rightWidth: number;
}
export interface StudioState {
    /** 绑定的会话 id（T-042：会话绑定，不提供下拉）。 */
    sessionId: string;
    /** 左侧栏 Tab。 */
    libTab: LibTab;
    /** 当前编辑对象模式（新建草稿的默认模式）。 */
    mode: 'mode1' | 'mode2';
    workflows: WorkflowDocument[];
    services: ServiceState[];
    templates: Record<TemplateKind, Array<RoleTemplate | FileTemplate | DatabaseTemplate>>;
    combos: ToolCombo[];
    presets: unknown[];
    tools: unknown[];
    models: unknown[];
    /** 当前画布对象（工作流或服务）。 */
    currentId: string | null;
    currentKind: 'workflow' | 'service' | null;
    canvas: {
        nodes: CanvasNode[];
        edges: CanvasEdge[];
    };
    selection: {
        nodeId: string | null;
        edgeId: string | null;
        lib: {
            kind: LibTab | 'service';
            id: string;
        } | null;
    };
    editor: EditorRef;
    dirty: boolean;
    run: {
        runId: string | null;
        snapshot: RunSnapshot | null;
    };
    toasts: ToastItem[];
    message: string;
    history: {
        past: GraphSnapshot[];
        future: GraphSnapshot[];
    };
    panels: PanelLayout;
    confirm: ConfirmState | null;
    historyOpen: boolean;
    runHistory: RunSnapshot[];
    selectedRunId: string | null;
    comboOpen: boolean;
    servicesOpen: boolean;
    importBusy: boolean;
}
/** 撤销重做栈上限（旧项目 HISTORY_LIMIT）。 */
export declare const HISTORY_LIMIT = 60;
/** 初始面板几何。 */
export declare function defaultPanels(): PanelLayout;
/** 初始状态（会话 id 由调用方注入）。 */
export declare function createInitialState(sessionId: string): StudioState;
export type StudioAction = {
    type: 'SET_SESSION';
    sessionId: string;
} | {
    type: 'SET_MODE';
    mode: 'mode1' | 'mode2';
} | {
    type: 'SET_LIB_TAB';
    tab: LibTab;
} | {
    type: 'WORKFLOWS_LOADED';
    items: WorkflowDocument[];
} | {
    type: 'WORKFLOW_ADDED';
    flow: WorkflowDocument;
} | {
    type: 'WORKFLOW_UPDATED';
    flow: WorkflowDocument;
} | {
    type: 'WORKFLOW_REMOVED';
    id: string;
} | {
    type: 'SERVICES_LOADED';
    items: ServiceState[];
} | {
    type: 'SERVICE_UPDATED';
    service: ServiceState;
} | {
    type: 'SERVICE_REMOVED';
    id: string;
} | {
    type: 'TEMPLATES_LOADED';
    kind: TemplateKind;
    items: Array<RoleTemplate | FileTemplate | DatabaseTemplate>;
} | {
    type: 'TEMPLATE_ADDED';
    kind: TemplateKind;
    template: RoleTemplate | FileTemplate | DatabaseTemplate;
} | {
    type: 'TEMPLATE_UPDATED';
    kind: TemplateKind;
    template: RoleTemplate | FileTemplate | DatabaseTemplate;
} | {
    type: 'TEMPLATE_REMOVED';
    kind: TemplateKind;
    id: string;
} | {
    type: 'COMBOS_LOADED';
    items: ToolCombo[];
} | {
    type: 'PRESETS_LOADED';
    items: unknown[];
} | {
    type: 'TOOLS_LOADED';
    items: unknown[];
} | {
    type: 'MODELS_LOADED';
    items: unknown[];
} | {
    type: 'OPEN_FLOW';
    flow: WorkflowDocument;
} | {
    type: 'OPEN_SERVICE';
    service: ServiceState;
} | {
    type: 'CLEAR_CANVAS';
} | {
    type: 'GRAPH_REPLACED';
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    dirty: boolean;
} | {
    type: 'NODE_ADDED';
    node: CanvasNode;
} | {
    type: 'NODE_MOVED';
    id: string;
    position: {
        x: number;
        y: number;
    };
} | {
    type: 'NODE_REMOVED';
    id: string;
} | {
    type: 'EDGE_ADDED';
    edge: CanvasEdge;
} | {
    type: 'EDGE_REMOVED';
    id: string;
} | {
    type: 'SELECT_NODE';
    id: string;
} | {
    type: 'SELECT_EDGE';
    id: string;
} | {
    type: 'SELECT_LIB';
    kind: LibTab;
    id: string;
} | {
    type: 'SELECT_EDITOR';
    editor: EditorRef;
} | {
    type: 'CLEAR_SELECTION';
} | {
    type: 'SET_DIRTY';
    dirty: boolean;
} | {
    type: 'RUN_STARTED';
    runId: string;
} | {
    type: 'RUN_SNAPSHOT';
    snapshot: RunSnapshot;
} | {
    type: 'RUN_CLEARED';
} | {
    type: 'TOAST_PUSH';
    toast: ToastItem;
} | {
    type: 'TOAST_DROP';
    id: string;
} | {
    type: 'SET_MESSAGE';
    message: string;
} | {
    type: 'HISTORY_PUSH';
    snapshot: GraphSnapshot;
} | {
    type: 'UNDO';
} | {
    type: 'REDO';
} | {
    type: 'PANELS_SET';
    panels: Partial<PanelLayout>;
} | {
    type: 'CONFIRM_SET';
    confirm: ConfirmState | null;
} | {
    type: 'HISTORY_OPEN';
    open: boolean;
} | {
    type: 'RUN_HISTORY_LOADED';
    items: RunSnapshot[];
} | {
    type: 'RUN_HISTORY_SELECT';
    id: string;
} | {
    type: 'COMBO_OPEN';
    open: boolean;
} | {
    type: 'SERVICES_OPEN';
    open: boolean;
} | {
    type: 'IMPORT_BUSY';
    busy: boolean;
};
/** 工作流文档 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
export declare function flowToCanvas(flow: WorkflowDocument): {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
};
/** 服务文档 → 画布投影（与工作流同构）。 */
export declare function serviceToCanvas(service: ServiceState): {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
};
export declare function studioReducer(state: StudioState, action: StudioAction): StudioState;
/** 当前图快照（撤销重做栈元素构造）。 */
export declare function graphSnapshotOf(state: StudioState): GraphSnapshot;
/** 当前工作流文档（内存列表优先；草稿回退）。 */
export declare function currentFlowOf(state: StudioState): WorkflowDocument | null;
/** 当前服务文档。 */
export declare function currentServiceOf(state: StudioState): ServiceState | null;
/** 当前运行状态（running 判定）。 */
export declare function isRunningOf(state: StudioState): boolean;
/** 编辑器数据（右侧面板渲染源）。 */
export declare function editorDataOf(state: StudioState): {
    kind: 'workflow' | 'service' | TemplateKind | 'edge';
    data: Record<string, unknown>;
    name: string;
    templateId?: string;
    template?: boolean;
} | null;

import type { WorkflowDocument, GraphNode, Line, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate, ToolCombo, RunSnapshot } from '../../host/shared/types.js';
/** 左侧栏 Tab（需求 §4.5.4：工作流 / 角色 / 数据（文件+数据库）/ 其他（阶段+协作组））。 */
export type LibTab = 'workflow' | 'role' | 'data' | 'other';
/** 左侧库选中种类（模板 kind + 固定卡片 + 工作流模板）。 */
export type LibSelKind = 'workflow' | 'service' | 'workflowTemplate' | 'role' | 'file' | 'database' | 'parentTemplate' | 'stage' | 'groupTemplate';
/** 模板种类（与后端 listTemplates 契约一致；group 为协作组模板，需求 §4.2.5.2）。 */
export type TemplateKind = 'role' | 'file' | 'database' | 'group';
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
/** 生态枚举条目（对齐后端 presets 端点返回结构）。 */
export interface PresetItem {
    id: string;
    name?: string;
    description?: string;
    trust?: string;
}
/** 生态枚举条目（对齐后端 tools 端点返回结构）。 */
export interface ToolItem {
    name: string;
    description: string;
}
/** 生态模型条目（对齐后端 models 端点返回结构：provider/model + 思考强度档位）。 */
export interface ModelItem {
    provider: string;
    model: string;
    efforts?: Array<{
        id: string;
        name: string;
    }>;
}
/**
 * 本地草稿标记（前端 UI 状态，绝不落盘——后端 put* 端点经 stripClientMeta 剥除）。
 * 以交叉类型表达「带草稿标记的持久化对象」，替代旧实现
 * `...({ _draft: true } as object)` + `as unknown as X` 的双重类型逃逸
 * （后者完全绕过类型检查，掩盖数据模型不一致）。
 */
export type Drafted<T> = T & {
    _draft: true;
};
/** 编辑器引用（右侧面板编辑对象）。 */
export type EditorRef = {
    source: 'workflow';
    id: string;
} | {
    source: 'service';
    id: string;
} | {
    source: 'flowTemplate';
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
    /** 确认按钮文案（confirmText 定制；缺省"删除"）。 */
    confirmLabel?: string;
    /** 导入冲突补充：导入类型（workflow/agent）。 */
    kind2?: string;
    /** 导入冲突补充：原始 JSON 文本。 */
    json?: string;
    /** 导入冲突补充：已存在名称。 */
    name?: string;
}
/** 轻提示。 */
export interface ToastItem {
    id: string;
    kind: 'info' | 'success' | 'error';
    text: string;
}
/** 面板几何（localStorage 持久化由 usePanelLayout 负责）。
 * 左栏/底栏显隐由「折叠切换循环位置 mode」（0..5）推导，右侧属性栏显隐由
 * 选中对象是否具备属性推导（见 studio-selectors.inspectorOpenOf）。
 * 本次改造：折叠按钮不再控制右侧栏，只控制左栏/底栏的展开、折叠、切换（6 态循环）。 */
export interface PanelLayout {
    /** 折叠/切换循环位置 0..5：
     *  0=左栏展开 1=底栏展开 2=底栏收起(全隐) 3=底栏展开 4=左栏展开 5=左栏收起(全隐)。
     *  默认 0（左栏展开）；next = (mode + 1) % 6。 */
    mode: number;
    leftWidth: number;
    rightWidth: number;
    /** 底栏高度（px）。 */
    bottomHeight: number;
}
export interface StudioState {
    /** 绑定的会话 id（T-042：会话绑定，不提供下拉）。
     *  工作台全局化改版：这是「当前主会话」（会话树根），仅用于——① 实例列表
     *  「当前」标签；② 进入工作台时画布默认选中；③ 未勾选新会话时创建实例的
     *  目标会话。**不再**作为实例列表的过滤条件（列表为全部会话实例）。 */
    sessionId: string;
    /** 左侧栏 Tab。 */
    libTab: LibTab;
    /** 当前编辑对象模式（新建草稿的默认模式）。 */
    mode: 'mode1' | 'mode2';
    workflows: WorkflowDocument[];
    services: ServiceState[];
    /** 全部会话的活跃 run 摘要（工作台全局化：实例列表状态徽标；running/paused 保留锁）。 */
    activeRuns: Array<{
        flowId: string;
        sessionId: string;
        status: string;
        runId: string;
    }>;
    /**
     * 「从模板创建实例」的一次性临时选项（模板态画布上方「开启新会话」复选框 +
     * 工作区输入框；不持久化到模板/实例文档，创建实例时消费：
     *   - newSession=true → 先新建主会话（createSession 端点），实例绑定该新会话；
     *   - newSession=false → 当前主会话，目标会话已有实例时弹覆盖确认。
     */
    instanceOptions: {
        newSession: boolean;
        workspacePath: string;
    };
    /** 工作流模板列表（全局共享；部分仅含当前 mode 的模板，模板拖入画布后经「创建实例」转实例）。 */
    flowTemplates: WorkflowTemplate[];
    templates: Record<TemplateKind, Array<RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate>>;
    combos: ToolCombo[];
    presets: PresetItem[];
    tools: ToolItem[];
    models: ModelItem[];
    /** 当前画布对象（工作流/服务实例，或工作流模板）。 */
    currentId: string | null;
    currentKind: 'workflow' | 'service' | 'flowTemplate' | null;
    canvas: {
        nodes: CanvasNode[];
        edges: CanvasEdge[];
    };
    selection: {
        nodeId: string | null;
        edgeId: string | null;
        lib: {
            kind: LibSelKind;
            id: string;
        } | null;
    };
    editor: EditorRef;
    /** 未保存修改标记（§4.5.9 未保存守卫）。 */
    dirty: boolean;
    /** 最近一次「已保存」的画布图快照：打开文档/保存成功时更新；
     *  UNDO/REDO 用它精确判定是否回到已保存状态（Bug 17——避免撤销回初始
     *  保存状态仍被误判为未保存而弹确认框）。 */
    savedGraph: GraphSnapshot | null;
    run: {
        runId: string | null;
        sessionId: string | null;
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
    /** 定时任务管理弹层开关（新功能本阶段；与组合管理并列入口）。 */
    schedulerOpen: boolean;
}
/** 编辑器数据（右侧面板渲染源；Inspector 按 kind 分发表单）。 */
export interface EditorData {
    kind: 'workflow' | 'service' | 'role' | 'file' | 'database' | 'group' | 'stage' | 'proxy' | 'edge';
    data: Record<string, unknown>;
    name: string;
    template?: boolean;
    templateId?: string;
    /** 角色模板/节点是否为父代理（模式仅 preset + 高级项裁剪，§4.2.3.1）。 */
    isParent?: boolean;
    /** 画布节点 id（node 来源编辑器）。 */
    nodeId?: string;
    /** 虚拟节点主节点名称。 */
    mainLabel?: string;
    /** 协作组成员（画布节点解析）。 */
    members?: Array<{
        id: string;
        label: string;
    }>;
}

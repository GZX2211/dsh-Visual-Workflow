import type { Dispatch } from 'react';
import type { Dict } from '../i18n.js';
import type { StudioAction, StudioState, EditorData, CanvasEdge, LibrarySource } from './studio-state.js';
import type { DocumentActionsFace } from '../hooks/useDocumentActions.js';
import type { AssetsFace } from '../hooks/useAssets.js';
import type { CanvasActionsFace } from '../hooks/useCanvasActions.js';
import type { EditorActionsFace } from '../hooks/useEditorActions.js';
import type { RunActionsFace } from '../hooks/useRunActions.js';
import type { StudioTransferFace } from '../hooks/useStudioTransfer.js';
import type { LibraryDragFace } from '../hooks/useLibraryDrag.js';
import type { SelectionFace } from '../hooks/useSelection.js';
import type { GraphHistoryFace } from '../hooks/useGraphHistory.js';
import type { UnsavedGuardFace } from '../hooks/useUnsavedGuard.js';
import type { PanelLayoutFace } from '../hooks/usePanelLayout.js';
import type { RemoteFace } from '../hooks/useRemote.js';
import type { ToastFace } from '../hooks/useToast.js';
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { GroupTemplate, RoleTemplate, ServiceState } from '../../host/shared/types.js';
import type { runStatusMap, runningNodeIds } from '../lib/run-status-map.js';
import type { stageTemplateKinds } from '../lib/graph-handles.js';
import type { CanvasApi } from '../components/canvas/GraphCanvas.js';
export interface StudioLayoutProps {
    t: Dict;
    state: StudioState;
    sessionId: string;
    remote: RemoteFace;
    currentFlow: WorkflowDocument | null;
    currentService: ServiceState | null;
    currentFlowTemplate: WorkflowTemplate | null;
    editorData: EditorData | null;
    edgeList: CanvasEdge[];
    stageKinds: ReturnType<typeof stageTemplateKinds>;
    parentTemplate: RoleTemplate | null;
    roleTemplates: RoleTemplate[];
    groupTemplates: GroupTemplate[];
    toolbarRunning: boolean;
    runStatusByNode: ReturnType<typeof runStatusMap>;
    highlightedNodeIds: ReturnType<typeof runningNodeIds>;
    /** 运行中锁定项（已完成/执行中流程）：节点锁角标、连线灰化虚线、连线点击不选中。 */
    lockedNodeIds: ReadonlySet<string>;
    lockedEdgeIds: ReadonlySet<string>;
    /** 当前实例是否运行中（模式一）：决定「清空」是否禁用等运行态交互。 */
    instanceRunning: boolean;
    modeName: (presetId: string | null | undefined) => string;
    /** 画布左上角工作流名称角标（实例/模板 + 名称）。 */
    canvasCaption: string;
    /** 外部导入兼容问题的悬停详情。 */
    canvasCaptionTitle?: string;
    leftOpen: boolean;
    bottomOpen: boolean;
    inspectorOpen: boolean;
    canvasApiRef: React.RefObject<CanvasApi | null>;
    canvasShellRef: React.RefObject<HTMLDivElement | null>;
    libraryImportRef: React.RefObject<HTMLInputElement | null>;
    personaInputRef: React.RefObject<HTMLInputElement | null>;
    groupMdInputRef: React.RefObject<HTMLInputElement | null>;
    dispatch: Dispatch<StudioAction>;
    doc: DocumentActionsFace;
    /** 资产面（左栏资产列表/资产态画布打开；入库/版本/回滚/退役由 T6 在属性栏接线）。 */
    assets: AssetsFace;
    canvas: CanvasActionsFace;
    editor: EditorActionsFace;
    run: RunActionsFace;
    transfer: StudioTransferFace;
    selection: SelectionFace;
    history: GraphHistoryFace;
    guard: UnsavedGuardFace;
    panels: PanelLayoutFace;
    toast: ToastFace['toast'];
    beginLibraryDrag: LibraryDragFace['beginLibraryDrag'];
    dragPreview: LibraryDragFace['dragPreview'];
    dropGroupId: LibraryDragFace['dropGroupId'];
    modeMenuOpen: boolean;
    setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    switchMode: (mode: 'mode1' | 'mode2') => void;
    /** 运行联动：宿主让出空间（官方右侧 Sidebar 全屏时缩回）+ 折叠自身左右栏 + 触发运行。 */
    handleRun: () => void;
    /** 库来源切换（模版 / 资产；未保存守卫后同时切库来源与画布文档类型）。 */
    onSetLibrarySource: (source: LibrarySource) => void;
    /** 打开工作流资产为画布文档（资产态；未保存守卫后切换）。 */
    onSelectFlowAsset: (assetId: string) => void;
    /** 角色资产拖入画布（装配层先装载详情，再生成内联角色节点）。 */
    onPlaceRoleAsset: (assetId: string, position: {
        x: number;
        y: number;
    }) => void;
    /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用）。 */
    panelsCollapsed: boolean;
    /** 顶部一键折叠/展开左右侧栏回调。 */
    onTogglePanels: () => void;
}
/** 工作台渲染层（JSX 组合 + 自动布局接线与弹层装配；数据/回调全部来自 props）。 */
export declare function StudioLayout(props: StudioLayoutProps): import("react").JSX.Element;

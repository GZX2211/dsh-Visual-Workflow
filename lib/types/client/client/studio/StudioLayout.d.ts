import type { Dispatch } from 'react';
import type { Dict } from '../i18n.js';
import type { StudioAction, StudioState, EditorData, CanvasEdge } from './studio-state.js';
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
import type { LeftPanelProps } from '../components/sidebar/LeftPanel.js';
/**
 * 左栏/底栏共用的库内容 props：即左栏 props 去掉「显示布局」相关字段
 * （open/width 与底栏的 open/height 各自由所在布局传入）与词典。
 * 词典不并入的原因：t 的引用不必跨渲染稳定，并入会让整份库 props 随词典重建，
 * 下游记忆化边界反而失效；两个面板各自显式取本布局持有的 t。
 */
export type StudioLibraryProps = Omit<LeftPanelProps, 'open' | 'width' | 'copy'>;
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
    /** P4 父代理补丁角标：由装配层按 state 记忆化，同一 state 下重渲染保持引用恒等。 */
    agentPatchedNodeIds: string[];
    /** 左栏/底栏共用的库内容 props（装配层已记忆化：同一 state 下引用恒等）。 */
    libraryProps: StudioLibraryProps;
    /** 运行中锁定项（已完成/执行中流程）：节点锁角标、连线灰化虚线、连线点击不选中。 */
    lockedNodeIds: ReadonlySet<string>;
    lockedEdgeIds: ReadonlySet<string>;
    /** 当前实例是否运行中（模式一）：决定「清空」是否禁用等运行态交互。 */
    instanceRunning: boolean;
    modeName: (presetId: string | null | undefined) => string;
    /** 画布左上角工作流名称角标（实例/模板 + 名称）。 */
    canvasCaption: string;
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
    /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用）。 */
    panelsCollapsed: boolean;
    /** 顶部一键折叠/展开左右侧栏回调。 */
    onTogglePanels: () => void;
}
/** 工作台渲染层（JSX 组合 + 自动布局接线与弹层装配；数据/回调全部来自 props）。 */
export declare function StudioLayout(props: StudioLayoutProps): import("react").JSX.Element;

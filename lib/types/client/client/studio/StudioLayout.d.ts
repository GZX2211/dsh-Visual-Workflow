import type { Dispatch } from 'react';
import type { Dict } from '../i18n.js';
import type { StudioAction, StudioState, EditorData } from './studio-state.js';
import type { DocumentActionsFace } from '../hooks/useDocumentActions.js';
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
import type { flowToCanvasLines, runStatusMap, runningNodeIds, stageTemplateKinds } from '../lib/graph-model.js';
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
    edgeList: ReturnType<typeof flowToCanvasLines>;
    stageKinds: ReturnType<typeof stageTemplateKinds>;
    parentTemplate: RoleTemplate | null;
    roleTemplates: RoleTemplate[];
    groupTemplates: GroupTemplate[];
    toolbarRunning: boolean;
    runStatusByNode: ReturnType<typeof runStatusMap>;
    highlightedNodeIds: ReturnType<typeof runningNodeIds>;
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
/** 工作台渲染层（纯 JSX 组合；回调/数据全部来自 props）。 */
export declare function StudioLayout(props: StudioLayoutProps): import("react").JSX.Element;

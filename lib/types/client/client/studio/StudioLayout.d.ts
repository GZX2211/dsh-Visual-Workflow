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
    /** 窗口关闭回调（标题栏 ×；浮窗宿主注入；对话视图挂载无关闭）。 */
    onClose?: () => void;
    /** 窗口拖动把手回调（浮窗注入；工作台标题顶栏兼任窗口标题栏拖动）。 */
    onTitlebarDrag?: (event: React.PointerEvent) => void;
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
    requestClose: () => void;
    /** 视图模式（浮窗/分栏）。 */
    viewMode?: 'float' | 'split';
    /** 标题栏窗口切换按钮回调（float↔split）。 */
    onToggleView?: () => void;
    /** 运行联动：切分栏 + 折叠自身左右栏 + 触发运行。 */
    handleRun: () => void;
    /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用）。 */
    panelsCollapsed: boolean;
    /** 顶部一键折叠/展开左右侧栏回调。 */
    onTogglePanels: () => void;
}
/** 工作台渲染层（纯 JSX 组合；回调/数据全部来自 props）。 */
export declare function StudioLayout(props: StudioLayoutProps): import("react").JSX.Element;

import type { Dispatch } from 'react';
import type { LibSelKind, StudioAction, StudioState } from '../studio/studio-state.js';
import type { WorkflowsFace } from './useWorkflows.js';
import type { FlowTemplatesFace } from './useFlowTemplates.js';
import type { TemplatesFace } from './useTemplates.js';
import type { SelectionFace } from './useSelection.js';
import type { RemoteFace } from './useRemote.js';
import type { ToastFace } from './useToast.js';
import type { DocumentActionsFace } from './useDocumentActions.js';
import type { CanvasActionsFace } from './useCanvasActions.js';
import type { RunLockSet } from '../lib/run-locks.js';
import type { Dict } from '../i18n.js';
export interface EditorActionsFace {
    selectLibraryCard(kind: LibSelKind, id: string): void;
    patchEditor(patch: Record<string, unknown>): void;
    saveEditor(): Promise<void>;
    deleteEditor(): Promise<void>;
}
/** 编辑器面外部依赖（运行中画布锁定判定）。 */
export interface EditorActionsOptions {
    /** 运行中锁定集：被锁连线的字段编辑直接忽略（防「运行前已选中」的旁路改写）。 */
    locks: RunLockSet;
}
/** 编辑器面（保存/删除失败 toast；节点/连线删除复用画布面）。 */
export declare function useEditorActions(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, workflows: WorkflowsFace, flowTemplates: FlowTemplatesFace, templates: TemplatesFace, selection: SelectionFace, remote: RemoteFace, saveCanvas: DocumentActionsFace['saveCanvas'], removeSelected: CanvasActionsFace['removeSelected'], removeLine: CanvasActionsFace['removeLine'], selectWorkflow: DocumentActionsFace['selectWorkflow'], selectFlowTemplate: DocumentActionsFace['selectFlowTemplate'], options: EditorActionsOptions): EditorActionsFace;

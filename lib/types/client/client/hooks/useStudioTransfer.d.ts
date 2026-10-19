import type { Dispatch } from 'react';
import type { EditorData, StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
import type { WorkflowsFace } from './useWorkflows.js';
import type { FlowTemplatesFace } from './useFlowTemplates.js';
import type { TemplatesFace } from './useTemplates.js';
import type { ToastFace } from './useToast.js';
import type { EditorActionsFace } from './useEditorActions.js';
import type { Dict } from '../i18n.js';
export interface StudioTransferFace {
    exportCurrent(): Promise<void>;
    handleImportFile(file: File | null): Promise<void>;
    resolveImportConflict(mode: 'rename' | 'overwrite'): Promise<void>;
    loadPersonaMd(): void;
    onPersonaMdSelected(file: File | null): Promise<void>;
    loadGroupMd(): void;
    onGroupMdSelected(file: File | null): Promise<void>;
    /** 任务描述追加文件路径（只写路径文本，不读取/上传文件内容）。 */
    pickFiles(picked: File[]): void;
    testDbConnection(): Promise<void>;
}
/** 导入导出与任务/数据库交互面（远端失败抛错，由调用方 toast）。 */
export declare function useStudioTransfer(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, remote: RemoteFace, templates: TemplatesFace, flowTemplates: FlowTemplatesFace, workflows: WorkflowsFace, patchEditor: EditorActionsFace['patchEditor'], editorData: EditorData | null, personaInputRef: React.RefObject<HTMLInputElement | null>, groupMdInputRef: React.RefObject<HTMLInputElement | null>, 
/**
 * 宿主接入层注入的文件路径解析器（桌面端走官方 __DSH_HOST_PATHS__.pathFor）。
 * 缺省回退旧 File.path / 文件名：浏览器安全模型下拿不到本地绝对路径。
 */
resolveFilePath?: (file: File) => string): StudioTransferFace;

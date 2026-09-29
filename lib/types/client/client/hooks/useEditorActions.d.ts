import type { Dispatch } from 'react';
import type { AssetKind, RoleAssetSummary, WorkflowAssetSummary } from '../../host/shared/asset-types.js';
import type { LibSelKind, StudioAction, StudioState } from '../studio/studio-state.js';
import type { WorkflowsFace } from './useWorkflows.js';
import type { FlowTemplatesFace } from './useFlowTemplates.js';
import type { TemplatesFace } from './useTemplates.js';
import type { SelectionFace } from './useSelection.js';
import type { RemoteFace } from './useRemote.js';
import type { ToastFace } from './useToast.js';
import type { DocumentActionsFace } from './useDocumentActions.js';
import type { CanvasActionsFace } from './useCanvasActions.js';
import type { AssetsFace } from './useAssets.js';
import type { ExperiencesFace } from './useExperiences.js';
import type { RunLockSet } from '../lib/run-locks.js';
import type { Dict } from '../i18n.js';
export interface EditorActionsFace {
    selectLibraryCard(kind: LibSelKind, id: string): void;
    patchEditor(patch: Record<string, unknown>): void;
    /**
     * 保存当前编辑对象（实例/模版/资产）：返回非 null/undefined = 本次已真实落库。
     * 未保存守卫「保存并继续」据此接续原操作（需要二次确认的路径本次返回 null，
     * 由 onSaved 在真实落库后转达）。
     */
    saveEditor(options?: {
        onSaved?: () => void;
    }): Promise<unknown>;
    deleteEditor(): Promise<void>;
    /** 模版 → 资产入库（先保存模版；保存未落库即中止）。 */
    promoteEditor(): Promise<void>;
    /** 模版态「入库」是否锁定（已入库且模版内容未再修改）。 */
    promoteLocked: boolean;
    /** 打开资产版本上拉列表（回滚选择）。 */
    openAssetVersions(): Promise<void>;
    /** 回滚到历史版本（只改 Active 指针）；无论成败都收起列表。 */
    rollbackAssetVersion(versionId: number): Promise<void>;
}
/** 编辑器面外部依赖（运行中画布锁定判定）。 */
export interface EditorActionsOptions {
    /** 运行中锁定集：被锁连线的字段编辑直接忽略（防「运行前已选中」的旁路改写）。 */
    locks: RunLockSet;
}
/**
 * 模版态「入库」目标（纯函数）：工作流模版 → workflow、角色模版 → role；
 * 其余模版（文件/数据库/协作组）与实例态/资产态均无入库目标（返回 null）。
 */
export declare function promoteTargetOf(state: StudioState): {
    kind: AssetKind;
    templateId: string;
} | null;
/**
 * 入库按钮锁定判据（纯函数）：该模版已入库，且模版内容自入库起未再修改。
 * 判据 = 资产条目 sourceTemplateId 命中当前模版，且入库时指纹（sourceFingerprint）
 * 与模版当前指纹（currentTemplateFingerprint）相等；模版已删除（指纹缺失）视为未锁定
 * ——此时按「可入库」放行，由后端按模版不存在报错。
 */
export declare function isPromoteLocked(summaries: ReadonlyArray<Pick<WorkflowAssetSummary | RoleAssetSummary, 'sourceTemplateId' | 'sourceFingerprint' | 'currentTemplateFingerprint'>>, templateId: string): boolean;
/** 当前模版态的入库锁定（无入库目标 → 未锁定）。 */
export declare function promoteLockedOf(state: StudioState): boolean;
/** 编辑器面（保存/删除失败 toast；节点/连线删除复用画布面）。 */
export declare function useEditorActions(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, workflows: WorkflowsFace, flowTemplates: FlowTemplatesFace, templates: TemplatesFace, assets: AssetsFace, experiences: ExperiencesFace, selection: SelectionFace, remote: RemoteFace, saveCanvas: DocumentActionsFace['saveCanvas'], removeSelected: CanvasActionsFace['removeSelected'], removeLine: CanvasActionsFace['removeLine'], selectWorkflow: DocumentActionsFace['selectWorkflow'], selectFlowTemplate: DocumentActionsFace['selectFlowTemplate'], options: EditorActionsOptions): EditorActionsFace;

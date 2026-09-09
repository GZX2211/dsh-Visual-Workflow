import type { Dispatch } from 'react';
import type { WorkflowDocument } from '../../host/shared/graph-model.js';
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface WorkflowsFace {
    loadWorkflows(): Promise<void>;
    /** 新建本地草稿（_draft 标记；首次保存时真正入库）。 */
    createWorkflowDraft(name: string): WorkflowDocument;
    /** 保存画布（草稿入库 / 正式带 revision 更新）。 */
    saveWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowDocument | null>;
    deleteWorkflow(id: string): Promise<void>;
    openFlow(flow: WorkflowDocument): void;
}
/** 画布 → 文档序列化（节点/连线直接映射；P12 图模型接管完整归一化）。 */
export declare function serializeWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowDocument;
/** 工作流列表面（远端失败抛错，由调用方 toast）。 */
export declare function useWorkflows(dispatch: Dispatch<StudioAction>, remote: RemoteFace, sessionId: string): WorkflowsFace;

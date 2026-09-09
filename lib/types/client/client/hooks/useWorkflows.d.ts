import type { Dispatch } from 'react';
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface WorkflowsFace {
    /** 加载工作流实例列表（全部会话）；返回加载的条目（供「进入工作台自动选中实例」复用）。 */
    loadWorkflows(): Promise<WorkflowDocument[]>;
    /** 新建本地草稿（_draft 标记；首次保存时真正入库；目标会话 = 当前主会话）。 */
    createWorkflowDraft(name: string, sessionId: string): WorkflowDocument;
    /** 保存画布（草稿入库 / 正式带 revision 更新）。 */
    saveWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowDocument | null>;
    /**
     * 模板 → 实例：深拷贝模板内容创建实例草图（绑定目标会话；不落盘，由调用方
     * saveWorkflow）。「开启新会话/工作区」为一次性临时选项，不继承到实例文档。
     */
    instantiateFromTemplate(template: WorkflowTemplate, targetSessionId: string): WorkflowDocument;
    deleteWorkflow(flow: WorkflowDocument): Promise<void>;
    openFlow(flow: WorkflowDocument): void;
}
/** 画布 → 文档序列化（节点/连线直接映射；P12 图模型接管完整归一化）。 */
export declare function serializeWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowDocument;
/** 工作流列表面（远端失败抛错，由调用方 toast）。 */
export declare function useWorkflows(dispatch: Dispatch<StudioAction>, remote: RemoteFace): WorkflowsFace;

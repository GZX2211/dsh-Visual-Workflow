import type { Dispatch } from 'react';
import type { WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface FlowTemplatesFace {
    loadFlowTemplates(): Promise<void>;
    /** 新建本地模板草稿（_draft 标记；首次保存时真正入库）。 */
    createFlowTemplateDraft(mode: 'mode1' | 'mode2'): WorkflowTemplate;
    /** 保存模板（画布节点/连线序列化后入库；草稿首存保持 id）。 */
    saveFlowTemplate(template: WorkflowTemplate, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowTemplate | null>;
    deleteFlowTemplate(id: string): Promise<void>;
    openFlowTemplate(template: WorkflowTemplate): void;
}
/** 画布 → 模板序列化（与 serializeWorkflow 同构）。 */
export declare function serializeFlowTemplate(template: WorkflowTemplate, nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowTemplate;
/** 工作流模板列表面（远端失败抛错，由调用方 toast）。 */
export declare function useFlowTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): FlowTemplatesFace;

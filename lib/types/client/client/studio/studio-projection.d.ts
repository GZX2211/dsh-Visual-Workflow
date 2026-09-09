import type { CanvasEdge, CanvasNode } from './studio-types.js';
import type { WorkflowDocument } from '../../host/shared/graph-model.js';
import type { ServiceState } from '../../host/shared/types.js';
/** 工作流文档/模板 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
export declare function flowToCanvas(flow: Pick<WorkflowDocument, 'nodes' | 'lines'>): {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
};
/** 服务文档 → 画布投影（与工作流同构）。 */
export declare function serviceToCanvas(service: ServiceState): {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
};

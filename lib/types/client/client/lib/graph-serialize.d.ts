import type { WorkflowDocument } from '../../host/shared/graph-model.js';
import type { CanvasEdge, CanvasNode } from './canvas-model.js';
export declare function serializeFlow(currentFlow: WorkflowDocument, nodes: CanvasNode[], lines: CanvasEdge[]): WorkflowDocument;

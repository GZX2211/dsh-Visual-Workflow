import type { CanvasEdge, CanvasNode } from './canvas-model.js';
export interface ConnectionProblem {
    valid: boolean;
    code: string;
    branch?: string;
}
/** 连接校验：在画布上建立一条连线（sourceHandle → targetHandle）。 */
export declare function connectionProblem(nodes: CanvasNode[], lines: CanvasEdge[], connection: {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    lineId?: string;
}): ConnectionProblem;
export declare function connectionProblemMessage(problem: ConnectionProblem, copy: Record<string, string>): string;

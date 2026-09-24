import type { Dict } from '../../i18n.js';
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
export interface CanvasEdgesProps {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    byId: Map<string, CanvasNode>;
    selectedEdge: string | null;
    /** 连线源节点的运行状态（运行中连线用虚线）。 */
    runStatusOf(id: string): {
        status: string;
        attempts: number;
        outputSummary: string;
    } | null;
    isLockedEdge(id: string): boolean;
    copy: Dict;
    onEdgeSelect(id: string): void;
    /** 连线草稿路径（拖拽连线中）。 */
    draftPath: string | null;
}
export declare function CanvasEdges(props: CanvasEdgesProps): import("react").JSX.Element;

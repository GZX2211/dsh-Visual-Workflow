import type { Dict } from '../../i18n.js';
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
import { type MemberGroupIndex } from './geometry.js';
export interface CanvasEdgesProps {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    byId: Map<string, CanvasNode>;
    /** 成员 → 组 预建索引（所属组反查 O(1)，由 GraphCanvas 按节点集 memo 化）。 */
    memberGroups: MemberGroupIndex;
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
export declare const CanvasEdges: import("react").MemoExoticComponent<(props: CanvasEdgesProps) => import("react").JSX.Element>;

import type { Line, NodeKind } from '../../host/shared/graph-model.js';
/** 画布节点投影（位置/数据全量内联）。 */
export interface CanvasNode {
    id: string;
    kind: NodeKind;
    position: {
        x: number;
        y: number;
    };
    data: Record<string, unknown>;
    /** 虚拟节点引用的主节点 id（kind='proxy' 时由文档投影保留，见 §4.2.3.2 规则 3）。 */
    proxySourceId?: string;
}
/** 画布连线投影（与存储 Line 同形）。 */
export interface CanvasEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle: Line['sourceHandle'];
    targetHandle: Line['targetHandle'];
    condition?: Line['condition'];
}
/** 画布节点 kind 统一读取（顶层 kind 优先，兼容 data.kind 历史数据）。 */
export declare function nodeKindOf(node: {
    kind?: unknown;
    data?: {
        kind?: unknown;
    };
} | null | undefined): string;

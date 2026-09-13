import type { GraphNode, Line } from '../shared/graph-model.js';
/** 流程子图（仅包含画布内合法端点的 flow 线）。 */
export interface FlowDag {
    /** 节点 id 列表（保持输入顺序）。 */
    nodeIds: string[];
    /** 邻接表：source → targets（保持线顺序、去重）。 */
    adjacency: Map<string, string[]>;
    /** 入边表：target → sources（保持线顺序、去重）。 */
    incoming: Map<string, string[]>;
    /** 合法的 flow 线（端点在画布内）。 */
    edges: Array<{
        id: string;
        source: string;
        target: string;
    }>;
}
/** 是否为流程线（flow-out → flow-in）。 */
export declare function isFlowLine(line: Line): boolean;
/** 构建流程子图（忽略端点缺失的线，避免悬空引用影响判定）。 */
export declare function buildFlowDag(nodes: GraphNode[] | null | undefined, lines: Line[] | null | undefined): FlowDag;
/**
 * 环检测（DFS 三色染色）：返回**参与环**的节点集合。
 * 为什么不用拓扑排序的「处理不完」近似：那条路会把「环下游的整段链条」也划入，
 * 判定过宽；三色染色能精确定位环上的节点（灰色回边命中）。
 */
export declare function detectCycleNodes(dag: FlowDag): Set<string>;
/**
 * 最长路径分层（列号从 0 起）：仅对**无环视图**计算——环上节点及其下游被排除在
 * 分层之外（返回的 layers 中不含它们），保证算法终止且结果确定。
 * 节点自身层级 = max(所有入边源层级 + 1)，无入边为 0。
 */
export declare function computeFlowLayers(dag: FlowDag, excluded?: Set<string>): Map<string, number>;
/** 单层最大宽度（按可执行单元计数；excluded 之外的节点不参与）。 */
export declare function maxLayerWidth(layers: Map<string, number>, unitIds: Iterable<string>): number;

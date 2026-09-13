/** 有向边（仅 id 与两端；几何/通道不参与分层）。 */
export interface DirectedEdge {
    source: string;
    target: string;
}
/** 分层结果。 */
export interface Layering {
    /** 参与分层的节点 id（保持输入顺序，不包括被环排除的节点）。 */
    ids: string[];
    /** 节点 → 层号（从 0 起，保证每条非回流边 col(u) < col(v)）。 */
    layerOf: Map<string, number>;
    /** 被识别为「回流边」的边下标集合（分层时忽略，供 UI 标注）。 */
    reversedEdgeIndexes: number[];
}
/**
 * 检测有向图中的环（DFS 三色染色，显式栈避免深图递归爆栈），返回参与环的节点集合。
 * 与 host 侧 graph/dag.ts 同算法但输入形态不同（显式边表）——两侧判定必须一致，
 * 单测各自锁定（此处不跨 program import，避免双 program 类型域污染）。
 */
export declare function detectCycleNodes(ids: string[], edges: DirectedEdge[]): Set<string>;
/**
 * 分层：环上节点先被排除（其所在边全部视为回流边），其余节点按**最长路径**分层
 * （col(u) = max(col(v) + 1)，无入边为 0）。
 * 为什么排除环而不是硬解环：环意味着流程不可终止，检查器会报 flowCycle；
 * 布局只需「不崩、不产生 NaN、不丢节点」——环上节点由调用方放到兜底列。
 */
export declare function layerGraph(ids: string[], edges: DirectedEdge[]): Layering;

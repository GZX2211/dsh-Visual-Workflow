import type { CanvasEdge, CanvasNode } from '../studio/studio-state.js';
export interface RunLockInput {
    /** 是否启用锁定（仅模式一 + 实例处于 running 时为 true）；false → 全部解锁。 */
    enabled: boolean;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    /** 运行快照节点状态（nodeId → status 字符串，如 'pending'|'running'|'ok'|'fail'|'react-capped'|'armed'）。 */
    statusByNode: Record<string, string>;
}
export interface RunLockSet {
    /** 被锁节点 id 集合（不可删除）。 */
    readonly lockedNodeIds: ReadonlySet<string>;
    /** 被锁连线 id 集合（不可删除、不可选中/编辑）。 */
    readonly lockedEdgeIds: ReadonlySet<string>;
    isNodeLocked(nodeId: string): boolean;
    isEdgeLocked(edgeId: string): boolean;
    /** 是否允许新建 source→target 连线（仅判定锁定规则，不承担既有连通性/通道校验）。 */
    canConnect(sourceNodeId: string, targetNodeId: string): boolean;
    /** 节点是否已完成（ok / react-capped）。 */
    isNodeCompleted(nodeId: string): boolean;
    /** 节点是否执行中（running）。 */
    isNodeRunning(nodeId: string): boolean;
}
/**
 * 计算画布运行锁定判定集（纯函数；同一入参恒返回同一判定结果）。
 */
export declare function computeRunLocks(input: RunLockInput): RunLockSet;

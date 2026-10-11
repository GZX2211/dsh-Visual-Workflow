import type { GraphNode, Line } from '../../host/shared/graph-model.js';
import type { CanvasEdge, CanvasNode } from './canvas-model.js';
/**
 * 画布节点 → 存储节点。
 * 虚拟节点的顶层 proxySourceId 必须保留（Bug 2）：与画布投影对称，否则保存后
 * 后端 validateFlow 报 proxySourceMissing；非虚拟节点不产出该字段。
 */
export declare function serializeNodes(nodes: CanvasNode[]): GraphNode[];
/** 画布连线 → 存储连线（只保留语义字段；condition 仅在存在时携带）。 */
export declare function serializeLines(edges: CanvasEdge[]): Line[];
/**
 * 文档 + 画布 → 可落盘文档：除 nodes / lines 外字段原样透传。
 * 泛型收三种文档（WorkflowDocument / WorkflowTemplate / ServiceState）——三者的
 * nodes / lines 同为 GraphNode[] / Line[]，差异字段随 `...doc` 透传。
 */
export declare function serializeFlow<T extends {
    nodes: GraphNode[];
    lines: Line[];
}>(doc: T, nodes: CanvasNode[], lines: CanvasEdge[]): T;

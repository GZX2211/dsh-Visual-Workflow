import type { GraphNode } from '../shared/graph-model.js';
/**
 * 归一化旧图节点（只读兼容）：kind='file' → task，其余节点原样返回。
 * 非对象项跳过——损坏项不得伪装成节点；不修改入参。
 */
export declare function normalizeLegacyNodes(nodes: readonly unknown[] | null | undefined): GraphNode[];

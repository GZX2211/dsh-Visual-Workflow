import type { RunSnapshot } from '../../host/shared/types.js';
/** 运行快照 → 节点状态映射（画布回显用）。 */
export declare function runStatusMap(snapshot: RunSnapshot | null | undefined): Record<string, {
    status: string;
    attempts: number;
    outputSummary: string;
}>;
/** 运行中节点 id 列表（需求 §4.5.8「当前运行节点高亮」；画布高亮数据源，防回环只写视图）。 */
export declare function runningNodeIds(snapshot: RunSnapshot | null | undefined): string[];

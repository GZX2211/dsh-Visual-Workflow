import type { ExecutionMode, WorkflowDocument } from "../shared/graph-model.js";
import type { RunSnapshot } from "../shared/run-types.js";
/** Mode is explicit: neither handoff policy nor Harness context selects the scheduler. */
export declare function executionModeOf(value: unknown): ExecutionMode;
export declare function dagConcurrencyOf(value: unknown): number;
/** The existing graph validator owns connection shapes; this check owns DAG execution support. */
export declare function validateDagForRun(flow: WorkflowDocument): void;
/** Rules consume only a settled JSON output, never code or arbitrary expression text. */
export declare function selectDagRoutes(flow: WorkflowDocument, snapshot: RunSnapshot, nodeId: string): string[];
export interface DagFrontier {
    ready: string[];
    skipped: string[];
    sources: Record<string, string[]>;
    complete: boolean;
}
/** Pure AND-join: wait for every live predecessor; an unselected branch never counts as success. */
export declare function dagFrontierOf(flow: WorkflowDocument, snapshot: RunSnapshot): DagFrontier;
export declare function findReadyNodes(graph: WorkflowDocument, snapshot: RunSnapshot): string[];
/** Read-only projection: execution status and task status retain their original facts. */
export declare function dagStateOf(flow: WorkflowDocument, snapshot: RunSnapshot): NonNullable<RunSnapshot["dagState"]>;
/** Only the isolated reviewer emits this small closed schema; business output stays free form. */
export declare function dagReviewResultOf(raw: string): {
    status: "accepted" | "needs-input" | "failed" | "unknown";
    reason: string;
};

import type { ExecutionMode, WorkflowDocument } from "../shared/graph-model.js";
import type { RunSnapshot } from "../shared/run-types.js";
/** Mode is explicit: neither handoff policy nor Harness context selects the scheduler. */
export declare function executionModeOf(value: unknown): ExecutionMode;
export declare function dagConcurrencyOf(value: unknown): number;
/** The existing graph validator owns connection shapes; this check owns DAG execution support. */
export declare function validateDagForRun(flow: WorkflowDocument): void;
export interface DagFrontier {
    ready: string[];
    skipped: string[];
    sources: Record<string, string[]>;
    complete: boolean;
}
/** Pure AND-join: wait for every live predecessor; an unselected branch never counts as success. */
export declare function dagFrontierOf(flow: WorkflowDocument, snapshot: RunSnapshot): DagFrontier;
export declare function findReadyNodes(graph: WorkflowDocument, snapshot: RunSnapshot): string[];

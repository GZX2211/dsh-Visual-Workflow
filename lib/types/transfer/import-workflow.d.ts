import type { FlowStore } from "../storage/flow-store.js";
export declare function importWorkflowSource(store: FlowStore, source: unknown, options?: {
    conflictMode?: "rename" | "overwrite";
}): Promise<unknown>;

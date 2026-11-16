import type { FlowStore } from "../storage/flow-store.js";
interface WorkflowImportSourceOptions {
    conflictMode?: "rename" | "overwrite";
    sourceName?: string;
}
export declare function importWorkflowSource(store: FlowStore, source: unknown, options?: WorkflowImportSourceOptions): Promise<unknown>;
export {};

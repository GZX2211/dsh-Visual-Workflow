import type { WorkflowImportParseResult } from "./types.js";
import type { WorkflowImportResult } from "./types.js";
import type { FlowStore } from "../storage/flow-store.js";
export declare class WorkflowImportService {
    parse(source: string, platform: "dify"): WorkflowImportParseResult;
    importDify(store: FlowStore, source: string, options?: {
        conflictMode?: "rename" | "overwrite";
    }): Promise<WorkflowImportResult>;
}

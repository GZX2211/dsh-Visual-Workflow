import type { SourceWorkflowIR } from "./ir/source-ir.js";
import type { DifyCapabilities } from "./source/dify/normalize.js";
import type { WorkflowTemplate } from "../shared/graph-model.js";
import type { WorkflowImportMetadata } from "../shared/workflow-import.js";
export interface WorkflowImportParseResult {
    source: SourceWorkflowIR;
    capabilities: DifyCapabilities;
}
export interface WorkflowImportResult {
    sourceFormat: "dify";
    conflict?: boolean;
    existingName?: string;
    existingId?: string;
    template?: WorkflowTemplate;
    report?: WorkflowImportMetadata;
}

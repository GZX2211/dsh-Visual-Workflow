import type { WorkflowTemplate } from "../../../shared/graph-model.js";
import type { WorkflowImportMetadata } from "../../../shared/workflow-import.js";
import type { SourceWorkflowIR } from "../../ir/source-ir.js";
import type { DifyCapabilities } from "../../source/dify/normalize.js";
export interface DshImportConversion {
    template: WorkflowTemplate;
    report: WorkflowImportMetadata;
}
export declare function convertDifyWorkflow(source: SourceWorkflowIR, capabilities: DifyCapabilities, options: {
    id: string;
    name?: string;
    importedAt?: string;
}): DshImportConversion;

import { WorkflowImportError, WorkflowImportService } from "../importer/index.js";
import { importWorkflowBundle, TransferError } from "./bundle.js";
import { parse } from "yaml";
export async function importWorkflowSource(store, source, options = {}) {
    const text = String(source ?? "");
    if (!isDifySourceName(options.sourceName) && !looksLikeDify(text)) {
        return importWorkflowBundle(store, text, options);
    }
    try {
        return await new WorkflowImportService().importDify(store, text, options);
    }
    catch (error) {
        if (!(error instanceof WorkflowImportError))
            throw error;
        const code = error.code === "invalid_yaml" ? "TRANSFER_INVALID_JSON" : "TRANSFER_INVALID_BUNDLE";
        throw new TransferError(code, `Dify 工作流导入失败：${error.message}`);
    }
}
function isDifySourceName(sourceName) {
    return /\.ya?ml$/i.test(sourceName?.trim() ?? "");
}
function looksLikeDify(source) {
    try {
        const value = parse(source);
        if (!isRecord(value) || !isRecord(value.workflow))
            return false;
        return isRecord(value.workflow.graph);
    }
    catch {
        return false;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=import-workflow.js.map
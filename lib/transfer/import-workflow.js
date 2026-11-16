import { WorkflowImportError, WorkflowImportService } from "../importer/index.js";
import { importWorkflowBundle, TransferError } from "./bundle.js";
export async function importWorkflowSource(store, source, options = {}) {
    const text = String(source ?? "");
    if (!looksLikeDify(text))
        return importWorkflowBundle(store, text, options);
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
function looksLikeDify(source) {
    try {
        const value = JSON.parse(source);
        return typeof value === "object" && value !== null && typeof value.workflow?.graph === "object";
    }
    catch {
        return /(?:^|\r?\n)workflow\s*:\s*(?:\r?\n|\{)/.test(source)
            && /(?:^|\r?\n)\s*graph\s*:\s*(?:\r?\n|\{)/.test(source);
    }
}
//# sourceMappingURL=import-workflow.js.map
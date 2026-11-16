import { parseDifyWorkflow } from "./source/dify/parser.js";
import { convertDifyWorkflow } from "./target/dsh/convert.js";
export class WorkflowImportService {
    parse(source, platform) {
        const parsed = parseDifyWorkflow(source);
        return { source: parsed.workflow, capabilities: parsed.capabilities };
    }
    async importDify(store, source, options = {}) {
        const parsed = this.parse(source, "dify");
        const templates = await store.listFlowTemplates();
        const existing = templates.find((template) => template.mode === "mode1" && template.name === parsed.source.name);
        if (existing && options.conflictMode !== "rename" && options.conflictMode !== "overwrite") {
            return {
                sourceFormat: "dify",
                conflict: true,
                existingName: existing.name,
                existingId: existing.id,
            };
        }
        const name = existing && options.conflictMode === "rename"
            ? uniqueName(parsed.source.name, templates.filter((template) => template.mode === "mode1").map((template) => template.name))
            : parsed.source.name;
        const id = existing && options.conflictMode === "overwrite" ? existing.id : makeTemplateId();
        const converted = convertDifyWorkflow(parsed.source, parsed.capabilities, { id, name });
        const saved = await store.saveFlowTemplate(converted.template, { force: true });
        return { sourceFormat: "dify", template: saved, report: converted.report };
    }
}
function makeTemplateId() {
    return `tpl-dify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function uniqueName(base, existingNames) {
    const names = new Set(existingNames);
    let candidate = base;
    let index = 2;
    while (names.has(candidate)) {
        candidate = `${base} (${index})`;
        index += 1;
    }
    return candidate;
}
//# sourceMappingURL=service.js.map
import { httpError } from "./http.js";
import { VisualWorkflowApiBase } from "./boundary.js";
export class MigratedToolEndpoints extends VisualWorkflowApiBase {
    async migrateDifyTools(args) {
        const migration = this.host.migratedToolMigration;
        if (!migration)
            throw httpError(501, "Dify 工具包迁移能力尚未装配", "DIFY_MIGRATOR_UNAVAILABLE");
        const name = String(args.name ?? "").trim();
        const base64 = String(args.base64 ?? "");
        if (!name || !base64)
            throw httpError(400, "requires name and base64", "DIFY_UPLOAD_INVALID");
        return migration.install({ name, base64 });
    }
}
//# sourceMappingURL=migrated-tools.js.map
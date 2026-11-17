import { VisualWorkflowApiBase } from "./boundary.js";
export declare class MigratedToolEndpoints extends VisualWorkflowApiBase {
    migrateDifyTools(args: {
        name?: unknown;
        base64?: unknown;
    }): Promise<unknown>;
}

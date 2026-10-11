import type { RoleNode, WorkflowDocument } from "../shared/graph-model.js";
import type { InputAttachmentRef, InputSlots, JsonValue, NodeInputAttachment, RuntimeInputs, RuntimeInputValue, SessionInputFile } from "../shared/runtime-types.js";
import { WfError } from "./errors.js";
/** Public attachment references never include resolved host paths; stored inputs remain intact. */
export declare function publicRuntimeInputs(inputs: RuntimeInputs | undefined): RuntimeInputs | undefined;
export declare function jsonValueOf(value: unknown, field: string, depth?: number, ancestors?: Set<unknown>): JsonValue;
export interface InputAccess {
    sessionId: string;
    managedRoot: string;
    files: readonly SessionInputFile[];
}
/** Explicit file selection wins; otherwise all currently admitted references are context, not bindings. */
export declare function nodeInputAttachments(flow: WorkflowDocument, node: RoleNode, inputs: InputSlots, access: InputAccess, onUnavailable: (file: InputAttachmentRef, error: WfError) => void): Promise<NodeInputAttachment[]>;
export declare function inputSlotsOf(raw: unknown, field: string, access: InputAccess): Promise<Record<string, RuntimeInputValue[]>>;
export declare function runtimeInputsOf(raw: unknown, flow: WorkflowDocument, access: InputAccess): Promise<RuntimeInputs>;
export declare function handoffPolicyOf(raw: unknown): import("../shared/runtime-types.js").HandoffPolicy;
export declare function validateRequiredInputs(node: import("../shared/graph-model.js").RoleNode, slots: import("../shared/runtime-types.js").InputSlots): void;

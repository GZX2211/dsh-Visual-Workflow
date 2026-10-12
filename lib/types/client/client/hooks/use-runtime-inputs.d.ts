import type { HandoffPolicy, RuntimeInputs, RuntimeInputOptions } from "../../host/shared/runtime-types.js";
import type { Dict } from "../i18n.js";
import type { RemoteFace } from "./useRemote.js";
import type { RuntimeInputValue, InputAttachmentRef } from "../../host/shared/runtime-types.js";
export type InputEditorKind = "text" | "json" | "attachment";
export declare function validInputSlot(name: string): boolean;
export declare function formInputValue(kind: InputEditorKind, value: string, files: readonly InputAttachmentRef[]): RuntimeInputValue;
export interface RuntimeInputSelection {
    runtimeInputs: RuntimeInputs;
    handoffPolicy?: HandoffPolicy;
    requestGeneration?: number;
}
export interface RuntimeInputLifecycle {
    capture(): number;
    isCurrent(ticket: number): boolean;
}
export type PrepareRuntimeInputs = (sessionId: string, flowId: string, runId?: string, binding?: boolean, configure?: boolean, freshStart?: boolean) => Promise<RuntimeInputSelection | null | undefined>;
export interface RuntimeInputDialogState {
    sessionId: string;
    flowId: string;
    options: RuntimeInputOptions;
    inputs: RuntimeInputs;
    handoffPolicy?: HandoffPolicy;
    nodeId?: string;
    runId?: string;
    revision?: number;
    eligibleNodes: string[];
    error: string;
    busy: boolean;
    blockedNodes?: string[];
    freshStart?: boolean;
}
export declare function useRuntimeInputs(remote: RemoteFace, t: Dict, owner: string): {
    dialog: RuntimeInputDialogState | null;
    prepare: PrepareRuntimeInputs;
    lifecycle: RuntimeInputLifecycle;
    cancel: () => void;
    change: (patch: Partial<RuntimeInputDialogState>) => void;
    reuseCheckpointInputs: () => void;
    add: (target: string, name: string, kind: InputEditorKind, value: string) => void;
    remove: (target: string, name: string) => void;
    upload: (target: string, name: string, file: File) => Promise<void>;
    submit: () => Promise<void>;
};

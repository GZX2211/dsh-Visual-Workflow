import type { RoleNode, WorkflowDocument } from "../shared/graph-model.js";
import type { FlowInputContext, InputSlots } from "../shared/runtime-types.js";
import type { RunSnapshot } from "../shared/types.js";
/** Only newly opted-in ordinary nodes use default Flow context; explicit sources keep their contract. */
export declare function usesHarnessContext(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot): boolean;
/** A conditional-only route may remain unexecuted; mandatory sources cannot be omitted. */
export declare function conditionalRoute(flow: WorkflowDocument, id: string, path?: Set<string>, memo?: Map<string, boolean>): boolean;
/** Source identities are direct graph dependencies, never model-provided paths or scanned files. */
export declare function flowNodeContextOf(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, limit: number, selection?: unknown): Promise<FlowInputContext[]>;
/** Workflow inputs belong to one initial Agent, never to every node or an arbitrary branch. */
export declare function workflowInputTarget(flow: WorkflowDocument): string;
export declare function boundNodeInputs(snapshot: RunSnapshot, nodeId: string): InputSlots;
/** Automatic handoff is limited to a unique unconditional direct Agent predecessor. */
export declare function effectiveNodeInputs(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot): Promise<InputSlots>;

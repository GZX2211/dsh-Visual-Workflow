import type { Line, ExecutionMode } from "./graph-model.js"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type HandoffPolicy = "explicit" | "auto"
export interface InputAttachmentRef { attachmentId: string; name: string; bytes: number }
export interface SessionInputFile extends InputAttachmentRef { path: string }
export interface NodeInputAttachment extends InputAttachmentRef { source: "session" | "binding" }
export interface FlowInputContext {
  nodeId: string
  label: string
  responsibility: string
  runId: string
  attempt: number
  childId?: string
  result: string
  /** Declared graph edges for this selected source, not a machine proof of predicate truth. */
  flowEdges?: Array<{ lineId: string; condition?: Line["condition"] }>
  artifacts: Array<{ path: string; size: number }>
}
export type RuntimeFileRef = { source: "managed"; path: string } | ({ source: "attachment" } & InputAttachmentRef & { path?: string }) | { source: "node"; path: string }
export interface InputOrigin { source: "user" | "managed" | "attachment" | "node"; nodeId?: string; runId?: string; attempt?: number }
export type RuntimeInputValue = ({ kind: "text"; value: string } | { kind: "json"; value: JsonValue } | { kind: "file"; fileRef: RuntimeFileRef }) & { origin?: InputOrigin }
export type InputSlots = Record<string, RuntimeInputValue[]>
export interface RuntimeInputs { workflowInputs: InputSlots; nodeInputs: Record<string, InputSlots> }
export interface InputRequirement { kind: "text" | "json" | "file"; required?: boolean }
export interface RuntimeInputOptions {
  executionMode?: ExecutionMode
  dagConcurrency?: number
  nodeInputs: Record<string, Record<string, InputRequirement>>
  files: InputAttachmentRef[]
  handoffPolicy?: HandoffPolicy
  /** Canonical initial Agent, only when the existing graph query resolves a unique target. */
  initialNodeId?: string
  checkpoint?: { runId: string; runtimeInputs?: RuntimeInputs; handoffPolicy?: HandoffPolicy; executionMode?: ExecutionMode; dagConcurrency?: number }
}

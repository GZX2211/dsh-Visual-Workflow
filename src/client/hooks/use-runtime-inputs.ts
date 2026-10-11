import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { HandoffPolicy, RuntimeInputs, RuntimeInputOptions } from "../../host/shared/runtime-types.js"
import type { RunSnapshot } from "../../host/shared/types.js"
import type { Dict } from "../i18n.js"
import type { RemoteFace } from "./useRemote.js"
import { EP } from "../lib/remote.js"
import type { RuntimeInputValue, InputAttachmentRef } from "../../host/shared/runtime-types.js"
export type InputEditorKind = "text" | "json" | "attachment"
export function validInputSlot(name: string): boolean { return !!name.trim() && name.length <= 128 && !["__proto__", "prototype", "constructor"].includes(name) }
export function formInputValue(kind: InputEditorKind, value: string, files: readonly InputAttachmentRef[]): RuntimeInputValue {
  if (kind === "text") return { kind: "text", value }
  if (kind === "json") return { kind: "json", value: JSON.parse(value) as import("../../host/shared/runtime-types.js").JsonValue }
  const file = files.find((entry) => entry.attachmentId === value)
  if (!file) throw new Error("attachmentId")
  return { kind: "file", fileRef: { source: "attachment", attachmentId: file.attachmentId, name: file.name, bytes: file.bytes } }
}

export interface RuntimeInputSelection { runtimeInputs: RuntimeInputs; handoffPolicy: HandoffPolicy; requestGeneration?: number }
export interface RuntimeInputLifecycle { capture(): number; isCurrent(ticket: number): boolean }
export type PrepareRuntimeInputs = (sessionId: string, flowId: string, runId?: string, binding?: boolean, configure?: boolean, freshStart?: boolean) => Promise<RuntimeInputSelection | null | undefined>
export interface RuntimeInputDialogState {
  sessionId: string; flowId: string; options: RuntimeInputOptions; inputs: RuntimeInputs; handoffPolicy: HandoffPolicy
  nodeId?: string; runId?: string; revision?: number; eligibleNodes: string[]; error: string; busy: boolean
  blockedNodes?: string[]
}

export function useRuntimeInputs(remote: RemoteFace, t: Dict, owner: string) {
  const [dialog, setDialog] = useState<RuntimeInputDialogState | null>(null)
  const current = useRef(dialog)
  current.current = dialog
  const generation = useRef(0)
  const pending = useRef<((selection: RuntimeInputSelection | null) => void) | null>(null)
  const alive = useRef(true)
  const previousOwner = useRef(owner)
  const requested = useRef<{ owner: string; flowId: string } | null>(null)
  const lifecycle = useMemo<RuntimeInputLifecycle>(() => ({ capture: () => generation.current, isCurrent: (ticket) => alive.current && ticket === generation.current }), [])
  const cancel = useCallback(() => {
    generation.current += 1
    pending.current?.(null)
    pending.current = null
    requested.current = null
    current.current = null
    if (alive.current) setDialog(null)
  }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel() } }, [cancel])
  useEffect(() => {
    const previous = previousOwner.current
    previousOwner.current = owner
    if (previous === owner) return
    const request = requested.current
    // Creating an instance can change the selected document before its input request completes.
    if (request?.owner === previous && !previous.endsWith(`:${request.flowId}`) && owner.endsWith(`:${request.flowId}`)) { request.owner = owner; return }
    cancel()
  }, [cancel, owner])
  const change = useCallback((patch: Partial<RuntimeInputDialogState>) => {
    if (!alive.current || !current.current) return
    const next = { ...current.current, error: "", ...patch }
    current.current = next
    setDialog(next)
  }, [])

  const prepare: PrepareRuntimeInputs = useCallback(async (sessionId, flowId, runId, binding = false, configure = true, freshStart = false) => {
    cancel()
    requested.current = { owner, flowId }
    const expected = generation.current
    const options = await remote.call(EP.EP_RUNTIME_INPUT_OPTIONS, { sessionId, flowId }) as RuntimeInputOptions
    if (!alive.current || generation.current !== expected) return null
    const checkpoint = runId ? await remote.call(EP.EP_RUN_STATUS, { sessionId, runId }) as RunSnapshot : undefined
    if (!alive.current || generation.current !== expected) return null
    if (checkpoint && checkpoint.flowId !== flowId) throw new Error(t.runtimeInputOwnerError)
    const inputs = structuredClone(checkpoint?.runtimeInputs ?? options.checkpoint?.runtimeInputs ?? { workflowInputs: {}, nodeInputs: {} })
    const handoffPolicy = checkpoint?.handoffPolicy ?? options.handoffPolicy
    const fileSlots = Object.entries(options.nodeInputs).flatMap(([id, requirements]) => Object.entries(requirements).filter(([, requirement]) => requirement.kind === "file" && requirement.required !== false).map(([name]) => ({ id, name })))
    let selectedAttachment = false
    // Only a new run may choose a unique authorized file; uploading during execution never binds it.
    if (!binding && !runId && (!options.checkpoint || freshStart) && options.files.length === 1 && fileSlots.length === 1) {
      const { id, name } = fileSlots[0]
      if (id === options.initialNodeId && !(inputs.nodeInputs[id]?.[name] ?? inputs.workflowInputs[name] ?? []).length) {
        ;(inputs.nodeInputs[id] ??= {})[name] = [formInputValue("attachment", options.files[0].attachmentId, options.files)]
        selectedAttachment = true
      }
    }
    const missingRequired = Object.entries(options.nodeInputs).some(([id, requirements]) => Object.entries(requirements).some(([name, requirement]) => requirement.required !== false && !(inputs.nodeInputs[id]?.[name] ?? inputs.workflowInputs[name] ?? []).some((value) => value.kind === requirement.kind)))
    if (!binding && !configure && !missingRequired) {
      requested.current = null
      return selectedAttachment || checkpoint?.runtimeInputs || options.checkpoint?.runtimeInputs || handoffPolicy === "auto" ? { runtimeInputs: inputs, handoffPolicy, requestGeneration: expected } : undefined
    }
    const eligibleNodes = Object.keys(options.nodeInputs).filter((id) => !binding || checkpoint?.nodes.some((node) => node.nodeId === id && node.status === "pending" && node.attempts === 0))
    const blockedNodes = binding ? Object.keys(options.nodeInputs).filter((id) => !eligibleNodes.includes(id)) : []
    const state: RuntimeInputDialogState = { sessionId, flowId, options, inputs, handoffPolicy, eligibleNodes, blockedNodes, ...(binding ? { nodeId: eligibleNodes[0], runId, revision: checkpoint?.inputRevision ?? 0 } : {}), busy: false, error: binding && !eligibleNodes.length ? t.runtimeRestartRequired : "" }
    current.current = state
    setDialog(state)
    return new Promise<RuntimeInputSelection | null>((resolve) => { pending.current = resolve })
  }, [cancel, owner, remote, t.runtimeInputOwnerError, t.runtimeRestartRequired])

  const add = useCallback((target: string, name: string, kind: InputEditorKind, value: string) => {
    const state = current.current
    if (!state || state.busy) return
    try {
      if (!validInputSlot(name)) throw new Error(t.runtimeInvalidSlot)
      const part = formInputValue(kind, value, state.options.files)
      const inputs = structuredClone(state.inputs)
      const slots = target === "workflow" ? inputs.workflowInputs : inputs.nodeInputs[target.slice(5)] ??= {}
      ;(slots[name] ??= []).push(part)
      change({ inputs })
    } catch (error) { change({ error: `${t.runtimeInvalidValue}: ${error instanceof Error ? error.message : String(error)}` }) }
  }, [change, t.runtimeInvalidSlot, t.runtimeInvalidValue])

  const remove = useCallback((target: string, name: string) => {
    const state = current.current
    if (!state || state.busy) return
    const inputs = structuredClone(state.inputs)
    delete (target === "workflow" ? inputs.workflowInputs : inputs.nodeInputs[target.slice(5)] ?? {})[name]
    change({ inputs })
  }, [change])

  const upload = useCallback(async (target: string, name: string, file: File) => {
    const state = current.current
    if (!state || state.busy) return
    if (!validInputSlot(name)) { change({ error: t.runtimeInvalidSlot }); return }
    const expected = generation.current
    change({ busy: true })
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(t.runtimeUploadFailed))
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
        reader.readAsDataURL(file)
      })
      if (!alive.current || expected !== generation.current) return
      const uploaded = await remote.call(EP.EP_FILE_UPLOAD, { sessionId: state.sessionId, name: `${crypto.randomUUID()}-${file.name}`, base64 }) as { managedPath?: string }
      if (!alive.current || expected !== generation.current) return
      if (!uploaded.managedPath) throw new Error(t.runtimeUploadFailed)
      const inputs = structuredClone(current.current!.inputs)
      const slots = target === "workflow" ? inputs.workflowInputs : inputs.nodeInputs[target.slice(5)] ??= {}
      ;(slots[name] ??= []).push({ kind: "file", fileRef: { source: "managed", path: uploaded.managedPath } })
      change({ inputs, busy: false })
    } catch (error) { if (alive.current && expected === generation.current) change({ busy: false, error: error instanceof Error ? error.message : t.runtimeUploadFailed }) }
  }, [change, remote, t.runtimeInvalidSlot, t.runtimeUploadFailed])

  const submit = useCallback(async () => {
    const state = current.current
    if (!state || state.busy) return
    const expected = generation.current
    change({ busy: true })
    try {
      const inputs = structuredClone(state.inputs)
      if (state.runId && !state.nodeId) throw new Error(t.runtimeNoPendingNode)
      if (state.runId) await remote.call(EP.EP_RUN_INPUT_BIND, { sessionId: state.sessionId, runId: state.runId, nodeId: state.nodeId, expectedRevision: state.revision, inputs: inputs.nodeInputs[state.nodeId!] ?? {} })
      if (!alive.current || expected !== generation.current) return
      pending.current?.({ runtimeInputs: inputs, handoffPolicy: state.handoffPolicy, requestGeneration: expected })
      pending.current = null
      requested.current = null
      current.current = null
      setDialog(null)
    } catch (error) {
      if (!alive.current || expected !== generation.current) return
      if (state.runId && (error as { code?: string } | null)?.code === "WF_INPUT_REVISION_CONFLICT") {
        try {
          const checkpoint = await remote.call(EP.EP_RUN_STATUS, { sessionId: state.sessionId, runId: state.runId }) as RunSnapshot
          if (!alive.current || expected !== generation.current) return
          const eligibleNodes = Object.keys(state.options.nodeInputs).filter((id) => checkpoint.nodes.some((node) => node.nodeId === id && node.status === "pending" && node.attempts === 0))
          change({ revision: checkpoint.inputRevision ?? 0, eligibleNodes, blockedNodes: Object.keys(state.options.nodeInputs).filter((id) => !eligibleNodes.includes(id)), nodeId: eligibleNodes.includes(state.nodeId!) ? state.nodeId : eligibleNodes[0], busy: false, error: eligibleNodes.length ? t.runtimeRevisionChanged : t.runtimeRestartRequired })
          return
        } catch { /* Keep the original diagnostic if the refresh also fails. */ }
      }
      const code = (error as { code?: string } | null)?.code
      change({ busy: false, error: code === "WF_INPUT_STATE_CONFLICT" ? `${code}: ${t.runtimeRestartRequired}` : `${code ? `${code}: ` : ""}${error instanceof Error ? error.message : t.runtimeInvalidValue}` })
    }
  }, [change, remote, t.runtimeInvalidValue, t.runtimeRevisionChanged, t.runtimeNoPendingNode, t.runtimeRestartRequired])

  return { dialog, prepare, lifecycle, cancel, change, add, remove, upload, submit }
}

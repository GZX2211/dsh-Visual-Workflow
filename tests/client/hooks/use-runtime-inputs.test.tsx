// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { formInputValue, useRuntimeInputs, type PrepareRuntimeInputs } from "../../../src/client/hooks/use-runtime-inputs.js"
import { useRunControl } from "../../../src/client/hooks/useRunControl.js"
import { zh } from "../../../src/client/i18n.js"
import { EP } from "../../../src/client/lib/remote.js"
import type { RemoteFace } from "../../../src/client/hooks/useRemote.js"
import type { RuntimeInputOptions } from "../../../src/host/shared/runtime-types.js"
import { RuntimeInputsDialog } from "../../../src/client/components/runtime-inputs-dialog.js"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
let face!: { inputs: ReturnType<typeof useRuntimeInputs>; control: ReturnType<typeof useRunControl> }
const options: RuntimeInputOptions = { nodeInputs: { workflow: {}, first: {} }, files: [{ attachmentId: "att", name: "data.csv", bytes: 4 }], handoffPolicy: "explicit" }
const checkpoint = { id: "run", flowId: "flow", inputRevision: 3, handoffPolicy: "auto", runtimeInputs: { workflowInputs: { subject: [{ kind: "text", value: "saved" }] }, nodeInputs: { first: { old: [{ kind: "json", value: { count: 2 } }] } } }, nodes: [{ nodeId: "first", status: "pending", attempts: 0 }, { nodeId: "workflow", status: "running", attempts: 1 }] }
const previousAttachment = { attachmentId: "att-a", name: "previous.csv", bytes: 4 }
const newAttachment = { attachmentId: "att-b", name: "current.csv", bytes: 7 }
function attachmentCheckpointOptions(files = [previousAttachment, newAttachment]): RuntimeInputOptions {
  return { ...structuredClone(options), initialNodeId: "first", nodeInputs: { first: { source: { kind: "file" } } }, files,
    checkpoint: { runId: "old", handoffPolicy: "explicit", runtimeInputs: { workflowInputs: { subject: [{ kind: "text", value: "previous subject" }] }, nodeInputs: { first: { source: [{ kind: "file", fileRef: { source: "attachment", ...previousAttachment } }] } } } },
  }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
async function render(remote: RemoteFace, owner = "session:flow", dispatch = vi.fn()) {
  function Harness({ owner }: { owner: string }) {
    const inputs = useRuntimeInputs(remote, zh, owner)
    const control = useRunControl(dispatch, remote, inputs.prepare, inputs.lifecycle)
    useEffect(() => { face = { inputs, control } })
    return inputs.dialog ? <RuntimeInputsDialog state={inputs.dialog} t={zh} onCancel={inputs.cancel} onReuseCheckpointInputs={inputs.reuseCheckpointInputs} onChange={inputs.change} onAdd={inputs.add} onRemove={inputs.remove} onUpload={inputs.upload} onSubmit={inputs.submit} /> : null
  }
  container = document.createElement("div"); document.body.append(container)
  root = createRoot(container)
  const rerender = async (owner: string) => { await act(async () => { root!.render(<Harness owner={owner} />) }) }
  await rerender(owner)
  return { rerender, dispatch }
}
function remoteOf(extra: (endpoint: string, args: unknown) => unknown = () => null): RemoteFace {
  return { call: vi.fn(async (endpoint: string, args: unknown) => endpoint === EP.EP_RUNTIME_INPUT_OPTIONS ? structuredClone(options) : endpoint === EP.EP_RUN_STATUS ? structuredClone(checkpoint) : extra(endpoint, args)) } as unknown as RemoteFace
}
async function prepare(runId?: string, binding = false) {
  let pending!: ReturnType<PrepareRuntimeInputs>
  await act(async () => { pending = face.inputs.prepare("session", "flow", runId, binding) })
  return { pending }
}
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; container?.remove(); vi.restoreAllMocks() })

it("test_legacy_normal_run_skips_dialog_and_preserves_original_request", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  await render(remote)
  await act(async () => { expect(await face.control.startRun("session", "flow")).toBe("started") })
  expect(face.inputs.dialog).toBeNull()
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow" })
})

it("test_default_harness_option_does_not_insert_explicit_or_show_input_dialog", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, handoffPolicy: undefined, files: [] }))
  await render(remote)
  await act(async () => { expect(await face.control.startRun("session", "flow")).toBe("started") })
  expect(face.inputs.dialog).toBeNull()
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow" })
})

it.each(["explicit", undefined] as const)("test_fresh_start_preserves_only_actually_stored_policy_%s", async (policy) => {
  const remote = remoteOf()
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, handoffPolicy: "explicit", checkpoint: { runId: "old", handoffPolicy: policy } }))
  await render(remote)
  let pending!: ReturnType<PrepareRuntimeInputs>
  await act(async () => { pending = face.inputs.prepare("session", "flow", undefined, false, true, true) })
  expect(face.inputs.dialog?.handoffPolicy).toBe(policy)
  expect(face.inputs.dialog?.inputs).toEqual({ workflowInputs: {}, nodeInputs: {} })
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_normal_run_collects_missing_required_input_before_dispatch", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, nodeInputs: { first: { source: { kind: "text", required: true } } } }))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow") })
  expect(face.inputs.dialog?.eligibleNodes).toEqual(["first"])
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN)).toBe(false)
  await act(async () => { face.inputs.add("node:first", "source", "text", "required"); await face.inputs.submit() })
  expect(await started).toBe("started")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toMatchObject({ runtimeInputs: { nodeInputs: { first: { source: [{ kind: "text", value: "required" }] } } } })
})

it("test_optional_configuration_can_enable_auto_without_required_inputs", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true) })
  expect(face.inputs.dialog?.handoffPolicy).toBe("explicit")
  await act(async () => { face.inputs.change({ handoffPolicy: "auto" }); await face.inputs.submit() })
  expect(await started).toBe("started")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toMatchObject({ handoffPolicy: "auto" })
})

it("test_cancel_configuration_never_starts_run", async () => {
  const remote = remoteOf(() => ({ runId: "unexpected" }))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true) })
  await act(async () => { face.inputs.cancel() })
  expect(await started).toBeNull()
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN)).toBe(false)
})

it("test_normal_resume_restores_checkpoint_inputs_and_auto_without_dialog", async () => {
  await render(remoteOf())
  let selection!: Awaited<ReturnType<PrepareRuntimeInputs>>
  await act(async () => { selection = await face.inputs.prepare("session", "flow", "run", false, false) })
  expect(face.inputs.dialog).toBeNull()
  expect(selection).toMatchObject({ runtimeInputs: checkpoint.runtimeInputs, handoffPolicy: "auto" })
})

it("test_client_attachment_submission_projects_only_public_reference", () => {
  const file = { attachmentId: "att", name: "data.csv", bytes: 4, path: "/unexpected/host/path" }
  expect(formInputValue("attachment", "att", [file])).toEqual({ kind: "file", fileRef: { source: "attachment", attachmentId: "att", name: "data.csv", bytes: 4 } })
})

it("test_unique_authorized_attachment_and_initial_file_requirement_start_with_public_binding", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, initialNodeId: "first", nodeInputs: { first: { source: { kind: "file" } } } }))
  await render(remote)
  await act(async () => { expect(await face.control.startRun("session", "flow")).toBe("started") })
  expect(face.inputs.dialog).toBeNull()
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", handoffPolicy: "explicit", runtimeInputs: { workflowInputs: {}, nodeInputs: { first: { source: [{ kind: "file", fileRef: { source: "attachment", attachmentId: "att", name: "data.csv", bytes: 4 } }] } } } })
})

it.each(["multiple-files", "multiple-targets", "multiple-slots", "unknown-target", "optional", "text", "saved-checkpoint"])("test_attachment_%s_never_guesses_binding", async (kind) => {
  const config: RuntimeInputOptions = { ...structuredClone(options), initialNodeId: "first", nodeInputs: { first: { source: { kind: "file" } } } }
  if (kind === "multiple-files") config.files.push({ attachmentId: "att2", name: "data2.csv", bytes: 4 })
  if (kind === "multiple-targets") config.nodeInputs.other = { source: { kind: "file" } }
  if (kind === "multiple-slots") config.nodeInputs.first.another = { kind: "file" }
  if (kind === "unknown-target") delete config.initialNodeId
  if (kind === "optional") config.nodeInputs.first.source.required = false
  if (kind === "text") config.nodeInputs.first.source.kind = "text"
  if (kind === "saved-checkpoint") config.checkpoint = { runId: "old", runtimeInputs: { workflowInputs: {}, nodeInputs: {} } }
  const remote = remoteOf()
  vi.mocked(remote.call).mockImplementationOnce(async () => config)
  await render(remote)
  const { pending } = await prepare()
  expect(face.inputs.dialog?.inputs).toEqual({ workflowInputs: {}, nodeInputs: {} })
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN || name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it.each([true, false])("test_fresh_start_configure_%s_selects_unique_new_attachment_without_inheriting_old_input", async (configure) => {
  const remote = remoteOf(() => ({ runId: "new" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => attachmentCheckpointOptions([newAttachment]))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", configure, true) })
  if (configure) {
    expect(container!.textContent).toContain(zh.runtimeFreshInputsHelp)
    expect(container!.textContent).toContain("source: current.csv")
    await act(async () => { await face.inputs.submit() })
  } else expect(face.inputs.dialog).toBeNull()
  expect(await started).toBe("new")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", freshStart: true, handoffPolicy: "explicit", runtimeInputs: { workflowInputs: {}, nodeInputs: { first: { source: [{ kind: "file", fileRef: { source: "attachment", ...newAttachment } }] } } } })
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_RESUME || name === EP.EP_RUN_INPUT_BIND)).toBe(false)
})

it("test_normal_checkpoint_resume_keeps_attachment_A_when_attachment_B_is_available", async () => {
  const config = attachmentCheckpointOptions()
  const remote = remoteOf(() => ({ runId: "resumed" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => config)
  await render(remote)
  await act(async () => { expect(await face.control.startRun("session", "flow")).toBe("resumed") })
  expect(face.inputs.dialog).toBeNull()
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", handoffPolicy: "explicit", runtimeInputs: config.checkpoint!.runtimeInputs })
})

it("test_fresh_start_reuses_checkpoint_inputs_only_after_explicit_user_action", async () => {
  const config = attachmentCheckpointOptions()
  const remote = remoteOf(() => ({ runId: "fresh" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => config)
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true, true) })
  expect(face.inputs.dialog?.inputs).toEqual({ workflowInputs: {}, nodeInputs: {} })
  await act(async () => { face.inputs.add("node:first", "source", "attachment", newAttachment.attachmentId) })
  expect(face.inputs.dialog?.inputs.nodeInputs.first.source).toEqual([{ kind: "file", fileRef: { source: "attachment", ...newAttachment } }])
  const reuse = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === zh.runtimeReuseCheckpointInputs)!
  await act(async () => { reuse.click() })
  expect(face.inputs.dialog?.inputs).toEqual(config.checkpoint!.runtimeInputs)
  expect(container!.textContent).toContain("source: previous.csv")
  await act(async () => { await face.inputs.submit() })
  expect(await started).toBe("fresh")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", freshStart: true, handoffPolicy: "explicit", runtimeInputs: config.checkpoint!.runtimeInputs })
})

it("test_pending_binding_does_not_offer_or_apply_fresh_input_reuse", async () => {
  const remote = remoteOf()
  vi.mocked(remote.call).mockImplementationOnce(async () => attachmentCheckpointOptions())
  await render(remote)
  const { pending } = await prepare("run", true)
  expect(container!.textContent).not.toContain(zh.runtimeReuseCheckpointInputs)
  await act(async () => { face.inputs.reuseCheckpointInputs() })
  expect(face.inputs.dialog?.inputs).toEqual(checkpoint.runtimeInputs)
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_active_binding_does_not_implicitly_choose_newly_uploaded_attachment", async () => {
  const remote = remoteOf()
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, initialNodeId: "first", nodeInputs: { first: { source: { kind: "file" } } } }))
  await render(remote)
  const { pending } = await prepare("run", true)
  expect(face.inputs.dialog?.inputs.nodeInputs.first.source).toBeUndefined()
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_executed_nodes_remain_blocked_and_have_new_run_guidance", async () => {
  const remote = remoteOf()
  vi.mocked(remote.call).mockImplementationOnce(async () => options).mockImplementationOnce(async () => ({ ...checkpoint, nodes: checkpoint.nodes.map((node) => ({ ...node, status: "fail", attempts: 2 })) }))
  await render(remote)
  const { pending } = await prepare("run", true)
  expect(face.inputs.dialog).toMatchObject({ eligibleNodes: [], blockedNodes: ["workflow", "first"], error: zh.runtimeRestartRequired })
  expect(container!.textContent).toContain(zh.runtimeRestartRequired)
  expect(container!.querySelector<HTMLButtonElement>(".is-primary")!.disabled).toBe(true)
  expect(Array.from(container!.querySelectorAll<HTMLOptionElement>("option[value^='node:']")).every((option) => option.disabled)).toBe(true)
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_fresh_run_dialog_prepares_unique_attachment_using_declared_target_and_slot", async () => {
  const remote = remoteOf(() => ({ runId: "fresh" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => ({ ...options, initialNodeId: "first", nodeInputs: { first: { source: { kind: "file" } } }, checkpoint: { runId: "old", runtimeInputs: { workflowInputs: {}, nodeInputs: {} } } }))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true, true) })
  expect(Array.from(container!.querySelectorAll("select")).map((select) => select.value)).toContain("node:first")
  expect(container!.querySelector<HTMLInputElement>("input:not([type='file'])")!.value).toBe("source")
  expect(Array.from(container!.querySelectorAll("select")).map((select) => select.value)).toContain("attachment")
  expect(container!.textContent).toContain("source: data.csv")
  await act(async () => { await face.inputs.submit() })
  expect(await started).toBe("fresh")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toMatchObject({ freshStart: true, runtimeInputs: { nodeInputs: { first: { source: [{ fileRef: options.files[0] }] } } } })
})

it.each([true, false])("test_fresh_start_configure_%s_multiple_attachments_A_and_B_require_selection_without_old_binding", async (configure) => {
  const remote = remoteOf(() => ({ runId: "selected" }))
  vi.mocked(remote.call).mockImplementationOnce(async () => attachmentCheckpointOptions())
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", configure, true) })
  expect(face.inputs.dialog?.inputs).toEqual({ workflowInputs: {}, nodeInputs: {} })
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN)).toBe(false)
  const select = Array.from(container!.querySelectorAll<HTMLSelectElement>("select")).find((select) => select.querySelector('option[value="att-b"]'))!
  expect(select.value).toBe("")
  await act(async () => { select.value = "att-b"; select.dispatchEvent(new Event("change", { bubbles: true })) })
  await act(async () => { Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === zh.runtimeAdd)!.click() })
  await act(async () => { await face.inputs.submit() })
  expect(await started).toBe("selected")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", freshStart: true, handoffPolicy: "explicit", runtimeInputs: { workflowInputs: {}, nodeInputs: { first: { source: [{ kind: "file", fileRef: { source: "attachment", ...newAttachment } }] } } } })
})

it.each(["WF_INPUT_STATE_CONFLICT", "WF_BUSY"])("test_bind_%s_preserves_diagnostic_without_automatic_retry", async (code) => {
  const remote = remoteOf(() => { throw Object.assign(new Error("conflict"), { code }) })
  await render(remote)
  const { pending } = await prepare("run", true)
  await act(async () => { await face.inputs.submit() })
  expect(face.inputs.dialog?.error).toContain(code)
  if (code === "WF_INPUT_STATE_CONFLICT") expect(face.inputs.dialog?.error).toContain(zh.runtimeRestartRequired)
  expect(vi.mocked(remote.call).mock.calls.filter(([name]) => name === EP.EP_RUN_INPUT_BIND)).toHaveLength(1)
  expect(face.inputs.dialog?.inputs).toEqual(checkpoint.runtimeInputs)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_document_switch_during_normal_options_lookup_never_starts_old_run", async () => {
  const gate = deferred<RuntimeInputOptions>()
  const remote = remoteOf(() => ({ runId: "unexpected" }))
  vi.mocked(remote.call).mockImplementationOnce(() => gate.promise)
  const { rerender, dispatch } = await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow") })
  await rerender("session:other")
  await act(async () => { gate.resolve(options) })
  expect(await started).toBeNull()
  expect(dispatch).not.toHaveBeenCalled()
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN)).toBe(false)
})

it("test_start_legacy_no_required_input_accepts_empty_dialog", async () => {
  const remote = remoteOf(() => ({ runId: "started" }))
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true) })
  await act(async () => { await face.inputs.submit() })
  expect(await started).toBe("started")
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toMatchObject({ runtimeInputs: { workflowInputs: {}, nodeInputs: {} } })
})

it("test_start_typed_inputs_and_policy_are_sent_without_ui_generation", async () => {
  const remote = remoteOf(() => ({ runId: "started", sessionId: "session" }))
  const { dispatch } = await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow", true) })
  await act(async () => { face.inputs.add("workflow", "subject", "text", "topic"); face.inputs.add("node:workflow", "payload", "json", '{"ok":true}'); face.inputs.change({ handoffPolicy: "auto" }) })
  await act(async () => { await face.inputs.submit(); await started })
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", handoffPolicy: "auto", runtimeInputs: { workflowInputs: { subject: [{ kind: "text", value: "topic" }] }, nodeInputs: { workflow: { payload: [{ kind: "json", value: { ok: true } }] } } } })
  expect(dispatch).toHaveBeenCalledWith({ type: "RUN_STARTED", runId: "started", runSessionId: "session" })
})

it("test_resume_explicit_checkpoint_restores_inputs_and_policy", async () => {
  await render(remoteOf())
  const { pending } = await prepare("run")
  expect(face.inputs.dialog).toMatchObject({ inputs: checkpoint.runtimeInputs, handoffPolicy: "auto" })
  await act(async () => { await face.inputs.submit() })
  expect(await pending).toMatchObject({ runtimeInputs: checkpoint.runtimeInputs, handoffPolicy: "auto" })
})

it("test_bind_pending_node_sends_exact_revision_and_node_slots", async () => {
  const remote = remoteOf()
  await render(remote)
  const { pending } = await prepare("run", true)
  expect(face.inputs.dialog?.eligibleNodes).toEqual(["first"])
  await act(async () => { face.inputs.add("node:first", "data", "attachment", "att") })
  await act(async () => { await face.inputs.submit() })
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN_INPUT_BIND)?.[1]).toEqual({ sessionId: "session", runId: "run", nodeId: "first", expectedRevision: 3, inputs: { old: [{ kind: "json", value: { count: 2 } }], data: [{ kind: "file", fileRef: { source: "attachment", attachmentId: "att", name: "data.csv", bytes: 4 } }] } })
  expect((await pending)?.runtimeInputs.nodeInputs.first.data?.[0]).toMatchObject({ kind: "file" })
})

it("test_bind_revision_conflict_refreshes_revision_and_requires_review", async () => {
  const remote = remoteOf(() => { throw Object.assign(new Error("conflict"), { code: "WF_INPUT_REVISION_CONFLICT" }) })
  await render(remote)
  const { pending } = await prepare("run", true)
  vi.mocked(remote.call).mockImplementationOnce(async () => { throw Object.assign(new Error("conflict"), { code: "WF_INPUT_REVISION_CONFLICT" }) }).mockImplementationOnce(async () => ({ ...checkpoint, inputRevision: 4 }))
  await act(async () => { await face.inputs.submit() })
  expect(face.inputs.dialog).toMatchObject({ revision: 4, busy: false, error: zh.runtimeRevisionChanged })
  expect(vi.mocked(remote.call).mock.calls.filter(([name]) => name === EP.EP_RUN_INPUT_BIND)).toHaveLength(1)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_upload_managed_file_stays_draft_until_explicit_binding", async () => {
  const remote = remoteOf(() => ({ managedPath: "/store/data/files/unique.csv" }))
  await render(remote)
  const { pending } = await prepare("run", true)
  await act(async () => { await face.inputs.upload("node:first", "source", new File(["data"], "data.csv")) })
  const upload = vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_FILE_UPLOAD)?.[1] as { name: string; base64: string }
  expect(upload.name).toMatch(/^[a-f0-9-]+-data\.csv$/)
  expect(upload.base64).toBe("ZGF0YQ==")
  expect(face.inputs.dialog?.inputs.nodeInputs.first.source).toEqual([{ kind: "file", fileRef: { source: "managed", path: "/store/data/files/unique.csv" } }])
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_edit_invalid_slot_json_and_removal_are_diagnosed", async () => {
  await render(remoteOf())
  const { pending } = await prepare()
  await act(async () => { face.inputs.add("workflow", "__proto__", "text", "bad") })
  expect(face.inputs.dialog?.error).toContain(zh.runtimeInvalidSlot)
  await act(async () => { face.inputs.add("workflow", "data", "json", "broken") })
  expect(face.inputs.dialog?.error).toContain(zh.runtimeInvalidValue)
  await act(async () => { face.inputs.add("workflow", "subject", "text", "some text"); face.inputs.remove("workflow", "subject") })
  expect(face.inputs.dialog?.inputs.workflowInputs).toEqual({})
  await act(async () => { face.inputs.cancel() }); expect(await pending).toBeNull()
})

it("test_owner_change_cancels_pending_input_selection", async () => {
  const { rerender } = await render(remoteOf())
  const { pending } = await prepare()
  await rerender("session:other")
  expect(await pending).toBeNull()
  expect(face.inputs.dialog).toBeNull()
})

it("test_template_instance_transition_preserves_requested_dialog", async () => {
  const { rerender } = await render(remoteOf(), "session:template")
  const { pending } = await prepare()
  await rerender("session:flow")
  expect(face.inputs.dialog?.flowId).toBe("flow")
  await act(async () => { face.inputs.cancel() }); expect(await pending).toBeNull()
})

it("test_late_start_response_after_document_change_does_not_patch_new_document", async () => {
  const gate = deferred<{ runId: string }>()
  const { rerender, dispatch } = await render(remoteOf(() => gate.promise))
  let pending!: Promise<string | null>
  await act(async () => { pending = face.control.startRun("session", "flow", true) })
  await act(async () => { face.inputs.add("workflow", "subject", "text", "topic"); await face.inputs.submit() })
  await rerender("session:other")
  gate.resolve({ runId: "old" })
  expect(await pending).toBeNull()
  expect(dispatch).not.toHaveBeenCalled()
})

it("test_unmount_during_input_options_ignores_late_result", async () => {
  const gate = deferred<RuntimeInputOptions>()
  await render({ call: vi.fn(() => gate.promise) } as unknown as RemoteFace)
  let pending!: ReturnType<PrepareRuntimeInputs>
  await act(async () => { pending = face.inputs.prepare("session", "flow") })
  await act(async () => { root!.unmount() }); root = undefined
  gate.resolve(options)
  expect(await pending).toBeNull()
})

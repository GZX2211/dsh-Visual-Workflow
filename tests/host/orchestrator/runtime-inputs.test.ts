import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { handoffPolicyOf, jsonValueOf, runtimeInputsOf, publicRuntimeInputs, nodeInputAttachments } from "../../../src/host/orchestrator/runtime-inputs.js"
import type { InputSlots, SessionInputFile } from "../../../src/host/shared/runtime-types.js"
import { cleanupTempDirs, makeFlow, makeHarness } from "./fixtures/harness.js"
afterEach(cleanupTempDirs)

it.each(["session", "binding", "managed", "required", "ctx"])("test_harness_%s_file_selection_keeps_authorization_and_explicit_priority", async (kind) => {
  const h = await makeHarness()
  const files: SessionInputFile[] = []
  for (const name of ["one.md", "two.json"]) {
    const path = join(h.dir, name); await writeFile(path, "data")
    files.push({ attachmentId: name, name, bytes: 4, path })
  }
  const flow = makeFlow()
  const node = flow.nodes.find((node) => node.id === "n-a1")!
  if (node.kind !== "agent") throw new Error("fixture")
  const inputs: InputSlots = {}
  if (kind === "binding") inputs.doc = [{ kind: "file", fileRef: { source: "attachment", ...files[1], path: "/forged/path" } }]
  if (kind === "managed") inputs.doc = [{ kind: "file", fileRef: { source: "managed", path: "explicit-file" } }]
  if (kind === "required") node.data.execution = { requiredFiles: ["explicit-file"] }
  if (kind === "ctx") {
    flow.nodes.push({ id: "doc", kind: "file", position: { x: 0, y: 0 }, data: { label: "explicit file", fileKind: "file" } })
    flow.lines.push({ id: "file-in", source: "doc", target: node.id, sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  }
  const attachments = await nodeInputAttachments(flow, node, inputs, { sessionId: "session-1", managedRoot: h.dir, files }, () => { throw new Error("valid fixture must not be unavailable") })
  const candidates = kind === "session" ? files : kind === "binding" ? [files[1]] : []
  expect(attachments).toEqual(candidates.map(({ attachmentId, name, bytes }) => ({ attachmentId, name, bytes, source: kind === "binding" ? "binding" : "session" })))
  expect(JSON.stringify(attachments)).not.toContain(h.dir)
})

it("test_unavailable_optional_session_context_is_reported_without_requiring_a_file_for_ordinary_node", async () => {
  const h = await makeHarness()
  const flow = makeFlow(); const node = flow.nodes.find((node) => node.id === "n-a1")!
  if (node.kind !== "agent") throw new Error("fixture")
  const file = { attachmentId: "removed", name: "removed.txt", bytes: 4, path: join(h.dir, "missing") }
  const unavailable: string[] = []
  expect(await nodeInputAttachments(flow, node, {}, { sessionId: "session-1", managedRoot: h.dir, files: [file] }, (ref, error) => { unavailable.push(`${ref.attachmentId}:${error.code}`) })).toEqual([])
  expect(unavailable).toEqual(["removed:WF_INPUT_FILE_UNAVAILABLE"])
})

it.each(["foreign", "forged"])("test_harness_%s_explicit_attachment_is_rejected_instead_of_falling_back_to_context", async (kind) => {
  const h = await makeHarness(); const flow = makeFlow(); const node = flow.nodes.find((node) => node.id === "n-a1")!
  if (node.kind !== "agent") throw new Error("fixture")
  const path = join(h.dir, "allowed"); await writeFile(path, "data")
  const file = { attachmentId: "own", name: "allowed", bytes: 4, path }
  const inputs: InputSlots = { doc: [{ kind: "file", fileRef: { source: "attachment", ...file, ...(kind === "foreign" ? { attachmentId: "other-session" } : { bytes: 5 }) } }] }
  await expect(nodeInputAttachments(flow, node, inputs, { sessionId: "session-1", managedRoot: h.dir, files: [file] }, () => {})).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
})

it.each(["unique", "proxy", "multiple", "conditional", "group", "isolated"])("test_input_options_%s_initial_target_uses_existing_graph_query", async (kind) => {
  const h = await makeHarness(undefined, { sessionInputFiles: async () => [{ attachmentId: "authorized", name: "sales.csv", bytes: 4, path: "/private/host/location" }] })
  const flow = makeFlow()
  flow.lines = [
    { id: "begin", source: "n-start", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" },
    { id: "next", source: "n-a1", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" },
  ]
  if (kind === "proxy") { flow.nodes.push({ id: "first-proxy", kind: "proxy", proxySourceId: "n-a1", position: { x: 0, y: 0 } }); flow.lines[0].target = "first-proxy" }
  if (kind === "multiple") flow.lines[1].source = "n-start"
  if (kind === "conditional") flow.lines[0].condition = { type: "pass" }
  if (kind === "group") { const first = flow.nodes.find((node) => node.id === "n-a1")!; if (first.kind === "agent") first.data.groupId = "group" }
  if (kind === "isolated") flow.lines.shift()
  await h.store.saveWorkflow(flow, "session-1")
  const options = await h.runtime.runtimeInputOptions({ sessionId: "session-1", flowId: flow.id })
  expect(options.initialNodeId).toBe(kind === "unique" || kind === "proxy" ? "n-a1" : undefined)
  expect(options.files).toEqual([{ attachmentId: "authorized", name: "sales.csv", bytes: 4 }])
  expect(JSON.stringify(options)).not.toContain("/private/host/location")
})

it("test_runtime_input_managed_symlink_and_path_escape_are_rejected", async () => {
  const h = await makeHarness()
  const outside = await makeHarness()
  await mkdir(join(h.dir, "data", "files"), { recursive: true })
  await writeFile(join(outside.dir, "secret"), "not authorized")
  await symlink(join(outside.dir, "secret"), join(h.dir, "data", "files", "escape"))
  for (const path of [join(outside.dir, "secret"), "data/files/escape", "../secret"]) {
    await expect(runtimeInputsOf({ workflowInputs: { input: [{ kind: "file", fileRef: { source: "managed", path } }] } }, makeFlow(), { sessionId: "session-1", managedRoot: h.dir, files: [] })).rejects.toMatchObject({ code: path === "../secret" ? "WF_INPUT_FILE_UNAVAILABLE" : "WF_INPUT_FILE_UNAUTHORIZED" })
  }
})

it("test_attachment_requires_exact_current_session_reference_and_ignores_supplied_path", async () => {
  const h = await makeHarness()
  const path = join(h.dir, "attachment.txt")
  await writeFile(path, "disk")
  const ref = { attachmentId: "current", name: "a.txt", bytes: 4, path }
  const access = { sessionId: "session-1", managedRoot: h.dir, files: [ref, { ...ref, attachmentId: "another" }] }
  const raw = { workflowInputs: { input: [{ kind: "file", fileRef: { source: "attachment", ...ref, path: "/forged/path" }, origin: { source: "node", runId: "fake" } }] } }
  const parsed = await runtimeInputsOf(raw, makeFlow(), access)
  expect(parsed.workflowInputs.input).toEqual([{ kind: "file", fileRef: { source: "attachment", ...ref }, origin: { source: "attachment" } }])
  expect(parsed.nodeInputs).toEqual({})
  expect(publicRuntimeInputs(parsed)?.workflowInputs.input).toEqual([{ kind: "file", fileRef: { source: "attachment", attachmentId: "current", name: "a.txt", bytes: 4 }, origin: { source: "attachment" } }])
  expect(parsed.workflowInputs.input[0]).toMatchObject({ fileRef: { path } })
  expect(publicRuntimeInputs(undefined)).toBeUndefined()
  await expect(runtimeInputsOf(raw, makeFlow(), { ...access, files: [] })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
  await expect(runtimeInputsOf({ workflowInputs: { input: [{ kind: "file", fileRef: { source: "attachment", ...ref, bytes: 3 } }] } }, makeFlow(), access)).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
})

const invalidInputs: unknown[] = [null, [], { workflowInputs: { x: [{ kind: "output", nodeId: "n-a1" }] } }, { nodeInputs: { missing: {} } }, { nodeInputs: { "n-a2": {}, "n-proxy-a2": {} } }, { workflowInputs: { x: [{ kind: "text", value: 3 }] } }, { workflowInputs: { x: "no array" } }, { workflowInputs: { x: Array(33).fill({ kind: "text", value: "x" }) } }, { workflowInputs: { x: [{ kind: "text", value: "x".repeat(262145) }] } }, { workflowInputs: { constructor: [] } }, { workflowInputs: { x: [{ kind: "file", fileRef: { source: "workspace", path: "/tmp/a" } }] } }]
it.each(invalidInputs.map((raw) => [raw] as [unknown]))("test_runtime_input_invalid_shape_returns_stable_error_%#", async (raw) => {
  const h = await makeHarness()
  await expect(runtimeInputsOf(raw, makeFlow(), { sessionId: "session-1", managedRoot: h.dir, files: [] })).rejects.toMatchObject({ code: "WF_RUNTIME_INPUT_INVALID" })
})

it("test_json_parser_rejects_cycles_nonfinite_unsafe_keys_and_excess_depth", () => {
  const cycle: unknown[] = []; cycle.push(cycle)
  let deep: unknown = null; for (let i = 0; i < 26; i++) deep = [deep]
  for (const raw of [cycle, Infinity, undefined, new Date(), JSON.parse('{"__proto__":1}'), deep]) expect(() => jsonValueOf(raw, "value")).toThrowError(expect.objectContaining({ code: "WF_RUNTIME_INPUT_INVALID" }))
  expect(jsonValueOf({ a: [null, true, 2, "ok"] }, "value")).toEqual({ a: [null, true, 2, "ok"] })
  expect(handoffPolicyOf("auto")).toBe("auto")
  expect(handoffPolicyOf("explicit")).toBe("explicit")
  expect(() => handoffPolicyOf("strict")).toThrowError(expect.objectContaining({ code: "WF_RUNTIME_INPUT_INVALID" }))
})

it("test_required_initial_input_is_rejected_before_parent_injection", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  const first = flow.nodes.find((node) => node.id === "n-a1")!
  if (first.kind === "agent") first.data.execution = { inputs: { query: { kind: "text" } } }
  await h.store.saveWorkflow(flow, "session-1")
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: flow.id })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.agents.roots.get("session-1")!.messages).toEqual([])
  expect(h.runtime.activeRunForSession("session-1")).toBeNull()
  expect(h.runner.calls).toEqual([])
})

it("test_multiple_attachment_candidates_never_fill_required_initial_input_automatically", async () => {
  const h = await makeHarness(undefined, { sessionInputFiles: async () => [{ attachmentId: "one", name: "data", bytes: 1, path: "/one" }, { attachmentId: "two", name: "data", bytes: 1, path: "/two" }] })
  const flow = makeFlow()
  const first = flow.nodes.find((node) => node.id === "n-a1")!
  if (first.kind === "agent") first.data.execution = { inputs: { input: { kind: "file" } } }
  await h.store.saveWorkflow(flow, "session-1")
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: flow.id })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.runner.calls).toEqual([])
  expect(h.agents.roots.get("session-1")!.messages).toEqual([])
})

it("test_initial_snapshot_write_failure_does_not_wake_parent_or_retain_lock", async () => {
  const h = await makeHarness()
  await h.store.saveWorkflow(makeFlow(), "session-1")
  const { vi } = await import("vitest")
  vi.spyOn(h.store, "saveRun").mockRejectedValueOnce(new Error("disk full"))
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", runtimeInputs: { workflowInputs: { input: [{ kind: "text", value: "draft" }] }, nodeInputs: {} } })).rejects.toMatchObject({ code: "WF_DEF_WRITE_FAILED" })
  expect(h.agents.roots.get("session-1")!.messages).toEqual([])
  expect(h.runtime.activeRunForSession("session-1")).toBeNull()
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })).resolves.toMatchObject({ runId: "run-2" })
})

it("test_pending_binding_cannot_remove_a_required_slot_using_previous_binding_as_evidence", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  const node = flow.nodes.find((node) => node.id === "n-a2")!
  if (node.kind === "agent") node.data.execution = { inputs: { source: { kind: "text" } } }
  await h.store.saveWorkflow(flow, "session-1")
  await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, runtimeInputs: { nodeInputs: { "n-a2": { source: [{ kind: "text", value: "required" }] } } } })
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: "run-1", nodeId: "n-a2", expectedRevision: 1, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.runtime.runSnapshot("run-1")?.inputRevision).toBe(1)
  expect(h.runtime.runSnapshot("run-1")?.runtimeInputs?.nodeInputs["n-a2"].source[0]).toMatchObject({ value: "required" })
})

it("test_runtime_managed_upload_from_other_session_is_rejected_in_current_run", async () => {
  const h = await makeHarness()
  const { copyIntoManagedFile } = await import("../../../src/host/storage/managed-files.js")
  const uploaded = await copyIntoManagedFile(h.dir, { sessionId: "session-1", name: "input.txt", base64: Buffer.from("owned").toString("base64") })
  const raw = { workflowInputs: { source: [{ kind: "file", fileRef: { source: "managed", path: uploaded.managedPath } }] } }
  expect((await runtimeInputsOf(raw, makeFlow(), { sessionId: "session-1", managedRoot: h.dir, files: [] })).workflowInputs.source[0]).toMatchObject({ kind: "file" })
  await expect(runtimeInputsOf(raw, makeFlow(), { sessionId: "session-other", managedRoot: h.dir, files: [] })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
})

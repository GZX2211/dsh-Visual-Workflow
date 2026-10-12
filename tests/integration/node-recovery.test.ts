import { runtimeManagedPrefix } from "../../src/host/storage/managed-files.js"
// Real runner + runtime + permission/prompt setup + persistence; only the DSH transport is fake.
import { mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { afterEach, expect, it, onTestFinished, vi } from "vitest"
import type { NodeStartInput } from "../../src/host/orchestrator/index.js"
import { NodeAgentRunner } from "../../src/host/agent/runner.js"
import type { SubagentsServiceLike } from "../../src/host/agent/runner.js"
import { createChildToolFilterSetup } from "../../src/host/agent/child-tool-filter.js"
import { createChildPromptSetup } from "../../src/host/agent/prompt-setup.js"
import { createModelSelectionSetup } from "../../src/host/agent/model-selection.js"
import { createReactGuard } from "../../src/host/agent/guards.js"
import { agent, caller, cleanupTempDirs, makeFlow, makeHarness, stage, start } from "../host/orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)

async function makeRealRunnerHarness(nodeId = "n-a1", options: { configure?: (flow: import("../../src/host/shared/graph-model.js").WorkflowDocument) => void; runtimeInputs?: unknown; handoffPolicy?: unknown; deferStart?: boolean; authorizedInputFiles?: () => Promise<readonly string[]>; sessionInputFiles?: () => Promise<readonly import("../../src/host/shared/runtime-types.js").SessionInputFile[]> } = {}) {
  const h = await makeHarness(undefined, { workingDirectory: async () => h.dir, sessionInputFiles: options.sessionInputFiles, authorizedInputFiles: options.authorizedInputFiles })
  const flow = makeFlow()
  options.configure?.(flow)
  for (const configured of flow.nodes) if (configured.kind === "agent") configured.data.presetId = "standard"
  const node = flow.nodes.find((node) => node.id === nodeId)!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.presetId = "standard"
  node.data.systemPrompt = "节点独立角色"
  const toolFilter = createChildToolFilterSetup()
  const promptSetup = createChildPromptSetup()
  const starts: Parameters<SubagentsServiceLike["startContinuable"]>[0][] = []
  const accepted: string[] = []
  const sent: string[] = []
  const sentContents: Parameters<NonNullable<SubagentsServiceLike["sendMessage"]>>[2][] = []
  const interrupted: string[] = []
  const epochs = new Map<string, string>()
  const control: { resumable: boolean; startGate?: Promise<void>; onStart?: (spec: Parameters<SubagentsServiceLike["startContinuable"]>[0]) => void | Promise<void> } = { resumable: true }
  let epoch = 0
  const activate = (childId: string) => {
    const runId = `epoch-${++epoch}`
    epochs.set(childId, runId)
    h.runtime.handleSubagentStart({ id: childId, runId })
    accepted.push(childId)
  }
  const transport: SubagentsServiceLike = {
    list: () => ["spawn"],
    startContinuable: async (spec) => {
      // Creation-window state is real AsyncLocalStorage, never broadened on recovery.
      expect(toolFilter.peekPending?.()).toEqual(["read", "write"])
      const executing = flow.nodes.find((candidate) => candidate.kind === "agent" && spec.request.prompt.some((block) => block.type === "text" && block.text.includes(`「${candidate.data.label}」`)))
      expect(promptSetup.peekPending()).toMatchObject({ systemPrompt: executing?.kind === "agent" ? executing.data.systemPrompt : node.data.systemPrompt })
      starts.push(spec)
      await control.onStart?.(spec)
      await control.startGate
      const childId = `child-${starts.length}`
      activate(childId)
      return { childId }
    },
    sendMessage: async (_sender, childId, content) => {
      sent.push(childId)
      if (!control.resumable) throw Object.assign(new Error("持久化子代理不可恢复", { cause: new Error("持久会话不可用") }), { name: "SubagentError", code: "NOT_RESUMABLE" })
      sentContents.push(content)
      activate(childId)
    },
    interrupt: (childId) => { interrupted.push(childId) },
  }
  const retired: string[] = []
  const runner = new NodeAgentRunner({
    store: h.store,
    agents: () => ({ get: (id) => h.agents.getRootAgent(id) }),
    subagents: () => transport,
    teams: () => null,
    toolsView: { visibleToolNames: async () => ["read", "write"], agentToolNames: async () => ["read", "write"], presetToolNames: async () => ["read", "write"] },
    toolFilter, promptSetup, modelSelection: createModelSelectionSetup(), react: createReactGuard().bridge,
    retireChild: (id) => { retired.push(id); toolFilter.remember(id, undefined) },
  })
  const dispatched: NodeStartInput[] = []
  h.runner.startNodeTask = (input) => { dispatched.push(input); return runner.startNodeTask(input) }
  h.runner.interruptChild = (childId, sessionId) => runner.interruptChild(childId, sessionId)
  onTestFinished(() => { h.runtime.dispose(); runner.dispose() })
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  if (!options.deferStart) await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, runtimeInputs: typeof options.runtimeInputs === "function" ? await options.runtimeInputs(h.dir) : options.runtimeInputs, handoffPolicy: options.handoffPolicy })
  const settle = (childId: string, stopReason = "completed") => h.runtime.handleSubagentEnd({ id: childId, runId: epochs.get(childId), stopReason })
  return { h, node, get entry() { const entry = h.runtime.activeRunForSession("session-1"); if (!entry) throw new Error("fixture requires an active run"); return entry }, starts, accepted, sent, sentContents, interrupted, epochs, control, retired, dispatched, settle }
}

it("test_recovery_NOT_RESUMABLE_one_attempt_replaces_child_and_isolates_late_end", async () => {
  const { h, node, entry, control, starts, accepted, retired, dispatched } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "第一轮完成" }] })
  control.resumable = false
  const second = await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })
  expect(second.childId).toBe("child-2")
  expect(starts).toHaveLength(2)
  expect(accepted).toEqual(["child-1", "child-2"])
  expect(starts[1].request.prompt).toEqual(dispatched[1].blocks)
  expect(starts[1].request.prompt[0].text).toContain("子任务A")
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ attempts: 2, childId: "child-2", status: "running" })
  expect(entry.callCount).toBe(2)
  expect(retired).toEqual(["child-1"])
  expect(h.runtime.childMetaFor("child-1")).toMatchObject({ retired: true })
  expect(h.runtime.childMetaFor("child-2")).toMatchObject({ runId: entry.snapshot.id, attempt: 2, hostEpochId: "epoch-2" })
  const parentMessages = h.agents.roots.get("session-1")!.messages.length
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "error" })
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)!.status).toBe("running")
  expect(h.agents.roots.get("session-1")!.messages).toHaveLength(parentMessages)
  await h.runtime.handleSubagentEnd({ id: "child-2", runId: "epoch-2", stopReason: "completed" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })).rejects.toMatchObject({ code: "WF_RETRY_LIMIT" })
  expect(starts).toHaveLength(2)
  await h.runtime.wfFinish(caller, { status: "failed" })
  expect(h.runtime.activeRunForSession("session-1")).toBeNull()
})

it.each(["n-a1", "n-a2", "n-proxy-a2"])("test_dispatch_%s_unsettled_child_is_busy_without_consuming_budget", async (requestedNodeId) => {
  const canonicalNodeId = requestedNodeId === "n-proxy-a2" ? "n-a2" : requestedNodeId
  const { h, entry, starts, sent, accepted, dispatched } = await makeRealRunnerHarness(canonicalNodeId)
  const args = { nodeId: requestedNodeId, retryLimit: 0 }
  await expect(h.runtime.wfRunNode(caller, args)).resolves.toMatchObject({ status: "started", nodeId: canonicalNodeId, childId: "child-1" })

  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })

  expect(entry.callCount).toBe(1)
  expect(entry.attempts.get(canonicalNodeId)).toBe(1)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === canonicalNodeId)).toMatchObject({ status: "running", attempts: 1, childId: "child-1" })
  expect(starts).toHaveLength(1)
  expect(sent).toEqual([])
  expect(accepted).toEqual(["child-1"])
  expect(dispatched).toHaveLength(1)
})

it.each(["completed", "error"])("test_dispatch_%s_settlement_allows_cached_child_retry_within_budget", async (stopReason) => {
  const { h, node, entry, starts, sent, dispatched, settle } = await makeRealRunnerHarness()
  const args = { nodeId: node.id, retryLimit: 1 }
  await h.runtime.wfRunNode(caller, args)
  // A stale host epoch cannot release the execution-window mutex.
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-stale", stopReason })
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.callCount).toBe(1)
  await settle("child-1", stopReason)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe(stopReason === "completed" ? "ok" : "fail")

  await expect(h.runtime.wfRunNode(caller, args)).resolves.toMatchObject({ status: "started", childId: "child-1" })

  expect(starts).toHaveLength(1)
  expect(sent).toEqual(["child-1"])
  expect(dispatched).toHaveLength(2)
  expect(entry.callCount).toBe(2)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ status: "running", attempts: 2 })
  expect(h.runtime.childMetaFor("child-1")).toMatchObject({ attempt: 2, hostEpochId: "epoch-2" })
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.attempts.get(node.id)).toBe(2)
  await settle("child-1")
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_RETRY_LIMIT" })
  expect(sent).toHaveLength(1)
})

it.each([["n-a2", "n-proxy-a2"], ["n-proxy-a2", "n-a2"]])("test_dispatch_%s_and_%s_share_startup_and_execution_mutex", async (firstNodeId, secondNodeId) => {
  const { h, entry, control, starts, sent, dispatched } = await makeRealRunnerHarness("n-a2")
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  control.startGate = new Promise<void>((resolve) => { release = resolve })
  control.onStart = entered
  const first = h.runtime.wfRunNode(caller, { nodeId: firstNodeId })
  await started
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: secondNodeId })).rejects.toMatchObject({ code: "WF_BUSY" })
  } finally { release() }
  await expect(first).resolves.toMatchObject({ status: "started", childId: "child-1" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: secondNodeId })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.callCount).toBe(1)
  expect(entry.attempts.get("n-a2")).toBe(1)
  expect(starts).toHaveLength(1)
  expect(sent).toEqual([])
  expect(dispatched).toHaveLength(1)
})

it("test_dispatch_settlement_validation_pending_remains_busy_until_verified", async () => {
  const { h, node, entry, sent, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  let entered!: () => void
  let release!: () => void
  const checking = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = h.store.getWorkflow.bind(h.store)
  vi.spyOn(h.store, "getWorkflow").mockImplementationOnce(async (...args) => { entered(); await gate; return original(...args) })
  const settlement = settle("child-1")
  await checking
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: "WF_BUSY" })
    expect(entry.callCount).toBe(1)
    expect(sent).toEqual([])
  } finally { release() }
  await settlement
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).resolves.toMatchObject({ status: "started" })
  expect(sent).toEqual(["child-1"])
})

it("test_dispatch_stopped_checkpoint_resumes_without_stale_busy_and_rejects_old_epoch", async () => {
  const { h, node, entry, interrupted, sent, starts, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  await h.runtime.stopRun(entry.snapshot.id)
  expect(interrupted).toEqual(["child-1"])
  expect(entry.inflight.size).toBe(0)
  await h.runtime.resumeRun({ sessionId: "session-1", flowId: "flow-1" })

  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).resolves.toMatchObject({ status: "started", childId: "child-1" })

  const current = h.runtime.activeRunForSession("session-1")!
  expect(current.snapshot.id).not.toBe(entry.snapshot.id)
  expect(current.callCount).toBe(1)
  expect(starts).toHaveLength(1)
  expect(sent).toEqual(["child-1"])
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(current.callCount).toBe(1)
  await settle("child-1")
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("ok")
})

it("test_dispatch_paused_child_settles_and_checkpoint_retry_rebuilds_unrecoverable_child", async () => {
  const { h, node, entry, control, starts, sent, retired, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  await h.runtime.suspendRun(entry.snapshot.id)
  await settle("child-1", "error")
  expect(entry.snapshot.status).toBe("paused")
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("fail")
  expect(entry.inflight.size).toBe(0)
  control.resumable = false

  // wf_run_node keeps the existing automatic checkpoint takeover semantics.
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })).resolves.toMatchObject({ status: "started", childId: "child-2" })

  const current = h.runtime.activeRunForSession("session-1")!
  expect(current.snapshot.id).not.toBe(entry.snapshot.id)
  expect(current.callCount).toBe(1)
  expect(starts).toHaveLength(2)
  expect(sent).toEqual(["child-1"])
  expect(retired).toEqual(["child-1"])
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })).rejects.toMatchObject({ code: "WF_BUSY" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed" })
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ status: "running", attempts: 1, childId: "child-2" })
  await settle("child-2")
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("ok")
})

function serialFlow(flow: import("../../src/host/shared/graph-model.js").WorkflowDocument): void {
  flow.nodes = flow.nodes.filter((node) => node.kind !== "pause")
  flow.lines = [
    { id: "begin", source: "n-start", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" },
    { id: "next", source: "n-a1", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" },
    { id: "end", source: "n-a2", target: "n-end", sourceHandle: "flow-out", targetHandle: "flow-in" },
  ]
}

it.each(["ordinary", "declared"])("test_harness_single_attachment_%s_reaches_each_real_child_without_manual_binding", async (kind) => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts, control, settle } = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    if (kind === "declared") for (const node of flow.nodes) if (node.kind === "agent") node.data.execution = { inputs: { document: { kind: "file" } } }
  } })
  const path = join(h.dir, "unusual-extension.payload")
  await writeFile(path, "authorized document")
  const ref = { attachmentId: "admitted-document", name: "unusual-extension.payload", bytes: 19 }
  files.push({ ...ref, path })
  const reads: string[] = []
  control.onStart = async (spec) => {
    expect(spec.request.prompt.filter((block) => block.type === "file")).toEqual([{ type: "file", attachment: ref }])
    reads.push(await readFile(files.find((file) => file.attachmentId === ref.attachmentId)!.path, "utf8"))
    if (kind === "ordinary") expect(spec.request.prompt[0].text).not.toContain(path)
  }
  const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })
  for (const nodeId of ["n-a1", "n-a2"]) { const child = await h.runtime.wfRunNode(caller, { nodeId }); await settle(child.childId!) }
  await h.runtime.wfFinish(caller, { status: "completed" })
  const snapshot = (await h.store.getRun(runId))!
  expect(reads).toEqual(["authorized document", "authorized document"])
  expect(starts).toHaveLength(2)
  expect(snapshot.status).toBe("completed")
  for (const node of snapshot.nodes.filter((node) => ["n-a1", "n-a2"].includes(node.nodeId))) expect(node).toMatchObject({ attempts: 1, status: "ok", attemptHistory: [{ inputAttachments: [{ ...ref, source: kind === "ordinary" ? "session" : "binding" }] }] })
  if (kind === "ordinary") { expect(snapshot.runtimeInputs).toBeUndefined(); expect(snapshot.inputRevision).toBeUndefined() }
  else {
    expect(snapshot.inputRevision).toBe(1)
    for (const id of ["n-a1", "n-a2"]) expect(snapshot.runtimeInputs?.nodeInputs[id].document[0]).toMatchObject({ kind: "file", fileRef: { source: "attachment", ...ref, path } })
  }
})

it.each(["ctx", "requiredFiles"])("test_single_attachment_does_not_autobind_over_%s_dependency", async (source) => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts, settle } = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    const target = flow.nodes.find((node) => node.id === "n-a2")!
    if (target.kind !== "agent") throw new Error("fixture")
    target.data.execution = { inputs: { document: { kind: "file" } }, ...(source === "requiredFiles" ? { requiredFiles: ["upstream.txt"] } : {}) }
    if (source === "ctx") flow.lines.push({ id: "ctx", source: "n-a1", target: "n-a2", sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  } })
  const path = join(h.dir, "external.payload"); await writeFile(path, "context")
  files.push({ attachmentId: "external", name: "external.payload", bytes: 7, path })
  const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })
  const child = await h.runtime.wfRunNode(caller, { nodeId: "n-a1" }); await settle(child.childId!)

  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2" })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })

  const snapshot = (await h.store.getRun(runId))!
  expect(snapshot.runtimeInputs).toBeUndefined()
  expect(snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ status: "pending", attempts: 0 })
  expect(starts).toHaveLength(1)
})

it("test_single_attachment_does_not_replace_declared_auto_upstream_file", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts, settle } = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    for (const node of flow.nodes) if (node.kind === "agent") node.data.execution = node.id === "n-a1" ? { outputFiles: ["transformed.txt"] } : { inputs: { upstreamFiles: { kind: "file" } } }
  } })
  const path = join(h.dir, "original.payload"); await writeFile(path, "original")
  files.push({ attachmentId: "original", name: "original.payload", bytes: 8, path })
  const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", handoffPolicy: "auto" })
  const child = await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await writeFile(join(h.dir, "transformed.txt"), "verified current output")
  await settle(child.childId!)

  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })

  expect(starts[1].request.prompt.filter((block) => block.type === "file")).toEqual([])
  expect(starts[1].request.prompt[0].text).toContain(join(h.dir, "transformed.txt"))
  expect(starts[1].request.prompt[0].text).not.toContain(path)
  expect((await h.store.getRun(runId))?.runtimeInputs).toBeUndefined()
})

it("test_harness_multiple_attachments_reach_two_readers_without_runtime_guessing", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts, control, settle } = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    flow.lines = [{ id: "one", source: "n-start", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" }, { id: "two", source: "n-start", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" }, ...["n-a1", "n-a2"].map((source) => ({ id: source, source, target: "n-end", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }))]
  } })
  for (const [name, content] of [["brief.txt", "requirements"], ["records.json", '{"count":2}']]) {
    const path = join(h.dir, name); await writeFile(path, content)
    files.push({ attachmentId: name, name, bytes: Buffer.byteLength(content), path })
  }
  const refs = files.map(({ attachmentId, name, bytes }) => ({ type: "file" as const, attachment: { attachmentId, name, bytes } }))
  const reads: string[] = []
  control.onStart = async (spec) => {
    expect(spec.request.prompt.filter((block) => block.type === "file")).toEqual(refs)
    // Controlled model choice deliberately differs from the attachment's list order.
    const selected = refs[starts.length === 1 ? 1 : 0].attachment
    reads.push(await readFile(files.find((file) => file.attachmentId === selected.attachmentId)!.path, "utf8"))
  }
  const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })
  for (const nodeId of ["n-a1", "n-a2"]) { const child = await h.runtime.wfRunNode(caller, { nodeId }); await settle(child.childId!) }
  await h.runtime.wfFinish(caller, { status: "completed" })
  expect(reads).toEqual(['{"count":2}', "requirements"])
  const snapshot = (await h.store.getRun(runId))!
  expect(snapshot.runtimeInputs).toBeUndefined()
  for (const node of snapshot.nodes.filter((node) => ["n-a1", "n-a2"].includes(node.nodeId))) expect(node.attemptHistory?.[0].inputAttachments).toEqual(refs.map(({ attachment }) => ({ ...attachment, source: "session" })))
})

it("test_harness_upload_during_execution_only_reaches_a_legitimate_next_attempt", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts, sentContents, settle, entry } = await makeRealRunnerHarness(undefined, { sessionInputFiles: async () => files })
  for (const [name, content] of [["first.md", "first"], ["second.md", "second"]]) {
    const path = join(h.dir, name); await writeFile(path, content)
    files.push({ attachmentId: name, name, bytes: content.length, path })
    if (files.length === 1) await h.runtime.wfRunNode(caller, { nodeId: "n-a1", retryLimit: 1 })
  }
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1", retryLimit: 1 })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(starts).toHaveLength(1); expect(sentContents).toEqual([])
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a1")?.attemptHistory?.[0].inputAttachments).toHaveLength(1)
  await settle("child-1", "error")
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1", retryLimit: 1 })
  expect(sentContents[0].filter((block) => block.type === "file")).toEqual(files.map(({ attachmentId, name, bytes }) => ({ type: "file", attachment: { attachmentId, name, bytes } })))
  expect((await h.store.getRun(entry.snapshot.id))?.nodes.find((node) => node.nodeId === "n-a1")?.attemptHistory?.map((attempt) => attempt.inputAttachments?.length)).toEqual([1, 2])
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed" })
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a1")).toMatchObject({ status: "running", attempts: 2 })
})

it("test_harness_generic_text_files_multiple_sources_condition_and_report_use_real_runtime", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const ids = ["draft", "left", "right", "combine", "inspect", "final"]
  const flowEdge = (source: string, target: string, condition?: import("../../src/host/shared/graph-model.js").Line["condition"]): import("../../src/host/shared/graph-model.js").Line => ({ id: `${source}-${target}`, source, target, sourceHandle: "flow-out", targetHandle: "flow-in", ...(condition ? { condition } : {}) })
  const { h, starts, epochs, control } = await makeRealRunnerHarness("draft", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    flow.nodes = [stage("begin", "start"), ...[...ids, "unused"].map((id) => agent(id, id, { execution: id === "final" ? { outputFiles: ["report.md"], inputSource: "ctx" } : id === "combine" ? { inputSource: "ctx" } : {} })), stage("done", "end")]
    flow.lines = [...["draft", "left", "right"].map((id) => flowEdge("begin", id)), ...["draft", "left", "right"].map((id) => flowEdge(id, "combine")), flowEdge("combine", "inspect", { type: "content", label: "needs inspection" }), flowEdge("combine", "unused", { type: "content", label: "alternative" }), flowEdge("inspect", "final"), flowEdge("unused", "final", { type: "content", label: "alternative report" }), flowEdge("final", "done")]
    flow.lines.push(...["draft", "left", "right"].map((id) => ({ id: `ctx-${id}`, source: id, target: "combine", sourceHandle: "ctx-out" as const, targetHandle: "ctx-in" as const })), { id: "ctx-final", source: "inspect", target: "final", sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  } })
  for (const [name, content] of [["brief.md", "apply rounding"], ["data.json", '{"value":21}']]) {
    const path = join(h.dir, name); await writeFile(path, content)
    files.push({ attachmentId: name, name, bytes: Buffer.byteLength(content), path })
  }
  const outputs = new Map<string, string>()
  const reads: string[] = []
  control.onStart = async (spec) => {
    const text = spec.request.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n")
    const id = ids.find((id) => text.includes(`「${id}」`))!
    let output = "Use the authorized documents"
    if (id === "left" || id === "right") {
      const refs = spec.request.prompt.filter((block) => block.type === "file")
      const ref = refs[id === "left" ? 0 : 1].attachment
      output = await readFile(files.find((file) => file.attachmentId === ref.attachmentId)!.path, "utf8"); reads.push(output)
    } else if (id === "combine") {
      for (const source of ["draft", "left", "right"]) expect(text).toContain(outputs.get(source))
      output = "needs inspection: apply rounding to value 21"
    } else if (id === "inspect") output = "Inspected value: 21; rounding applied"
    else if (id === "final") {
      expect(text).toContain(outputs.get("inspect"))
      const path = join(h.dir, "report.md")
      await writeFile(path, `# Generic report\n${outputs.get("inspect")}\n`)
      output = path
    }
    outputs.set(id, output)
  }
  const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })
  for (const nodeId of ids) {
    const { childId } = await h.runtime.wfRunNode(caller, { nodeId })
    await h.runtime.handleSubagentEnd({ id: childId, runId: epochs.get(childId!), stopReason: "completed", lastAssistantMessage: [{ type: "text", text: outputs.get(nodeId)! }] })
  }
  await h.runtime.wfFinish(caller, { status: "completed" })
  const snapshot = (await h.store.getRun(runId))!
  expect(snapshot.status).toBe("completed")
  expect(starts).toHaveLength(6)
  expect(reads).toEqual(["apply rounding", '{"value":21}'])
  expect(snapshot.nodes.filter((node) => ids.includes(node.nodeId)).every((node) => node.status === "ok" && node.attempts === 1)).toBe(true)
  expect(snapshot.nodes.find((node) => node.nodeId === "unused")).toMatchObject({ status: "skipped", attempts: 0 })
  expect(snapshot.nodes.find((node) => node.nodeId === "final")?.artifacts?.[0]).toMatchObject({ path: join(h.dir, "report.md"), attempt: 1, runId })
  expect(await readFile(join(h.dir, "report.md"), "utf8")).toBe("# Generic report\nInspected value: 21; rounding applied\n")
})

it.each(["none", "ambiguous"])("test_required_initial_attachment_%s_without_binding_never_starts_child_or_parent", async (kind) => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts } = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    const first = flow.nodes.find((node) => node.id === "n-a1")!
    if (first.kind === "agent") first.data.execution = { inputs: { source: { kind: "file" } } }
  } })
  const path = join(h.dir, "sales_workflow_test.csv")
  await writeFile(path, "authorized")
  if (kind === "ambiguous") files.push({ attachmentId: "admitted", name: "sales_workflow_test.csv", bytes: 10, path }, { attachmentId: "another", name: "other.txt", bytes: 10, path })
  for (let index = 0; index < 2; index++) {
    h.agents.roots.get("session-1")!.session.events.push({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "已经上传" }] } })
    await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1" })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  }
  expect(starts).toEqual([])
  expect(h.agents.roots.get("session-1")!.messages).toEqual([])
  expect(await h.store.listRuns("flow-1", "session-1")).toEqual([])
})

it("test_authorized_initial_attachment_binding_is_persisted_and_read_on_first_real_runner_dispatch", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const fixture = await makeRealRunnerHarness("n-a1", { deferStart: true, sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    const first = flow.nodes.find((node) => node.id === "n-a1")!
    if (first.kind === "agent") first.data.execution = { inputs: { source: { kind: "file" } } }
  } })
  const { h, starts, control } = fixture
  const path = join(h.dir, "session-attachment.csv")
  await copyFile(fileURLToPath(new URL("../fixtures/sales_workflow_test.csv", import.meta.url)), path)
  const bytes = (await readFile(path)).length
  const ref = { attachmentId: "official-reference", name: "sales_workflow_test.csv", bytes }
  files.push({ ...ref, path })
  const options = await h.runtime.runtimeInputOptions({ sessionId: "session-1", flowId: "flow-1" })
  expect(options).toMatchObject({ initialNodeId: "n-a1", files: [ref] })
  expect(JSON.stringify(options)).not.toContain(path)
  await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", runtimeInputs: { nodeInputs: { "n-a1": { source: [{ kind: "file", fileRef: { source: "attachment", ...options.files[0], path: "/forged/path" } }] } } } })
  let actualInput = ""
  control.onStart = async (spec) => {
    expect(spec.request.prompt[0].text).toContain(path)
    actualInput = await readFile(path, "utf8")
  }
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1", retryLimit: 0 })
  expect(actualInput.trim().split(/\r?\n/)).toHaveLength(12)
  expect(starts).toHaveLength(1)
  const snapshot = (await h.store.getRun(fixture.entry.snapshot.id))!
  expect(snapshot).toMatchObject({ inputRevision: 1, runtimeInputs: { nodeInputs: { "n-a1": { source: [{ fileRef: { source: "attachment", ...ref, path } }] } } } })
  expect(snapshot.nodes.find((node) => node.nodeId === "n-a1")).toMatchObject({ status: "running", attempts: 1 })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1", retryLimit: 0 })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(fixture.entry.callCount).toBe(1)
})

it("test_pending_attachment_upload_and_natural_language_do_not_change_revision_until_binding", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, entry, starts } = await makeRealRunnerHarness("n-a2", { sessionInputFiles: async () => files, configure: (flow) => {
    serialFlow(flow)
    const target = flow.nodes.find((node) => node.id === "n-a2")!
    if (target.kind === "agent") target.data.execution = { inputs: { source: { kind: "file" } } }
  } })
  const path = join(h.dir, "admitted.csv")
  await writeFile(path, "disk data")
  const ref = { attachmentId: "admitted", name: "sales.csv", bytes: 9 }
  files.push({ ...ref, path })
  for (let index = 0; index < 2; index++) {
    h.agents.roots.get("session-1")!.session.events.push({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "已经上传" }] } })
    await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  }
  expect(entry.callCount).toBe(0)
  expect(entry.snapshot.inputRevision).toBeUndefined()
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ status: "pending", attempts: 0 })
  expect(starts).toEqual([])
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-proxy-a2", expectedRevision: 0, inputs: { source: [{ kind: "file", fileRef: { source: "attachment", ...ref } }] } })
  expect((await h.store.getRun(entry.snapshot.id))?.inputRevision).toBe(1)
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })
  expect(starts[0].request.prompt[0].text).toContain(path)
  expect(entry.callCount).toBe(1)
})

it.each(["running", "failed", "exhausted", "stopped"])("test_attachment_hot_binding_%s_is_rejected_without_resetting_attempts", async (state) => {
  const { h, node, entry, starts, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })
  if (state !== "running") await settle("child-1", "error")
  if (state === "exhausted") await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })).rejects.toMatchObject({ code: "WF_RETRY_LIMIT" })
  if (state === "stopped") await h.runtime.stopRun(entry.snapshot.id)
  const previous = structuredClone(entry.snapshot)
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: node.id, expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_STATE_CONFLICT", message: expect.stringContaining("新建运行") })
  expect(entry.snapshot).toEqual(previous)
  expect(starts).toHaveLength(1)
})

it("test_new_run_accepts_selected_attachment_and_isolates_old_failed_child", async () => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, node, entry, starts, control, settle } = await makeRealRunnerHarness(undefined, { sessionInputFiles: async () => files })
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })
  await settle("child-1", "error")
  await h.runtime.stopRun(entry.snapshot.id)
  const path = join(h.dir, "selected.csv")
  await writeFile(path, "selected input")
  const ref = { attachmentId: "selected", name: "sales.csv", bytes: 14 }
  files.push({ ...ref, path })
  const result = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", runtimeInputs: { nodeInputs: { [node.id]: { source: [{ kind: "file", fileRef: { source: "attachment", ...ref } }] } } } })
  control.resumable = false
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain(path)
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "old failure cannot become evidence" }] })
  const snapshot = h.runtime.runSnapshot(result.runId)!
  expect(snapshot).toMatchObject({ flowId: "flow-1", inputRevision: 1 })
  expect(snapshot.resumedFromRunId).toBeUndefined()
  expect(snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ status: "running", attempts: 1, childId: "child-2", output: "" })
  expect((await h.store.getRun(result.runId))?.runtimeInputs?.nodeInputs[node.id].source[0]).toMatchObject({ fileRef: { ...ref, path } })
})

it.each(["foreign", "forged", "revoked"])("test_attachment_%s_is_rejected_before_real_runner_start", async (kind) => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const { h, starts } = await makeRealRunnerHarness(undefined, { deferStart: true, sessionInputFiles: async () => files })
  const path = join(h.dir, "own.csv")
  await writeFile(path, "own")
  const ref = { attachmentId: "own", name: "own.csv", bytes: 3 }
  if (kind !== "revoked") files.push({ ...ref, path })
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", runtimeInputs: { nodeInputs: { "n-a1": { source: [{ kind: "file", fileRef: { source: "attachment", ...ref, ...(kind === "foreign" ? { attachmentId: "other-session" } : kind === "forged" ? { bytes: 4 } : {}) } }] } } } })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
  expect(starts).toEqual([])
  expect(h.agents.roots.get("session-1")!.messages).toEqual([])
})

it.each(["text", "json", "file"])("test_input_%s_without_file_node_reaches_first_real_child", async (kind) => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, runtimeInputs: async (dir: string) => {
    await mkdir(join(dir, "data", "files"), { recursive: true })
    await writeFile(join(dir, "data", "files", `${runtimeManagedPrefix("session-1")}input.txt`), "file content stays on disk")
    const value = kind === "text" ? { kind, value: "USER_TEXT" } : kind === "json" ? { kind, value: { nested: [1, true, null] } } : { kind, fileRef: { source: "managed", path: `data/files/${runtimeManagedPrefix("session-1")}input.txt` } }
    return { workflowInputs: { input: [value] }, nodeInputs: {} }
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  expect(starts).toHaveLength(1)
  const prompt = starts[0].request.prompt.map((block) => block.text).join("\n")
  expect(prompt).toContain(kind === "text" ? "USER_TEXT" : kind === "json" ? "nested" : join(h.dir, "data", "files", `${runtimeManagedPrefix("session-1")}input.txt`))
  expect(prompt).not.toContain("file content stays on disk")
  expect(entry.snapshot.workflowInputNodeId).toBe("n-a1")
  expect((await h.store.getRun(entry.snapshot.id))?.runtimeInputs?.workflowInputs.input[0].kind).toBe(kind)
})

it("test_required_input_missing_no_child_or_budget_then_pending_binding_recovers", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: (flow) => {
    serialFlow(flow)
    const node = flow.nodes.find((node) => node.id === "n-a2")!
    if (node.kind === "agent") node.data.execution = { inputs: { payload: { kind: "json" } } }
  } })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(starts).toEqual([])
  expect(entry.callCount).toBe(0)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ status: "pending", attempts: 0 })
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-proxy-a2", expectedRevision: 0, inputs: { payload: [{ kind: "json", value: { ready: true } }] } })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })).resolves.toMatchObject({ status: "started" })
  expect(starts).toHaveLength(1)
  expect(starts[0].request.prompt[0].text).toContain("ready")
  expect(entry.callCount).toBe(1)
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 1, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_STATE_CONFLICT" })
})

it("test_auto_handoff_text_in_first_downstream_real_child_without_ctx", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: '{"result":"VALID_JSON_TEXT"}' }] })
  await h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("VALID_JSON_TEXT")
  expect(starts[1].request.prompt[0].text).toContain('"attempt": 1')
  expect(starts[1].request.prompt[0].text).toContain(entry.snapshot.id)
  expect(entry.baseFlow.lines.some((line) => line.targetHandle === "ctx-in")).toBe(false)
})

it("test_auto_handoff_file_verified_current_write_reaches_downstream_first_prompt", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: (flow) => {
    serialFlow(flow)
    const first = flow.nodes.find((node) => node.id === "n-a1")!
    if (first.kind === "agent") first.data.execution = { outputFiles: ["result.json"] }
  }, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await writeFile(join(h.dir, "result.json"), '{"private":"FILE_BODY_NOT_IN_PROMPT"}')
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "result ready" }] })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[1].request.prompt[0].text).toContain(join(h.dir, "result.json"))
  expect(starts[1].request.prompt[0].text).not.toContain("FILE_BODY_NOT_IN_PROMPT")
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a1")?.artifacts?.[0]).toMatchObject({ runId: entry.snapshot.id, attempt: 1, nodeId: "n-a1", signature: expect.any(String) })
})

it.each(["running", "failed", "retried"])("test_auto_%s_upstream_is_not_usable_and_does_not_start_downstream", async (state) => {
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  if (state !== "running") await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: state === "failed" ? "error" : "completed", lastAssistantMessage: [{ type: "text", text: "OLD_ATTEMPT" }] })
  if (state === "retried") {
    await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
    await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "STALE_LATE_OUTPUT" }] })
  }
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2" })).rejects.toMatchObject({ code: "WF_INPUT_UPSTREAM_UNAVAILABLE" })
  expect(starts).toHaveLength(1)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ attempts: 0, status: "pending" })
})

it("test_auto_explicit_binding_overrides_upstream_without_guessing", async () => {
  const { h, starts } = await makeRealRunnerHarness("n-a2", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: { workflowInputs: {}, nodeInputs: { "n-a2": { input: [{ kind: "text", value: "EXPLICIT_BINDING" }] } } } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[0].request.prompt[0].text).toContain("EXPLICIT_BINDING")
  expect(starts[0].request.prompt[0].text).not.toContain("upstreamText")
})

it("test_binding_inflight_blocks_dispatch_proxy_and_concurrent_binding_then_releases", async () => {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { h, entry, starts } = await makeRealRunnerHarness()
  vi.spyOn(h.store, "saveRun").mockImplementationOnce(async (snapshot) => { entered(); await gate; return snapshot })
  const binding = h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { text: [{ kind: "text", value: "NEW" }] } })
  await started
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })).rejects.toMatchObject({ code: "WF_BUSY" })
    await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_BUSY" })
    expect(starts).toEqual([])
    expect(entry.callCount).toBe(0)
  } finally { release() }
  await binding
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_REVISION_CONFLICT" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })
  expect(starts[0].request.prompt[0].text).toContain("NEW")
})

it("test_binding_stop_during_durable_write_cannot_publish_to_terminal_run", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness()
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const save = h.store.saveRun.bind(h.store)
  vi.spyOn(h.store, "saveRun").mockImplementationOnce(async (snapshot) => { entered(); await gate; return save(snapshot) })
  const binding = h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "not published" }] } })
  const rejected = expect(binding).rejects.toMatchObject({ code: "WF_CANCELLED" })
  await started
  const stopped = h.runtime.stopRun(entry.snapshot.id)
  release()
  await rejected
  await stopped
  const snapshot = await h.store.getRun(entry.snapshot.id)
  expect(snapshot?.status).toBe("stopped")
  expect(snapshot?.inputRevision).toBeUndefined()
  expect(snapshot?.runtimeInputs).toBeUndefined()
  expect(starts).toEqual([])
})

it("test_binding_save_failure_leaves_revision_unchanged_and_mutex_reusable", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness()
  vi.spyOn(h.store, "saveRun").mockRejectedValueOnce(new Error("disk failed"))
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "failed save" }] } })).rejects.toThrow("disk failed")
  expect(entry.snapshot.inputRevision).toBeUndefined()
  expect(entry.snapshot.runtimeInputs).toBeUndefined()
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "accepted" }] } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[0].request.prompt[0].text).toContain("accepted")
  expect(starts[0].request.prompt[0].text).not.toContain("failed save")
})

it("test_resume_auto_preserves_settled_upstream_and_original_input_provenance", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: { workflowInputs: { input: [{ kind: "text", value: "SOURCE" }] }, nodeInputs: {} } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "PRESERVED_RESULT" }] })
  await h.runtime.stopRun(entry.snapshot.id)
  const resumed = await h.runtime.resumeRun({ sessionId: "session-1", flowId: "flow-1" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("PRESERVED_RESULT")
  expect(starts[1].request.prompt[0].text).toContain('"runId": "run-1"')
  expect(h.runtime.runSnapshot(resumed.runId)?.handoffPolicy).toBe("auto")
  expect(h.runtime.runSnapshot(resumed.runId)?.runtimeInputs?.workflowInputs.input[0]).toMatchObject({ kind: "text", value: "SOURCE" })
})

it("test_upstream_retried_during_downstream_preflight_rejects_stale_first_task_without_budget", async () => {
  let delay = false
  let entered!: () => void
  let release!: () => void
  const enteredGate = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", authorizedInputFiles: async () => {
    if (delay) { delay = false; entered(); await gate }
    return []
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "OLD_RESULT" }] })
  delay = true
  const downstream = h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  const rejected = expect(downstream).rejects.toMatchObject({ code: "WF_INPUT_UPSTREAM_UNAVAILABLE" })
  await enteredGate
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  release()
  await rejected
  expect(starts).toHaveLength(1)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ attempts: 0, status: "pending" })
  expect(entry.callCount).toBe(2)
})

it("test_downstream_preflight_checks_its_inputs_without_requiring_consumed_source_file", async () => {
  const { h, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: async (dir: string) => {
    await mkdir(join(dir, "data", "files"), { recursive: true })
    await writeFile(join(dir, "data", "files", `${runtimeManagedPrefix("session-1")}consumed`), "initial")
    return { workflowInputs: { source: [{ kind: "file", fileRef: { source: "managed", path: `data/files/${runtimeManagedPrefix("session-1")}consumed` } }] }, nodeInputs: {} }
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "CURRENT_RESULT" }] })
  await rm(join(h.dir, "data", "files", `${runtimeManagedPrefix("session-1")}consumed`))
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("CURRENT_RESULT")
  expect(starts[1].request.prompt[0].text).not.toContain(`data/files/${runtimeManagedPrefix("session-1")}consumed`)
})

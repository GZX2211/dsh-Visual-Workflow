import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, onTestFinished, vi } from "vitest"
import { NodeAgentRunner } from "../../src/host/agent/runner.js"
import type { SubagentsServiceLike } from "../../src/host/agent/runner.js"
import { CordisAgentHost } from "../../src/host/agent/agents-host.js"
import { createChildToolFilterSetup } from "../../src/host/agent/child-tool-filter.js"
import { createChildPromptSetup } from "../../src/host/agent/prompt-setup.js"
import { createModelSelectionSetup } from "../../src/host/agent/model-selection.js"
import { createReactGuard } from "../../src/host/agent/guards.js"
import type { NodeStartInput } from "../../src/host/orchestrator/index.js"
import type { WorkflowDocument } from "../../src/host/shared/graph-model.js"
import type { SessionInputFile } from "../../src/host/shared/runtime-types.js"
import { agent, caller, cleanupTempDirs, makeHarness, stage } from "../host/orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)

function flowOf(ids = ["a", "b"]): WorkflowDocument {
  const path = ["start", ...ids, "end"]
  return { id: "dag", sessionId: "session-1", mode: "mode1", executionMode: "dag", name: "generic flow", description: "", nodes: [stage("start", "start"), ...ids.map((id) => ({ ...agent(id, id), data: { ...agent(id, id).data, presetId: "standard" } })), stage("end", "end")], lines: path.slice(1).map((target, index) => ({ id: `line-${index}`, source: path[index], target, sourceHandle: "flow-out", targetHandle: "flow-in" })) }
}

async function harness(flow = flowOf(), config: { dagReviewTimeoutMs?: number } = {}) {
  const files: SessionInputFile[] = []
  const h = await makeHarness(config, { workingDirectory: async () => h.dir, sessionInputFiles: async () => files })
  const injects: unknown[] = []
  const wakes: unknown[] = []
  const root = Object.assign(h.agents.roots.get("session-1")!, { inject: (message: unknown) => injects.push(message), followup: (message: unknown) => wakes.push(message) })
  const disposers: Array<() => void> = []
  const host = new CordisAgentHost({ get: () => ({ get: (id: string) => h.agents.roots.get(id) }), effect: (effect: () => () => void) => { disposers.push(effect()) } } as never)
  Object.assign(h.agents, { installDagNotificationGate: host.installDagNotificationGate.bind(host) })
  const toolFilter = createChildToolFilterSetup()
  const promptSetup = createChildPromptSetup()
  const starts: Parameters<SubagentsServiceLike["startContinuable"]>[0][] = []
  const epochs = new Map<string, string>()
  const control: { onStart?: (spec: Parameters<SubagentsServiceLike["startContinuable"]>[0]) => Promise<void> } = {}
  const recovery = { resumable: true }
  let fixtureEpoch = 0
  let onSaved: ((status: string) => void) | undefined
  const saveRun = h.store.saveRun.bind(h.store)
  h.store.saveRun = async (snapshot) => { const saved = await saveRun(snapshot); onSaved?.(saved.status); return saved }
  const transport: SubagentsServiceLike = {
    list: () => ["spawn"],
    startContinuable: async (spec) => {
      expect(toolFilter.peekPending?.()).toEqual(spec.label.startsWith("DAG review ") ? [] : ["read", "write"])
      starts.push(spec)
      const childId = spec.childId ?? `child-${starts.length}`
      const epoch = `epoch-${starts.length}`
      epochs.set(childId, epoch)
      h.runtime.handleSubagentStart({ id: childId, runId: epoch })
      await control.onStart?.(spec)
      return { childId }
    },
    sendMessage: vi.fn(async (_sender: unknown, childId: string, _content: Parameters<NonNullable<SubagentsServiceLike["sendMessage"]>>[2]) => {
      if (!recovery.resumable) throw Object.assign(new Error("Child cannot resume"), { name: "SubagentError", code: "NOT_RESUMABLE", accepted: false })
      const epoch = `reuse-${epochs.size}-${fixtureEpoch++}`
      epochs.set(childId, epoch)
      h.runtime.handleSubagentStart({ id: childId, runId: epoch })
    }),
    interrupt: vi.fn(),
  }
  const runner = new NodeAgentRunner({ store: h.store, agents: () => ({ get: (id) => h.agents.getRootAgent(id) }), subagents: () => transport, teams: () => null,
    toolsView: { visibleToolNames: async () => ["read", "write"], agentToolNames: async () => ["read", "write"], presetToolNames: async () => ["read", "write"] },
    toolFilter, promptSetup, modelSelection: createModelSelectionSetup(), react: createReactGuard().bridge })
  const dispatched: NodeStartInput[] = []
  h.runner.startNodeTask = (input) => { dispatched.push(input); return runner.startNodeTask(input) }
  h.runner.interruptChild = (id, session) => runner.interruptChild(id, session)
  onTestFinished(() => { h.runtime.dispose(); runner.dispose(); for (const dispose of disposers) dispose() })
  await h.store.saveWorkflow(flow, flow.sessionId, { force: true })
  return { h, files, root, injects, wakes, starts, epochs, control, transport, dispatched, recovery,
    nextSaved: (status: string) => new Promise<void>((resolve) => { onSaved = (actual) => { if (actual === status) { onSaved = undefined; resolve() } } }),
    launch: () => h.runtime.startRun({ sessionId: flow.sessionId, flowId: flow.id }),
    settle: (childId: string, text = "result") => h.runtime.handleSubagentEnd({ id: childId, runId: epochs.get(childId), stopReason: "completed", lastAssistantMessage: [{ type: "text", text }] }) }
}

async function finishTask(fixture: Awaited<ReturnType<typeof harness>>, id: string, text: string, status = "accepted") {
  const worker = [...fixture.dispatched].reverse().find((input) => input.node.id === id)!
  const snapshot = fixture.h.runtime.activeRunForSession("session-1")!.snapshot
  const childId = snapshot.nodes.find((node) => node.nodeId === id)!.childId!
  await fixture.settle(childId, text)
  const reviewer = [...fixture.starts].reverse().find((spec) => spec.label === `DAG review ${id}`)!
  await fixture.settle(reviewer.childId!, JSON.stringify({ status, reason: status === "accepted" ? "The actual output fulfills the task" : "Cannot fulfill the task with the available input" }))
  return worker
}

it("test_linear_three_ordinary_agents_advance_and_finish_without_parent_tools_or_fixed_business_json", async () => {
  const fixture = await harness(flowOf(["a", "b", "c"]))
  const { runId } = await fixture.launch()
  for (const id of ["a", "b", "c"]) await finishTask(fixture, id, `Free form actual result ${id}`)
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("completed")
  expect(saved.termination).toMatchObject({ source: "runtime", stopReason: "dag-completed" })
  expect(fixture.dispatched.filter((input) => !input.modelCallLimit).map((input) => input.node.id)).toEqual(["a", "b", "c"])
  expect(fixture.dispatched.filter((input) => input.modelCallLimit)).toHaveLength(3)
  expect(fixture.dispatched.find((input) => input.node.id === "b")!.blocks[0].text).toContain("Free form actual result a")
  expect(fixture.dispatched.find((input) => input.node.id === "c")!.blocks[0].text).toContain('"nodeId":"b"')
  expect(saved.nodes.filter((node) => ["a", "b", "c"].includes(node.nodeId)).map((node) => [node.attempts, node.taskAcceptance?.status, node.taskAcceptance?.review?.state])).toEqual([[1, "accepted", "finished"], [1, "accepted", "finished"], [1, "accepted", "finished"]])
  expect(fixture.wakes).toEqual([])
  expect(fixture.root.messages).toEqual([])
  expect(fixture.transport.sendMessage).not.toHaveBeenCalled()
  expect(fixture.h.runtime.activeRunForSession("session-1")).toBeNull()
})

it("test_concurrent_parallel_reviews_join_once_only_after_both_durable_acceptances", async () => {
  const flow = flowOf(["a", "b", "c", "d"])
  flow.lines = [["start", "a"], ["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["d", "end"]].map(([source, target], index) => ({ id: `edge-${index}`, source, target, sourceHandle: "flow-out", targetHandle: "flow-in" }))
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await finishTask(fixture, "a", "Ready for both branches")
  expect(fixture.dispatched.filter((input) => !input.modelCallLimit).map((input) => input.node.id)).toEqual(["a", "b", "c"])
  const entry = fixture.h.runtime.activeRunForSession("session-1")!
  const children = ["b", "c"].map((id) => entry.snapshot.nodes.find((node) => node.nodeId === id)!.childId!)
  await Promise.all(children.map((id) => fixture.settle(id, `Branch result ${id}`)))
  expect(fixture.dispatched.filter((input) => input.node.id === "d")).toHaveLength(0)
  const reviews = ["b", "c"].map((id) => [...fixture.starts].reverse().find((spec) => spec.label === `DAG review ${id}`)!.childId!)
  const verdict = JSON.stringify({ status: "accepted", reason: "Branch fulfills its responsibility" })
  await Promise.all(reviews.flatMap((id) => [fixture.settle(id, verdict), fixture.settle(id, verdict)]))
  expect(fixture.dispatched.filter((input) => input.node.id === "d")).toHaveLength(1)
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.nodes.filter((node) => ["b", "c"].includes(node.nodeId)).map((node) => node.taskAcceptance?.status)).toEqual(["accepted", "accepted"])
  await finishTask(fixture, "d", "Merged actual branch results")
  expect((await fixture.h.store.getRun(runId))!.status).toBe("completed")
})

it.each(["needs-input", "failed", "unknown", "malformed"])("test_review_%s_never_advances_business_successor_or_loops_verification", async (kind) => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  await fixture.settle(fixture.starts[0].childId!, "Please provide the missing authorized input")
  const review = fixture.starts[1]
  const reply = kind === "malformed" ? "This is definitely successful!" : JSON.stringify({ status: kind, reason: "Current evidence cannot establish completion" })
  await Promise.all([fixture.settle(review.childId!, reply), fixture.settle(review.childId!, reply)])
  expect(fixture.dispatched.filter((input) => input.node.id === "b")).toHaveLength(0)
  expect(fixture.dispatched).toHaveLength(2)
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe(kind === "failed" ? "failed" : "paused")
  expect(saved.nodes.find((node) => node.nodeId === "a")).toMatchObject({ status: "ok", attempts: 1, taskAcceptance: { status: kind === "malformed" || kind === "unknown" ? "pending" : kind } })
})

it("test_review_timeout_blocks_without_retry_and_rejects_late_acceptance", async () => {
  vi.useFakeTimers()
  onTestFinished(() => { vi.useRealTimers() })
  const fixture = await harness(flowOf(), { dagReviewTimeoutMs: 1000 })
  const { runId } = await fixture.launch()
  await fixture.settle(fixture.starts[0].childId!, "Free form output")
  const paused = fixture.nextSaved("paused")
  await vi.advanceTimersByTimeAsync(1000)
  await paused
  await fixture.settle(fixture.starts[1].childId!, JSON.stringify({ status: "accepted", reason: "Late" }))
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("paused")
  expect(saved.nodes.find((node) => node.nodeId === "a")!.taskAcceptance!.review).toMatchObject({ state: "blocked", errorCode: "WF_DAG_REVIEW_TIMEOUT" })
  expect(fixture.dispatched).toHaveLength(2)
  expect(fixture.transport.interrupt).toHaveBeenCalledWith(fixture.starts[1].childId, { kind: "user", parentSessionId: "session-1" })
})

it("test_actual_tool_failure_blocks_acceptance_before_harness_review", async () => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  const childId = fixture.starts[0].childId!
  fixture.h.runtime.recordToolResult({ agent: { id: childId }, name: "read", callId: "real-error" }, { isError: true, error: { info: { code: "SANDBOX_UNAVAILABLE" } } })
  await fixture.settle(childId, "Claimed success despite failed tools")
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("failed")
  expect(saved.nodes.find((node) => node.nodeId === "a")!.taskAcceptance).toMatchObject({ status: "failed", source: "runtime", reason: expect.stringContaining("SANDBOX_UNAVAILABLE") })
  expect(fixture.dispatched).toHaveLength(1)
})

it("test_needs_input_resume_requires_changed_authorized_binding_and_preserves_retry_budget", async () => {
  const flow = flowOf()
  const node = flow.nodes.find((entry) => entry.id === "a")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.execution = { inputs: { source: { kind: "file" } } }
  const fixture = await harness(flow)
  const firstPath = join(fixture.h.dir, "first.payload")
  const secondPath = join(fixture.h.dir, "second.payload")
  await writeFile(firstPath, "first")
  await writeFile(secondPath, "second")
  fixture.files.push({ attachmentId: "a", name: "first.payload", bytes: 5, path: firstPath })
  const { runId } = await fixture.launch()
  await finishTask(fixture, "a", "Need the corrected document", "needs-input")
  fixture.files.push({ attachmentId: "b", name: "second.payload", bytes: 6, path: secondPath })
  const unchanged = await fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: flow.id, fromRunId: runId })
  const unchangedSnapshot = (await fixture.h.store.getRun(unchanged.runId))!
  expect(unchangedSnapshot.status).toBe("paused")
  expect(unchangedSnapshot.nodes.find((entry) => entry.nodeId === "a")!.attempts).toBe(1)
  expect(fixture.dispatched).toHaveLength(2)
  fixture.recovery.resumable = false
  const changed = await fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: flow.id, fromRunId: unchanged.runId, runtimeInputs: { nodeInputs: { a: { source: [{ kind: "file", fileRef: { source: "attachment", attachmentId: "b", name: "second.payload", bytes: 6 } }] } } } })
  const changedSnapshot = (await fixture.h.store.getRun(changed.runId))!
  expect(changedSnapshot.nodes.find((entry) => entry.nodeId === "a")).toMatchObject({ status: "running", attempts: 2 })
  expect(fixture.starts).toHaveLength(3)
  expect(fixture.transport.sendMessage).toHaveBeenCalledTimes(1)
  expect(changedSnapshot.dagDefinitionRunId).toBe(runId)
  await fixture.settle(fixture.starts[0].childId!, "Old reply")
  expect(fixture.h.runtime.activeRunForSession("session-1")!.snapshot.nodes.find((entry) => entry.nodeId === "a")!.status).toBe("running")
})

it("test_pause_checkpoint_inherits_accepted_tasks_and_never_replays_them", async () => {
  const flow = flowOf()
  flow.nodes.push(stage("pause", "pause"))
  flow.lines[1].target = "pause"
  flow.lines.push({ id: "after-pause", source: "pause", target: "b", sourceHandle: "flow-out", targetHandle: "flow-in" })
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await finishTask(fixture, "a", "Completed first task")
  expect((await fixture.h.store.getRun(runId))!.status).toBe("paused")
  const resumed = await fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: flow.id, fromRunId: runId })
  expect(fixture.dispatched.filter((input) => input.node.id === "a")).toHaveLength(1)
  expect(fixture.dispatched.filter((input) => input.node.id === "b")).toHaveLength(1)
  await finishTask(fixture, "b", "Completed remaining task")
  expect((await fixture.h.store.getRun(resumed.runId))!.status).toBe("completed")
})

it("test_interrupted_execution_with_unknown_side_effects_and_pending_review_require_intervention", async () => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  await fixture.h.runtime.stopRun(runId)
  await expect(fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: "dag", fromRunId: runId })).rejects.toMatchObject({ code: "WF_DAG_RECOVERY_REQUIRED" })
  expect(fixture.dispatched).toHaveLength(1)
  const second = await harness()
  const started = await second.launch()
  await second.settle(second.starts[0].childId!, "Task ended but review is still running")
  await second.h.runtime.stopRun(started.runId)
  await expect(second.h.runtime.resumeRun({ sessionId: "session-1", flowId: "dag", fromRunId: started.runId })).rejects.toMatchObject({ code: "WF_DAG_REVIEW_INTERRUPTED" })
  expect(second.dispatched).toHaveLength(2)
})

it("test_explicit_sufficient_file_contract_uses_real_artifact_verification_without_model_review", async () => {
  const flow = flowOf(["a"])
  const node = flow.nodes.find((entry) => entry.id === "a")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.execution = { outputFiles: ["result.payload"], completion: "output-files" }
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await writeFile(join(fixture.h.dir, "result.payload"), "Actual current-attempt output")
  await fixture.settle(fixture.starts[0].childId!, "The requested output is ready")
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("completed")
  expect(saved.nodes.find((entry) => entry.nodeId === "a")!.taskAcceptance).toMatchObject({ status: "accepted", source: "contract" })
  expect(saved.nodes.find((entry) => entry.nodeId === "a")!.artifacts).toEqual([expect.objectContaining({ nodeId: "a", runId, attempt: 1, signature: expect.any(String) })])
  expect(fixture.dispatched).toHaveLength(1)
})

it("test_missing_declared_artifact_never_reaches_semantic_acceptance", async () => {
  const flow = flowOf(["a"])
  const node = flow.nodes.find((entry) => entry.id === "a")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.execution = { outputFiles: ["missing.payload"], completion: "output-files" }
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await fixture.settle(fixture.starts[0].childId!, "Claimed an output that does not exist")
  expect((await fixture.h.store.getRun(runId))!.status).toBe("failed")
  expect(fixture.dispatched).toHaveLength(1)
})

it("test_computable_branch_selection_is_persisted_and_conditional_join_waits_for_actual_path", async () => {
  const flow = flowOf(["a", "b", "c", "d"])
  flow.lines = [["start", "a"], ["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["d", "end"]].map(([source, target], index) => ({ id: `edge-${index}`, source, target, sourceHandle: "flow-out", targetHandle: "flow-in" }))
  flow.lines[1].condition = { type: "pass", rule: { path: ["branch"], operator: "eq", value: "b" } }
  flow.lines[2].condition = { type: "fail", rule: { path: ["branch"], operator: "eq", value: "c" } }
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await finishTask(fixture, "a", '{"branch":"b"}')
  expect(fixture.dispatched.filter((input) => !input.modelCallLimit).map((input) => input.node.id)).toEqual(["a", "b"])
  const routed = (await fixture.h.store.getRun(runId))!
  expect(routed.nodes.find((node) => node.nodeId === "a")!.attemptHistory![0].dagRoutes).toEqual(["edge-1"])
  expect(routed.nodes.find((node) => node.nodeId === "c")).toMatchObject({ status: "skipped", attempts: 0 })
  await finishTask(fixture, "b", "Selected branch result")
  expect(fixture.dispatched.filter((input) => input.node.id === "d")).toHaveLength(1)
  const merge = fixture.dispatched.find((input) => input.node.id === "d")!
  expect(merge.blocks[0].text).toContain("Selected branch result")
  expect(merge.blocks[0].text).not.toContain('"nodeId":"c"')
  await finishTask(fixture, "d", "Joined only the selected branch")
  expect((await fixture.h.store.getRun(runId))!.status).toBe("completed")
})

it("test_five_null_execution_agents_read_actual_attachment_and_generate_real_intermediate_files", async () => {
  const ids = ["ingest", "inspect", "aggregate", "describe", "report"]
  const flow = flowOf(ids)
  for (const node of flow.nodes) if (node.kind === "agent") node.data.execution = null
  const fixture = await harness(flow)
  const input = join(fixture.h.dir, "authorized.payload")
  await writeFile(input, "id,value\na,2\nb,3\n")
  fixture.files.push({ attachmentId: "official-payload", name: "authorized.payload", bytes: 17, path: input })
  const seen: string[] = []
  fixture.control.onStart = async (spec) => {
    if (spec.label.startsWith("DAG review ")) return
    const reference = spec.request.prompt.find((block) => block.type === "file")!
    if (reference.type !== "file") throw new Error("fixture")
    const actual = await readFile(fixture.files.find((file) => file.attachmentId === reference.attachment.attachmentId)!.path, "utf8")
    seen.push(actual)
    await writeFile(join(fixture.h.dir, `${spec.label}.result`), `${actual}\n${spec.label} actual output`)
  }
  const { runId } = await fixture.launch()
  for (const id of ids) await finishTask(fixture, id, `${id} used the authorized input: sum=5`)
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("completed")
  expect(saved.nodes.filter((node) => ids.includes(node.nodeId)).map((node) => [node.attempts, node.taskAcceptance?.status])).toEqual(ids.map(() => [1, "accepted"]))
  expect(seen).toEqual(ids.map(() => "id,value\na,2\nb,3\n"))
  for (const id of ids) expect(await readFile(join(fixture.h.dir, `${id}.result`), "utf8")).toContain(`${id} actual output`)
  expect(fixture.dispatched.filter((input) => !input.modelCallLimit).map((input) => input.node.id)).toEqual(ids)
  expect(fixture.root.messages).toEqual([])
})

it("test_pause_before_worker_settlement_defers_review_and_resume_does_not_rerun_business_task", async () => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  await fixture.h.runtime.suspendRun(runId)
  await fixture.settle(fixture.starts[0].childId!, "Actual task completed during pause")
  expect(fixture.dispatched).toHaveLength(1)
  const checkpoint = (await fixture.h.store.getRun(runId))!
  expect(checkpoint.nodes.find((node) => node.nodeId === "a")!.taskAcceptance).toEqual({ status: "pending" })
  const resumed = await fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: "dag", fromRunId: runId })
  expect(fixture.dispatched.filter((input) => input.node.id === "a")).toHaveLength(1)
  const review = fixture.starts[1]
  await fixture.settle(review.childId!, JSON.stringify({ status: "accepted", reason: "Prior completed execution fulfills the task" }))
  expect(fixture.dispatched.filter((input) => input.node.id === "b")).toHaveLength(1)
  await finishTask(fixture, "b", "Remaining task result")
  expect((await fixture.h.store.getRun(resumed.runId))!.status).toBe("completed")
})

it("test_dag_initial_dispatch_uses_real_runner_and_authorized_fileblock_without_root_planning", async () => {
  const flow = flowOf()
  const first = flow.nodes.find((node) => node.id === "a")!
  if (first.kind !== "agent") throw new Error("fixture")
  first.data.execution = { inputs: { document: { kind: "file" } } }
  const fixture = await harness(flow)
  const path = join(fixture.h.dir, "opaque-document.bin")
  await writeFile(path, "actual authorized content")
  fixture.files.push({ attachmentId: "official-a", name: "opaque-document.bin", bytes: 25, path })
  const reads: string[] = []
  fixture.control.onStart = async (spec) => {
    const file = spec.request.prompt.find((block) => block.type === "file")!
    if (file.type !== "file") throw new Error("fixture")
    reads.push(await readFile(fixture.files.find((entry) => entry.attachmentId === file.attachment.attachmentId)!.path, "utf8"))
    expect(file.attachment).toEqual({ attachmentId: "official-a", name: "opaque-document.bin", bytes: 25 })
  }
  const { runId } = await fixture.launch()
  expect(fixture.starts).toHaveLength(1)
  expect(reads).toEqual(["actual authorized content"])
  expect(fixture.h.agents.roots.get("session-1")!.messages).toEqual([])
  expect(fixture.wakes).toEqual([])
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved).toMatchObject({ executionMode: "dag", dagConcurrency: 2, inputRevision: 1 })
  expect(saved.nodes.find((node) => node.nodeId === "a")).toMatchObject({ status: "running", attempts: 1 })
  expect(saved.nodes.find((node) => node.nodeId === "b")).toMatchObject({ status: "pending", attempts: 0 })
  expect(saved.nodes.find((node) => node.nodeId === "a")!.attemptHistory![0].inputAttachments).toEqual([{ attachmentId: "official-a", name: "opaque-document.bin", bytes: 25, source: "binding" }])
  await expect(fixture.h.runtime.wfRunNode(caller, { nodeId: "a" })).rejects.toMatchObject({ code: "WF_DAG_MANAGED" })
  await expect(fixture.h.runtime.wfFinish(caller, { status: "completed" })).rejects.toMatchObject({ code: "WF_DAG_MANAGED" })
  expect(fixture.starts).toHaveLength(1)
  expect((await fixture.h.store.getRun(runId))!.nodes.find((node) => node.nodeId === "a")!.attempts).toBe(1)
  fixture.root.followup!({ source: { kind: "subagent-settled", form: "notice", senderSessionId: fixture.starts[0].childId }, content: [] } as never)
  expect(fixture.wakes).toEqual([])
  expect(fixture.injects).toHaveLength(1)
})

it("test_dag_required_input_prevents_running_record_and_child_creation_without_filename_inference", async () => {
  const flow = flowOf()
  const first = flow.nodes.find((node) => node.id === "a")!
  if (first.kind !== "agent") throw new Error("fixture")
  first.data.execution = { inputs: { document: { kind: "file" } } }
  const fixture = await harness(flow)
  await expect(fixture.launch()).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(fixture.starts).toEqual([])
  expect(await fixture.h.store.listRuns(flow.id)).toEqual([])
  expect(fixture.h.runtime.activeRunForSession(flow.sessionId)).toBeNull()
})

it("test_dag_parallel_initial_nodes_respect_frozen_concurrency_and_stop_prevents_future_dispatch", async () => {
  const flow = flowOf(["a", "b", "c"])
  flow.dagConcurrency = 2
  flow.lines = ["a", "b", "c"].flatMap((id) => [{ id: `in-${id}`, source: "start", target: id, sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }, { id: `out-${id}`, source: id, target: "end", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }])
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  expect(fixture.starts.map((spec) => spec.label)).toEqual(["a", "b"])
  const changed = { ...flow, dagConcurrency: 16, executionMode: "agent" as const, lines: [] }
  await fixture.h.store.saveWorkflow(changed, flow.sessionId, { force: true })
  await fixture.h.runtime.refreshActiveDefinitions(flow.id, flow.sessionId, changed)
  expect(await fixture.h.store.readOrchestration(runId)).toMatchObject({ executionMode: "dag", dagConcurrency: 2, lines: flow.lines })
  await fixture.h.runtime.stopRun(runId)
  for (const spec of fixture.starts) await fixture.settle(spec.childId!)
  expect(fixture.starts).toHaveLength(2)
  expect((await fixture.h.store.getRun(runId))!.status).toBe("stopped")
  expect(fixture.wakes).toEqual([])
  expect(fixture.h.agents.roots.get(flow.sessionId)!.messages).toEqual([])
})

it("test_dag_duplicate_settlement_does_not_double_record_turn_or_create_child", async () => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  const childId = fixture.starts[0].childId!
  await Promise.all([fixture.settle(childId), fixture.settle(childId)])
  const record = (await fixture.h.store.getRun(runId))!.nodes.find((node) => node.nodeId === "a")!
  expect(record.turns).toHaveLength(1)
  expect(record.attemptHistory).toHaveLength(1)
  expect(fixture.starts).toHaveLength(2)
  expect(fixture.starts[1].label).toBe("DAG review a")
  expect(record.taskAcceptance).toMatchObject({ status: "pending", review: { state: "running", modelCallLimit: 1 } })
})

it("test_concurrent_different_workflows_cannot_share_a_dag_parent_session", async () => {
  const fixture = await harness()
  const other = { ...flowOf(), id: "other-dag" }
  await fixture.h.store.saveWorkflow(other, other.sessionId, { force: true })
  const results = await Promise.allSettled([fixture.launch(), fixture.h.runtime.startRun({ sessionId: other.sessionId, flowId: other.id })])
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "WF_DAG_SESSION_CONFLICT" } })
  expect(fixture.dispatched).toHaveLength(1)
})

it("test_artifact_changed_during_pause_cannot_be_accepted_from_old_completion_evidence", async () => {
  const flow = flowOf(["a"])
  const node = flow.nodes.find((entry) => entry.id === "a")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.execution = { outputFiles: ["result.payload"], completion: "output-files" }
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  await fixture.h.runtime.suspendRun(runId)
  const output = join(fixture.h.dir, "result.payload")
  await writeFile(output, "Actual current-attempt result")
  await fixture.settle(fixture.starts[0].childId!, "Output ready")
  await writeFile(output, "Replaced after settlement")
  const resumed = await fixture.h.runtime.resumeRun({ sessionId: "session-1", flowId: flow.id, fromRunId: runId })
  const saved = (await fixture.h.store.getRun(resumed.runId))!
  expect(saved.status).toBe("failed")
  expect(saved.nodes.find((entry) => entry.nodeId === "a")!.taskAcceptance).toMatchObject({ status: "failed", source: "runtime" })
  expect(fixture.dispatched).toHaveLength(1)
})

it("test_declared_artifacts_are_rechecked_before_automatic_workflow_completion", async () => {
  const flow = flowOf()
  const node = flow.nodes.find((entry) => entry.id === "a")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.execution = { outputFiles: ["result.payload"], completion: "output-files" }
  const fixture = await harness(flow)
  const { runId } = await fixture.launch()
  const output = join(fixture.h.dir, "result.payload")
  await writeFile(output, "Verified original result")
  await fixture.settle(fixture.starts[0].childId!, "Output ready")
  await writeFile(output, "Modified while successor was executing")
  await finishTask(fixture, "b", "Successor actual output")
  expect((await fixture.h.store.getRun(runId))!.status).toBe("failed")
})

it("test_review_tool_failure_preserves_real_error_and_cannot_accept", async () => {
  const fixture = await harness()
  const { runId } = await fixture.launch()
  await fixture.settle(fixture.starts[0].childId!, "Actual result")
  const review = fixture.starts[1]
  fixture.h.runtime.recordToolResult({ agent: { id: review.childId! }, name: "send_message", callId: "review-tool" }, { isError: true, error: { info: { code: "TOOL_DENIED" } } })
  await fixture.settle(review.childId!, JSON.stringify({ status: "accepted", reason: "Claimed completion" }))
  const saved = (await fixture.h.store.getRun(runId))!
  expect(saved.status).toBe("paused")
  expect(saved.nodes.find((entry) => entry.nodeId === "a")!.taskAcceptance).toMatchObject({ status: "pending", review: { runId, state: "blocked", errorCode: "WF_DAG_REVIEW_TOOL_DENIED" } })
  expect(fixture.dispatched.filter((input) => input.node.id === "b")).toHaveLength(0)
})

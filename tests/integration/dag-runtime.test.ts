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
import type { WorkflowDocument } from "../../src/host/shared/graph-model.js"
import type { SessionInputFile } from "../../src/host/shared/runtime-types.js"
import { agent, caller, cleanupTempDirs, makeHarness, stage } from "../host/orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)

function flowOf(ids = ["a", "b"]): WorkflowDocument {
  const path = ["start", ...ids, "end"]
  return { id: "dag", sessionId: "session-1", mode: "mode1", executionMode: "dag", name: "generic flow", description: "", nodes: [stage("start", "start"), ...ids.map((id) => ({ ...agent(id, id), data: { ...agent(id, id).data, presetId: "standard" } })), stage("end", "end")], lines: path.slice(1).map((target, index) => ({ id: `line-${index}`, source: path[index], target, sourceHandle: "flow-out", targetHandle: "flow-in" })) }
}

async function harness(flow = flowOf()) {
  const files: SessionInputFile[] = []
  const h = await makeHarness(undefined, { workingDirectory: async () => h.dir, sessionInputFiles: async () => files })
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
  const transport: SubagentsServiceLike = {
    list: () => ["spawn"],
    startContinuable: async (spec) => {
      expect(toolFilter.peekPending?.()).toEqual(["read", "write"])
      starts.push(spec)
      const childId = spec.childId ?? `child-${starts.length}`
      const epoch = `epoch-${starts.length}`
      epochs.set(childId, epoch)
      h.runtime.handleSubagentStart({ id: childId, runId: epoch })
      await control.onStart?.(spec)
      return { childId }
    },
    sendMessage: vi.fn(async () => undefined),
    interrupt: vi.fn(),
  }
  const runner = new NodeAgentRunner({ store: h.store, agents: () => ({ get: (id) => h.agents.getRootAgent(id) }), subagents: () => transport, teams: () => null,
    toolsView: { visibleToolNames: async () => ["read", "write"], agentToolNames: async () => ["read", "write"], presetToolNames: async () => ["read", "write"] },
    toolFilter, promptSetup, modelSelection: createModelSelectionSetup(), react: createReactGuard().bridge })
  h.runner.startNodeTask = (input) => runner.startNodeTask(input)
  h.runner.interruptChild = (id, session) => runner.interruptChild(id, session)
  onTestFinished(() => { h.runtime.dispose(); runner.dispose(); for (const dispose of disposers) dispose() })
  await h.store.saveWorkflow(flow, flow.sessionId, { force: true })
  return { h, files, root, injects, wakes, starts, epochs, control, transport,
    launch: () => h.runtime.startRun({ sessionId: flow.sessionId, flowId: flow.id }),
    settle: (childId: string, text = "result") => h.runtime.handleSubagentEnd({ id: childId, runId: epochs.get(childId), stopReason: "completed", lastAssistantMessage: [{ type: "text", text }] }) }
}

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
  expect(fixture.starts).toHaveLength(1)
  expect(record.taskAcceptance).toEqual({ status: "pending" })
})

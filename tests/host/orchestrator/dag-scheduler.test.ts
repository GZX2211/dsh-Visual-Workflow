import { describe, expect, it } from "vitest"
import { dagConcurrencyOf, dagFrontierOf, executionModeOf, findReadyNodes, validateDagForRun } from "../../../src/host/orchestrator/dag-scheduler.js"
import type { WorkflowDocument } from "../../../src/host/shared/graph-model.js"
import { createRunSnapshot, setNodeStatus } from "../../../src/host/orchestrator/snapshot.js"
import { agent, stage } from "./fixtures/harness.js"

function graph(pairs: Array<[string, string]>, ids = ["a", "b", "c", "d"]): WorkflowDocument {
  return { id: "dag", sessionId: "session-1", mode: "mode1", executionMode: "dag", name: "generic tasks", description: "", nodes: [stage("start", "start"), ...ids.map((id) => agent(id, id)), stage("end", "end")], lines: pairs.map(([source, target], index) => ({ id: `edge-${index}`, source, target, sourceHandle: "flow-out", targetHandle: "flow-in" })) }
}
function snapshot(flow: WorkflowDocument) {
  const value = createRunSnapshot({ flow, runId: "run-1", sessionId: flow.sessionId, mode: "mode1", now: 1000 })
  value.executionMode = "dag"
  setNodeStatus(value, "start", "ok", { now: 1000 })
  return value
}
function accept(value: ReturnType<typeof snapshot>, id: string) {
  setNodeStatus(value, id, "running", { attempts: 1, childId: `${id}-child`, now: 1000 })
  setNodeStatus(value, id, "ok", { childId: `${id}-child`, output: `${id} result`, now: 2000 })
  const node = value.nodes.find((entry) => entry.nodeId === id)!
  node.taskAcceptance = { status: "accepted" }
  node.attemptHistory![0].taskAcceptance = { status: "accepted" }
}

describe("deterministic DAG frontier", () => {
  it("test_linear_frontier_uses_current_accepted_generation_without_mutating_inputs", () => {
    const flow = graph([["start", "a"], ["a", "b"], ["b", "end"]], ["a", "b"])
    validateDagForRun(flow)
    const run = snapshot(flow)
    expect(findReadyNodes(flow, run)).toEqual(["a"])
    accept(run, "a")
    const before = structuredClone({ flow, run })
    expect(dagFrontierOf(flow, run)).toMatchObject({ ready: ["b"], sources: { b: ["a"] }, complete: false })
    expect({ flow, run }).toEqual(before)
    accept(run, "b")
    expect(findReadyNodes(flow, run)).toEqual(["end"])
    setNodeStatus(run, "end", "ok", { now: 2000 })
    expect(dagFrontierOf(flow, run).complete).toBe(true)
  })
  it("test_parallel_and_join_waits_for_both_branches_in_stable_definition_order", () => {
    const flow = graph([["start", "a"], ["a", "c"], ["a", "b"], ["c", "d"], ["b", "d"], ["d", "end"]])
    const run = snapshot(flow)
    accept(run, "a")
    expect(findReadyNodes(flow, run)).toEqual(["b", "c"])
    accept(run, "b")
    expect(findReadyNodes(flow, run)).toEqual(["c"])
    accept(run, "c")
    expect(dagFrontierOf(flow, run)).toMatchObject({ ready: ["d"], sources: { d: ["c", "b"] } })
  })
  it.each(["pending", "needs-input", "failed"] as const)("test_%s_task_result_blocks_downstream_even_if_execution_is_ok", (status) => {
    const flow = graph([["start", "a"], ["a", "end"]], ["a"])
    const run = snapshot(flow)
    accept(run, "a")
    run.nodes[1].taskAcceptance = { status }
    expect(findReadyNodes(flow, run)).toEqual([])
  })
  it.each(["runId", "attempt", "childId", "phase", "status"])("test_mismatched_%s_generation_is_not_a_successful_dependency", (field) => {
    const flow = graph([["start", "a"], ["a", "end"]], ["a"])
    const run = snapshot(flow)
    accept(run, "a")
    Object.assign(run.nodes[1].attemptHistory![0], { [field]: field === "attempt" ? 0 : "stale" })
    expect(findReadyNodes(flow, run)).toEqual([])
  })
  it("test_selected_route_skips_unselected_path_and_joins_only_actual_successes", () => {
    const flow = graph([["start", "a"], ["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["d", "end"]])
    flow.lines[1].condition = { type: "pass" }
    flow.lines[2].condition = { type: "fail" }
    const run = snapshot(flow)
    accept(run, "a")
    expect(findReadyNodes(flow, run)).toEqual([])
    run.nodes[1].attemptHistory![0].dagRoutes = [flow.lines[1].id]
    expect(dagFrontierOf(flow, run)).toMatchObject({ ready: ["b"], skipped: ["c"] })
    accept(run, "b")
    expect(dagFrontierOf(flow, run)).toMatchObject({ ready: ["d"], sources: { d: ["b"] }, skipped: ["c"] })
    run.nodes.find((node) => node.nodeId === "b")!.status = "fail"
    expect(findReadyNodes(flow, run)).toEqual([])
  })
  it.each(["paused", "stopped", "failed", "completed", "interrupted"] as const)("test_%s_run_cannot_dispatch", (status) => {
    const flow = graph([["start", "a"], ["a", "end"]], ["a"])
    const run = snapshot(flow)
    run.status = status
    expect(dagFrontierOf(flow, run)).toEqual({ ready: [], skipped: [], sources: {}, complete: false })
  })
  it.each([undefined, "agent"])("test_legacy_mode_%s_does_not_infer_dag_from_harness_context", (mode) => {
    const flow = graph([["start", "a"], ["a", "end"]], ["a"])
    const run = snapshot(flow)
    run.executionMode = mode as "agent" | undefined
    run.harnessContext = true
    expect(findReadyNodes(flow, run)).toEqual([])
  })
  it.each(["parent", "group", "proxy"])("test_unsupported_%s_fails_before_start_with_actionable_agent_mode", (kind) => {
    const flow = graph([["start", "a"], ["a", "end"]], ["a"])
    flow.nodes.push({ ...agent("special", "special"), kind } as never)
    expect(() => validateDagForRun(flow)).toThrow(expect.objectContaining({ code: "WF_DAG_UNSUPPORTED", message: expect.stringContaining("agent") }))
  })
  it("test_cycle_dangling_disconnected_and_nonancestor_ctx_are_rejected", () => {
    const cyclic = graph([["start", "a"], ["a", "b"], ["b", "a"], ["b", "end"]], ["a", "b"])
    cyclic.lines[2].condition = { type: "fail" }
    expect(() => validateDagForRun(cyclic)).toThrow(expect.objectContaining({ code: "WF_DAG_CYCLE" }))
    const dangling = graph([["start", "missing"], ["a", "end"]], ["a"])
    expect(() => validateDagForRun(dangling)).toThrow(expect.objectContaining({ code: "WF_FLOW_INVALID" }))
    const disconnected = graph([["start", "a"], ["a", "end"]], ["a", "b"])
    expect(() => validateDagForRun(disconnected)).toThrow(expect.objectContaining({ code: "WF_FLOW_INVALID" }))
    const siblings = graph([["start", "a"], ["start", "b"], ["a", "end"], ["b", "end"]], ["a", "b"])
    siblings.lines.push({ id: "ctx", source: "a", target: "b", sourceHandle: "ctx-out", targetHandle: "ctx-in" })
    expect(() => validateDagForRun(siblings)).toThrow(expect.objectContaining({ code: "WF_DAG_UNSUPPORTED" }))
  })
  it("test_explicit_mode_and_concurrency_validate_without_coercion", () => {
    expect(executionModeOf(undefined)).toBe("agent")
    expect(executionModeOf("dag")).toBe("dag")
    expect(dagConcurrencyOf(undefined)).toBe(2)
    for (const invalid of ["mode1", null, 1]) expect(() => executionModeOf(invalid)).toThrow(expect.objectContaining({ code: "WF_BAD_ARGS" }))
    for (const invalid of [0, 17, 1.5, "2", NaN, Infinity]) expect(() => dagConcurrencyOf(invalid)).toThrow(expect.objectContaining({ code: "WF_BAD_ARGS" }))
  })
})

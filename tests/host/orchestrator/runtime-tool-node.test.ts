import { afterEach, describe, expect, it, vi } from "vitest"
import type { ToolNode, WorkflowDocument } from "../../../src/host/shared/graph-model.js"
import type { MigratedToolExecutor } from "../../../src/host/migrated-tools/index.js"
import { cleanupTempDirs, makeHarness, stage } from "./fixtures/harness.js"

afterEach(cleanupTempDirs)

describe("migrated Dify ToolNode runtime", () => {
  it("runs the registered DSH tool and preserves an explicit Dify end binding", async () => {
    const invoke = vi.fn(async (_toolRef: string, args: Record<string, unknown>) => ({
      text: `tool:${String(args.query)}`,
      messages: [{ type: "text", value: `tool:${String(args.query)}` }],
    }))
    const migratedTools: MigratedToolExecutor = {
      has: (toolRef) => toolRef === "dsh_migrated__example__weather__current_weather",
      invoke,
    }
    const h = await makeHarness(undefined, { migratedTools })
    Object.assign(h.agents, { installDagNotificationGate: () => true })
    const tool: ToolNode = {
      id: "tool",
      kind: "tool",
      position: { x: 0, y: 0 },
      data: {
        label: "Weather",
        toolRef: "dsh_migrated__example__weather__current_weather",
        arguments: { query: "{{#start.query#}}" },
        source: { platform: "dify", pluginId: "example/weather" },
      },
    }
    const end = stage("end", "end")
    end.data.outputBindings = { original: { nodeId: "start", port: "query" } }
    const flow: WorkflowDocument = {
      id: "dify-tool-flow",
      sessionId: "session-1",
      mode: "mode1",
      executionMode: "dag",
      name: "Dify tool",
      description: "",
      revision: 1,
      sourceImport: { platform: "dify", importedAt: "2026-11-17T00:00:00.000Z", status: "ready", issues: [], dependencies: [] },
      nodes: [stage("start", "start"), tool, end],
      lines: [
        { id: "l1", source: "start", target: "tool", sourceHandle: "flow-out", targetHandle: "flow-in" },
        { id: "l2", source: "tool", target: "end", sourceHandle: "flow-out", targetHandle: "flow-in" },
      ],
    }
    await h.store.saveWorkflow(flow, "session-1", { force: true })

    const started = await h.runtime.startRun({
      sessionId: "session-1",
      flowId: flow.id,
      runtimeInputs: { workflowInputs: { query: [{ kind: "text", value: "Shanghai" }] }, nodeInputs: {} },
    })
    const persisted = await h.store.getRun(started.runId)

    expect(invoke).toHaveBeenCalledWith(tool.data.toolRef, { query: "Shanghai" }, expect.any(AbortSignal), undefined)
    expect(persisted).toMatchObject({ status: "completed", summary: "Shanghai" })
    expect(persisted?.nodes.find((record) => record.nodeId === "tool")).toMatchObject({ status: "ok", output: "tool:Shanghai" })
  })

  it("fails preflight when the converted package is not installed", async () => {
    const migratedTools: MigratedToolExecutor = { has: () => false, invoke: vi.fn() }
    const h = await makeHarness(undefined, { migratedTools })
    const flow: WorkflowDocument = {
      id: "missing-tool-flow",
      sessionId: "session-1",
      mode: "mode1",
      executionMode: "dag",
      name: "Missing tool",
      description: "",
      revision: 1,
      nodes: [
        stage("start", "start"),
        { id: "tool", kind: "tool", position: { x: 0, y: 0 }, data: { label: "Missing", toolRef: "dsh_migrated__missing__plugin__tool", arguments: {} } },
        stage("end", "end"),
      ],
      lines: [
        { id: "l1", source: "start", target: "tool", sourceHandle: "flow-out", targetHandle: "flow-in" },
        { id: "l2", source: "tool", target: "end", sourceHandle: "flow-out", targetHandle: "flow-in" },
      ],
    }
    await h.store.saveWorkflow(flow, "session-1", { force: true })

    await expect(h.runtime.startRun({ sessionId: "session-1", flowId: flow.id })).rejects.toMatchObject({ code: "WF_TOOL_NOT_INSTALLED" })
  })
})

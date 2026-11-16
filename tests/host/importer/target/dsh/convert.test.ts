import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { WorkflowImportService, convertDifyWorkflow, parseDifyWorkflow } from "../../../../../src/host/importer/index.js"
import { FlowStore } from "../../../../../src/host/storage/flow-store.js"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function fixture(name: string): Promise<string> {
  return readFile(resolve("tests/fixtures/dify", name), "utf8")
}

async function store(): Promise<FlowStore> {
  const root = await mkdtemp(join(tmpdir(), "dsh-dify-import-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const result = new FlowStore(root)
  await result.init()
  return result
}

describe("Dify to DSH conversion", () => {
  test("test_convert_basic_llm_preserves_topology_prompt_model_and_review_report", async () => {
    const parsed = parseDifyWorkflow(await fixture("basic-llm.yml"))
    const converted = convertDifyWorkflow(parsed.workflow, parsed.capabilities, {
      id: "tpl-1",
      importedAt: "2026-11-13T00:00:00.000Z",
    })

    expect(converted.template.nodes.map((node) => node.kind)).toEqual(["start", "agent", "end"])
    expect(converted.template.executionMode).toBe("dag")
    expect(converted.template.lines).toEqual([
      expect.objectContaining({ source: "start-node", target: "llm-node", sourceHandle: "flow-out", targetHandle: "flow-in" }),
      expect.objectContaining({ source: "llm-node", target: "answer-node", sourceHandle: "flow-out", targetHandle: "flow-in" }),
    ])
    expect(converted.template.nodes[1]).toMatchObject({
      kind: "agent",
      data: {
        provider: "sample",
        model: "sample-model",
        systemPrompt: expect.stringContaining("Question: [运行输入「query」"),
        execution: {
          inputs: { query: { kind: "text", required: true } },
          inputSource: "runtime",
          retrySafe: true,
        },
      },
    })
    expect((converted.template.nodes[1] as { data: { systemPrompt: string } }).data.systemPrompt).not.toContain("{{#")
    expect(converted.report.status).toBe("review-required")
    expect(converted.template.sourceImport).toEqual(converted.report)
  })

  test("test_convert_non_adjacent_agent_reference_adds_explicit_context_dependency", async () => {
    const parsed = parseDifyWorkflow(await fixture("basic-llm.yml"))
    const answerIndex = parsed.workflow.nodes.findIndex((node) => node.id === "answer-node")
    parsed.workflow.nodes.splice(answerIndex, 0, {
      id: "review-node",
      semanticKind: "llm",
      title: "Reviewer",
      config: {
        model: { provider: "sample", name: "sample-model" },
        prompt_template: [{ role: "user", text: "Review {{#llm-node.text#}} for {{#start-node.query#}}" }],
      },
      inputs: [{ name: "llm-node.text", references: [{ sourceNodeId: "llm-node", sourcePort: "text" }] }, { name: "start-node.query", references: [{ sourceNodeId: "start-node", sourcePort: "query" }] }],
      outputs: [],
      source: { platform: "dify", type: "llm", raw: {} },
    })
    parsed.workflow.edges.splice(1, 1,
      { id: "edge-review", sourceNodeId: "llm-node", targetNodeId: "review-node" },
      { id: "edge-answer", sourceNodeId: "review-node", targetNodeId: "answer-node" },
    )
    parsed.workflow.nodes[parsed.workflow.nodes.findIndex((node) => node.id === "answer-node")].config.answer = "{{#review-node.text#}}"

    const converted = convertDifyWorkflow(parsed.workflow, parsed.capabilities, { id: "tpl-context" })
    expect(converted.template.lines).toContainEqual(expect.objectContaining({
      source: "llm-node",
      target: "review-node",
      sourceHandle: "ctx-out",
      targetHandle: "ctx-in",
    }))
    expect(converted.template.nodes[2]).toMatchObject({
      kind: "agent",
      data: { execution: { inputs: { query: { kind: "text", required: true } } } },
    })
  })

  test("test_convert_unknown_node_keeps_placeholder_and_blocks_direct_run", async () => {
    const parsed = parseDifyWorkflow(await fixture("unknown-node.yml"))
    const converted = convertDifyWorkflow(parsed.workflow, parsed.capabilities, { id: "tpl-unknown" })

    expect(converted.report.status).toBe("blocked")
    expect(converted.report.issues).toContainEqual(expect.objectContaining({
      code: "DIFY_NODE_UNSUPPORTED",
      level: "error",
      nodeId: "llm-node",
    }))
    expect(converted.template.nodes[1]).toMatchObject({
      kind: "agent",
      data: { systemPrompt: expect.stringContaining("已脱敏") },
    })
  })

  test("test_import_service_persists_template_and_applies_conflict_policy", async () => {
    const target = await store()
    const source = await fixture("basic-llm.yml")
    const service = new WorkflowImportService()

    const first = await service.importDify(target, source)
    expect(first.template).toMatchObject({ name: "Basic LLM", sourceImport: { platform: "dify" } })
    expect(await target.listFlowTemplates()).toHaveLength(1)

    const conflict = await service.importDify(target, source)
    expect(conflict).toMatchObject({ conflict: true, existingName: "Basic LLM" })

    const renamed = await service.importDify(target, source, { conflictMode: "rename" })
    expect(renamed.template?.name).toBe("Basic LLM (2)")
    expect(await target.listFlowTemplates()).toHaveLength(2)
  })
})

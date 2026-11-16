import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, expect, test } from "vitest"
import { importWorkflowSource } from "../../../src/host/transfer/import-workflow.js"
import { cleanupAll, makeStore } from "./fixtures/flow-fixtures.js"

afterEach(cleanupAll)

test("test_import_source_detects_dify_yaml_and_returns_compatibility_report", async () => {
  const store = await makeStore()
  const source = await readFile(resolve("tests/fixtures/dify/basic-llm.yml"), "utf8")

  const result = await importWorkflowSource(store, source) as {
    sourceFormat?: string
    report?: { status?: string; dependencies?: Array<{ kind?: string }> }
  }

  expect(result.sourceFormat).toBe("dify")
  expect(result.report?.status).toBe("review-required")
  expect(result.report?.dependencies).toContainEqual(expect.objectContaining({ kind: "model" }))
  expect(await store.listFlowTemplates()).toHaveLength(1)
})

test("test_import_source_detects_quoted_dify_yaml_keys_without_filename_hint", async () => {
  const store = await makeStore()
  const source = (await readFile(resolve("tests/fixtures/dify/basic-llm.yml"), "utf8"))
    .replace(/^workflow:/m, '"workflow":')
    .replace(/^  graph:/m, '  "graph":')

  const result = await importWorkflowSource(store, source) as {
    sourceFormat?: string
    report?: { status?: string }
  }

  expect(result).toMatchObject({ sourceFormat: "dify", report: { status: "review-required" } })
})

test("test_import_source_uses_yaml_filename_hint_and_reports_dify_parse_error", async () => {
  const store = await makeStore()

  await expect(importWorkflowSource(store, '"workflow": [', { sourceName: "broken.YAML" })).rejects.toMatchObject({
    code: "TRANSFER_INVALID_JSON",
    message: expect.stringContaining("Dify 工作流导入失败"),
  })
})

test("test_import_source_blocks_unsupported_dify_nodes_without_discarding_the_template", async () => {
  const store = await makeStore()
  const source = await readFile(resolve("tests/fixtures/dify/tool.yml"), "utf8")

  const result = await importWorkflowSource(store, source) as {
    sourceFormat?: string
    report?: {
      status?: string
      issues?: Array<{ code?: string; level?: string; nodeId?: string }>
      dependencies?: Array<{ kind?: string }>
    }
  }

  expect(result.sourceFormat).toBe("dify")
  expect(result.report?.status).toBe("blocked")
  expect(result.report?.issues).toContainEqual(expect.objectContaining({
    code: "DIFY_NODE_UNSUPPORTED",
    level: "error",
    nodeId: "llm-node",
  }))
  expect(result.report?.dependencies).toContainEqual(expect.objectContaining({ kind: "tool" }))
  expect(await store.listFlowTemplates()).toHaveLength(1)
})

test("test_import_source_preserves_legacy_error_codes_for_unrecognized_input", async () => {
  const store = await makeStore()
  await expect(importWorkflowSource(store, "not-json")).rejects.toMatchObject({ code: "TRANSFER_INVALID_JSON" })
  await expect(importWorkflowSource(store, JSON.stringify({ format: "x" }))).rejects.toMatchObject({ code: "TRANSFER_INVALID_BUNDLE" })
})

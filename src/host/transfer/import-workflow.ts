import type { FlowStore } from "../storage/flow-store.js"
import { WorkflowImportError, WorkflowImportService } from "../importer/index.js"
import { importWorkflowBundle, TransferError } from "./bundle.js"
import { parse } from "yaml"

interface WorkflowImportSourceOptions {
  conflictMode?: "rename" | "overwrite"
  sourceName?: string
}

export async function importWorkflowSource(
  store: FlowStore,
  source: unknown,
  options: WorkflowImportSourceOptions = {},
): Promise<unknown> {
  const text = String(source ?? "")
  if (!isDifySourceName(options.sourceName) && !looksLikeDify(text)) {
    return importWorkflowBundle(store, text, options)
  }
  try {
    return await new WorkflowImportService().importDify(store, text, options)
  } catch (error) {
    if (!(error instanceof WorkflowImportError)) throw error
    const code = error.code === "invalid_yaml" ? "TRANSFER_INVALID_JSON" : "TRANSFER_INVALID_BUNDLE"
    throw new TransferError(code, `Dify 工作流导入失败：${error.message}`)
  }
}

function isDifySourceName(sourceName: string | undefined): boolean {
  return /\.ya?ml$/i.test(sourceName?.trim() ?? "")
}

function looksLikeDify(source: string): boolean {
  try {
    const value = parse(source)
    if (!isRecord(value) || !isRecord(value.workflow)) return false
    return isRecord(value.workflow.graph)
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

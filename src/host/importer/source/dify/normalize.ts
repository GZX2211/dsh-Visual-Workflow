import { WorkflowImportError } from "../../errors.js"
import type { SourceEdgeIR, SourceVariableIR, SourceWorkflowIR } from "../../ir/source-ir.js"
import { SourceAdapterRegistry } from "../registry.js"
import { createDifyAdapters } from "./adapters/index.js"
import { collectDifyDependencies } from "./dependencies.js"
import { isRecord } from "./variables.js"

export interface DifyCapabilities {
  dslVersion?: string
  hasGraph: boolean
  hasVariables: boolean
  hasEnvironmentVariables: boolean
  hasConversationVariables: boolean
  nodeTypes: Set<string>
  unknownFields: string[]
  unknownNodeTypes: string[]
}

export interface NormalizedDifyWorkflow {
  workflow: SourceWorkflowIR
  capabilities: DifyCapabilities
}

const registry = new SourceAdapterRegistry(createDifyAdapters())
const knownRootFields = new Set(["app", "kind", "version", "workflow"])
const knownNodeTypes = new Set(["start", "answer", "end", "llm", "agent", "tool", "knowledge-retrieval", "if-else", "condition", "http-request", "http", "template-transform", "code", "loop", "iteration"])

export function normalizeDifyDocument(document: unknown): NormalizedDifyWorkflow {
  if (!isRecord(document) || !isRecord(document.workflow) || !isRecord(document.workflow.graph)) throw new WorkflowImportError("invalid_dify_structure", "Dify workflow.graph is required")
  const graph = document.workflow.graph
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new WorkflowImportError("invalid_dify_graph", "Dify workflow.graph.nodes and edges must be arrays")
  const nodes = graph.nodes.map((node) => registry.normalize(node, { platform: "dify" }))
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new WorkflowImportError("duplicate_node_id", `Dify node id is duplicated: ${node.id}`)
    nodeIds.add(node.id)
  }
  const edges = graph.edges.map(normalizeEdge)
  for (const edge of edges) if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) throw new WorkflowImportError("dangling_edge", `Dify edge ${edge.id} references an unknown node`)
  const app = isRecord(document.app) ? document.app : {}
  const workflow: SourceWorkflowIR = {
    source: { platform: "dify", dslVersion: typeof document.version === "string" ? document.version : undefined },
    name: typeof app.name === "string" ? app.name : "Imported Workflow",
    description: typeof app.description === "string" ? app.description : undefined,
    nodes, edges,
    variables: collectVariables(document.workflow, nodes),
    dependencies: collectDifyDependencies(nodes),
  }
  const nodeTypes = new Set(nodes.map((node) => node.source.type))
  return { workflow, capabilities: {
    dslVersion: workflow.source.dslVersion,
    hasGraph: true,
    hasVariables: Array.isArray(document.workflow.variables),
    hasEnvironmentVariables: Array.isArray(document.workflow.environment_variables) && document.workflow.environment_variables.length > 0,
    hasConversationVariables: Array.isArray(document.workflow.conversation_variables) && document.workflow.conversation_variables.length > 0,
    nodeTypes,
    unknownFields: Object.keys(document).filter((field) => !knownRootFields.has(field)),
    unknownNodeTypes: [...nodeTypes].filter((type) => !knownNodeTypes.has(type)),
  } }
}

function normalizeEdge(value: unknown, index: number): SourceEdgeIR {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.target !== "string") throw new WorkflowImportError("invalid_dify_edge", `Dify edge at index ${index} requires source and target`)
  return { id: typeof value.id === "string" ? value.id : `edge-${index + 1}`, sourceNodeId: value.source, targetNodeId: value.target,
    sourceHandle: typeof value.sourceHandle === "string" ? value.sourceHandle : undefined, targetHandle: typeof value.targetHandle === "string" ? value.targetHandle : undefined }
}

function collectVariables(workflow: Record<string, unknown>, nodes: SourceWorkflowIR["nodes"]): SourceVariableIR[] {
  const result: SourceVariableIR[] = []
  const add = (values: unknown, scope: SourceVariableIR["scope"]): void => {
    if (!Array.isArray(values)) return
    for (const value of values) if (isRecord(value)) {
      const name = typeof value.variable === "string" ? value.variable : typeof value.name === "string" ? value.name : undefined
      if (name) result.push({ name, scope, required: value.required === true, dataType: typeof value.type === "string" ? value.type : undefined })
    }
  }
  add(workflow.variables, "workflow"); add(workflow.environment_variables, "environment"); add(workflow.conversation_variables, "conversation")
  for (const node of nodes.filter((candidate) => candidate.semanticKind === "start")) for (const port of node.outputs) result.push({ name: port.name, scope: "input", required: port.required === true, dataType: port.dataType, sourceNodeId: node.id })
  return result
}

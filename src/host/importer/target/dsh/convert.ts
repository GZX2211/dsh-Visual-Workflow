import type { GraphNode, Line, RoleNode, StageNode, ToolNode, WorkflowTemplate } from "../../../shared/graph-model.js"
import type { InputRequirement } from "../../../shared/runtime-types.js"
import type {
  WorkflowImportDependency,
  WorkflowImportIssue,
  WorkflowImportMetadata,
  WorkflowImportStatus,
} from "../../../shared/workflow-import.js"
import { checkGraphInvariants, stageLabel, validateFlow } from "../../../graph/index.js"
import type { SourceDependencyIR, SourceEdgeIR, SourceNodeIR, SourceWorkflowIR } from "../../ir/source-ir.js"
import type { DifyCapabilities } from "../../source/dify/normalize.js"

export interface DshImportConversion {
  template: WorkflowTemplate
  report: WorkflowImportMetadata
}

const directlyMappedKinds = new Set(["start", "end", "llm", "agent", "tool"])

export function convertDifyWorkflow(
  source: SourceWorkflowIR,
  capabilities: DifyCapabilities,
  options: { id: string; name?: string; importedAt?: string },
): DshImportConversion {
  const issues: WorkflowImportIssue[] = []
  const nodes = source.nodes.map((node, index) => convertNode(node, index, source, issues))
  const lines = [...source.edges.map((edge) => convertEdge(edge)), ...contextLinesOf(source, issues)]
  collectSourceIssues(source, capabilities, issues)

  const importedAt = options.importedAt ?? new Date().toISOString()
  const draft: WorkflowTemplate = {
    id: options.id,
    mode: "mode1",
    // Dify 导出描述的是固定图。导入后由 Runtime 按 DAG 确定性调度，不再让父模型
    // 临场猜测节点顺序；需要动态编排的原生从零创建流程仍保留 agent 模式。
    executionMode: "dag",
    name: options.name ?? source.name,
    description: source.description ?? "",
    revision: 0,
    nodes,
    lines,
    createdAt: importedAt,
    updatedAt: importedAt,
  }

  const validationFlow = { ...draft, sessionId: "dify-import-validation" }
  const structural = validateFlow(validationFlow)
  for (const issue of structural.issues) {
    issues.push({
      code: `TARGET_${issue.code}`,
      level: "error",
      message: issue.message,
      ...(issue.id ? { nodeId: issue.id } : {}),
    })
  }
  for (const issue of checkGraphInvariants({ flow: validationFlow, origin: "user" })) {
    issues.push({
      code: `TARGET_${issue.code}`,
      level: issue.level,
      message: issue.message,
      ...(issue.nodeIds?.[0] ? { nodeId: issue.nodeIds[0] } : {}),
    })
  }

  const deduplicated = deduplicateIssues(issues)
  const report: WorkflowImportMetadata = {
    platform: "dify",
    ...(source.source.dslVersion ? { sourceVersion: source.source.dslVersion } : {}),
    importedAt,
    status: statusOf(deduplicated),
    issues: deduplicated,
    dependencies: source.dependencies.map(convertDependency),
  }
  draft.sourceImport = report
  return { template: draft, report }
}

function convertNode(node: SourceNodeIR, index: number, source: SourceWorkflowIR, issues: WorkflowImportIssue[]): GraphNode {
  const position = positionOf(node, index)
  if (node.semanticKind === "start" || node.semanticKind === "end") {
    const outputBindings = node.semanticKind === "end" ? endOutputBindingsOf(node, source) : undefined
    if (node.semanticKind === "end" && outputBindings === null) {
      issues.push(issueOf(node, "DIFY_END_UNSUPPORTED", "error", "该结束节点包含无法安全转换的结果表达式；当前支持单一引用或命名的 node.port 输出绑定。"))
    }
    const stage: StageNode = {
      id: node.id,
      kind: node.semanticKind,
      position,
      data: {
        label: stageLabel(node.semanticKind, "mode1"),
        ...(outputBindings && Object.keys(outputBindings).length > 0 ? { outputBindings } : {}),
      },
    }
    return stage
  }

  if (node.semanticKind === "tool") return convertToolNode(node, position, issues)

  const model = recordOf(node.config.model)
  const provider = stringOf(model?.provider) ?? ""
  const modelName = stringOf(model?.name) ?? ""
  if ((node.semanticKind === "llm" || node.semanticKind === "agent") && (!provider || !modelName)) {
    issues.push(issueOf(node, "DIFY_MODEL_REBIND_REQUIRED", "warning", "该节点缺少可直接使用的模型映射，请在运行前重新选择模型。"))
  }
  if (!directlyMappedKinds.has(node.semanticKind)) {
    issues.push(issueOf(
      node,
      "DIFY_NODE_UNSUPPORTED",
      "error",
      "该 Dify 节点没有等价的原生执行语义，已保留为可见占位 Agent；完成适配前不能直接运行。",
    ))
  }

  const inputs = runtimeInputsOf(node, source)

  const role: RoleNode = {
    id: node.id,
    kind: "agent",
    position,
    data: {
      label: node.title?.trim() || node.source.type || node.id,
      responsibility: {
        id: `dify:${node.id}`,
        purpose: responsibilityOf(node),
        deliverable: "产生与原 Dify 节点等价的输出，并交给下游节点。",
      },
      systemPrompt: promptOf(node, source),
      provider,
      model: modelName,
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: JSON.stringify(node.inputs, null, 2),
      outputSchema: JSON.stringify(node.outputs, null, 2),
      ...(Object.keys(inputs).length > 0 ? { execution: { inputs, inputSource: "runtime" as const, retrySafe: true } } : { execution: { retrySafe: true } }),
      injectSystemPrompt: true,
      injectToolSections: true,
      groupId: null,
    },
  }
  return role
}

function convertToolNode(
  node: SourceNodeIR,
  position: { x: number; y: number },
  issues: WorkflowImportIssue[],
): ToolNode {
  const pluginId = stringOf(node.config.plugin_id)
  const providerId = stringOf(node.config.provider_id)
  const toolName = stringOf(node.config.tool_name)
  const identity = difyToolIdentity(pluginId, providerId, toolName)
  if (!toolName || !identity) {
    issues.push(issueOf(node, "DIFY_TOOL_IDENTITY_INVALID", "error", "该工具节点缺少可映射的 plugin_id/provider_id/tool_name，无法绑定 DSH 工具。"))
  }
  const toolRef = identity
    ? dshToolRef(identity.author, identity.plugin, identity.tool)
    : `dsh_migrated__unresolved__${safeId(node.id)}`
  return {
    id: node.id,
    kind: "tool",
    position,
    data: {
      label: node.title?.trim() || toolName || node.id,
      toolRef,
      arguments: toolArgumentsOf(node.config),
      ...(stringOf(node.config.plugin_unique_identifier) ? { requestedPackage: stringOf(node.config.plugin_unique_identifier) } : {}),
      source: {
        platform: "dify",
        ...(pluginId ? { pluginId } : {}),
        ...(stringOf(node.config.plugin_unique_identifier) ? { uniqueIdentifier: stringOf(node.config.plugin_unique_identifier) } : {}),
      },
    },
  }
}

function dshToolRef(author: string, plugin: string, tool: string): string {
  return `dsh_migrated__${toolSegment(author)}__${toolSegment(plugin)}__${toolSegment(tool)}`
}

function toolSegment(value: string): string {
  const normalized = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return (normalized || "unknown").slice(0, 48)
}

function difyToolIdentity(
  pluginId: string | undefined,
  providerId: string | undefined,
  toolName: string | undefined,
): { author: string; plugin: string; tool: string } | undefined {
  if (!toolName) return undefined
  const parts = (pluginId ?? providerId ?? "").split("/").map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return { author: parts[0], plugin: parts[1], tool: toolName }
  if (parts.length === 1) return { author: "unknown", plugin: parts[0], tool: toolName }
  return undefined
}

function toolArgumentsOf(config: Record<string, unknown>): Record<string, unknown> {
  const parameters = recordOf(config.tool_parameters)
  const legacy = recordOf(config.params)
  const result: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(parameters ?? legacy ?? {})) {
    const entry = recordOf(raw)
    result[name] = entry && Object.hasOwn(entry, "value") ? entry.value : raw
  }
  return result
}

function convertEdge(edge: SourceEdgeIR): Line {
  const condition = conditionOf(edge.sourceHandle)
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: "flow-out",
    targetHandle: "flow-in",
    ...(condition ? { condition } : {}),
  }
}

/**
 * Dify 模板变量不会在 DSH 中做字符串插值，而是作为受控运行输入进入任务块。
 * 这里只声明被当前节点实际引用的输入；下游 Agent 输出通过 ctx 连线传递。
 */
function runtimeInputsOf(node: SourceNodeIR, source: SourceWorkflowIR): Record<string, InputRequirement> {
  if (node.semanticKind !== "llm" && node.semanticKind !== "agent") return {}
  const nodes = new Map(source.nodes.map((candidate) => [candidate.id, candidate]))
  const result: Record<string, InputRequirement> = {}
  for (const input of node.inputs) for (const reference of input.references ?? []) {
    const referencedNode = nodes.get(reference.sourceNodeId)
    if (referencedNode && referencedNode.semanticKind !== "start") continue
    const variable = source.variables.find((candidate) => candidate.name === reference.sourcePort
      && (candidate.sourceNodeId === reference.sourceNodeId || !referencedNode && candidate.sourceNodeId === undefined))
    result[reference.sourcePort] = {
      kind: inputKindOf(variable?.dataType),
      required: variable?.required ?? true,
    }
  }
  return result
}

function inputKindOf(dataType: string | undefined): InputRequirement["kind"] {
  const normalized = dataType?.trim().toLowerCase() ?? ""
  if (normalized.includes("file") || normalized.includes("image") || normalized.includes("document")) return "file"
  if (["number", "integer", "float", "boolean", "checkbox", "select", "json", "object", "array"].some((part) => normalized.includes(part))) return "json"
  return "text"
}

/** Explicit variable dependencies preserve non-adjacent upstream output semantics. */
function contextLinesOf(source: SourceWorkflowIR, issues: WorkflowImportIssue[]): Line[] {
  const nodes = new Map(source.nodes.map((node) => [node.id, node]))
  const executable = (node: SourceNodeIR | undefined): boolean => node?.semanticKind === "llm" || node?.semanticKind === "agent" || node?.semanticKind === "tool"
  const adjacency = new Map<string, string[]>()
  for (const edge of source.edges) adjacency.set(edge.sourceNodeId, [...(adjacency.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set([from])
    for (const id of seen) for (const next of adjacency.get(id) ?? []) {
      if (next === target) return true
      seen.add(next)
    }
    return false
  }
  const pairs = new Set<string>()
  for (const target of source.nodes.filter((node) => executable(node))) for (const input of target.inputs) for (const reference of input.references ?? []) {
    const origin = nodes.get(reference.sourceNodeId)
    if (!executable(origin) || origin!.id === target.id) continue
    if (!reaches(origin!.id, target.id)) {
      issues.push(issueOf(target, "DIFY_VARIABLE_DEPENDENCY_INVALID", "error", `变量引用 ${origin!.id}.${reference.sourcePort} 不是当前节点的流程前驱，无法安全转换。`))
      continue
    }
    pairs.add(`${origin!.id}\u0000${target.id}`)
  }
  return [...pairs].map((pair, index) => {
    const [sourceNodeId, targetNodeId] = pair.split("\u0000")
    return {
      id: `dify-ctx-${index + 1}-${safeId(sourceNodeId)}-${safeId(targetNodeId)}`,
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle: "ctx-out",
      targetHandle: "ctx-in",
    }
  })
}

function collectSourceIssues(
  source: SourceWorkflowIR,
  capabilities: DifyCapabilities,
  issues: WorkflowImportIssue[],
): void {
  if (capabilities.hasEnvironmentVariables || capabilities.hasConversationVariables) {
    issues.push({
      code: "DIFY_VARIABLE_SCOPE_REVIEW_REQUIRED",
      level: "warning",
      message: "Dify 环境变量或会话变量不会携带值，需在目标环境重新绑定。",
    })
  }
  const runtimeVariables = source.variables.filter((variable) => variable.scope === "input" || variable.scope === "workflow")
  if (runtimeVariables.length > 0) {
    const names = [...new Set(runtimeVariables.map((variable) => variable.name))]
    issues.push({
      code: "DIFY_RUNTIME_INPUT_REQUIRED",
      level: "warning",
      message: `以下 Dify 变量已转换为运行输入，运行前请填写：${names.join("、")}。`,
    })
  }
  for (const dependency of source.dependencies) {
    if (dependency.kind === "model") {
      issues.push({
        code: "DIFY_MODEL_REBIND_REQUIRED",
        level: "warning",
        message: `尚未验证目标环境是否提供模型「${dependency.source.name ?? dependency.id}」，请在运行前确认或重新选择。`,
        nodeId: dependency.id.split(":", 1)[0],
      })
      continue
    }
    // Tool 节点已经绑定到稳定的 DSH toolRef。安装由迁移器负责；运行前注册表会
    // 对缺包/缺凭据给出确定错误，不再把节点降级成需要手工替换的占位 Agent。
    if (dependency.kind === "tool") continue
    issues.push({
      code: `DIFY_${dependency.kind.toUpperCase()}_REBIND_REQUIRED`,
      level: dependency.kind === "credential" ? "error" : "warning",
      message: dependencyMessage(dependency),
      nodeId: dependency.id.split(":", 1)[0],
    })
  }
  for (const field of capabilities.unknownFields) {
    issues.push({
      code: "DIFY_UNKNOWN_ROOT_FIELD",
      level: "warning",
      message: `Dify 导出包含当前适配器不认识的顶层字段：${field}。`,
    })
  }
}

function promptOf(node: SourceNodeIR, source: SourceWorkflowIR): string {
  const prompt = node.config.prompt_template
  const sections: string[] = []
  if (Array.isArray(prompt)) {
    for (const item of prompt) {
      const entry = recordOf(item)
      const text = stringOf(entry?.text)?.trim()
      if (text) sections.push(`${stringOf(entry?.role) ?? "prompt"}:\n${rewriteReferences(text, source)}`)
    }
  }
  if (sections.length > 0 && (node.semanticKind === "llm" || node.semanticKind === "agent")) {
    return sections.join("\n\n")
  }
  return [
    `这是从 Dify 的 ${node.source.type} 节点导入的适配占位。`,
    "请先根据兼容报告重绑定所需模型、工具、知识库或凭据，再确认执行语义。",
    "来源配置已脱敏：",
    limitedJson(node.config),
  ].join("\n\n")
}

function rewriteReferences(text: string, source: SourceWorkflowIR): string {
  const nodes = new Map(source.nodes.map((node) => [node.id, node]))
  return text.replace(/\{\{#([^.#{}]+)\.([^#{}]+)#\}\}/g, (_match, sourceNodeId: string, sourcePort: string) => {
    const origin = nodes.get(sourceNodeId)
    if (origin?.semanticKind === "start" || !origin) return `[运行输入「${sourcePort}」；读取任务块中的实际值]`
    return `[上游节点「${origin.title ?? sourceNodeId}」的「${sourcePort}」输出；读取上游上下文中的实际值]`
  })
}

function endOutputBindingsOf(
  node: SourceNodeIR,
  source: SourceWorkflowIR,
): Record<string, { nodeId: string; port: string }> | undefined | null {
  if (node.source.type === "answer") {
    const answer = stringOf(node.config.answer)?.trim()
    const match = answer?.match(/^\{\{#([^.#{}]+)\.([^#{}]+)#\}\}$/)
    if (!match) return null
    const origin = source.nodes.find((candidate) => candidate.id === match[1])
    const incoming = source.edges.filter((edge) => edge.targetNodeId === node.id)
    if ((origin?.semanticKind !== "llm" && origin?.semanticKind !== "agent" && origin?.semanticKind !== "tool")
      || incoming.length !== 1 || incoming[0].sourceNodeId !== origin.id) return null
    return { answer: { nodeId: match[1], port: match[2] } }
  }
  const outputs = node.config.outputs
  if (outputs === undefined || Array.isArray(outputs) && outputs.length === 0) return undefined
  if (!Array.isArray(outputs)) return null
  const result: Record<string, { nodeId: string; port: string }> = {}
  for (const raw of outputs) {
    const output = recordOf(raw)
    const name = stringOf(output?.variable)
    const selector = output?.value_selector
    if (!name || !Array.isArray(selector) || selector.length !== 2
      || typeof selector[0] !== "string" || typeof selector[1] !== "string"
      || !source.nodes.some((candidate) => candidate.id === selector[0])) return null
    result[name] = { nodeId: selector[0], port: selector[1] }
  }
  return result
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "node"
}

function responsibilityOf(node: SourceNodeIR): string {
  if (node.semanticKind === "llm" || node.semanticKind === "agent") return `执行原 Dify「${node.title ?? node.id}」节点的模型任务。`
  return `承接原 Dify ${node.source.type} 节点的职责；当前为待适配占位。`
}

function positionOf(node: SourceNodeIR, index: number): { x: number; y: number } {
  const raw = recordOf(node.source.raw)
  const original = recordOf(raw?.position)
  const x = numberOf(original?.x)
  const y = numberOf(original?.y)
  if (x !== undefined && y !== undefined) return { x, y }
  return { x: 120 + index * 280, y: 120 }
}

function conditionOf(sourceHandle: string | undefined): Line["condition"] | undefined {
  const normalized = sourceHandle?.trim().toLowerCase()
  if (!normalized || normalized === "source") return undefined
  if (["true", "yes", "pass"].includes(normalized)) return { type: "pass" }
  if (["false", "no", "fail"].includes(normalized)) return { type: "fail" }
  return { type: "content", label: sourceHandle }
}

function issueOf(
  node: SourceNodeIR,
  code: string,
  level: WorkflowImportIssue["level"],
  message: string,
): WorkflowImportIssue {
  return { code, level, message, nodeId: node.id, sourceType: node.source.type }
}

function convertDependency(dependency: SourceDependencyIR): WorkflowImportDependency {
  return {
    kind: dependency.kind,
    ...(dependency.source.provider ? { provider: dependency.source.provider } : {}),
    ...(dependency.source.name ? { name: dependency.source.name } : {}),
    requiresRebinding: dependency.kind !== "tool",
  }
}

function dependencyMessage(dependency: SourceDependencyIR): string {
  const label = dependency.source.name ?? dependency.source.provider ?? dependency.id
  if (dependency.kind === "credential") return `来源凭据「${label}」已被移除，必须在目标环境重新配置。`
  return `外部依赖「${label}」不会自动迁移，请在目标环境重新绑定 ${dependency.kind}。`
}

function statusOf(issues: readonly WorkflowImportIssue[]): WorkflowImportStatus {
  if (issues.some((issue) => issue.level === "error")) return "blocked"
  if (issues.length > 0) return "review-required"
  return "ready"
}

function deduplicateIssues(issues: readonly WorkflowImportIssue[]): WorkflowImportIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.nodeId ?? ""}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function limitedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  return text.length <= 12_000 ? text : `${text.slice(0, 12_000)}\n…（配置过长，已截断）`
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

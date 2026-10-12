import { ctxInEdges, isFlowLine, isGroupMember, mainNodeIdOf, nodeById } from "../graph/index.js"
import type { RoleNode, WorkflowDocument } from "../shared/graph-model.js"
import type { FlowInputContext, InputSlots } from "../shared/runtime-types.js"
import type { RunSnapshot } from "../shared/types.js"
import { WfError } from "./errors.js"
import { executionOf, verifyNodeArtifacts } from "./execution-inputs.js"
import { authorizedOutputPath, outputSignature } from "./execution-file-access.js"
import { truncateText } from "./snapshot.js"

/** Only newly opted-in ordinary nodes use default Flow context; explicit sources keep their contract. */
export function usesHarnessContext(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot): boolean {
  const execution = executionOf(node)
  return snapshot.harnessContext === true && snapshot.handoffPolicy === undefined && node.kind === "agent" && !isGroupMember(flow, node.id)
    && !ctxInEdges(flow, node.id).length && !Object.values(boundNodeInputs(snapshot, node.id)).some((values) => values.length)
    && !execution.inputSource && !Object.keys(execution.inputs ?? {}).length && !execution.requiredFiles?.length
}

/** A conditional-only route may remain unexecuted; mandatory sources cannot be omitted. */
export function conditionalRoute(flow: WorkflowDocument, id: string, path = new Set<string>(), memo = new Map<string, boolean>()): boolean {
  if (memo.has(id)) return memo.get(id)!
  if (path.has(id)) return false
  const next = new Set(path).add(id)
  const incoming = flow.lines.filter(isFlowLine).filter((line) => (mainNodeIdOf(flow, line.target) ?? line.target) === id)
  const result = incoming.length > 0 && incoming.every((line) => !!line.condition || conditionalRoute(flow, mainNodeIdOf(flow, line.source) ?? line.source, next, memo))
  memo.set(id, result)
  return result
}

/** Source identities are direct graph dependencies, never model-provided paths or scanned files. */
export async function flowNodeContextOf(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, limit: number, selection?: unknown): Promise<FlowInputContext[]> {
  if (!usesHarnessContext(flow, node, snapshot)) {
    if (selection !== undefined) throw new WfError("flowSources 仅用于默认 Harness 上下文的普通节点", "WF_BAD_ARGS")
    return []
  }
  const idOf = (id: string): string => mainNodeIdOf(flow, id) ?? id
  const incoming = flow.lines.filter(isFlowLine).filter((line) => idOf(line.target) === node.id)
  const sources = [...new Set(incoming.map((line) => idOf(line.source)))].map((id) => nodeById(flow, id)).filter((source): source is RoleNode => source?.kind === "agent")
  const chosen = selection === undefined ? undefined : Array.isArray(selection) && selection.every((id) => typeof id === "string") ? new Set(selection.map(idOf)) : null
  if (chosen === null || chosen && [...chosen].some((id) => !sources.some((source) => source.id === id))) throw new WfError("flowSources 必须是直接上游节点 ID 的数组", "WF_BAD_ARGS")
  const conditional = sources.filter((source) => incoming.filter((line) => idOf(line.source) === source.id).every((line) => !!line.condition))
  if (!chosen && conditional.filter((source) => ["ok", "react-capped"].includes(snapshot.nodes.find((record) => record.nodeId === source.id)?.status ?? "")).length > 1) throw new WfError("多个条件上游已执行，请用 flowSources 明确此次生效的来源", "WF_INPUT_AMBIGUOUS")
  const context: FlowInputContext[] = []
  let remaining = Math.max(0, limit)
  for (const source of sources) {
    const optional = conditional.some((entry) => entry.id === source.id) || conditionalRoute(flow, source.id)
    const record = snapshot.nodes.find((entry) => entry.nodeId === source.id)
    if (chosen && !chosen.has(source.id)) {
      if (!optional) throw new WfError(`不能省略必需上游 ${source.id}`, "WF_INPUT_UPSTREAM_UNAVAILABLE")
      continue
    }
    if (!chosen && optional && !record?.attempts) continue
    if (!chosen && optional && record?.status === "fail") continue
    if (!chosen && optional && record?.taskAcceptance && ["failed", "needs-input"].includes(record.taskAcceptance.status)) continue
    const attempt = record?.attemptHistory?.at(-1)
    if (!record || !["ok", "react-capped"].includes(record.status) || !attempt || attempt.phase !== "settled" || attempt.attempt !== record.attempts || attempt.status !== record.status
      || (!record.resumed && attempt.runId !== snapshot.id) || !attempt.runId) throw new WfError(`直接上游 ${source.id} 尚无当前代际有效结算`, "WF_INPUT_UPSTREAM_UNAVAILABLE")
    if (record.taskAcceptance && record.taskAcceptance.status !== "accepted") throw new WfError(`上游 ${source.id} 任务${record.taskAcceptance.status === "pending" ? "待一次验收；请通过 reviews 明确接受、待输入或失败" : "未通过验收，请补充输入或失败收尾"}`, "WF_TASK_REVIEW_REQUIRED")
    const checked = structuredClone(snapshot)
    await verifyNodeArtifacts(source, checked, Date.now())
    const artifacts = executionOf(source).outputFiles?.length ? checked.nodes.find((entry) => entry.nodeId === source.id)?.artifacts ?? [] : []
    for (const artifact of artifacts) {
      const evidence = record.artifacts?.find((entry) => entry.path === artifact.path)
      if (!evidence?.signature || evidence.attempt !== record.attempts || evidence.nodeId !== source.id || evidence.runId !== attempt.runId
        || (await outputSignature(await authorizedOutputPath(artifact.path, snapshot.workingDirectory)))?.signature !== evidence.signature) throw new WfError(`上游 ${source.id} 产物缺少当前代际证据或已变化`, "WF_OUTPUT_FILE_STALE")
    }
    const result = truncateText(record.output === "(子代理已完成，但无可汇总文本)" ? "" : record.output, remaining)
    remaining = Math.max(0, remaining - result.length)
    context.push({ nodeId: source.id, label: source.data.label || source.id, responsibility: truncateText(source.data.responsibility?.purpose ?? source.data.systemPrompt ?? "", Math.min(remaining, 1000)), runId: attempt.runId, attempt: record.attempts, childId: record.childId, result,
      flowEdges: incoming.filter((line) => idOf(line.source) === source.id).map((line) => ({ lineId: line.id, ...(line.condition ? { condition: { ...line.condition } } : {}) })), artifacts: artifacts.map(({ path, size }) => ({ path, size })) })
    remaining = Math.max(0, remaining - context.at(-1)!.responsibility.length)
  }
  return context
}

/** Workflow inputs belong to one initial Agent, never to every node or an arbitrary branch. */
export function workflowInputTarget(flow: WorkflowDocument): string {
  const idOf = (id: string): string => mainNodeIdOf(flow, id) ?? id
  const candidates = flow.nodes.filter((node) => {
    if (node.kind !== "agent" || isGroupMember(flow, node.id)) return false
    const incoming = flow.lines.filter(isFlowLine).filter((line) => idOf(line.target) === node.id)
    return incoming.length > 0 && incoming.every((line) => !line.condition && nodeById(flow, idOf(line.source))?.kind === "start")
  })
  if (candidates.length !== 1) throw new WfError("工作流输入没有唯一初始 Agent；请明确绑定到指定节点", "WF_INPUT_AMBIGUOUS")
  return candidates[0].id
}

export function boundNodeInputs(snapshot: RunSnapshot, nodeId: string): InputSlots {
  return { ...(snapshot.workflowInputNodeId === nodeId ? snapshot.runtimeInputs?.workflowInputs : {}), ...snapshot.runtimeInputs?.nodeInputs[nodeId] }
}

/** Automatic handoff is limited to a unique unconditional direct Agent predecessor. */
export async function effectiveNodeInputs(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot): Promise<InputSlots> {
  const bound = boundNodeInputs(snapshot, node.id)
  // Existing ctx always wins. User node bindings deliberately replace automatic input.
  if (snapshot.handoffPolicy !== "auto" || ctxInEdges(flow, node.id).length || Object.values(bound).some((values) => values.length)) return bound
  const idOf = (id: string): string => mainNodeIdOf(flow, id) ?? id
  const lines = flow.lines.filter(isFlowLine)
  const incoming = lines.filter((line) => idOf(line.target) === node.id)
  if (!incoming.length || incoming.every((line) => !line.condition && nodeById(flow, idOf(line.source))?.kind === "start")) return bound
  const sources = [...new Set(incoming.map((line) => idOf(line.source)))]
  const source = sources.length === 1 ? nodeById(flow, sources[0]) : undefined
  const reachable = new Set([node.id])
  for (const id of reachable) for (const line of lines) if (idOf(line.source) === id) reachable.add(idOf(line.target))
  if (isGroupMember(flow, node.id) || source?.kind !== "agent" || isGroupMember(flow, source.id) || incoming.some((line) => line.condition) || reachable.has(source.id)) {
    throw new WfError(`节点 ${node.id} 的自动交接来源不确定；请绑定输入或使用显式 ctx`, "WF_INPUT_AMBIGUOUS")
  }
  const record = snapshot.nodes.find((entry) => entry.nodeId === source.id)
  const attempt = record?.attemptHistory?.at(-1)
  if (!record || !["ok", "react-capped"].includes(record.status) || !record.attempts || attempt?.attempt !== record.attempts || attempt.phase !== "settled" || attempt.status !== record.status) {
    throw new WfError(`上游 ${source.id} 尚无有效结算；请等待结算或处理失败后重试`, "WF_INPUT_UPSTREAM_UNAVAILABLE")
  }
  const inputs: InputSlots = {}
  const origin = { source: "node" as const, nodeId: source.id, runId: attempt.runId ?? snapshot.id, attempt: record.attempts }
  if (record.output.trim() && record.output !== "(子代理已完成，但无可汇总文本)") inputs.upstreamText = [{ kind: "text", value: record.output, origin }]
  // Reuse the original existence/current-write evidence check without mutating the source snapshot.
  const checked = structuredClone(snapshot)
  await verifyNodeArtifacts(source, checked, Date.now())
  const verified = executionOf(source).outputFiles?.length ? checked.nodes.find((entry) => entry.nodeId === source.id)?.artifacts ?? [] : []
  for (const artifact of verified) {
    const settled = record.artifacts?.find((entry) => entry.path === artifact.path)
    if (settled?.signature && (settled.attempt !== record.attempts || settled.nodeId !== source.id || (!record.resumed && settled.runId !== snapshot.id)
      || (await outputSignature(await authorizedOutputPath(artifact.path, snapshot.workingDirectory)))?.signature !== settled.signature)) {
      throw new WfError(`上游 ${source.id} 的文件已变化或属于旧尝试；请重新执行`, "WF_OUTPUT_FILE_STALE")
    }
  }
  if (verified.length) inputs.upstreamFiles = verified.map((artifact) => ({ kind: "file", fileRef: { source: "node", path: artifact.path }, origin }))
  if (!Object.keys(inputs).length) throw new WfError(`上游 ${source.id} 没有可交接的文本或已验证文件`, "WF_INPUT_UPSTREAM_UNAVAILABLE")
  return inputs
}

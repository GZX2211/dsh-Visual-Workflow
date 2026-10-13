import { buildFlowDag, computeFlowLayers, detectCycleNodes, isFlowLine, validateFlow } from "../graph/index.js"
import type { ExecutionMode, WorkflowDocument } from "../shared/graph-model.js"
import type { RunSnapshot } from "../shared/run-types.js"
import { WfError } from "./errors.js"

/** Mode is explicit: neither handoff policy nor Harness context selects the scheduler. */
export function executionModeOf(value: unknown): ExecutionMode {
  if (value === undefined) return "agent"
  if (value === "dag" || value === "agent") return value
  throw new WfError("executionMode 必须为 dag 或 agent", "WF_BAD_ARGS")
}

export function dagConcurrencyOf(value: unknown): number {
  if (value === undefined) return 2
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 16) throw new WfError("dagConcurrency 必须是 1 到 16 的整数", "WF_BAD_ARGS")
  return value
}

/** The existing graph validator owns connection shapes; this check owns DAG execution support. */
export function validateDagForRun(flow: WorkflowDocument): void {
  const unsupported = flow.nodes.filter((node) => ["parent", "proxy", "group"].includes(node.kind))
  if (flow.nodes.some((node) => ["__proto__", "prototype", "constructor"].includes(node.id) || node.id.startsWith("dag-review:"))) throw new WfError("DAG 节点 ID 不能使用保留属性名或内部 dag-review: 前缀", "WF_FLOW_INVALID")
  if (flow.mode !== "mode1" || unsupported.length) throw new WfError(`DAG 首版不支持后台服务、Parent、Proxy 或 Team：${unsupported.map((node) => node.id).join(", ")}；请显式选择 agent 模式`, "WF_DAG_UNSUPPORTED")
  const validation = validateFlow(flow)
  if (!validation.ok) throw new WfError(`DAG 图无效：${validation.issues[0]?.message}`, "WF_FLOW_INVALID")
  const dag = buildFlowDag(flow.nodes, flow.lines)
  if (detectCycleNodes(dag).size) throw new WfError("DAG 不允许流程循环；需要动态回流时请选择 agent 模式", "WF_DAG_CYCLE")
  const starts = flow.nodes.filter((node) => node.kind === "start")
  const ends = flow.nodes.filter((node) => node.kind === "end")
  if (starts.length !== 1 || ends.length !== 1) throw new WfError("DAG 必须具有唯一 start 和 end", "WF_FLOW_INVALID")
  const control = flow.nodes.filter((node) => ["agent", "start", "end", "pause"].includes(node.kind))
  const controlIds = new Set(control.map((node) => node.id))
  if (flow.lines.some((line) => isFlowLine(line) && (!controlIds.has(line.source) || !controlIds.has(line.target)))) throw new WfError("DAG 文件和数据库节点只能通过 ctx/db 提供输入，不能承载流程控制", "WF_DAG_UNSUPPORTED")
  const walk = (initial: string, neighbours: Map<string, string[]>): Set<string> => {
    const reached = new Set([initial])
    for (const id of reached) for (const next of neighbours.get(id) ?? []) reached.add(next)
    return reached
  }
  const fromStart = walk(starts[0].id, dag.adjacency)
  const toEnd = walk(ends[0].id, dag.incoming)
  if (control.some((node) => !fromStart.has(node.id) || !toEnd.has(node.id))) throw new WfError("DAG 所有执行节点必须位于 start 到 end 的路径上", "WF_FLOW_INVALID")
  const lineIds = new Set<string>()
  for (const line of flow.lines) {
    if (!line.id || lineIds.has(line.id)) throw new WfError("DAG 连线 ID 必须非空且唯一", "WF_FLOW_INVALID")
    lineIds.add(line.id)
    if (line.condition && (!isFlowLine(line) || !["pass", "fail", "content"].includes(line.condition.type) || flow.nodes.find((node) => node.id === line.source)?.kind !== "agent")) throw new WfError("DAG 条件只能由 Agent 节点的已验证决策产生", "WF_DAG_CONDITION_INVALID")
    if (line.condition) validateDagRule(line.condition.rule)
  }
  // ctx from another Agent is also a dependency, not permission to consume unsettled output.
  const ancestors = (id: string): Set<string> => walk(id, dag.incoming)
  for (const line of flow.lines) if (line.targetHandle === "ctx-in" && flow.nodes.find((node) => node.id === line.source)?.kind === "agent" && (line.source === line.target || !ancestors(line.target).has(line.source))) throw new WfError("DAG 的 Agent ctx 来源必须是流程前驱，不能形成隐式并发依赖", "WF_DAG_UNSUPPORTED")
}

function validateDagRule(rule: unknown): void {
  if (!rule) throw new WfError("DAG 首版不执行自然语言条件；请声明可计算的 condition.rule 或选择 agent 模式", "WF_DAG_UNSUPPORTED")
  const row = rule as Record<string, unknown>
  if (Object.keys(row).some((key) => !["path", "operator", "value"].includes(key)) || !Array.isArray(row.path) || !row.path.length || row.path.length > 16 || row.path.some((field) => typeof field !== "string" || !field || field.length > 128 || ["__proto__", "prototype", "constructor"].includes(field)) || !["eq", "ne", "gt", "gte", "lt", "lte", "exists"].includes(String(row.operator)) || row.operator !== "exists" && (row.value !== null && !["string", "number", "boolean"].includes(typeof row.value) || typeof row.value === "number" && !Number.isFinite(row.value))) throw new WfError("DAG 条件规则需要有效 JSON path、operator 与标量 value", "WF_DAG_CONDITION_INVALID")
  if (["gt", "gte", "lt", "lte"].includes(String(row.operator)) && typeof row.value !== "number") throw new WfError("数值条件的 value 必须是数值", "WF_DAG_CONDITION_INVALID")
}

function dagAgentAccepted(snapshot: RunSnapshot, record: RunSnapshot["nodes"][number] | undefined): boolean {
  const attempt = record?.attemptHistory?.at(-1)
  const task = record?.taskAcceptance
  const origin = task?.origin
  return !!record && ["ok", "react-capped"].includes(record.status) && task?.status === "accepted" && !!attempt && attempt.phase === "settled"
    && attempt.status === record.status && !!attempt.runId && !!attempt.childId && attempt.attempt === record.attempts && attempt.childId === record.childId && attempt.taskAcceptance?.status === "accepted"
    && (!task.review || task.review.state === "finished") && (record.resumed === true || attempt.runId === snapshot.id)
    && !!origin && origin.runId === attempt.runId && origin.nodeId === record.nodeId && origin.attempt === record.attempts && origin.childId === record.childId && origin.definitionRunId === (snapshot.dagDefinitionRunId ?? snapshot.id)
}

/** Rules consume only a settled JSON output, never code or arbitrary expression text. */
export function selectDagRoutes(flow: WorkflowDocument, snapshot: RunSnapshot, nodeId: string): string[] {
  const outgoing = flow.lines.filter(isFlowLine).filter((line) => line.source === nodeId && line.condition)
  if (!outgoing.length) return []
  const record = snapshot.nodes.find((node) => node.nodeId === nodeId)
  if (!record || !dagAgentAccepted(snapshot, record)) throw new WfError("条件来源尚未有效结算并验收", "WF_DAG_CONDITION_INVALID")
  let output: unknown
  try { output = JSON.parse(record.output.trim().replace(/^```json\s*([\s\S]*?)\s*```$/, "$1")) } catch { throw new WfError("可计算条件的来源必须返回有效 JSON 数据", "WF_DAG_CONDITION_INVALID") }
  return outgoing.filter((line) => {
    validateDagRule(line.condition!.rule)
    const rule = line.condition!.rule!
    let value: unknown = output
    let exists = true
    for (const field of rule.path) {
      if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, field)) { exists = false; break }
      value = (value as Record<string, unknown>)[field]
    }
    if (rule.operator === "exists") return exists
    if (!exists) throw new WfError(`条件字段不存在：${rule.path.join(".")}`, "WF_DAG_CONDITION_INVALID")
    if (rule.operator === "eq") return value === rule.value
    if (rule.operator === "ne") return value !== rule.value
    if (typeof value !== "number" || typeof rule.value !== "number" || !Number.isFinite(value)) throw new WfError("数值条件需要有限数值字段与 value", "WF_DAG_CONDITION_INVALID")
    if (rule.operator === "gt") return value > rule.value
    if (rule.operator === "gte") return value >= rule.value
    if (rule.operator === "lt") return value < rule.value
    return value <= rule.value
  }).map((line) => line.id)
}

export interface DagFrontier {
  ready: string[]
  skipped: string[]
  sources: Record<string, string[]>
  complete: boolean
}

/** Pure AND-join: wait for every live predecessor; an unselected branch never counts as success. */
export function dagFrontierOf(flow: WorkflowDocument, snapshot: RunSnapshot): DagFrontier {
  const result: DagFrontier = { ready: [], skipped: [], sources: {}, complete: false }
  if (snapshot.status !== "running" || snapshot.executionMode !== "dag") return result
  const dag = buildFlowDag(flow.nodes, flow.lines)
  const layers = computeFlowLayers(dag)
  const order = new Map(flow.nodes.map((node, index) => [node.id, index]))
  const control = flow.nodes.filter((node) => ["start", "agent", "pause", "end"].includes(node.kind)).sort((a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0) || order.get(a.id)! - order.get(b.id)!)
  const records = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))
  const inactive = new Set<string>()
  const accepted = (id: string): boolean => {
    const node = flow.nodes.find((entry) => entry.id === id)
    const record = records.get(id)
    if (node?.kind === "start" || node?.kind === "pause" || node?.kind === "end") return record?.status === "ok"
    return dagAgentAccepted(snapshot, record)
  }
  for (const node of control) {
    const record = records.get(node.id)
    if (record?.status === "skipped") { inactive.add(node.id); continue }
    if (node.kind === "start") continue
    const incoming = flow.lines.filter(isFlowLine).filter((line) => line.target === node.id)
    const states = incoming.map((line) => {
      if (inactive.has(line.source)) return "inactive"
      if (!accepted(line.source)) return "waiting"
      if (line.condition && !Array.isArray(records.get(line.source)?.attemptHistory?.at(-1)?.dagRoutes)) return "waiting"
      if (line.condition && !records.get(line.source)?.attemptHistory?.at(-1)?.dagRoutes?.includes(line.id)) return "inactive"
      return "satisfied"
    })
    if (states.length && states.every((state) => state === "inactive")) {
      inactive.add(node.id)
      if (record?.status === "pending") result.skipped.push(node.id)
      continue
    }
    if (states.some((state) => state === "waiting") || !states.includes("satisfied")) continue
    result.sources[node.id] = [...new Set(incoming.filter((_, index) => states[index] === "satisfied").map((line) => line.source).filter((id) => flow.nodes.find((source) => source.id === id)?.kind === "agent"))]
    if (record?.status === "pending") result.ready.push(node.id)
  }
  const end = control.find((node) => node.kind === "end")
  result.complete = !!end && accepted(end.id) && control.every((node) => inactive.has(node.id) || accepted(node.id))
  return result
}

export function findReadyNodes(graph: WorkflowDocument, snapshot: RunSnapshot): string[] {
  return dagFrontierOf(graph, snapshot).ready
}

/** Read-only projection: execution status and task status retain their original facts. */
export function dagStateOf(flow: WorkflowDocument, snapshot: RunSnapshot): NonNullable<RunSnapshot["dagState"]> {
  const { ready } = dagFrontierOf(flow, snapshot)
  const blocked: NonNullable<RunSnapshot["dagState"]>["blocked"] = {}
  const running = snapshot.nodes.filter((node) => node.status === "running" || node.taskAcceptance?.review?.state === "running").length
  for (const record of snapshot.nodes) {
    if (record.taskAcceptance?.status === "needs-input") blocked[record.nodeId] = { reason: "needs-input", nodeIds: [] }
    else if (record.taskAcceptance?.status === "pending") blocked[record.nodeId] = { reason: "task-review", nodeIds: [] }
    else if (record.status === "pending") {
      if (snapshot.status !== "running") blocked[record.nodeId] = { reason: snapshot.status === "paused" ? "paused" : "stopped", nodeIds: [] }
      else if (ready.includes(record.nodeId)) {
        if (running >= (snapshot.dagConcurrency ?? 2)) blocked[record.nodeId] = { reason: "capacity", nodeIds: [] }
      } else {
        const incoming = flow.lines.filter(isFlowLine).filter((line) => line.target === record.nodeId)
        if (incoming.length) blocked[record.nodeId] = { reason: "dependency", nodeIds: [...new Set(incoming.map((line) => line.source).filter((id) => snapshot.nodes.find((node) => node.nodeId === id)?.status !== "skipped" && !dagAgentAccepted(snapshot, snapshot.nodes.find((node) => node.nodeId === id)) && flow.nodes.find((node) => node.id === id)?.kind !== "start"))] }
      }
    }
  }
  return { ready, blocked }
}

/** Only the isolated reviewer emits this small closed schema; business output stays free form. */
export function dagReviewResultOf(raw: string): { status: "accepted" | "needs-input" | "failed" | "unknown"; reason: string } {
  if (raw.length > 16000) throw new WfError("语义验收输出过长", "WF_DAG_REVIEW_INVALID")
  const text = raw.trim().replace(/^```json\s*([\s\S]*?)\s*```$/, "$1")
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new WfError("语义验收必须返回合法 JSON", "WF_DAG_REVIEW_INVALID") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WfError("语义验收必须返回对象", "WF_DAG_REVIEW_INVALID")
  const row = value as Record<string, unknown>
  if (Object.keys(row).some((key) => !["status", "reason"].includes(key)) || !["accepted", "needs-input", "failed", "unknown"].includes(String(row.status)) || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 2000) throw new WfError("语义验收需要有效 status 与简短非空 reason", "WF_DAG_REVIEW_INVALID")
  return { status: row.status as "accepted" | "needs-input" | "failed" | "unknown", reason: row.reason.trim() }
}

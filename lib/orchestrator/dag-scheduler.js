import { buildFlowDag, computeFlowLayers, detectCycleNodes, isFlowLine, validateFlow } from "../graph/index.js";
import { WfError } from "./errors.js";
/** Mode is explicit: neither handoff policy nor Harness context selects the scheduler. */
export function executionModeOf(value) {
    if (value === undefined)
        return "agent";
    if (value === "dag" || value === "agent")
        return value;
    throw new WfError("executionMode 必须为 dag 或 agent", "WF_BAD_ARGS");
}
export function dagConcurrencyOf(value) {
    if (value === undefined)
        return 2;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 16)
        throw new WfError("dagConcurrency 必须是 1 到 16 的整数", "WF_BAD_ARGS");
    return value;
}
/** The existing graph validator owns connection shapes; this check owns DAG execution support. */
export function validateDagForRun(flow) {
    const unsupported = flow.nodes.filter((node) => ["parent", "proxy", "group"].includes(node.kind));
    if (flow.mode !== "mode1" || unsupported.length)
        throw new WfError(`DAG 首版不支持后台服务、Parent、Proxy 或 Team：${unsupported.map((node) => node.id).join(", ")}；请显式选择 agent 模式`, "WF_DAG_UNSUPPORTED");
    const validation = validateFlow(flow);
    if (!validation.ok)
        throw new WfError(`DAG 图无效：${validation.issues[0]?.message}`, "WF_FLOW_INVALID");
    const dag = buildFlowDag(flow.nodes, flow.lines);
    if (detectCycleNodes(dag).size)
        throw new WfError("DAG 不允许流程循环；需要动态回流时请选择 agent 模式", "WF_DAG_CYCLE");
    const starts = flow.nodes.filter((node) => node.kind === "start");
    const ends = flow.nodes.filter((node) => node.kind === "end");
    if (starts.length !== 1 || ends.length !== 1)
        throw new WfError("DAG 必须具有唯一 start 和 end", "WF_FLOW_INVALID");
    const control = flow.nodes.filter((node) => ["agent", "start", "end", "pause"].includes(node.kind));
    const controlIds = new Set(control.map((node) => node.id));
    if (flow.lines.some((line) => isFlowLine(line) && (!controlIds.has(line.source) || !controlIds.has(line.target))))
        throw new WfError("DAG 文件和数据库节点只能通过 ctx/db 提供输入，不能承载流程控制", "WF_DAG_UNSUPPORTED");
    const walk = (initial, neighbours) => {
        const reached = new Set([initial]);
        for (const id of reached)
            for (const next of neighbours.get(id) ?? [])
                reached.add(next);
        return reached;
    };
    const fromStart = walk(starts[0].id, dag.adjacency);
    const toEnd = walk(ends[0].id, dag.incoming);
    if (control.some((node) => !fromStart.has(node.id) || !toEnd.has(node.id)))
        throw new WfError("DAG 所有执行节点必须位于 start 到 end 的路径上", "WF_FLOW_INVALID");
    const lineIds = new Set();
    for (const line of flow.lines) {
        if (!line.id || lineIds.has(line.id))
            throw new WfError("DAG 连线 ID 必须非空且唯一", "WF_FLOW_INVALID");
        lineIds.add(line.id);
        if (line.condition && (!isFlowLine(line) || !["pass", "fail", "content"].includes(line.condition.type) || flow.nodes.find((node) => node.id === line.source)?.kind !== "agent"))
            throw new WfError("DAG 条件只能由 Agent 节点的已验证决策产生", "WF_DAG_CONDITION_INVALID");
    }
    // ctx from another Agent is also a dependency, not permission to consume unsettled output.
    const ancestors = (id) => walk(id, dag.incoming);
    for (const line of flow.lines)
        if (line.targetHandle === "ctx-in" && flow.nodes.find((node) => node.id === line.source)?.kind === "agent" && !ancestors(line.target).has(line.source))
            throw new WfError("DAG 的 Agent ctx 来源必须是流程前驱，不能形成隐式并发依赖", "WF_DAG_UNSUPPORTED");
}
/** Pure AND-join: wait for every live predecessor; an unselected branch never counts as success. */
export function dagFrontierOf(flow, snapshot) {
    const result = { ready: [], skipped: [], sources: {}, complete: false };
    if (snapshot.status !== "running" || snapshot.executionMode !== "dag")
        return result;
    const dag = buildFlowDag(flow.nodes, flow.lines);
    const layers = computeFlowLayers(dag);
    const order = new Map(flow.nodes.map((node, index) => [node.id, index]));
    const control = flow.nodes.filter((node) => ["start", "agent", "pause", "end"].includes(node.kind)).sort((a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0) || order.get(a.id) - order.get(b.id));
    const records = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
    const inactive = new Set();
    const accepted = (id) => {
        const node = flow.nodes.find((entry) => entry.id === id);
        const record = records.get(id);
        if (node?.kind === "start" || node?.kind === "pause" || node?.kind === "end")
            return record?.status === "ok";
        const attempt = record?.attemptHistory?.at(-1);
        return record?.status === "ok" && record.taskAcceptance?.status === "accepted" && !!attempt && attempt.phase === "settled"
            && attempt.status === "ok" && !!attempt.runId && !!attempt.childId && attempt.attempt === record.attempts && attempt.childId === record.childId && attempt.taskAcceptance?.status === "accepted"
            && (record.resumed === true || attempt.runId === snapshot.id);
    };
    for (const node of control) {
        const record = records.get(node.id);
        if (record?.status === "skipped") {
            inactive.add(node.id);
            continue;
        }
        if (node.kind === "start")
            continue;
        const incoming = flow.lines.filter(isFlowLine).filter((line) => line.target === node.id);
        const states = incoming.map((line) => {
            if (inactive.has(line.source))
                return "inactive";
            if (!accepted(line.source))
                return "waiting";
            if (line.condition && !Array.isArray(records.get(line.source)?.attemptHistory?.at(-1)?.dagRoutes))
                return "waiting";
            if (line.condition && !records.get(line.source)?.attemptHistory?.at(-1)?.dagRoutes?.includes(line.id))
                return "inactive";
            return "satisfied";
        });
        if (states.length && states.every((state) => state === "inactive")) {
            inactive.add(node.id);
            if (record?.status === "pending")
                result.skipped.push(node.id);
            continue;
        }
        if (states.some((state) => state === "waiting") || !states.includes("satisfied"))
            continue;
        result.sources[node.id] = [...new Set(incoming.filter((_, index) => states[index] === "satisfied").map((line) => line.source).filter((id) => flow.nodes.find((source) => source.id === id)?.kind === "agent"))];
        if (record?.status === "pending")
            result.ready.push(node.id);
    }
    const end = control.find((node) => node.kind === "end");
    result.complete = !!end && accepted(end.id) && control.every((node) => inactive.has(node.id) || accepted(node.id));
    return result;
}
export function findReadyNodes(graph, snapshot) {
    return dagFrontierOf(graph, snapshot).ready;
}
//# sourceMappingURL=dag-scheduler.js.map
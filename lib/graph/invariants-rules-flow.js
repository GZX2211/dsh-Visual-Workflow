// src/host/graph/invariants-rules-flow.ts
//
// 图质量规则（自主编排方案 §6.2 规则表）第一期：**流程与阶段**维度——启动/结束唯一性
// 与端点合法性、孤立节点、条件分支配对、环路、可达性与断头流程、阶段节点方向。
// 节点/组/数据/虚拟节点维度见 invariants-rules-nodes.ts；元参数维度见
// invariants-rules-meta.ts；汇总与级别提升见 invariants.ts。
//
// 每个规则一个纯函数（入参 CheckGraphInput + 已构建的流程子图 FlowDag，返回 GraphIssue[]）：
// 规则表逐条对应单测（每 code 一例），单函数即可被精确断言。
//
// 与 validateFlow 的分工（§6.3）：validateFlow = 结构合法性（连接点矩阵/自环/重复线/
// 阶段唯一/父唯一）；本层 = 编排质量（可达性/孤岛/断头/条件分支完整性）。
// 纯函数：不读时钟/随机源，不改写入参，输出顺序稳定（按输入顺序遍历）。
import { channelOut } from './model.js';
/** 可执行单元种类（流程端点判定用：agent/parent/group）。 */
const UNIT_KINDS = ['agent', 'parent', 'group'];
/** 节点 id 是否为可执行单元。 */
function isUnit(node) {
    return !!node && UNIT_KINDS.includes(node.kind);
}
/** 按 id 建索引（保持输入顺序）。 */
function nodeMapOf(flow) {
    return new Map((flow?.nodes ?? []).map((node) => [node.id, node]));
}
/** a) 恰好 1 个启动/输入节点（缺失/多个都是 error）。 */
export function ruleStartRequired({ flow }) {
    const starts = (flow?.nodes ?? []).filter((node) => node.kind === 'start');
    if (starts.length === 1)
        return [];
    return [{
            code: 'startRequired',
            level: 'error',
            message: starts.length === 0 ? 'missing the start/input node' : `there must be exactly one start/input node (currently ${starts.length})`,
            nodeIds: starts.map((node) => node.id),
            suggestion: 'keep exactly one start/input node as the single flow entry',
        }];
}
/** b) 启动节点的流程出 ≥1 且目标为可执行单元。 */
export function ruleStartFlowOut(input, dag) {
    const { flow } = input;
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'start')
            continue;
        const targets = dag.adjacency.get(node.id) ?? [];
        if (targets.length === 0) {
            issues.push({
                code: 'startNoFlowOut',
                level: 'error',
                message: 'the start/input node has no flow-out edge, so the flow cannot begin',
                nodeIds: [node.id],
                suggestion: 'connect the start/input node\'s flow-out to the first executable node (agent / parent / Team)',
            });
            continue;
        }
        const bad = targets.filter((id) => !isUnit(byId.get(id)));
        if (bad.length > 0) {
            issues.push({
                code: 'startNoFlowOut',
                level: 'error',
                message: `the start/input node's flow-out points at non-executable nodes: ${bad.join(', ')}`,
                nodeIds: [node.id, ...bad],
                suggestion: 'a flow edge may only target an executable node (agent / parent / Team); wire data nodes with context or database edges',
            });
        }
    }
    return issues;
}
/** c) 恰好 1 个结束/输出节点。 */
export function ruleEndRequired({ flow }) {
    const ends = (flow?.nodes ?? []).filter((node) => node.kind === 'end');
    if (ends.length === 1)
        return [];
    return [{
            code: 'endRequired',
            level: 'error',
            message: ends.length === 0 ? 'missing the end/output node' : `there must be exactly one end/output node (currently ${ends.length})`,
            nodeIds: ends.map((node) => node.id),
            suggestion: 'keep exactly one end/output node as the single flow exit',
        }];
}
/** d) 结束节点的流程入 ≥1 且来源为可执行单元。 */
export function ruleEndFlowIn(input, dag) {
    const { flow } = input;
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'end')
            continue;
        const sources = dag.incoming.get(node.id) ?? [];
        if (sources.length === 0) {
            issues.push({
                code: 'endNoFlowIn',
                level: 'error',
                message: 'the end/output node has no flow-in edge, so the flow cannot close',
                nodeIds: [node.id],
                suggestion: 'connect the last executable node\'s flow-out to the end/output node',
            });
            continue;
        }
        const bad = sources.filter((id) => !isUnit(byId.get(id)));
        if (bad.length > 0) {
            issues.push({
                code: 'endNoFlowIn',
                level: 'error',
                message: `the end/output node's flow-in comes from non-executable nodes: ${bad.join(', ')}`,
                nodeIds: [node.id, ...bad],
                suggestion: 'the end node\'s flow-in may only come from an executable node (agent / parent / Team)',
            });
        }
    }
    return issues;
}
/** e) 孤立节点：既无流程线也无上下文/数据库线。 */
export function ruleOrphanNode({ flow }) {
    const connected = new Set();
    for (const line of flow?.lines ?? []) {
        connected.add(line.source);
        connected.add(line.target);
    }
    return (flow?.nodes ?? [])
        .filter((node) => !connected.has(node.id))
        .map((node) => ({
        code: 'orphanNode',
        level: 'error',
        message: `node "${node.id}" is neither wired into the flow nor connected by context/database edges (dangling node)`,
        nodeIds: [node.id],
        suggestion: 'delete this node, or wire it in with a flow, context or database edge',
    }));
}
/** f) 条件线相对分支缺失（warning，不阻断）。 */
export function ruleConditionPair({ flow }) {
    const groups = new Map();
    for (const line of flow?.lines ?? []) {
        const type = line.condition?.type;
        if (!type || type === 'content')
            continue;
        if (line.sourceHandle !== channelOut('flow'))
            continue;
        const key = `${line.source}|${line.sourceHandle}`;
        const group = groups.get(key) ?? { pass: [], fail: [], ids: [] };
        if (type === 'pass')
            group.pass.push(line.target);
        else
            group.fail.push(line.target);
        group.ids.push(line.id);
        groups.set(key, group);
    }
    const issues = [];
    for (const [key, group] of groups) {
        const [source] = key.split('|');
        if (group.pass.length > 0 && group.fail.length === 0) {
            issues.push({
                code: 'conditionMissingOpposite',
                level: 'warning',
                message: `node "${source}" only has a pass branch and lacks a fail branch`,
                nodeIds: [source],
                lineIds: group.ids,
                suggestion: 'add the fail conditional edge, otherwise the failure path has nowhere to go',
            });
        }
        else if (group.fail.length > 0 && group.pass.length === 0) {
            issues.push({
                code: 'conditionMissingOpposite',
                level: 'warning',
                message: `node "${source}" only has a fail branch and lacks a pass branch`,
                nodeIds: [source],
                lineIds: group.ids,
                suggestion: 'add the pass conditional edge, otherwise the success path has nowhere to go',
            });
        }
    }
    return issues;
}
/** g) 流程子图存在多节点环（自环由 validateFlow 拦截，此处只报 ≥2 节点的环）。 */
export function ruleFlowCycle(_input, dag, cycleNodes) {
    const multi = [...cycleNodes].filter((id) => {
        const out = dag.adjacency.get(id) ?? [];
        return out.some((next) => next !== id && cycleNodes.has(next));
    });
    if (multi.length === 0)
        return [];
    return [{
            code: 'flowCycle',
            level: 'error',
            message: `the flow contains a cycle: ${multi.join(' -> ')}`,
            nodeIds: multi,
            suggestion: 'break one flow edge in the cycle (turn it into a conditional branch or serialize it); the flow must be a terminable DAG',
        }];
}
/** h) 可达性：有流程入但从启动节点沿流程不可达（孤岛段）。 */
export function ruleReachability(input, dag) {
    const starts = (input.flow?.nodes ?? []).filter((node) => node.kind === 'start').map((node) => node.id);
    const visited = new Set(starts);
    const queue = [...starts];
    let cursor = 0;
    while (cursor < queue.length) {
        const id = queue[cursor];
        cursor += 1;
        for (const next of dag.adjacency.get(id) ?? []) {
            if (visited.has(next))
                continue;
            visited.add(next);
            queue.push(next);
        }
    }
    const issues = [];
    for (const node of input.flow?.nodes ?? []) {
        const hasIncoming = (dag.incoming.get(node.id) ?? []).length > 0;
        if (node.kind === 'start' || !hasIncoming)
            continue;
        if (visited.has(node.id))
            continue;
        issues.push({
            code: 'unreachableFromStart',
            level: 'error',
            message: `node "${node.id}" has a flow-in edge but is unreachable from the start node (island segment)`,
            nodeIds: [node.id],
            suggestion: 'reconnect the island to the main flow (a flow edge from a reachable node), or delete the whole island',
        });
    }
    return issues;
}
/** i) 断头流程：有流程入但无流程出且不是结束节点（warning）。 */
export function ruleCannotReachEnd(input, dag) {
    const issues = [];
    for (const node of input.flow?.nodes ?? []) {
        if (node.kind === 'end')
            continue;
        const hasIncoming = (dag.incoming.get(node.id) ?? []).length > 0;
        const hasOutgoing = (dag.adjacency.get(node.id) ?? []).length > 0;
        if (!hasIncoming || hasOutgoing)
            continue;
        issues.push({
            code: 'cannotReachEnd',
            level: 'warning',
            message: `node "${node.id}" has a flow-in but no flow-out, so the flow dead-ends here`,
            nodeIds: [node.id],
            suggestion: 'add a flow-out edge onwards (or straight to the end node); if this really is the end, convert it into the end node',
        });
    }
    return issues;
}
/** j) 阶段节点方向违规：暂停悬空 / 启动有流程入 / 结束有流程出。 */
export function ruleStageDirection({ flow }, dag) {
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind === 'pause') {
            const hasIncoming = (dag.incoming.get(node.id) ?? []).length > 0;
            const hasOutgoing = (dag.adjacency.get(node.id) ?? []).length > 0;
            if (!hasIncoming || !hasOutgoing) {
                issues.push({
                    code: 'pauseNodeDangling',
                    level: 'error',
                    message: `pause node "${node.id}" ${!hasIncoming ? 'is missing its flow-in' : 'is missing its flow-out'}`,
                    nodeIds: [node.id],
                    suggestion: 'a pause node needs both a flow-in and a flow-out (it is a flow gate: both ends must be wired)',
                });
            }
            continue;
        }
        if (node.kind === 'start' && (dag.incoming.get(node.id) ?? []).length > 0) {
            issues.push({
                code: 'startHasFlowIn',
                level: 'error',
                message: 'the start/input node has a flow-in edge (direction violation)',
                nodeIds: [node.id],
                suggestion: 'delete the flow edge pointing back into the start/input node - it can only be the flow origin',
            });
            continue;
        }
        if (node.kind === 'end' && (dag.adjacency.get(node.id) ?? []).length > 0) {
            issues.push({
                code: 'endHasFlowOut',
                level: 'error',
                message: 'the end/output node has a flow-out edge (direction violation)',
                nodeIds: [node.id],
                suggestion: 'delete the flow edge leaving the end/output node - it can only be the flow terminus',
            });
        }
    }
    return issues;
}
//# sourceMappingURL=invariants-rules-flow.js.map
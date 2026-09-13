// src/host/graph/invariants-rules.ts
//
// 图质量规则（自主编排方案 §6.2 规则表）第一期：**流程与阶段**维度——启动/结束唯一性
// 与端点合法性、孤立节点、条件分支配对、环路、可达性与断头流程、阶段节点方向。
// 节点/组/数据/虚拟节点维度见 invariants-rules-nodes.ts；元参数维度见
// invariants-meta-rules.ts；汇总与级别提升见 invariants.ts。
//
// 每个规则一个纯函数（入参 CheckGraphInput + 已构建的流程子图 FlowDag，返回 GraphIssue[]）：
// 规则表逐条对应单测（每 code 一例），单函数即可被精确断言。
//
// 与 validateFlow 的分工（§6.3）：validateFlow = 结构合法性（连接点矩阵/自环/重复线/
// 阶段唯一/父唯一）；本层 = 编排质量（可达性/孤岛/断头/条件分支完整性）。
// 纯函数：不读时钟/随机源，不改写入参，输出顺序稳定（按输入顺序遍历）。
import { isFlowLine } from './dag.js';
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
/** 全部流程线（仅 flow-out → flow-in）。 */
export function flowLinesOf(flow) {
    return (flow?.lines ?? []).filter((line) => isFlowLine(line));
}
/** a) 恰好 1 个启动/输入节点（缺失/多个都是 error）。 */
export function ruleStartRequired({ flow }) {
    const starts = (flow?.nodes ?? []).filter((node) => node.kind === 'start');
    if (starts.length === 1)
        return [];
    return [{
            code: 'startRequired',
            level: 'error',
            message: starts.length === 0 ? '缺少启动/输入节点' : `启动/输入节点只能有一个（当前 ${starts.length} 个）`,
            nodeIds: starts.map((node) => node.id),
            suggestion: '保留且只保留一个启动/输入节点，作为流程的唯一入口',
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
                message: '启动/输入节点没有流程出线，流程无法开始',
                nodeIds: [node.id],
                suggestion: '把启动/输入节点的流程出连接到第一个可执行节点（子代理 / 父代理 / 协作组）',
            });
            continue;
        }
        const bad = targets.filter((id) => !isUnit(byId.get(id)));
        if (bad.length > 0) {
            issues.push({
                code: 'startNoFlowOut',
                level: 'error',
                message: `启动/输入节点的流程出指向了不可执行节点：${bad.join('、')}`,
                nodeIds: [node.id, ...bad],
                suggestion: '流程线的目标只能是可执行节点（子代理 / 父代理 / 协作组）；数据节点请用上下文或数据库连线',
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
            message: ends.length === 0 ? '缺少结束/输出节点' : `结束/输出节点只能有一个（当前 ${ends.length} 个）`,
            nodeIds: ends.map((node) => node.id),
            suggestion: '保留且只保留一个结束/输出节点，作为流程的唯一出口',
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
                message: '结束/输出节点没有流程入线，流程无法收口',
                nodeIds: [node.id],
                suggestion: '把最后一个可执行节点的流程出连接到结束/输出节点',
            });
            continue;
        }
        const bad = sources.filter((id) => !isUnit(byId.get(id)));
        if (bad.length > 0) {
            issues.push({
                code: 'endNoFlowIn',
                level: 'error',
                message: `结束/输出节点的流程入来自不可执行节点：${bad.join('、')}`,
                nodeIds: [node.id, ...bad],
                suggestion: '结束节点的流程入只能来自可执行节点（子代理 / 父代理 / 协作组）',
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
        message: `节点「${node.id}」既未接入流程，也没有上下文/数据库连线（悬空节点）`,
        nodeIds: [node.id],
        suggestion: '删除该节点，或用流程线/上下文线/数据库线把它接入流程',
    }));
}
/** f) 条件线相对分支缺失（warning，不阻断）。 */
export function ruleConditionPair({ flow }) {
    const groups = new Map();
    for (const line of flow?.lines ?? []) {
        const type = line.condition?.type;
        if (!type || type === 'content')
            continue;
        if (line.sourceHandle !== 'flow-out')
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
                message: `节点「${source}」只有「通过」分支，缺少「不通过」分支`,
                nodeIds: [source],
                lineIds: group.ids,
                suggestion: '补充「不通过」条件线（失败分支），否则失败路径无处可去',
            });
        }
        else if (group.fail.length > 0 && group.pass.length === 0) {
            issues.push({
                code: 'conditionMissingOpposite',
                level: 'warning',
                message: `节点「${source}」只有「不通过」分支，缺少「通过」分支`,
                nodeIds: [source],
                lineIds: group.ids,
                suggestion: '补充「通过」条件线，否则成功路径无处可去',
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
            message: `流程存在环路：${multi.join(' → ')}`,
            nodeIds: multi,
            suggestion: '打断环上的某条流程线（改为条件分支或串行），流程必须是可终止的 DAG',
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
            message: `节点「${node.id}」有流程入线，但从启动节点沿流程不可达（孤岛段）`,
            nodeIds: [node.id],
            suggestion: '把该孤岛接回主流程（从可达节点连一条流程线过来），或删除整段孤岛',
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
            message: `节点「${node.id}」有流程入但无流程出，流程走到此处会断头`,
            nodeIds: [node.id],
            suggestion: '补一条流程出线继续向下游（或直接连到结束节点）；若确为终点，请改为结束节点',
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
                    message: `暂停节点「${node.id}」${!hasIncoming ? '缺少流程入' : '缺少流程出'}`,
                    nodeIds: [node.id],
                    suggestion: '暂停节点必须有流程入与流程出（它是流程门，两端都要接）',
                });
            }
            continue;
        }
        if (node.kind === 'start' && (dag.incoming.get(node.id) ?? []).length > 0) {
            issues.push({
                code: 'startHasFlowIn',
                level: 'error',
                message: '启动/输入节点存在流程入线（方向违规）',
                nodeIds: [node.id],
                suggestion: '删除指回启动/输入节点的流程线——它只能是流程起点',
            });
            continue;
        }
        if (node.kind === 'end' && (dag.adjacency.get(node.id) ?? []).length > 0) {
            issues.push({
                code: 'endHasFlowOut',
                level: 'error',
                message: '结束/输出节点存在流程出线（方向违规）',
                nodeIds: [node.id],
                suggestion: '删除从结束/输出节点出发的流程线——它只能是流程终点',
            });
        }
    }
    return issues;
}
//# sourceMappingURL=invariants-rules.js.map
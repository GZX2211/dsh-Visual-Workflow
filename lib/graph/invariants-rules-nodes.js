// src/host/graph/invariants-rules-nodes.ts
//
// 图质量规则（自主编排方案 §6.2 规则表）第二期：**节点维度**——协作组一致性、虚拟节点
// 引用、数据节点完整性、上下文/数据库连线合法性、里程碑闸门（指向父代理的虚拟节点）。
// 流程/阶段维度见 invariants-rules-flow.ts；元参数维度见 invariants-rules-meta.ts。
//
// 每个规则一个纯函数（入参 CheckGraphInput + 可选 FlowDag，返回 GraphIssue[]）。
// 纯函数：不读时钟/随机源，不改写入参，输出顺序稳定（按输入顺序遍历）。
import { channelIn, channelOfIn, channelOfOut, channelOut, proxyRoleOf } from './model.js';
/** 按 id 建索引（保持输入顺序）。 */
function nodeMapOf(flow) {
    return new Map((flow?.nodes ?? []).map((node) => [node.id, node]));
}
/** a) 协作组一致性：无成员 / 悬空成员 / 无流程线。 */
export function ruleGroupMembers(input, dag) {
    const { flow } = input;
    const byId = nodeMapOf(flow);
    const flowTouched = new Set();
    for (const edge of dag.edges) {
        flowTouched.add(edge.source);
        flowTouched.add(edge.target);
    }
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'group')
            continue;
        const label = node.data.label || node.id;
        const members = [...new Set(Array.isArray(node.data.memberIds) ? node.data.memberIds : [])];
        if (members.length === 0) {
            issues.push({
                code: 'groupNoMembers',
                level: 'error',
                message: `collaboration group "${label}" has no members`,
                nodeIds: [node.id],
                suggestion: 'drop role nodes into the group, or delete the empty group card',
            });
        }
        const missing = members.filter((id) => !byId.has(id));
        if (missing.length > 0) {
            issues.push({
                code: 'groupMemberMissing',
                level: 'error',
                message: `collaboration group "${label}" references members that do not exist: ${missing.join(', ')}`,
                nodeIds: [node.id, ...missing],
                suggestion: 'remove the dangling member ids (their nodes were deleted) and pick the group members again',
            });
        }
        if (!flowTouched.has(node.id)) {
            issues.push({
                code: 'groupNoFlow',
                level: 'error',
                message: `collaboration group "${label}" has no flow edge`,
                nodeIds: [node.id],
                suggestion: 'connect a flow-in and a flow-out on the group card: the group card carries the flow gate, while members are wired by context edges only',
            });
        }
    }
    return issues;
}
/** b) 虚拟节点引用缺失或指向非角色节点。 */
export function ruleProxySource({ flow }) {
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'proxy')
            continue;
        const sourceId = String(node.proxySourceId ?? '');
        const source = sourceId ? byId.get(sourceId) : undefined;
        if (!source) {
            issues.push({
                code: 'proxySourceMissing',
                level: 'error',
                message: `proxy node "${node.id}" references a source node that does not exist (${sourceId || 'unset'})`,
                nodeIds: [node.id],
                suggestion: 'delete this proxy node, or point it back to an existing role node',
            });
            continue;
        }
        if (source.kind !== 'parent' && source.kind !== 'agent') {
            issues.push({
                code: 'proxySourceMissing',
                level: 'error',
                message: `proxy node "${node.id}" references "${sourceId}", which is not a role node (${source.kind})`,
                nodeIds: [node.id, sourceId],
                suggestion: 'a proxy node can only reference an agent or parent node',
            });
        }
    }
    return issues;
}
/**
 * c) 数据节点配置完整性：**只校验数据库节点**（缺少运行必需项 → error）。
 *
 * 为什么不再校验 file 节点（用户裁决 2026-10-10）：
 *   1. 唯一生产调用方是 wf_graph_patch（origin='agent'），而写图只产**文本型** file 节点（D-07）——
 *      「受管文件未选文件」这一形态在代理路径上已不可达，规则成为死码；
 *   2. 受管形态只能由画布产生，而画布保存路径只跑结构校验 validateFlow、不经本检查器——
 *      它从未真正保护过用户路径；
 *   3. 文本型文件节点允许空内容（占位 / 待填），空文本不构成运行期失败（ctx 注入空串，节点照常运行）；
 *   4. 该判定是 error 级 = 整批补丁原子失败 + 全量 op 重发；收益为零而误伤成本高。
 *
 * 保留数据库分支的理由相反：既无本地路径又无连接信息时运行期**必然**失败（索引无从构建），
 * 属配置残缺而非「可空字段」，值得在规划期阻断。
 */
export function ruleDataNodeComplete({ flow }) {
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'database')
            continue;
        const db = node;
        const hasLocal = String(db.data?.localPath ?? '').trim().length > 0;
        const hasConn = !!db.data?.conn;
        if (hasLocal || hasConn)
            continue;
        issues.push({
            code: 'dataNodeIncomplete',
            level: 'error',
            message: `database node "${db.data?.label || db.id}" has neither a local file path nor server connection settings`,
            nodeIds: [db.id],
            suggestion: 'complete the database configuration (a file path for the local type, connection settings for the server type); otherwise the run will fail',
        });
    }
    return issues;
}
/** d) 上下文入线来源合法性（角色 / 虚拟节点 / 文件 / 模式二输入节点）。 */
export function ruleCtxSource({ flow }) {
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const line of flow?.lines ?? []) {
        // 通道判定经通道本体查询（不写字面量）：与 HANDLE_PAIRING 同源，避免第二套口径
        if (channelOfIn(line.targetHandle) !== 'ctx')
            continue;
        const source = byId.get(line.source);
        if (!source)
            continue;
        const ok = source.kind === 'agent' || source.kind === 'parent' || source.kind === 'proxy'
            || source.kind === 'file' || (source.kind === 'start' && flow.mode === 'mode2');
        if (ok)
            continue;
        issues.push({
            code: 'ctxSourceInvalid',
            level: 'error',
            message: `context-in edge source "${line.source}" (${source.kind}) cannot provide context`,
            nodeIds: [source.id, line.target],
            lineIds: [line.id],
            suggestion: 'a context-in edge may only come from an agent / parent / proxy / file node',
        });
    }
    return issues;
}
/**
 * e) 数据库出线目标合法性：**必须是角色节点**（子代理 / 父代理 / 虚拟节点）。
 *
 * 为什么不是「必须是数据库节点」：db 通道的语义是「把数据源转换为检索/查询工具注入角色」
 * （数据库内容绝不注入上下文），配对矩阵 `HANDLE_PAIRING` 也只把 db-out 映到 db-in——
 * 而 db-in 只存在于角色节点上（database 的 inputs 为空，无法自连）。若要求目标为数据库节点，
 * 则 db 线在任何路径下都无法成立，database 节点必然悬空、整类节点不可用。
 */
export function ruleDbTarget({ flow }) {
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const line of flow?.lines ?? []) {
        if (channelOfOut(line.sourceHandle) !== 'db')
            continue;
        const target = byId.get(line.target);
        if (!target)
            continue;
        const isRoleNode = target.kind === 'agent' || target.kind === 'parent' || target.kind === 'proxy';
        if (isRoleNode)
            continue;
        issues.push({
            code: 'dbLineTargetInvalid',
            level: 'error',
            message: `database-out edge target "${line.target}" (${target.kind}) is not a role node - database content is never injected into context; it reaches agents as retrieval/query tools instead`,
            nodeIds: [line.source, target.id],
            lineIds: [line.id],
            suggestion: 'a database-out edge may only connect to the db-in point of a role node (agent / parent / proxy)',
        });
    }
    return issues;
}
/**
 * f) 数据流契约（warning，规划期提醒；用户裁决 C6）：把「上下游交接没有通道」变成规划期
 * 可见的提醒。两条互补规则，各自只在**确有可交接的产出 / 确有多个上游可连接**时才报，
 * 因此不会对普通的线性流水线（start → a1 → a2 → end）产生噪声：
 *
 *   - nodeNoConsumer：某可执行节点**声明了产出**（有 ctx-out 出线，或配置了 outputSchema），
 *     但它所有流程下游都没接入该节点的 ctx 出线——上游写了产出却没人读。
 *   - nodeNoUpstream：某可执行节点**有多个可执行前置节点**（存在其他可选的上游信息来源），
 *     却没有任何 ctx/file/db 入线——它多半该连一条而漏了（首节点只有一个前置 start，不报）。
 *
 * 为什么是 warning 而不是 error：单节点流水线、串联中确实不需要上游数据的节点都是合法的，
 * 硬判会误伤；本规则只负责「提醒」，是否补线由规划者/用户判断。
 */
export function ruleNodeDataFlowContract({ flow }) {
    const byId = nodeMapOf(flow);
    const lines = flow?.lines ?? [];
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'agent' && node.kind !== 'parent')
            continue;
        const label = node.data.label ?? node.id;
        // 产出「声明」的唯一判据是 outputSchema：只有规划者明确声明了输出结构，
        // 「下游没接这条 ctx」才是不一致（否则它可能本来就把结果写在文件里，报出来是噪声）。
        const declaredOutput = String(node.data.outputSchema ?? '').trim();
        if (declaredOutput) {
            const flowTargets = [...new Set(lines
                    .filter((line) => line.source === node.id && line.sourceHandle === channelOut('flow') && isUnitNode(byId.get(line.target)))
                    .map((line) => line.target))];
            const consumed = new Set(lines
                .filter((line) => line.source === node.id && line.sourceHandle === channelOut('ctx'))
                .map((line) => line.target));
            const unconsumed = flowTargets.filter((targetId) => {
                if (consumed.has(targetId))
                    return false;
                // 下游经虚拟节点接 ctx 也算被消费（proxy 与主节点共享产出）
                return !lines.some((line) => line.source === targetId && line.targetHandle === channelIn('ctx'));
            });
            if (flowTargets.length > 0 && unconsumed.length === flowTargets.length) {
                issues.push({
                    code: 'nodeNoConsumer',
                    level: 'warning',
                    message: `executable node "${label}" declares an output contract, but none of its downstream nodes (${unconsumed.join(', ')}) consumes its ctx-out edge`,
                    nodeIds: [node.id, ...unconsumed],
                    suggestion: 'connect a ctx edge to the downstream nodes that need this output (sourceHandle=ctx-out -> targetHandle=ctx-in); if none of them needs it, clear this node\'s outputSchema so the contract matches the graph',
                });
            }
        }
        // 上游：只在「存在多个可执行前置」时判定——首节点只有一个前置（start），不该被误报。
        if (!lines.some((line) => line.target === node.id && (line.targetHandle === channelIn('ctx') || line.targetHandle === channelIn('db')))) {
            const predecessors = new Set(lines
                .filter((line) => line.target === node.id && line.targetHandle === channelIn('flow') && isUnitNode(byId.get(line.source)))
                .map((line) => line.source));
            if (predecessors.size >= 2) {
                issues.push({
                    code: 'nodeNoUpstream',
                    level: 'warning',
                    message: `executable node "${label}" has several executable predecessors but no input channel (no ctx / file / db in-edge)`,
                    nodeIds: [node.id],
                    suggestion: 'if it needs upstream output or managed files, connect a ctx edge (upstream sourceHandle=ctx-out -> this node targetHandle=ctx-in) or an edge from a file/database node; if it is genuinely self-contained, ignore this warning',
                });
            }
        }
    }
    return issues;
}
/** 是否可执行单元（agent/parent/group）。 */
function isUnitNode(node) {
    return node?.kind === 'agent' || node?.kind === 'parent' || node?.kind === 'group';
}
/**
 * g) 角色节点配置完整性（warning，规划期提醒；用户裁决 C6 + P2 决策）：
 *   - presetId 为空 → 运行期 `resolveAgentTools` 判定该节点**零工具**（连 read/write 都调不到），
 *     是无效节点；这条只能在规划期提醒，运行期发现就太晚了。
 *   - systemPrompt 为空 → 子代理没有自身角色与任务说明，会以空任务启动。
 * 两者都是语义错误而非形状错误（形状由 wf_graph_patch 的补全兜住）。
 */
export function ruleRoleNodeConfigured({ flow }) {
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'agent' && node.kind !== 'parent')
            continue;
        const data = node.data;
        const label = data.label ?? node.id;
        const presetId = String(data.presetId ?? '').trim();
        if (!presetId) {
            issues.push({
                code: 'roleNodeNoPreset',
                level: 'warning',
                message: `role node "${label}" has no tool combo configured (empty presetId) - at run time it will have no tools at all`,
                nodeIds: [node.id],
                suggestion: 'set presetId with update_node_data, taking it from wf_org_catalog combos[].id (a tool combo, recommended) or presets[].id (an official preset)',
            });
        }
        if (!String(data.systemPrompt ?? '').trim()) {
            issues.push({
                code: 'roleNodeNoPrompt',
                level: 'warning',
                message: `role node "${label}" has no System Prompt - the child agent would have no role or task description`,
                nodeIds: [node.id],
                suggestion: 'set systemPrompt with update_node_data (state the child agent\'s role, task, deliverables and acceptance criteria)',
            });
        }
    }
    return issues;
}
/**
 * h) 里程碑闸门（指向父代理的虚拟节点）：
 *   - 任何指向父代理的虚拟节点缺流程入口 → 不会被流程驱动（warning）；
 *   - `data.role='milestone'` 却指向非父代理节点 → 闸门语义无效（warning）；
 *   - 标记为 milestone 的闸门数超过 `meta.milestoneMax` → 超上限（warning）。
 * P3 起闸门以 `data.role` 判别（缺省 executor，不占闸门预算）。
 */
export function ruleMilestoneProxy(input, dag) {
    const { flow, meta } = input;
    const byId = nodeMapOf(flow);
    const proxies = (flow?.nodes ?? []).filter((node) => {
        if (node.kind !== 'proxy')
            return false;
        const source = byId.get(String(node.proxySourceId ?? ''));
        return source?.kind === 'parent';
    });
    const issues = [];
    for (const node of proxies) {
        if ((dag.incoming.get(node.id) ?? []).length === 0) {
            issues.push({
                code: 'milestoneProxyInvalid',
                level: 'warning',
                message: `the parent-agent proxy node "${node.id}" has no flow entry, so the flow will never drive it`,
                nodeIds: [node.id],
                suggestion: 'connect the previous node\'s flow-out to this proxy node (a parent-agent gate only runs when driven by the flow)',
            });
        }
    }
    // P3：闸门角色一致性（`data.role` 是闸门识别的事实源）——
    // 只有标记为 milestone 的虚拟节点才是闸门；缺省 executor 沿用既有自动完成行为，不进闸门预算。
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'proxy' || proxyRoleOf(node) !== 'milestone')
            continue;
        const sourceId = String(node.proxySourceId ?? '');
        if (byId.get(sourceId)?.kind === 'parent')
            continue;
        issues.push({
            code: 'milestoneProxyInvalid',
            level: 'warning',
            message: `proxy node "${node.id}" is marked as a milestone gate (data.role='milestone') but references "${sourceId || '(empty)'}", which is not a parent node`,
            nodeIds: [node.id],
            suggestion: 'a gate can only hang on a parent node: change proxySourceId to the parent node, or remove data.role',
        });
    }
    const gates = proxies.filter((node) => proxyRoleOf(node) === 'milestone');
    const milestoneMax = Number(meta?.milestoneMax) || 0;
    if (milestoneMax > 0 && gates.length > milestoneMax) {
        issues.push({
            code: 'milestoneProxyInvalid',
            level: 'warning',
            message: `${gates.length} parent-agent gate nodes exceed the meta-parameter limit ${milestoneMax}`,
            nodeIds: gates.map((node) => node.id),
            suggestion: `reduce the gate nodes to ${milestoneMax} or fewer, or raise the meta parameter milestoneMax`,
        });
    }
    return issues;
}
//# sourceMappingURL=invariants-rules-nodes.js.map
// src/host/graph/invariants-rules-nodes.ts
//
// 图质量规则（自主编排方案 §6.2 规则表）第二期：**节点维度**——协作组一致性、虚拟节点
// 引用、数据节点完整性、上下文/数据库连线合法性、里程碑闸门（指向父代理的虚拟节点）。
// 流程/阶段维度见 invariants-rules.ts；元参数维度见 invariants-meta-rules.ts。
//
// 每个规则一个纯函数（入参 CheckGraphInput + 可选 FlowDag，返回 GraphIssue[]）。
// 纯函数：不读时钟/随机源，不改写入参，输出顺序稳定（按输入顺序遍历）。
import { proxyRoleOf } from './model.js';
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
                message: `协作组「${label}」没有成员`,
                nodeIds: [node.id],
                suggestion: '把角色节点拖入该协作组，或删除空组卡片',
            });
        }
        const missing = members.filter((id) => !byId.has(id));
        if (missing.length > 0) {
            issues.push({
                code: 'groupMemberMissing',
                level: 'error',
                message: `协作组「${label}」的成员不存在：${missing.join('、')}`,
                nodeIds: [node.id, ...missing],
                suggestion: '移除悬空成员 id（成员节点已被删除），重新选择组内成员',
            });
        }
        if (!flowTouched.has(node.id)) {
            issues.push({
                code: 'groupNoFlow',
                level: 'error',
                message: `协作组「${label}」没有任何流程线`,
                nodeIds: [node.id],
                suggestion: '为协作组卡片接上流程入/流程出（组卡片承担流程门语义，成员只走上下文连线）',
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
                message: `虚拟节点「${node.id}」引用的主节点不存在（${sourceId || '未设置'}）`,
                nodeIds: [node.id],
                suggestion: '删除该虚拟节点，或把它重新指向一个存在的角色节点',
            });
            continue;
        }
        if (source.kind !== 'parent' && source.kind !== 'agent') {
            issues.push({
                code: 'proxySourceMissing',
                level: 'error',
                message: `虚拟节点「${node.id}」引用的「${sourceId}」不是角色节点（${source.kind}）`,
                nodeIds: [node.id, sourceId],
                suggestion: '虚拟节点只能引用子代理或父代理节点',
            });
        }
    }
    return issues;
}
/** c) 数据节点配置完整性（缺少运行必需项 → error）。 */
export function ruleDataNodeComplete({ flow }) {
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind === 'database') {
            const db = node;
            const hasLocal = String(db.data?.localPath ?? '').trim().length > 0;
            const hasConn = !!db.data?.conn;
            if (!hasLocal && !hasConn) {
                issues.push({
                    code: 'dataNodeIncomplete',
                    level: 'error',
                    message: `数据库节点「${db.data?.label || db.id}」既无本地文件路径也无服务器连接信息`,
                    nodeIds: [db.id],
                    suggestion: '补全数据库配置（本地类型填文件路径，服务器类型填连接信息），否则运行期必然失败',
                });
            }
            continue;
        }
        if (node.kind === 'file') {
            const file = node;
            if (file.data?.fileKind !== 'file')
                continue;
            const hasManaged = String(file.data?.managedPath ?? '').trim().length > 0;
            const hasFiles = Array.isArray(file.data?.files) && file.data.files.length > 0;
            if (!hasManaged && !hasFiles) {
                issues.push({
                    code: 'dataNodeIncomplete',
                    level: 'error',
                    message: `文件节点「${file.data?.label || file.id}」未选择任何文件`,
                    nodeIds: [file.id],
                    suggestion: '为该文件节点选择至少一个文件（或把类型改回文本并填写内容）',
                });
            }
        }
    }
    return issues;
}
/** d) 上下文入线来源合法性（角色 / 虚拟节点 / 文件 / 模式二输入节点）。 */
export function ruleCtxSource({ flow }) {
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const line of flow?.lines ?? []) {
        if (line.targetHandle !== 'ctx-in')
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
            message: `上下文入线的来源「${line.source}」（${source.kind}）不能提供上下文`,
            nodeIds: [source.id, line.target],
            lineIds: [line.id],
            suggestion: '上下文入线只能来自子代理 / 父代理 / 虚拟节点 / 文件节点',
        });
    }
    return issues;
}
/** e) 数据库出线目标合法性（必须是数据库节点）。 */
export function ruleDbTarget({ flow }) {
    const byId = nodeMapOf(flow);
    const issues = [];
    for (const line of flow?.lines ?? []) {
        if (line.sourceHandle !== 'db-out')
            continue;
        const target = byId.get(line.target);
        if (!target || target.kind === 'database')
            continue;
        issues.push({
            code: 'dbLineTargetInvalid',
            level: 'error',
            message: `数据库出线的目标「${line.target}」（${target.kind}）不是数据库节点`,
            nodeIds: [line.source, target.id],
            lineIds: [line.id],
            suggestion: '数据库出线只能连到数据库节点的数据库入点',
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
                    .filter((line) => line.source === node.id && line.sourceHandle === 'flow-out' && isUnitNode(byId.get(line.target)))
                    .map((line) => line.target))];
            const consumed = new Set(lines
                .filter((line) => line.source === node.id && line.sourceHandle === 'ctx-out')
                .map((line) => line.target));
            const unconsumed = flowTargets.filter((targetId) => {
                if (consumed.has(targetId))
                    return false;
                // 下游经虚拟节点接 ctx 也算被消费（proxy 与主节点共享产出）
                return !lines.some((line) => line.source === targetId && line.targetHandle === 'ctx-in');
            });
            if (flowTargets.length > 0 && unconsumed.length === flowTargets.length) {
                issues.push({
                    code: 'nodeNoConsumer',
                    level: 'warning',
                    message: `可执行节点「${label}」声明了输出结构，但它的下游（${unconsumed.join('、')}）都没有接入它的 ctx 出线`,
                    nodeIds: [node.id, ...unconsumed],
                    suggestion: '为需要该产出的下游连一条 ctx 线（sourceHandle=ctx-out → targetHandle=ctx-in）；若下游确实不需要它的产出，请清空该节点的 outputSchema，避免契约与图形不一致',
                });
            }
        }
        // 上游：只在「存在多个可执行前置」时判定——首节点只有一个前置（start），不该被误报。
        if (!lines.some((line) => line.target === node.id && (line.targetHandle === 'ctx-in' || line.targetHandle === 'db-in'))) {
            const predecessors = new Set(lines
                .filter((line) => line.target === node.id && line.targetHandle === 'flow-in' && isUnitNode(byId.get(line.source)))
                .map((line) => line.source));
            if (predecessors.size >= 2) {
                issues.push({
                    code: 'nodeNoUpstream',
                    level: 'warning',
                    message: `可执行节点「${label}」有多个可执行前置节点，但没有任何输入通道（无 ctx / file / db 入线）`,
                    nodeIds: [node.id],
                    suggestion: '若它需要使用上游产出或受管文件，请连一条 ctx 线（上游 sourceHandle=ctx-out → 本节点 targetHandle=ctx-in）或从文件/数据库节点连入；若它确实自给自足，可忽略本条',
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
                message: `角色节点「${label}」没有配置工具组合（presetId 为空）——运行时该节点将没有任何工具`,
                nodeIds: [node.id],
                suggestion: '用 update_node_data 给该节点补 presetId：取 wf_org_catalog 的 combos[].id（组合，推荐）或 presets[].id（官方预设）',
            });
        }
        if (!String(data.systemPrompt ?? '').trim()) {
            issues.push({
                code: 'roleNodeNoPrompt',
                level: 'warning',
                message: `角色节点「${label}」没有 System Prompt——子代理将没有自身角色与任务说明`,
                nodeIds: [node.id],
                suggestion: '用 update_node_data 给该节点补 systemPrompt（写清该子代理的角色、任务、交付物与验收标准）',
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
                message: `指向父代理的虚拟节点「${node.id}」没有流程入口，不会被流程驱动`,
                nodeIds: [node.id],
                suggestion: '把上一个节点的流程出连到该虚拟节点（父代理闸门需要被流程驱动才会执行）',
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
            message: `虚拟节点「${node.id}」标记为里程碑闸门（data.role='milestone'），但它引用的「${sourceId || '（空）'}」不是父代理节点`,
            nodeIds: [node.id],
            suggestion: '闸门只能挂在父代理节点上：把 proxySourceId 改为父代理节点，或移除 data.role',
        });
    }
    const gates = proxies.filter((node) => proxyRoleOf(node) === 'milestone');
    const milestoneMax = Number(meta?.milestoneMax) || 0;
    if (milestoneMax > 0 && gates.length > milestoneMax) {
        issues.push({
            code: 'milestoneProxyInvalid',
            level: 'warning',
            message: `父代理闸门节点 ${gates.length} 个超过元参数上限 ${milestoneMax}`,
            nodeIds: gates.map((node) => node.id),
            suggestion: `减少闸门节点数量至 ${milestoneMax} 个以内，或提高元参数 milestoneMax`,
        });
    }
    return issues;
}
//# sourceMappingURL=invariants-rules-nodes.js.map
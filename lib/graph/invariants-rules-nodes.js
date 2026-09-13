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
            suggestion: '上下文入线只能来自子代理 / 父代理 / 虚拟节点 / 文件节点（模式二还可来自输入节点）',
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
 * f) 里程碑闸门（指向父代理的虚拟节点）：
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
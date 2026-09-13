// src/host/tools/wf-graph-patch-apply.ts
//
// wf_graph_patch 的**纯函数内核**（自主编排方案 §4.2 A/C 组）：
//   - applyGraphOps：按序应用图结构操作，返回新文档（不改写入参，深拷贝语义）；
//   - applyMarkOp：运行状态标记的**状态机纯函数**（run 持有者按此改写快照）；
//   - ensureGroupConsistency：协作组与成员的 groupId 双向一致（复用画布侧同款语义）。
// 不触盘、不读时钟/随机源——落盘与校验在 wf-graph-patch.ts 执行层。
import { newRoleNode, makeNodeId, makeLineId, NODE_KINDS } from '../graph/model.js';
import { stageLabel } from '../graph/model.js';
import { WfError } from '../orchestrator/seams.js';
/** 深拷贝文档骨架（保持元数据字段；节点/连线走 JSON 深拷贝避免共享引用）。 */
export function cloneDoc(doc) {
    return {
        ...doc,
        nodes: JSON.parse(JSON.stringify(doc.nodes ?? [])),
        lines: JSON.parse(JSON.stringify(doc.lines ?? [])),
    };
}
/** 阶段节点标签（判定/补默认都走同一实现，避免两处硬编码漂移）。 */
function stageLabelOf(kind, mode) {
    return stageLabel(kind, mode);
}
/**
 * 协作组一致性：成员节点的 groupId 与组的 memberIds 双向对齐。
 * 入组：写 node.data.groupId；出组：置 null。组不存在或成员不存在 → 稳定错误。
 */
export function ensureGroupConsistency(nodes, groupId, memberIds) {
    const group = nodes.find((node) => node.id === groupId);
    if (!group || group.kind !== 'group') {
        throw new WfError(`协作组不存在：${groupId}`, 'WF_GRAPH_INVALID');
    }
    const unique = [...new Set(memberIds.map(String).filter(Boolean))];
    for (const memberId of unique) {
        const member = nodes.find((node) => node.id === memberId);
        if (!member)
            throw new WfError(`协作组成员不存在：${memberId}`, 'WF_GRAPH_INVALID');
        if (member.kind !== 'agent' && member.kind !== 'parent') {
            throw new WfError(`协作组成员必须是角色节点（${memberId} 是 ${member.kind}）`, 'WF_GRAPH_INVALID');
        }
    }
    return nodes.map((node) => {
        if (node.id === groupId && node.kind === 'group') {
            return { ...node, data: { ...node.data, memberIds: unique } };
        }
        if (node.kind === 'agent' || node.kind === 'parent') {
            const current = node.data.groupId ?? null;
            // 只改本组相关的成员：其它组的成员保持不变
            const next = unique.includes(node.id) ? groupId : (current === groupId ? null : current);
            if (next === current)
                return node;
            return { ...node, data: { ...node.data, groupId: next } };
        }
        return node;
    });
}
/**
 * 虚拟节点 data 归一化（P3；自主编排方案 §5.2 扩展1）：只保留 `label` / `role`。
 * `role` 越界（既不是 executor 也不是 milestone）→ WF_GRAPH_INVALID；
 * 归一化后无有效字段则返回 undefined（调用方删除 data，保持文档形状最小）。
 */
function normalizeProxyData(raw) {
    const role = raw?.role;
    if (role !== undefined && role !== null && role !== 'executor' && role !== 'milestone') {
        throw new WfError(`虚拟节点 data.role 只能是 executor 或 milestone（收到 ${String(role)}）`, 'WF_GRAPH_INVALID');
    }
    const out = {};
    const label = raw?.label;
    if (label !== undefined && label !== null && String(label).trim())
        out.label = String(label).trim();
    if (role === 'executor' || role === 'milestone')
        out.role = role;
    return Object.keys(out).length > 0 ? out : undefined;
}
/**
 * 应用 A 组图结构操作（按序，纯函数）。
 * 失败一律抛 WfError（稳定 code），调用方据此返回带修复建议的补丁错误。
 */
export function applyGraphOps(input) {
    const doc = cloneDoc(input.doc);
    const createdNodeIds = [];
    const removedNodeIds = [];
    const updatedNodeIds = [];
    const connectedLineIds = [];
    const disconnectedLineIds = [];
    const mode = doc.mode === 'mode2' ? 'mode2' : 'mode1';
    for (const op of input.ops ?? []) {
        switch (op.op) {
            case 'create_node': {
                const raw = (op.node ?? {});
                const kind = String(raw.kind ?? '');
                if (!NODE_KINDS.includes(kind)) {
                    throw new WfError(`create_node: 非法节点种类「${kind}」（允许：${NODE_KINDS.join('/')}）`, 'WF_GRAPH_INVALID');
                }
                const id = String(raw.id ?? '').trim() || makeNodeId();
                if (doc.nodes.some((node) => node.id === id)) {
                    throw new WfError(`create_node: 节点 id 已存在「${id}」`, 'WF_GRAPH_INVALID');
                }
                const position = raw.position ?? { x: 0, y: 0 };
                const node = {
                    ...raw,
                    id,
                    kind,
                    // 坐标纯视图数据（D-16）：父代理不产出坐标；缺省写哨兵 {0,0}，由客户端自动布局接手
                    position: { x: Number(position?.x) || 0, y: Number(position?.y) || 0 },
                };
                if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
                    // 阶段节点属性锁定：label 由系统硬编码（忽略补丁传入值）
                    ;
                    node.data = { label: stageLabelOf(node.kind, mode) };
                }
                if (node.kind === 'proxy') {
                    const sourceId = String(raw.proxySourceId ?? '');
                    const source = doc.nodes.find((item) => item.id === sourceId);
                    if (!source || (source.kind !== 'agent' && source.kind !== 'parent')) {
                        throw new WfError(`create_node: 虚拟节点必须引用已存在的角色节点（${sourceId || '未提供 proxySourceId'}）`, 'WF_GRAPH_INVALID');
                    }
                    // P3：虚拟节点 data 只认 label / role（闸门识别的事实源）
                    const proxyData = normalizeProxyData((raw.data ?? {}));
                    if (proxyData)
                        node.data = proxyData;
                    else
                        delete node.data;
                }
                if (node.kind === 'group') {
                    const data = (raw.data ?? {});
                    node.data = {
                        label: String(data.label ?? node.id),
                        collabPrompt: String(data.collabPrompt ?? ''),
                        memberIds: [],
                        // 组卡片尺寸（视图数据；缺省与画布默认一致）
                        size: data.size ?? { w: 300, h: 220 },
                    };
                }
                doc.nodes.push(node);
                createdNodeIds.push(id);
                break;
            }
            case 'remove_node': {
                const nodeId = String(op.nodeId ?? '');
                const node = doc.nodes.find((item) => item.id === nodeId);
                if (!node)
                    throw new WfError(`remove_node: 节点不存在「${nodeId}」`, 'WF_GRAPH_INVALID');
                const cascade = op.cascade !== false;
                const removed = new Set([nodeId]);
                if (cascade) {
                    // 级联：其虚拟节点 + 组内成员引用清理（与画布删除语义一致）
                    for (const item of doc.nodes) {
                        if (item.kind === 'proxy' && item.proxySourceId === nodeId)
                            removed.add(item.id);
                    }
                }
                doc.lines = doc.lines.filter((line) => !removed.has(line.source) && !removed.has(line.target));
                doc.nodes = doc.nodes.filter((item) => !removed.has(item.id));
                // 组内成员被删：从各组成员清单移除（组卡片保持可用）
                doc.nodes = doc.nodes.map((item) => {
                    if (item.kind !== 'group')
                        return item;
                    const members = (item.data.memberIds ?? []).filter((memberId) => !removed.has(memberId));
                    return members.length === (item.data.memberIds ?? []).length
                        ? item
                        : { ...item, data: { ...item.data, memberIds: members } };
                });
                if (node.kind === 'group') {
                    // 删除组卡片：成员出组（groupId 置 null）
                    doc.nodes = doc.nodes.map((item) => {
                        if (item.kind !== 'agent' && item.kind !== 'parent')
                            return item;
                        return (item.data.groupId === nodeId) ? { ...item, data: { ...item.data, groupId: null } } : item;
                    });
                }
                removedNodeIds.push(...removed);
                break;
            }
            case 'update_node_data': {
                const nodeId = String(op.nodeId ?? '');
                const node = doc.nodes.find((item) => item.id === nodeId);
                if (!node)
                    throw new WfError(`update_node_data: 节点不存在「${nodeId}」`, 'WF_GRAPH_INVALID');
                if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
                    throw new WfError(`update_node_data: 阶段节点（${node.kind}）属性锁定，只能改名称且由系统管理`, 'WF_GRAPH_INVALID');
                }
                const patch = { ...(op.data ?? {}) };
                delete patch.kind;
                if (node.kind === 'proxy') {
                    // 虚拟节点：引用字段在顶层；data 只认 label / role（P3 闸门识别）
                    if ('proxySourceId' in patch) {
                        const sourceId = String(patch.proxySourceId ?? '');
                        const source = doc.nodes.find((item) => item.id === sourceId);
                        if (!source || (source.kind !== 'agent' && source.kind !== 'parent')) {
                            throw new WfError(`update_node_data: 虚拟节点必须引用已存在的角色节点（${sourceId}）`, 'WF_GRAPH_INVALID');
                        }
                        ;
                        node.proxySourceId = sourceId;
                    }
                    const merged = { ...(node.data ?? {}), ...patch };
                    const proxyData = normalizeProxyData(merged);
                    if (proxyData)
                        node.data = proxyData;
                    else
                        delete node.data;
                }
                else {
                    const target = node;
                    const next = { ...(target.data ?? {}), ...patch };
                    // 成员关系只能经 set_group_members 维护；此处保守地忽略成员字段（防组内清单与节点不一致）
                    delete next.memberIds;
                    target.data = next;
                }
                updatedNodeIds.push(nodeId);
                break;
            }
            case 'connect': {
                const source = String(op.source ?? '');
                const target = String(op.target ?? '');
                if (!doc.nodes.some((item) => item.id === source)) {
                    throw new WfError(`connect: 源节点不存在「${source}」`, 'WF_GRAPH_INVALID');
                }
                if (!doc.nodes.some((item) => item.id === target)) {
                    throw new WfError(`connect: 目标节点不存在「${target}」`, 'WF_GRAPH_INVALID');
                }
                const sourceHandle = String(op.sourceHandle ?? '');
                const targetHandle = String(op.targetHandle ?? '');
                if (doc.lines.some((line) => line.source === source && line.target === target
                    && line.sourceHandle === sourceHandle && line.targetHandle === targetHandle)) {
                    throw new WfError('connect: 该连线已存在（重复连线）', 'WF_GRAPH_INVALID');
                }
                const lineId = makeLineId();
                const condition = op.condition?.type;
                doc.lines.push({
                    id: lineId,
                    source,
                    target,
                    sourceHandle: sourceHandle,
                    targetHandle: targetHandle,
                    ...(condition ? { condition: { type: condition, ...(op.condition?.label ? { label: op.condition.label } : {}) } } : {}),
                });
                connectedLineIds.push(lineId);
                break;
            }
            case 'disconnect': {
                const before = doc.lines.length;
                if (op.lineId) {
                    doc.lines = doc.lines.filter((line) => line.id !== op.lineId);
                }
                else if (op.key) {
                    const key = op.key;
                    doc.lines = doc.lines.filter((line) => !(line.source === key.source && line.target === key.target
                        && line.sourceHandle === key.sourceHandle && line.targetHandle === key.targetHandle));
                }
                else {
                    throw new WfError('disconnect: 需要 lineId 或 key（四个端点字段）', 'WF_GRAPH_INVALID');
                }
                if (doc.lines.length === before) {
                    throw new WfError('disconnect: 未找到匹配的连线（请先用 wf_org_catalog 读取拓扑）', 'WF_GRAPH_INVALID');
                }
                break;
            }
            case 'create_group': {
                const groupId = String(op.groupId ?? '').trim() || makeNodeId();
                if (doc.nodes.some((item) => item.id === groupId)) {
                    throw new WfError(`create_group: 节点 id 已存在「${groupId}」`, 'WF_GRAPH_INVALID');
                }
                doc.nodes.push({
                    id: groupId,
                    kind: 'group',
                    position: { x: 0, y: 0 },
                    data: {
                        label: String(op.label ?? groupId),
                        collabPrompt: String(op.collabPrompt ?? ''),
                        memberIds: [],
                        size: { w: 300, h: 220 },
                    },
                });
                createdNodeIds.push(groupId);
                if (Array.isArray(op.memberIds) && op.memberIds.length > 0) {
                    doc.nodes = ensureGroupConsistency(doc.nodes, groupId, op.memberIds);
                }
                break;
            }
            case 'set_group_members': {
                const groupId = String(op.groupId ?? '');
                doc.nodes = ensureGroupConsistency(doc.nodes, groupId, Array.isArray(op.memberIds) ? op.memberIds : []);
                updatedNodeIds.push(groupId);
                break;
            }
            default: {
                throw new WfError(`未知图操作：${String(op.op)}`, 'WF_GRAPH_INVALID');
            }
        }
    }
    return {
        doc: doc,
        createdNodeIds,
        removedNodeIds,
        updatedNodeIds,
        connectedLineIds,
        disconnectedLineIds,
    };
}
/**
 * 运行状态标记（C 组）纯函数：校验节点存在 + 闸门预算，给出标记结果。
 * 状态机分工（P3）：**「必须是当前闸门轮 / 当前闸门节点」由 runMarkGroup 判定**
 * （需要入口 entry 与解析后的画布），本函数只负责与单据无关的校验——
 * status 取值、节点是否在快照内、以及 status=ok 时的闸门预算（D-21：不含首次编排）。
 */
export function applyMarkOp(input) {
    const nodeId = String(input.op?.nodeId ?? '');
    const status = input.op?.status;
    if (status !== 'ok' && status !== 'fail') {
        throw new WfError('mark_node: status 必须是 ok 或 fail', 'WF_GRAPH_INVALID');
    }
    if (!input.nodeIds.includes(nodeId)) {
        throw new WfError(`mark_node: 节点不在当前运行快照中「${nodeId}」`, 'WF_MILESTONE_INVALID');
    }
    const milestoneMax = Number(input.milestoneMax) || 0;
    const used = Math.max(0, Math.floor(Number(input.milestoneUsed) || 0));
    if (milestoneMax > 0 && status === 'ok' && used >= milestoneMax) {
        throw new WfError(`mark_node: 父代理闸门次数已用尽（${used}/${milestoneMax}，不含首次编排）`, 'WF_MILESTONE_INVALID');
    }
    return { nodeId, status, runId: input.runId };
}
//# sourceMappingURL=wf-graph-patch-apply.js.map
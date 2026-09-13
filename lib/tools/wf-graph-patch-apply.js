// src/host/tools/wf-graph-patch-apply.ts
//
// wf_graph_patch 的**纯函数内核**（自主编排方案 §4.2 A/C 组）：
//   - applyGraphOps：按序应用图结构操作，返回新文档（不改写入参，深拷贝语义）；
//   - applyMarkOp：运行状态标记的**状态机纯函数**（run 持有者按此改写快照）；
//   - ensureGroupConsistency：协作组与成员的 groupId 双向一致（复用画布侧同款语义）。
// 不触盘、不读时钟/随机源——落盘与校验在 wf-graph-patch.ts 执行层。
import { newRoleNode, makeNodeId, makeLineId, NODE_KINDS, NODE_HANDLES, HANDLE_PAIRING, CONDITION_TYPES } from '../graph/model.js';
import { stageLabel } from '../graph/model.js';
import { WfError } from '../orchestrator/seams.js';
/**
 * 各图操作的「最小字段契约」（**单一事实源**）。
 *
 * 为什么放在这里而不是只写进工具描述（2026-09 实机取证）：
 *   模型写补丁时唯一能看到的事实源是工具 Schema，而 ops 是 `additionalProperties:true`
 *   的自由对象——描述里只举 create_node 一例时，模型对 connect 的端点字段只能猜
 *   （实测猜成 from/to，报「源节点不存在「」」）。契约文本同时供两处消费：
 *     ① wf_graph_patch 的 ops 描述（可发现性）；② 参数层错误消息（自我修正通道）。
 *   两处共用一份常量，避免文档与实现再次漂移。
 */
export const OP_FIELD_SHAPES = {
    create_node: "{ op:'create_node', node:{ kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'file'|'database', id?:string, data?:{...} } }（节点字段必须在 node 里，不能平铺到 op 顶层）",
    remove_node: "{ op:'remove_node', nodeId:string, cascade?:boolean }",
    update_node_data: "{ op:'update_node_data', nodeId:string, data:{...} }",
    connect: "{ op:'connect', source:string, target:string, sourceHandle?:'flow-out'|'ctx-out'|'db-out', targetHandle?:'flow-in'|'ctx-in'|'db-in', condition?:{ type:'pass'|'fail'|'content', label?:string } }（端点字段名是 source/target；handle 省略时按流程通道补全 flow-out→flow-in）",
    disconnect: "{ op:'disconnect', lineId:string } 或 { op:'disconnect', key:{ source,target,sourceHandle,targetHandle } }",
    create_group: "{ op:'create_group', groupId:string, label:string, collabPrompt?:string, memberIds?:string[] }",
    set_group_members: "{ op:'set_group_members', groupId:string, memberIds:string[] }（memberIds 必填，缺省不会清空成员）",
};
/**
 * 参数层错误（WF_BAD_ARGS）：字段没给对，**不是**图语义问题。
 * 与 WF_GRAPH_INVALID 分开的理由：后者会诱导模型去改图，而真正要改的是自己的入参形状。
 */
function badArgs(message) {
    throw new WfError(message, 'WF_BAD_ARGS');
}
/** 校验连接点是否属于该节点种类；不属于则报出可用值（而不是写出一条无效连线）。 */
function resolveHandle(handle, kind, side) {
    const def = NODE_HANDLES[kind];
    const allowed = (side === 'out' ? def?.outputs : def?.inputs) ?? [];
    if (!allowed.includes(handle)) {
        throw new WfError(`connect: ${kind} 节点没有${side === 'out' ? '输出' : '输入'}点「${handle}」（可用：${allowed.join('/') || '无'}）`, 'WF_GRAPH_INVALID');
    }
    return handle;
}
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
                const opTop = op;
                const hasNodeObject = opTop.node !== undefined && opTop.node !== null
                    && typeof opTop.node === 'object' && !Array.isArray(opTop.node);
                if (!hasNodeObject) {
                    // 实测最常见的写法错误：把 kind/data 平铺到 op 顶层。
                    // 以前这里只报「非法节点种类「」」，模型无法定位到自己少了一层 node 包装。
                    const flattened = 'kind' in opTop || 'data' in opTop;
                    badArgs(`create_node: 缺少 node 对象${flattened ? '（检测到 kind/data 被直接写在了 op 顶层）' : ''}——正确形状：${OP_FIELD_SHAPES.create_node}`);
                }
                const raw = opTop.node;
                const kind = String(raw.kind ?? '').trim();
                if (!kind) {
                    badArgs(`create_node: node.kind 缺失——正确形状：${OP_FIELD_SHAPES.create_node}`);
                }
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
                const nodeId = String(op.nodeId ?? '').trim();
                if (!nodeId)
                    badArgs(`remove_node: nodeId 必填——正确形状：${OP_FIELD_SHAPES.remove_node}`);
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
                const nodeId = String(op.nodeId ?? '').trim();
                if (!nodeId)
                    badArgs(`update_node_data: nodeId 必填——正确形状：${OP_FIELD_SHAPES.update_node_data}`);
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
                const opc = op;
                if (opc.from !== undefined || opc.to !== undefined) {
                    // 实测最常见的写法错误：端点字段猜成 from/to（契约是 source/target）。
                    badArgs(`connect: 端点字段是 source/target（不是 from/to）——正确形状：${OP_FIELD_SHAPES.connect}`);
                }
                const source = String(opc.source ?? '').trim();
                const target = String(opc.target ?? '').trim();
                if (!source || !target) {
                    badArgs(`connect: source/target 必填（收到 source=${JSON.stringify(opc.source ?? null)}, target=${JSON.stringify(opc.target ?? null)}）`
                        + `——正确形状：${OP_FIELD_SHAPES.connect}`);
                }
                const sourceNode = doc.nodes.find((item) => item.id === source);
                const targetNode = doc.nodes.find((item) => item.id === target);
                if (!sourceNode) {
                    throw new WfError(`connect: 源节点不存在「${source}」（请先用 wf_org_catalog 读取画布节点 id）`, 'WF_GRAPH_INVALID');
                }
                if (!targetNode) {
                    throw new WfError(`connect: 目标节点不存在「${target}」（请先用 wf_org_catalog 读取画布节点 id）`, 'WF_GRAPH_INVALID');
                }
                // handle：缺省按流程通道补全。
                // 为什么不能沿用旧的 `?? ''` 兜底：'' 会写出 isFlowLine()=false 的**幽灵线**——
                // 该线在流程 DAG 中不存在，检查器随后报「启动节点没有流程出线 / 悬空节点」，
                // 把「handle 没写」误诊成「图缺线」，真因被完全掩盖。
                const sourceHandle = resolveHandle(String(opc.sourceHandle ?? '').trim() || 'flow-out', sourceNode.kind, 'out');
                const targetHandle = resolveHandle(String(opc.targetHandle ?? '').trim() || 'flow-in', targetNode.kind, 'in');
                const expectedTarget = HANDLE_PAIRING[sourceHandle];
                if (targetHandle !== expectedTarget) {
                    throw new WfError(`connect: ${sourceHandle} 只能连接 ${expectedTarget}（收到 ${targetHandle}）`, 'WF_GRAPH_INVALID');
                }
                // condition：必须显式带 type，否则条件线会**静默**退化成普通流程线（成对校验随之失效）。
                // 放在「重复连线」之前：参数层错误优先于图状态错误，报错才指向模型真正该改的地方。
                const rawCondition = opc.condition;
                let conditionType = '';
                let conditionLabel;
                if (rawCondition !== undefined && rawCondition !== null) {
                    if (typeof rawCondition === 'string') {
                        conditionType = rawCondition.trim();
                    }
                    else if (typeof rawCondition === 'object' && !Array.isArray(rawCondition)) {
                        const box = rawCondition;
                        conditionType = String(box.type ?? '').trim();
                        if (box.label !== undefined && box.label !== null)
                            conditionLabel = String(box.label);
                    }
                    if (!CONDITION_TYPES.includes(conditionType)) {
                        badArgs(`connect: condition.type 必须是 ${CONDITION_TYPES.join('/')}（收到 ${JSON.stringify(conditionType)}）`
                            + `——漏写 type 会让条件线静默退化成普通流程线；正确形状：${OP_FIELD_SHAPES.connect}`);
                    }
                    if (conditionType === 'content' && !conditionLabel) {
                        badArgs(`connect: condition.type='content' 必须带 label（条件内容文本）——正确形状：${OP_FIELD_SHAPES.connect}`);
                    }
                }
                if (doc.lines.some((line) => line.source === source && line.target === target
                    && line.sourceHandle === sourceHandle && line.targetHandle === targetHandle)) {
                    throw new WfError('connect: 该连线已存在（重复连线）', 'WF_GRAPH_INVALID');
                }
                const lineId = makeLineId();
                doc.lines.push({
                    id: lineId,
                    source,
                    target,
                    sourceHandle: sourceHandle,
                    targetHandle: targetHandle,
                    ...(conditionType
                        ? { condition: { type: conditionType, ...(conditionLabel ? { label: conditionLabel } : {}) } }
                        : {}),
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
                    badArgs(`disconnect: 需要 lineId 或 key（四个端点字段）——正确形状：${OP_FIELD_SHAPES.disconnect}`);
                }
                if (doc.lines.length === before) {
                    throw new WfError('disconnect: 未找到匹配的连线（请先用 wf_org_catalog 读取拓扑）', 'WF_GRAPH_INVALID');
                }
                break;
            }
            case 'create_group': {
                const groupId = String(op.groupId ?? '').trim();
                if (!groupId)
                    badArgs(`create_group: groupId 必填——正确形状：${OP_FIELD_SHAPES.create_group}`);
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
                const groupId = String(op.groupId ?? '').trim();
                if (!groupId)
                    badArgs(`set_group_members: groupId 必填——正确形状：${OP_FIELD_SHAPES.set_group_members}`);
                // 旧实现把缺失的 memberIds 兜底成 []，等于「悄悄清空全组成员」——破坏性默认值必须拒绝。
                if (!Array.isArray(op.memberIds)) {
                    badArgs(`set_group_members: memberIds 必须是数组（清空成员请显式传 []）——正确形状：${OP_FIELD_SHAPES.set_group_members}`);
                }
                doc.nodes = ensureGroupConsistency(doc.nodes, groupId, op.memberIds);
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
// src/host/tools/wf-graph-patch-types.ts
//
// wf_graph_patch 的类型契约（自主编排方案 §4.2）：
//   - PatchOp 判别联合：A 组图结构变更 / B 组元参数 / C 组运行状态标记（三分区）；
//   - 每组一个「已应用操作」类型，供执行层按组分别落地（三条代码路径零共享）；
//   - OP_GROUP 工具箱：op → 组名（服务端据此拒绝同一补丁混用不同组）。
// 纯类型 + 常量（无 IO），可在 host 单测与后续客户端角标渲染侧复用。
/** op → 组名映射（服务端混组拒绝的唯一依据）。 */
export function opGroupOf(op) {
    const name = String(op?.op ?? '');
    if (name === 'create_node' || name === 'remove_node' || name === 'update_node_data'
        || name === 'connect' || name === 'disconnect' || name === 'create_group' || name === 'set_group_members') {
        return 'graph';
    }
    if (name === 'set_meta')
        return 'meta';
    if (name === 'mark_node')
        return 'mark';
    return null;
}
/** 补丁中出现的全部组名（按出现顺序去重）。 */
export function groupsOf(ops) {
    const out = [];
    for (const op of ops ?? []) {
        const group = opGroupOf(op);
        if (group && !out.includes(group))
            out.push(group);
    }
    return out;
}
/** 未知 op 名（用于错误信息）。 */
export function unknownOpsOf(ops) {
    return (ops ?? []).filter((op) => opGroupOf(op) === null).map((op) => String(op?.op ?? ''));
}
/** 混组错误的可读分组说明（写进错误文本，帮助模型自我修正）。 */
export const GROUP_HINTS = {
    graph: 'graph structure ops (create_node/remove_node/update_node_data/connect/disconnect/create_group/set_group_members)',
    meta: 'meta parameter op (set_meta)',
    mark: 'run-state marking op (mark_node)',
};
/** 检查器 issue → 稳定错误码（error 阻断，warning 放行）。 */
export function blockingIssuesOf(issues) {
    return (issues ?? []).filter((issue) => issue.level === 'error');
}
//# sourceMappingURL=wf-graph-patch-types.js.map
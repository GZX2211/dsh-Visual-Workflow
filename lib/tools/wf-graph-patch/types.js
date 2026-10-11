// src/host/tools/wf-graph-patch/types.ts
//
// wf_graph_patch 的类型契约：
//   - PatchOp 判别联合：图结构变更 / 运行状态标记（两组）；
//   - 每组一个「已应用操作」类型，供执行层按组分别落地（两条代码路径零共享）；
//   - op → 组名映射：服务端据此拒绝同一补丁混用不同组。
// 纯类型 + 常量（无 IO），可在 host 单测与后续客户端角标渲染侧复用。
/** 图结构组的 op 名（op → 组映射、分组提示与契约完整性校验的唯一来源）。 */
export const GRAPH_OP_NAMES = [
    'create_node',
    'remove_node',
    'update_node_data',
    'connect',
    'disconnect',
    'create_group',
    'set_group_members',
];
/** 标记组的 op 名。 */
export const MARK_OP_NAMES = ['mark_node'];
/** op → 组名映射（服务端混组拒绝的唯一依据）。 */
export function opGroupOf(op) {
    const name = String(op?.op ?? '');
    if (GRAPH_OP_NAMES.includes(name))
        return 'graph';
    if (MARK_OP_NAMES.includes(name))
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
    graph: `graph structure ops (${GRAPH_OP_NAMES.join('/')})`,
    mark: `run-state marking op (${MARK_OP_NAMES.join('/')})`,
};
//# sourceMappingURL=types.js.map
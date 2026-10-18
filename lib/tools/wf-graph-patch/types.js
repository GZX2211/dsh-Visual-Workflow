// src/host/tools/wf-graph-patch/types.ts
//
// wf_graph_patch 的类型契约：
//   - PatchOp：图结构变更操作的判别联合；
//   - GraphPatchResult：执行层按条落地的结果清单；
//   - op 名清单与未知 op 判定：服务端据此拒绝非法 op（未知 op 属入参形状错误）。
// 纯类型 + 常量（无 IO），可在 host 单测与后续客户端角标渲染侧复用。
/** 图结构 op 名清单（契约完整性校验与未知 op 判定的唯一来源）。 */
export const GRAPH_OP_NAMES = [
    'create_node',
    'remove_node',
    'update_node_data',
    'connect',
    'disconnect',
    'create_group',
    'set_group_members',
];
/** op 是否属于图结构 op（未知 op 由参数层按 WF_BAD_ARGS 拒绝）。 */
export function opGroupOf(op) {
    const name = String(op?.op ?? '');
    return GRAPH_OP_NAMES.includes(name) ? 'graph' : null;
}
/** 未知 op 名（用于错误信息）。 */
export function unknownOpsOf(ops) {
    return (ops ?? []).filter((op) => opGroupOf(op) === null).map((op) => String(op?.op ?? ''));
}
/** 全部允许的 op 名（写进错误文本，帮助模型自我修正）。 */
export const ALLOWED_OP_NAMES_TEXT = GRAPH_OP_NAMES.join(' / ');
/**
 * 角色引用展开层写入 op 顶层的内部字段名（模型不可见）。
 *
 * 为什么需要它：`sourceAssetId` 属父代理不可配置字段（见 apply.ts 的
 * PARENT_UNCONFIGURABLE_ROLE_FIELDS），但通过 roleAssetId 引用资产时又必须把来源
 * 写进节点 data。展开层因此把它放在 op 顶层，apply 只认这个内部字段；执行入口会
 * 先剥掉模型传入的同名字段，避免绕过既有护栏。
 */
export const ROLE_SOURCE_ASSET_ID_FIELD = '__roleSourceAssetId';
//# sourceMappingURL=types.js.map
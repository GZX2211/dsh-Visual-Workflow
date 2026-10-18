// src/host/orchestrator/role-identity.ts
//
// 角色节点 → 稳定角色身份（经验退役的跨角色多样性判定输入）。
//
// 为什么需要单独的推导：角色节点没有统一的 roleId。从角色资产拖入时带 sourceAssetId，
// 手动配置的角色只有人工命名的 label。二者都没有时不能伪造身份——空身份意味着
// 「这条使用/评价无法归属到某个角色」，经验域的长期无用判定会保守地忽略它。
//
// 为什么键带前缀：asset: 与 label: 是两种来源，加前缀避免资产 id 与角色名撞在同一个键空间，
// 也让未来诊断能区分「稳定资产引用」与「按名称归属」。
//
// 为什么名称要归一空白：同一角色名在复制/粘贴后可能带多余空白，不归一会让同一角色
// 凭空分裂成多个身份，从而把「同一角色重复使用」误判成多样性。
/** 角色名归一：连续空白折叠为单个空格并去首尾空白。 */
function normalizeRoleLabel(value) {
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}
/** 角色节点 → 角色身份；节点缺失或无任何可识别身份时返回空身份。 */
export function roleIdentityOf(node) {
    if (!node)
        return { roleKey: "", roleLabel: "" };
    const roleLabel = normalizeRoleLabel(node.data?.label);
    const sourceAssetId = typeof node.data?.sourceAssetId === "string" ? node.data.sourceAssetId.trim() : "";
    if (sourceAssetId)
        return { roleKey: `asset:${sourceAssetId}`, roleLabel };
    if (roleLabel)
        return { roleKey: `label:${roleLabel}`, roleLabel };
    return { roleKey: "", roleLabel: "" };
}
/** 流程的父代理角色身份；流程没有父代理节点（或节点无身份）时为空。 */
export function parentRoleIdentityOf(flow) {
    return roleIdentityOf(flow.nodes.find((node) => node.kind === "parent"));
}
//# sourceMappingURL=role-identity.js.map
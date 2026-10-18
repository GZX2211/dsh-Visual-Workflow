import type { RoleNode, WorkflowDocument } from "../shared/graph-model.js";
/** 角色身份：键用于判定，标签用于展示与未来角色分析。 */
export interface RoleIdentity {
    /** 稳定角色键（asset:<角色资产 id> / label:<归一角色名> / 空串 = 无角色）。 */
    roleKey: string;
    /** 角色名（展示用；无角色时为空串）。 */
    roleLabel: string;
}
/** 角色节点 → 角色身份；节点缺失或无任何可识别身份时返回空身份。 */
export declare function roleIdentityOf(node: RoleNode | null | undefined): RoleIdentity;
/** 流程的父代理角色身份；流程没有父代理节点（或节点无身份）时为空。 */
export declare function parentRoleIdentityOf(flow: WorkflowDocument): RoleIdentity;

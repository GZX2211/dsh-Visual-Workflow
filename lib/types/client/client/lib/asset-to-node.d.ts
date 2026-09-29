import type { AssetDetail, RoleAssetDetail } from '../../host/shared/asset-types.js';
/**
 * 资产详情联合的窄化入口：`WorkflowAssetDetail` 没有 `kind` 字段，`RoleAssetDetail` 有。
 * 为什么需要它：回滚端点的返回类型由 `kind` 参数决定，客户端拿到的是联合类型，
 * 要在不改写契约的前提下把「角色资产详情」安全地交给 roleAssetContentOf。
 */
export declare function isRoleAssetDetail(detail: AssetDetail): detail is RoleAssetDetail;
/**
 * 角色资产详情 → 画布节点的**角色字段**（不含 groupId / sourceAssetId）。
 * 回滚后刷新节点内容用它：节点归属与绑定事实由画布持有，不属于资产内容。
 */
export declare function roleAssetContentOf(detail: RoleAssetDetail): Record<string, unknown>;
/** 角色资产详情 → 角色节点 data（与 templateToNodeData 的 role 分支同口径 + 来源资产 id）。 */
export declare function roleAssetToNodeData(detail: RoleAssetDetail): Record<string, unknown>;
/** 角色资产种类 → 画布节点 kind（parent / agent；与 RoleNode.kind 同域）。 */
export declare function roleAssetNodeKind(detail: RoleAssetDetail): 'parent' | 'agent';

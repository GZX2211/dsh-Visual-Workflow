import { type RolePortContext } from './role-assets.js';
/**
 * 父代理职责资产的固定 id。
 * client 新建父代理节点时按它建立引用（节点 data.sourceAssetId），因此 id 属对外契约，不可变更。
 */
export declare const PARENT_DUTIES_ASSET_ID = "role-parent-duties";
/** 资产名称（资产面板展示用）。 */
export declare const PARENT_DUTIES_ASSET_NAME = "\u7236\u4EE3\u7406\u804C\u8D23\uFF08\u5185\u7F6E\uFF09";
/** 库中是否已有 parent 类型的角色资产（含历史版本行）。 */
export declare function hasParentRoleAsset(ctx: RolePortContext): boolean;
/** 库中无任何 parent 角色资产时播种父代理职责资产（V1 = 五维正文）；否则空操作。 */
export declare function seedParentDutiesAsset(ctx: RolePortContext): void;

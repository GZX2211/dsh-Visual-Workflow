import { ERR_ASSET_BAD_ARGS, ERR_ASSET_DUPLICATE, ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND, ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_NOT_FOUND } from '../shared/protocol.js';
/** 资产库稳定错误码（与共享协议常量同域；此处只做类型收窄，不新增取值）。 */
export type AssetErrorCode = typeof ERR_ASSET_NOT_FOUND | typeof ERR_ASSET_VERSION_NOT_FOUND | typeof ERR_ASSET_DUPLICATE | typeof ERR_ASSET_BAD_ARGS | typeof ERR_EXPERIENCE_NOT_FOUND | typeof ERR_EXPERIENCE_BAD_ARGS;
/**
 * 资产库错误：API 边界按 code 翻译 HTTP 状态（404 / 409 / 400），
 * 因此 code 属对外契约，取值只能来自 shared/protocol。
 */
export declare class AssetError extends Error {
    readonly code: AssetErrorCode;
    constructor(message: string, code: AssetErrorCode);
}
/** 资产不存在或已退役（Active 索引无对应行）。 */
export declare function assetNotFound(assetId: string): AssetError;
/** 目标版本行不存在（回滚目标版本号非法）。 */
export declare function assetVersionNotFound(assetId: string, versionId: number): AssetError;
/** 入参形状非法（缺失必填字段 / 类型不符）。 */
export declare function assetBadArgs(message: string): AssetError;
/** 经验不存在（经验表无该 id）。 */
export declare function experienceNotFound(experienceId: string): AssetError;
/** 经验入参非法（id 缺失 / 必填字段被清空 / 载荷形状不符）。 */
export declare function experienceBadArgs(message: string): AssetError;

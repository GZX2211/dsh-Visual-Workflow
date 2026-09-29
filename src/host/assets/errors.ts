// src/host/assets/errors.ts
//
// 资产库的稳定错误类型：code 只取共享协议常量（禁止在调用点硬编码字面量），
// message 面向可行动性——说明发生了什么、哪个资产/版本、如何恢复。

import {
  ERR_ASSET_BAD_ARGS,
  ERR_ASSET_DUPLICATE,
  ERR_ASSET_NOT_FOUND,
  ERR_ASSET_VERSION_NOT_FOUND,
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_NOT_FOUND,
} from '../shared/protocol.js'

/** 资产库稳定错误码（与共享协议常量同域；此处只做类型收窄，不新增取值）。 */
export type AssetErrorCode =
  | typeof ERR_ASSET_NOT_FOUND
  | typeof ERR_ASSET_VERSION_NOT_FOUND
  | typeof ERR_ASSET_DUPLICATE
  | typeof ERR_ASSET_BAD_ARGS
  | typeof ERR_EXPERIENCE_NOT_FOUND
  | typeof ERR_EXPERIENCE_BAD_ARGS

/**
 * 资产库错误：API 边界按 code 翻译 HTTP 状态（404 / 409 / 400），
 * 因此 code 属对外契约，取值只能来自 shared/protocol。
 */
export class AssetError extends Error {
  readonly code: AssetErrorCode

  constructor(message: string, code: AssetErrorCode) {
    super(message)
    this.name = 'AssetError'
    this.code = code
  }
}

/** 资产不存在或已退役（Active 索引无对应行）。 */
export function assetNotFound(assetId: string): AssetError {
  return new AssetError(`资产 ${assetId} 不存在或已退役：请刷新资产列表后重试`, ERR_ASSET_NOT_FOUND)
}

/** 目标版本行不存在（回滚目标版本号非法）。 */
export function assetVersionNotFound(assetId: string, versionId: number): AssetError {
  return new AssetError(
    `资产 ${assetId} 的版本 v${versionId} 不存在：请从版本列表中选择有效版本`,
    ERR_ASSET_VERSION_NOT_FOUND,
  )
}

/** 入参形状非法（缺失必填字段 / 类型不符）。 */
export function assetBadArgs(message: string): AssetError {
  return new AssetError(message, ERR_ASSET_BAD_ARGS)
}

/** 经验不存在（经验表无该 id）。 */
export function experienceNotFound(experienceId: string): AssetError {
  return new AssetError(`经验 ${experienceId} 不存在：请刷新经验列表后重试`, ERR_EXPERIENCE_NOT_FOUND)
}

/** 经验入参非法（id 缺失 / 必填字段被清空 / 载荷形状不符）。 */
export function experienceBadArgs(message: string): AssetError {
  return new AssetError(message, ERR_EXPERIENCE_BAD_ARGS)
}

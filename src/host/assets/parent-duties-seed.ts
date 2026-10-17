// src/host/assets/parent-duties-seed.ts
//
// 父代理职责资产的 V1 播种：把五维职责提示词作为一条 kind='parent' 的角色资产写入资产库，
// 使父代理提示词与其它角色资产同享版本控制（修改即叠加版本、可回滚、Active 唯一）。
//
// 播种条件（用户裁决 2026-10）：库中**没有任何** parent 类型角色资产时播种一次。
// 已存在（含用户改写过的、或已归档的）一律不动——覆盖会破坏用户内容，也会与固定 id 撞主键。
// 判定取历史表而非 Active 表：归档等于用户显式退役该资产，再播种会与固定 id 冲突。

import { PARENT_ROLE_DUTIES } from '../prompts/index.js'
import { createRoleAsset, type RolePortContext } from './role-assets.js'

/**
 * 父代理职责资产的固定 id。
 * client 新建父代理节点时按它建立引用（节点 data.sourceAssetId），因此 id 属对外契约，不可变更。
 */
export const PARENT_DUTIES_ASSET_ID = 'role-parent-duties'

/** 资产名称（资产面板展示用）。 */
export const PARENT_DUTIES_ASSET_NAME = '父代理职责（内置）'

/** 库中是否已有 parent 类型的角色资产（含历史版本行）。 */
export function hasParentRoleAsset(ctx: RolePortContext): boolean {
  return ctx.tx.get("SELECT 1 AS present FROM role_asset_history WHERE kind = 'parent' LIMIT 1") !== null
}

/** 库中无任何 parent 角色资产时播种父代理职责资产（V1 = 五维正文）；否则空操作。 */
export function seedParentDutiesAsset(ctx: RolePortContext): void {
  if (hasParentRoleAsset(ctx)) return
  createRoleAsset(ctx, {
    assetId: PARENT_DUTIES_ASSET_ID,
    roleAssetType: 'standalone',
    source: 'human',
    fields: {
      kind: 'parent',
      name: PARENT_DUTIES_ASSET_NAME,
      systemPrompt: PARENT_ROLE_DUTIES,
      provider: '',
      model: '',
      reasoning: '',
      presetId: 'standard',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: null,
      outputSchema: null,
      systemPromptSource: null,
      injectSystemPrompt: true,
      injectToolSections: true,
      promptFilePath: null,
    },
  })
}

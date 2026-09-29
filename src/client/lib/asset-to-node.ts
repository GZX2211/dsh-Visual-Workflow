// src/client/lib/asset-to-node.ts
//
// 角色资产 → 画布角色节点（深拷贝解耦）：字段逐项映射与 template-to-node 的
// role 分支对齐（同一语义只允许一处映射口径），额外写入 data.sourceAssetId。
//
// 语义边界（用户裁决）：拖入资产仍生成**内联节点**——sourceAssetId 只登记
// 「来源资产」事实，不建立运行时引用，节点字段是拖入时刻的快照。
//
// 回滚刷新复用同一份字段映射：回滚把节点内容替换为所选版本内容时，绝不能连带改写
// 节点归属（groupId）与绑定事实（sourceAssetId），因此字段集与 data 集分成两个函数。

import type { AssetDetail, RoleAssetDetail } from '../../host/shared/asset-types.js'

/**
 * 资产详情联合的窄化入口：`WorkflowAssetDetail` 没有 `kind` 字段，`RoleAssetDetail` 有。
 * 为什么需要它：回滚端点的返回类型由 `kind` 参数决定，客户端拿到的是联合类型，
 * 要在不改写契约的前提下把「角色资产详情」安全地交给 roleAssetContentOf。
 */
export function isRoleAssetDetail(detail: AssetDetail): detail is RoleAssetDetail {
  return 'kind' in detail
}

/**
 * 角色资产详情 → 画布节点的**角色字段**（不含 groupId / sourceAssetId）。
 * 回滚后刷新节点内容用它：节点归属与绑定事实由画布持有，不属于资产内容。
 */
export function roleAssetContentOf(detail: RoleAssetDetail): Record<string, unknown> {
  return {
    label: String(detail.name ?? ''),
    systemPrompt: String(detail.systemPrompt ?? ''),
    provider: String(detail.provider ?? ''),
    model: String(detail.model ?? ''),
    reasoning: (detail.reasoning as string | null | undefined) ?? null,
    presetId: detail.presetId ?? 'standard',
    retryLimit: Number(detail.retryLimit ?? 3),
    reactLimit: detail.reactLimit ?? null,
    inputSchema: String(detail.inputSchema ?? ''),
    outputSchema: String(detail.outputSchema ?? ''),
    injectSystemPrompt: detail.injectSystemPrompt !== false,
    injectToolSections: detail.injectToolSections !== false,
    promptFilePath: String(detail.promptFilePath ?? '') || undefined,
  }
}

/** 角色资产详情 → 角色节点 data（与 templateToNodeData 的 role 分支同口径 + 来源资产 id）。 */
export function roleAssetToNodeData(detail: RoleAssetDetail): Record<string, unknown> {
  return {
    ...roleAssetContentOf(detail),
    groupId: null,
    // 来源资产：仅「从资产拖入」写入（模版/实例拖入不写），保存工作流资产时据此登记引用
    sourceAssetId: detail.assetId,
  }
}

/** 角色资产种类 → 画布节点 kind（parent / agent；与 RoleNode.kind 同域）。 */
export function roleAssetNodeKind(detail: RoleAssetDetail): 'parent' | 'agent' {
  return detail.kind === 'parent' ? 'parent' : 'agent'
}

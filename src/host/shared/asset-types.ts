// Host + Client 共享契约：资产与经验（纯类型，零运行时依赖）。
//
// 职责：定义「模版晋升而来的资产」与「复盘沉淀的经验」在两端共用的形状——
// 资产索引条目（列表）、资产详情（属性栏编辑 / catalog 详情召回）、版本条目
// （回滚上拉列表）与经验条目（catalog 两次召回）。
//
// 语义边界（用户裁决）：
//   - 模版 = 可随意修改的草稿；资产 = 带版本控制与回滚的可复用资料，父代理只能召回资产；
//   - assetId 是逻辑身份（跨版本不变），versionId 是整数版本号（展示为 vN）；
//   - 回滚只改 Active 指针，历史版本内容永不被改写。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。

import type { GraphNode, Line, WorkflowMode } from './graph-model.js'
import type { OrgMeta } from './org-meta.js'

/** 资产种类：工作流资产 / 角色资产（V1 只此两类）。 */
export type AssetKind = 'workflow' | 'role'

/** 角色资产的父/子角色种类（与 RoleNode.kind 同域）。 */
export type RoleAssetKind = 'parent' | 'agent'

/**
 * 角色资产类型（用户裁决）：
 *   - standalone：直接由角色模版晋升，且未被任何工作流资产登记引用；
 *   - inline：由工作流模版晋升带来的内联角色，且未被其他工作流资产引用、也未与 standalone 重复；
 *   - shared：被多个工作流资产登记引用，或 standalone 与 inline 发生重复（修改会触发级联）。
 */
export type RoleAssetType = 'standalone' | 'inline' | 'shared'

/** 资产版本来源：human=人类创建/修改；agent=代理生成（V1 入库只由人类触发，agent 预留）。 */
export type AssetVersionSource = 'human' | 'agent'

/** 资产版本条目（回滚上拉列表与版本展示；不含版本内容）。 */
export interface AssetVersionEntry {
  /** 整数版本号（展示为 vN）。 */
  versionId: number
  /** 该版本行的全局唯一 id（角色版本会被工作流资产按此引用）。 */
  rowId: string
  /** 该版本名称（列表展示）。 */
  name: string
  /** 该版本创建时间（epoch 毫秒）。 */
  createdAt: number
  /** 该版本来源（human / agent）。 */
  source: AssetVersionSource
  /** 是否为当前 Active 版本。 */
  active: boolean
}

/** 工作流资产索引条目（Active 版本投影；归档资产取最新版本行投影）。 */
export interface WorkflowAssetSummary {
  assetId: string
  versionId: number
  name: string
  description: string
  /** 晋升来源模版 id（非模版晋升时省略）。 */
  sourceTemplateId?: string
  /** 晋升时来源模版的内容指纹（入库按钮锁定判据）。 */
  sourceFingerprint?: string
  /**
   * 该资产绑定的来源模版**当前**内容指纹（由 API 边界读取模版后填充；AssetStore 不读模版）。
   * 客户端判定「入库按钮锁定」= sourceFingerprint === currentTemplateFingerprint；
   * 模版已删除时省略（视为未锁定）。
   */
  currentTemplateFingerprint?: string
  /** Active 索引最后更新时间（epoch 毫秒）。 */
  updatedAt: number
}

/**
 * 引用某个角色资产的工作流资产（按资产聚合去重后的引用事实）。
 *
 * 为什么必须按资产聚合：reference_workflow_ids 记的是工作流**版本行** id，且新版本行
 * 的引用从零开始计数——直接读 Active 版本行的数组长度会得出「shared 资产被 0 个工作流引用」
 * 这种自相矛盾的结论。语义上「谁在引用这个角色资产」是资产级事实。
 */
export interface RoleAssetReference {
  /** 引用方工作流资产 id。 */
  assetId: string
  /** 该工作流资产的当前名称（取最新版本行；行缺失时回退 assetId）。 */
  name: string
  /** 该工作流资产引用本角色资产的版本行数量（同一资产的多版本只聚合为一条）。 */
  versionCount: number
}

/** 角色资产索引条目（Active 版本投影；归档资产取最新版本行投影）。 */
export interface RoleAssetSummary {
  assetId: string
  versionId: number
  name: string
  kind: RoleAssetKind
  /** 角色资产类型（standalone / inline / shared）。 */
  roleAssetType: RoleAssetType
  /**
   * 角色职责摘要（Active 版本 systemPrompt 前 60 字；由 AssetStore 在列表查询里
   * JOIN 当前 Active 版本行生成，供父代理判断适用性）。
   */
  summary?: string
  /** 晋升来源模版 id（非模版晋升时省略）。 */
  sourceTemplateId?: string
  /** 晋升时来源模版的内容指纹（入库按钮锁定判据）。 */
  sourceFingerprint?: string
  /** 该资产绑定的来源模版**当前**内容指纹（由 API 边界填充；语义同 WorkflowAssetSummary）。 */
  currentTemplateFingerprint?: string
  /** Active 索引最后更新时间（epoch 毫秒）。 */
  updatedAt: number
}

/**
 * 角色资产详情（Active 版本）。
 * 与 RoleTemplate 字段同域，便于客户端属性栏直接编辑与回写；
 * 检索上下文（retrieval_context）与向量字段是 V1 预留，不进本契约。
 */
export interface RoleAssetDetail {
  assetId: string
  versionId: number
  rowId: string
  kind: RoleAssetKind
  roleAssetType: RoleAssetType
  name: string
  systemPrompt: string
  provider: string
  model: string
  reasoning?: string
  presetId?: string | null
  retryLimit: number
  reactLimit?: number | null
  inputSchema?: string
  outputSchema?: string
  systemPromptSource?: string
  injectSystemPrompt?: boolean
  injectToolSections?: boolean
  promptFilePath?: string
  /** 引用过该角色版本的工作流资产版本行 id 列表（统计缓存；单调递增）。 */
  referenceWorkflowIds: string[]
  /**
   * 已归档标记（Active 行已移除）。缺省即活跃。
   * 归档资产没有 Active 指针，其详情与版本列表一律以**最新版本行**为准。
   */
  retired?: boolean
  /**
   * 引用了本角色资产**任一版本**的工作流资产（已按资产聚合去重；仅详情读填充）。
   * 保存前的影响面告知与归档确认框都消费它，因此必须是资产级事实而非单版本行事实。
   */
  referencingWorkflowAssets?: RoleAssetReference[]
  /** 晋升来源模版 id（非模版晋升时省略）。 */
  sourceTemplateId?: string
  /** 该版本创建时间（epoch 毫秒）。 */
  createdAt: number
}

/** 工作流资产里的角色节点 → 角色版本行引用（固定回放用）。 */export interface WorkflowAssetRoleRef {
  /** 工作流图内的角色节点 id。 */
  nodeId: string
  /** 被引用的角色版本行 id（role_asset_history.id）。 */
  roleVersionId: string
}

/** 工作流资产详情（Active 版本；nodes 已按固定版本把角色节点字段 join 回填）。 */
export interface WorkflowAssetDetail {
  assetId: string
  versionId: number
  rowId: string
  mode: WorkflowMode
  name: string
  description: string
  /** 全量节点（角色节点已 join 回角色版本字段；非角色节点为晋升时快照）。 */
  nodes: GraphNode[]
  lines: Line[]
  meta?: OrgMeta
  /** 角色节点 → 角色版本行 id（与 nodes 中的角色节点一一对应）。 */
  roleVersionIds: WorkflowAssetRoleRef[]
  /**
   * 已归档标记（Active 行已移除）。缺省即活跃。
   * 归档资产没有 Active 指针，其详情与版本列表一律以**最新版本行**为准。
   */
  retired?: boolean
  /** 晋升来源模版 id（非模版晋升时省略）。 */
  sourceTemplateId?: string
  /** 该版本创建时间（epoch 毫秒）。 */
  createdAt: number
}

/** 资产 Active 详情（按 kind 判别）。 */
export type AssetDetail = WorkflowAssetDetail | RoleAssetDetail

/** 经验索引条目（catalog 第一层召回：id + task_context）。 */
export interface ExperienceIndexEntry {
  id: string
  taskContext: string
}

/** 经验条目（catalog 第二层召回：完整内容）。 */
export interface ExperienceEntry {
  id: string
  /** 产生该经验的那次工作流运行 id（可空）。 */
  sourceRunId?: string
  /** 生成该经验时使用的复盘提示词版本号（V1 固定 '1'）。 */
  reflectionPromptVersion: string
  /** 任务类型（粗粒度，如「软件开发」）。 */
  taskType: string
  /** 任务语义上下文（自然语言，召回检索锚点）。 */
  taskContext: string
  /** 可复用经验本体（单句、精简）。 */
  insight: string
  /** 支撑该经验的关键事实（可空）。 */
  evidence?: string
  /** 人工审核意见 / 修改意见（用户在多选卡片里补充时写入）。 */
  reviewFeedback?: string
  /** 人工审核时间（epoch 毫秒）；未审核为 undefined。 */
  reviewedAt?: number
  createdAt: number
  updatedAt: number
}

/** 经验候选（复盘后由父代理提交给入库工具；用户确认前不落库）。 */
export interface ExperienceDraft {
  taskType: string
  taskContext: string
  insight: string
  evidence?: string
  /** 产生该候选的 run id（可空）。 */
  sourceRunId?: string
}

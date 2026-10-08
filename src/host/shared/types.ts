// Host + Client 共享契约（type-only barrel）：Host 半区与 Client 半区共用的契约入口。
//
// 为什么是本文件：对外契约路径（`from './types.js'`）遍布 host 与 client 两侧，
// 契约本体按「一个变化原因一个文件」拆分后，本文件只做 type-only 再导出，
// 使内部拆分不影响任何既有 import 说明符（契约路径稳定）。
//
// 纯度契约：
//   - 本文件只允许 `import type` / `export type … from`（编译期完全擦除）；
//   - 禁止任何运行时 import（避免双 tsconfig 的 Context augmentation 互相污染）；
//   - 不得定义运行时值。
//
// 契约本体分工：
//   - graph-model.js    节点/连线/工作流文档形状（工作流结构事实源）
//   - run-types.js      run 快照与节点执行记录
//   - service-types.js  模式二服务实例与 userId→sessionId 映射
//   - template-types.js 模板与导入导出 v2 bundle
//   - scheduler-types.js 定时任务实体与运行态
//   - org-meta.js       元参数本体（OrgMeta / OrgBudget）

export type { NodeOutputRecord, NodeRunStatus, RunSnapshot, RunStatus } from './run-types.js'
export type { ServiceState, ServiceStatus, UserIdMap } from './service-types.js'
export type {
  BundleV2,
  DatabaseTemplate,
  FileTemplate,
  GroupTemplate,
  RoleTemplate,
  ToolCombo,
} from './template-types.js'
export type {
  DailyTimeConfig,
  IntervalConfig,
  ScheduledTask,
  ScheduledTaskRuntime,
  ScheduledTaskView,
  ScheduleRuntimePolicy,
  ScheduleSessionMode,
  ScheduleTriggerMode,
  ScheduleWindowConfig,
  TimeRangeConfig,
} from './scheduler-types.js'

// 工作流模板：与 WorkflowDocument 同构但全局共享、跨会话可见。
// 契约本体与图结构同源，此处 re-export 保持既有契约路径。
export type { WorkflowTemplate } from './graph-model.js'

// 元参数（自主编排）：本体在 org-meta.js（零 import 纯类型文件），
// 供既有 `from './types.js'` 调用方继续引用。
export type { OrgBudget, OrgMeta } from './org-meta.js'

// 资产与经验：本体在 asset-types.js（资产索引/详情、版本条目、经验条目与召回候选）。
export type {
  AssetDetail,
  AssetKind,
  AssetVersionEntry,
  AssetVersionSource,
  ExperienceDuplicateCandidate,
  ExperienceDuplicateExisting,
  ExperienceDuplicateJudge,
  ExperienceDuplicateVerdict,
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceInsertCheckedInput,
  ExperienceInsertDraft,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRecallHit,
  ExperienceRetrievalUpdate,
  ExperienceType,
  RoleAssetDetail,
  RoleAssetKind,
  RoleAssetSummary,
  RoleAssetType,
  WorkflowAssetDetail,
  WorkflowAssetRoleRef,
  WorkflowAssetSummary,
} from './asset-types.js'

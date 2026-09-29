import type { AssetVersionEntry, RoleAssetReference, WorkflowAssetDetail, WorkflowAssetRoleRef, WorkflowAssetSummary } from '../shared/asset-types.js';
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js';
import type { OrgMeta } from '../shared/org-meta.js';
import type { AssetTxContext } from './db.js';
import { type RolePortContext } from './role-assets.js';
/** 节点壳：角色节点只保留结构字段，内容字段由角色版本行回填。 */
export interface NodeShell {
    id: string;
    kind: GraphNode['kind'];
    position: {
        x: number;
        y: number;
    };
    groupId?: string | null;
    sourceAssetId?: string;
}
/** 工作流资产版本行的内容字段（不含审计列）。 */
export interface WorkflowContentFields {
    mode: WorkflowMode;
    name: string;
    description: string;
    /** 节点壳数组；非角色节点为完整节点对象（晋升时已是快照）。 */
    nodeShells: NodeShell[];
    lines: Line[];
    meta: OrgMeta | null;
    roleVersionIds: WorkflowAssetRoleRef[];
}
/** 工作流资产版本行。 */
export interface WorkflowAssetRow extends WorkflowContentFields {
    id: string;
    versionId: number;
    assetId: string;
    retrievalContext: string | null;
    source: 'human' | 'agent';
    sourceRunId: string | null;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    createdAt: number;
}
/** 工作流资产 Active 行。 */
export interface WorkflowAssetActiveRow {
    assetId: string;
    versionId: number;
    name: string;
    retrievalContext: string;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    updatedAt: number;
}
/** 登记入参（AssetStore 组装；assetId 已解析、来源绑定已确定）。 */
export interface WorkflowWriteRequest {
    assetId: string;
    mode: WorkflowMode;
    name: string;
    description: string;
    nodes: GraphNode[];
    lines: Line[];
    meta: OrgMeta | null;
    source: 'human' | 'agent';
    sourceTemplateId: string | null;
    fingerprint: string | null;
    /** 幂等短路判据（仅晋升路径非空）：与 Active 行来源指纹相同即视为内容未变。 */
    shortCircuitFingerprint: string | null;
    /**
     * 新角色资产 id 生成器：**按需调用**（只有真正要新建内联资产时才取一个）。
     * 为什么不预分配整池：id 源是被消费的单调序列，预分配会让「本用例第几个资产」
     * 变得难以预测，也会在复用/去重路径上凭空消耗 id。
     */
    nextRoleAssetId: () => string;
}
/** 登记结果。 */
export interface WorkflowRegistration {
    assetId: string;
    versionId: number;
    rowId: string;
    unchanged: boolean;
    sharedRoleAssetIds: string[];
    /** 本次登记使「已无任何工作流引用」而自动归档的角色资产 id（去重）。 */
    archivedRoleAssetIds: string[];
}
/** 工作流资产列表（活跃资产 = 有 Active 行的资产；Active 版本投影）。 */
export declare function listWorkflowAssets(ctx: AssetTxContext): WorkflowAssetSummary[];
/**
 * 历史（已归档）工作流资产列表：有历史行、但没有 Active 行的资产，按**最新版本行**投影。
 * 与活跃列表分开返回：活跃列表是父代理召回面（`wf_org_catalog` 消费），归档资产不得混入。
 *
 * 排序与 updatedAt 用版本行的 created_at：workflow_asset_history 没有 updated_at 列
 * （内容不可变，只有角色表把可变统计缓存记在行上），归档资产也没有 Active 行可取用。
 */
export declare function listRetiredWorkflowAssets(ctx: AssetTxContext): WorkflowAssetSummary[];
/**
 * 工作流资产详情：节点壳按 role_version_ids join 回角色版本字段。
 * 活跃资产取 Active 版本；归档资产取**最新版本行**并标 `retired`。
 * 壳与映射不一致（缺映射 / 引用行缺失）即抛带路径的错误：静默产半张图会让运行期
 * 拿到结构上无法执行的图，比直接失败更难排查。
 */
export declare function getWorkflowAssetDetail(ctx: AssetTxContext, assetId: string): WorkflowAssetDetail | null;
/**
 * 工作流资产版本列表（版本号倒序）。
 * 归档资产同样可列（无 Active 指针时全部标 `active: false`）：历史资产的「重新启用」
 * 与「保存迭代」都以本列表为入口。
 */
export declare function readWorkflowVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[];
/** 工作流资产 Active 行。 */
export declare function readWorkflowActive(ctx: AssetTxContext, assetId: string): WorkflowAssetActiveRow | null;
/** 最新版本行（max version_id）；归档资产的详情、保存基线与版本列表都以它为准。 */
export declare function latestWorkflowVersionRow(ctx: AssetTxContext, assetId: string): WorkflowAssetRow | null;
/** 按来源模版定位绑定资产（同一模版的二次晋升复用同一资产）。 */
export declare function findWorkflowAssetByTemplate(ctx: AssetTxContext, templateId: string): WorkflowAssetActiveRow | null;
/** 工作流版本行读取（JSON 列严格解析，损坏即抛错）。 */
export declare function readWorkflowVersionRow(ctx: AssetTxContext, assetId: string, versionId: number): WorkflowAssetRow | null;
/**
 * 回滚：把 Active 指针移向目标版本（name / retrieval_context / 来源指纹同步），
 * 不新增版本、不改历史行。
 *
 * 归档资产（无 Active 行）的回滚即「重新启用」：按目标版本重建 Active 行。
 * TODO(职责分离-遗留)：这一分支让回滚同时承担了「状态转换」，与「回滚只管版本与指针」
 * 的目标职责不符。界面已改为归档资产只显示「恢复」（不再给回滚入口），领域侧按用户裁决
 * 暂留旧行为待定案——需要收紧时以本标记为准（恢复入口见 restoreWorkflowAssetTo）。
 */
export declare function rollbackWorkflowAssetTo(ctx: RolePortContext, assetId: string, versionId: number): WorkflowAssetDetail;
/**
 * 恢复：把已归档工作流资产恢复为活跃——取**最新版本行**重建 Active 指针。
 * 与回滚的分工、幂等语义与角色资产一致（见 role-assets.ts 的 restoreRoleAssetTo）。
 */
export declare function restoreWorkflowAssetTo(ctx: RolePortContext, assetId: string): WorkflowAssetDetail;
/** 归档：删除 Active 行；历史行与角色资产全部保留（流程归档不触发角色归档）。 */
export declare function retireWorkflowAssetRow(tx: AssetTxContext, assetId: string): void;
/** 工作流检索上下文 = id + name + description。 */
export declare function workflowRetrievalContext(assetId: string, name: string, description: string): string;
/** 首版登记：写入版本 1 并建立 Active 行（资产此前不存在）。 */
export declare function createWorkflowAsset(ctx: RolePortContext, request: Omit<WorkflowWriteRequest, 'shortCircuitFingerprint'>): WorkflowRegistration;
/**
 * 追加版本：先判幂等短路（来源指纹未变），再做内容查重（节点坐标不参与），
 * 最后解析角色节点、写版本行并结算引用。
 *
 * 基线版本：活跃资产取 Active 版本；归档资产取最新版本行（保存只做迭代，不重建 Active 行）。
 */
export declare function registerWorkflowVersion(ctx: RolePortContext, request: WorkflowWriteRequest): WorkflowRegistration;
/**
 * 保存前的影响面预览：本次内容会为哪些角色资产登记新版本，进而牵连哪些**其他**工作流资产。
 *
 * 判据与 registerRoleNode 的第一步完全一致（源资产存活性 + 内容是否与源资产 Active 版本全等），
 * 因此「预览说会牵连」与「保存真的会牵连」不会出现分叉；只读、不落库。
 * 排除 `workflowAssetId`（正在保存的本资产自己不算被牵连方）。
 */
export declare function previewWorkflowAssetCascade(ctx: AssetTxContext, input: {
    workflowAssetId: string | null;
    nodes: GraphNode[];
}): RoleAssetReference[];

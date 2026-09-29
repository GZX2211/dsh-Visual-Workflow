import type { AssetKind, AssetVersionEntry, RoleAssetDetail, RoleAssetReference, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../shared/asset-types.js';
import { VisualWorkflowApiBase, type ApiHost } from './boundary.js';
/** 资产库能力缝（形状由 boundary 的宿主能力缝定义，本模块不自建第二份）。 */
type Assets = NonNullable<ApiHost['assets']>;
/** 入库/保存的领域出参：直接取自能力缝签名，避免端点与资产库各写一份形状。 */
type AssetPromoteResult = Awaited<ReturnType<Assets['promoteRole']>>;
export declare class AssetEndpoints extends VisualWorkflowApiBase {
    /**
     * 资产列表：活跃与历史（已归档）分开返回，两类各自按 kind 拆分。
     * 分开是契约要求而非展示细节——活跃列表是父代理召回面，归档资产绝不进召回面。
     */
    listAssets(args: {
        kind?: unknown;
    }): Promise<{
        workflows: WorkflowAssetSummary[];
        roles: RoleAssetSummary[];
        retiredWorkflows: WorkflowAssetSummary[];
        retiredRoles: RoleAssetSummary[];
    }>;
    getAsset(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<WorkflowAssetDetail | RoleAssetDetail>;
    promoteAsset(args: {
        kind?: unknown;
        templateId?: unknown;
    }): Promise<AssetPromoteResult>;
    /** 角色模版入库：模版内容整体作为首个资产版本的来源。 */
    private promoteRoleTemplate;
    /** 工作流模版入库：模版图整体作为首个资产版本的来源（meta 缺省不落约束）。 */
    private promoteWorkflowTemplate;
    saveAssetVersion(args: {
        kind?: unknown;
        assetId?: unknown;
        payload?: unknown;
    }): Promise<AssetPromoteResult>;
    /**
     * 影响面预览（只读，不落库）：按本次要保存的内容推演哪些**其他**工作流资产会被牵连。
     *
     * 为什么必须是独立端点而不是让客户端自行推演：角色字段映射、源资产存活性与共享判定
     * 全部是 Host 的事实；客户端复制一份就会在「预览说没事、保存却级联」时分叉。
     */
    previewAssetCascade(args: {
        kind?: unknown;
        assetId?: unknown;
        payload?: unknown;
    }): Promise<{
        kind: AssetKind;
        affected: RoleAssetReference[];
    }>;
    listAssetVersions(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<AssetVersionEntry[]>;
    rollbackAsset(args: {
        kind?: unknown;
        assetId?: unknown;
        versionId?: unknown;
    }): Promise<WorkflowAssetDetail | RoleAssetDetail>;
    retireAsset(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<{
        kind: AssetKind;
        assetId: string;
        retired: true;
    }>;
    /**
     * 恢复历史（已归档）资产：取**最新版本行**重建 Active 指针。
     *
     * 与回滚的职责分工（用户裁决）：本端点只管状态转换（归档 → 活跃），回滚只管版本与
     * Active 指针；恢复不接版本号，需要旧版本时恢复后再回滚。
     */
    restoreAsset(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<WorkflowAssetDetail | RoleAssetDetail>;
}
export {};

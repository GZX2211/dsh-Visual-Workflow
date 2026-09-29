import type { Dispatch } from 'react';
import type { AssetDetail, AssetKind, RoleAssetReference, RoleAssetType } from '../../host/shared/asset-types.js';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
import type { ToastFace } from './useToast.js';
import type { Dict } from '../i18n.js';
/** 入库 / 登记新版本的返回面（后端 promoteAsset / saveAssetVersion 契约）。 */
export interface AssetPromoteResult {
    assetId: string;
    versionId: number;
    rowId: string;
    /** true = 内容与当前基线版本全等，未新增版本（去重命中）。 */
    unchanged: boolean;
    /** 角色资产的种类（角色入库返回）。 */
    roleAssetType?: RoleAssetType;
    /** 因本次入库被判定为共享的角色资产 id 列表。 */
    sharedRoleAssetIds?: string[];
    /** 因本次登记失去全部工作流引用而被自动归档的角色资产 id 列表。 */
    archivedRoleAssetIds?: string[];
}
export interface AssetsFace {
    assets: StudioState['assets'];
    assetDoc: StudioState['assetDoc'];
    assetVersions: StudioState['assetVersions'];
    /** 重新加载资产列表（活跃 + 历史（已归档））。 */
    refresh(): Promise<void>;
    /** 取单个资产详情（按 kind 装载对应状态槽；失败返回 null）。 */
    loadAsset(kind: AssetKind, assetId: string): Promise<AssetDetail | null>;
    /** 模版 → 资产入库（同一模版再次入库 = 同一资产的新版本）。 */
    promote(kind: AssetKind, templateId: string): Promise<AssetPromoteResult | null>;
    /** 资产态保存：登记该资产的新版本。 */
    saveVersion(kind: AssetKind, assetId: string, payload: unknown): Promise<AssetPromoteResult | null>;
    /**
     * 保存前的影响面预览（只读）：本次内容会牵连哪些**其他**工作流资产。
     * 判定归 Host（角色字段映射与共享判定都是 Host 的事实），本面只转发与降级。
     */
    previewCascade(kind: AssetKind, assetId: string | null, payload: unknown): Promise<RoleAssetReference[]>;
    /** 打开版本上拉列表数据（回滚选择）。 */
    openVersions(kind: AssetKind, assetId: string): Promise<void>;
    /** 关闭版本上拉列表数据。 */
    closeVersions(): void;
    /**
     * 回滚 Active 指针到历史版本（不改写历史版本内容）；归档资产的回滚即重新启用。
     * @returns 回滚后的详情（失败返回 null；调用方据此保留现场，并用详情刷新画布节点内容）。
     */
    rollback(kind: AssetKind, assetId: string, versionId: number): Promise<AssetDetail | null>;
    /**
     * 归档资产（Active 移除、历史与版本内容全保留；不删除任何版本行）。
     * @returns 是否成功（语义同 rollback）。
     */
    retire(kind: AssetKind, assetId: string): Promise<boolean>;
    /** 打开工作流资产文档：装载详情后把画布切到该资产（资产态画布文档）。 */
    openFlowAsset(assetId: string): Promise<void>;
    /** 打开角色资产：装载详情后在属性栏编辑。 */
    openRoleAsset(assetId: string): Promise<void>;
}
/** 资产面（远端失败已就地翻译为提示；返回值 null 表示本次调用未产生结果）。 */
export declare function useAssets(remote: RemoteFace, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, state: StudioState): AssetsFace;

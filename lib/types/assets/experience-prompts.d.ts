import type { AssetVersionEntry, ExperienceGenerationPromptEntry, ExperienceType, PromptAssetDetail, PromptAssetSummary } from '../shared/asset-types.js';
import type { AssetTxContext } from './db.js';
/** 版本登记结果（AssetStore 映射为资产写路径的公共结果形状）。 */
export interface PromptAssetRegistration {
    assetId: string;
    versionId: number;
    rowId: string;
    unchanged: boolean;
}
/** 某主体类型当前生效的 Prompt（无活跃行返回 null：该类型的经验生成被显式关闭）。 */
export declare function getActivePromptRow(ctx: AssetTxContext, type: ExperienceType): ExperienceGenerationPromptEntry | null;
/**
 * 全量 Prompt（含历史版本；同一资产内活跃行排在前）。
 *
 * 经验域只消费 `getActivePrompt`；本函数保留给诊断/管理读路径，
 * `active` 由 Active 指针比较得出，而不是行上的状态列（后者已不存在）。
 */
export declare function listPromptRows(ctx: AssetTxContext): ExperienceGenerationPromptEntry[];
/** 提示词资产列表（Active 版本投影；两款资产都必须有活跃指针，否则初始化会自愈）。 */
export declare function listPromptAssets(ctx: AssetTxContext): PromptAssetSummary[];
/**
 * 提示词资产详情（Active 版本）。
 *
 * Active 行缺失时回落到最新版本行（只读降级）：页面仍能看到可用正文，
 * 写路径会在下一次保存/回滚时重建指针；不把「指针损坏」伪装成「资产不存在」。
 */
export declare function getPromptAssetDetail(ctx: AssetTxContext, assetId: string): PromptAssetDetail | null;
/** 提示词资产版本列表（版本号倒序；不可归档，因此所有版本都属于同一条活跃资产）。 */
export declare function readPromptVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[];
/**
 * 保存提示词资产新版本：只接受正文，其余固定字段从当前基线版本继承。
 *
 * 内容全等即 `unchanged`（与其他资产的保存查重同口径）：重复点击保存不堆版本。
 * 新版本行 id 用 `<assetId>@<versionId>`；`prompt_version` 取 `V<versionId>`，
 * 供经验 provenance 记录「生成时使用的是哪一版正文」。
 */
export declare function savePromptAssetVersion(ctx: {
    tx: AssetTxContext;
    now: () => number;
}, input: {
    assetId: string;
    prompt: string;
}): PromptAssetRegistration;
/**
 * 回滚：只把 Active 指针移向目标版本，不新增版本、不改历史行。
 * 提示词资产永远活跃，因此这里不存在「归档资产回滚即恢复」的分支。
 */
export declare function rollbackPromptAssetTo(ctx: {
    tx: AssetTxContext;
    now: () => number;
}, assetId: string, versionId: number): PromptAssetDetail;

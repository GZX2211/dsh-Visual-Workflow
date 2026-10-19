import type { ExperienceType } from "../shared/asset-types.js";
/** 种子 Prompt 版本（两节正文的版本号一致，故收敛为一个常量）。 */
export declare const EXPERIENCE_PROMPT_SEED_VERSION = "V1";
/**
 * 两类主体的提示词资产逻辑 id（跨版本不变）。
 * 资产 id 固定为这两个值：播种、迁移与经验 provenance 都依赖其稳定性。
 */
export declare const EXPERIENCE_PROMPT_ASSET_IDS: Readonly<Record<ExperienceType, string>>;
/** 单条种子 Prompt 的全部固定字段（名称/描述/主体类型不可编辑；正文是 V1 初值）。 */
export interface ExperiencePromptSeed {
    /** 提示词资产逻辑 id（跨版本不变；版本行 id 由 `<assetId>@<versionId>` 生成）。 */
    assetId: string;
    experienceType: ExperienceType;
    name: string;
    description: string;
    prompt: string;
    promptVersion: string;
}
/** 两类主体的 V1 种子（顺序即播种顺序）。team 类型已退役，不得再为其播种。 */
export declare const EXPERIENCE_PROMPT_SEEDS: readonly ExperiencePromptSeed[];

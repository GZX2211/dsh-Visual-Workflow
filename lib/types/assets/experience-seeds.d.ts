import type { ExperienceType } from "../shared/asset-types.js";
/** 种子 Prompt 版本（三节正文的版本号一致，故收敛为一个常量）。 */
export declare const EXPERIENCE_PROMPT_SEED_VERSION = "V1";
/** 单条种子 Prompt 的全部字段（id 固定，播种判定依赖其稳定性）。 */
export interface ExperiencePromptSeed {
    id: string;
    experienceType: ExperienceType;
    name: string;
    description: string;
    prompt: string;
    promptVersion: string;
}
/** 三类主体的 V1 种子（顺序即播种顺序）。 */
export declare const EXPERIENCE_PROMPT_SEEDS: readonly ExperiencePromptSeed[];

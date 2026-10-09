import type { ExperienceType } from '../../shared/asset-types.js';
/** 初始化态：当前主体类型唯一生效的生成 Prompt。 */
export interface LearnInitializedResult {
    kind: 'initialized';
    /** 生成 Prompt 行 id（提交时由 domain 自动记录为 provenance）。 */
    promptId: string;
    promptVersion: string;
    name: string;
    /** Prompt 正文（模型据此产出候选）。 */
    prompt: string;
    experienceType: ExperienceType;
}
/** 提交态：本次真正入库的条目与被拒绝的候选。 */
export interface LearnSubmittedResult {
    kind: 'submitted';
    inserted: Array<{
        id: string;
        experienceType: ExperienceType;
    }>;
    /** 被拒绝的候选原因（近似重复等）；不入库的候选在此交代清楚。 */
    skipped: Array<{
        reason: string;
    }>;
}
export type LearnResult = LearnInitializedResult | LearnSubmittedResult;

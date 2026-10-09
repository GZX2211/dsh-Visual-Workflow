import type { ExperienceDecisionEffectAnchor, ExperienceScoreAnchor } from '../../shared/asset-types.js';
/** 已写入的评价在工作流语境下的投影（按模型提交的顺序，与评价行一一对应）。 */
export interface FeedbackAcceptedEntry {
    experienceId: string;
    fitScore: ExperienceScoreAnchor;
    decisionEffect: ExperienceDecisionEffectAnchor;
    informationGain: ExperienceScoreAnchor;
    causalConfidence: ExperienceScoreAnchor;
}
/** 未受理的评价：原因由经验域给出（工具层不得改写或追加引导）。 */
export interface FeedbackSkippedEntry {
    experienceId: string;
    reason: string;
}
/** 反馈结果：区分已写入与未受理，让模型知道哪些经验真正进入了长期统计。 */
export interface FeedbackResult {
    accepted: FeedbackAcceptedEntry[];
    skipped: FeedbackSkippedEntry[];
}

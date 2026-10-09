import type { ExperienceEvaluationEntry, ExperienceEvaluationScores, ExperienceType } from "../shared/asset-types.js";
import type { ExperienceCaller, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js";
/**
 * 准入拒绝的固定语义（文案是产品要求，不是提示词建议）。
 *
 * 用户明确要求只表达「没有使用的经验，不能评价」，不得引导模型「先用 ids 召回再评价」：
 * 该引导会把「补一次召回再评价」变成合法路径，从而让未真正使用过的经验也能被评价。
 */
export declare const FEEDBACK_ADMISSION_REJECTED_REASON = "\u6CA1\u6709\u4F7F\u7528\u7684\u7ECF\u9A8C\uFF0C\u4E0D\u80FD\u8BC4\u4EF7";
/** 单条待提交评价（四维评分 + 经验 id + 证据说明）。 */
export interface ExperienceFeedbackInput extends ExperienceEvaluationScores {
    experienceId: string;
    /** 支撑本次评价的事实说明；缺省按空串落库。 */
    evidence?: string;
}
/** 被跳过的评价条目（原样回报给调用方，便于模型知道哪几条没进历史）。 */
export interface ExperienceFeedbackSkip {
    experienceId: string;
    reason: string;
}
/** 反馈结果：已写入的评价行投影 + 被跳过的条目。 */
export interface ExperienceFeedbackResult {
    accepted: ExperienceEvaluationEntry[];
    skipped: ExperienceFeedbackSkip[];
}
/** 反馈入参（主体身份 + 经验类型 + 评价列表）。 */
export interface ExperienceFeedbackRequest {
    caller: ExperienceCaller;
    type: ExperienceType;
    evaluations: readonly ExperienceFeedbackInput[];
}
/** 反馈依赖（与服务的端口依赖同源，便于单测直接驱动编排）。 */
export interface ExperienceFeedbackDeps {
    store: ExperienceStorePort;
    runtime: ExperienceRuntimePort;
}
/**
 * 提交评价：解析主体 → 校验每条评分 → 准入判定 → 一笔事务写评价并重算统计。
 *
 * 失败隔离：写入失败只把错误归一为 `WF_EXPERIENCE_FEEDBACK_FAILED`（保留原始原因），
 * 经验本体与既有评价历史都不受影响；统计可由 rebuild 全量重放修复（§24 / §35）。
 */
export declare function submitExperienceFeedback(deps: ExperienceFeedbackDeps, request: ExperienceFeedbackRequest): Promise<ExperienceFeedbackResult>;

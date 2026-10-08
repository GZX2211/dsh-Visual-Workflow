import type { ExperienceFeedbackInput, ExperienceFeedbackResult } from '../../experience/index.js';
import type { FeedbackResult } from './types.js';
/**
 * 解析并校验模型侧 evaluations（整批 deterministic 校验，任一非法项即拒绝整批）。
 * 通过后返回经验域入参（camelCase）；缺省的 evidence 不进键，由域层按空串解释。
 */
export declare function parseFeedbackEvaluations(raw: unknown): ExperienceFeedbackInput[];
/** 域层结果 → 模型可见结果（字段一一投影，顺序保持域层给出的顺序）。 */
export declare function projectFeedbackResult(result: ExperienceFeedbackResult): FeedbackResult;

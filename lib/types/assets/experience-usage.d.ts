import type { ExperienceType, ExperienceUsageRecordInput } from "../shared/asset-types.js";
import { type ExperiencePortContext } from "./experiences.js";
/** 记录一批使用事实：逐条插入使用行，并对涉及的经验累加被注入次数。 */
export declare function recordUsageRows(ctx: ExperiencePortContext, input: ExperienceUsageRecordInput): {
    recorded: number;
};
/**
 * 该主体在给定经验类型下「已被显式注入」的经验 id（feedback 准入判据）。
 *
 * 为什么要连经验表：使用事实只记 id，而「是否属于该类型」是经验行上的事实；
 * 类型不匹配的 id 必须被排除，否则跨类型评价会污染另一类主体的长期统计（§29）。
 * 返回顺序与去重口径跟入参一致：调用方按它逐条判定准入，顺序变化会让结果难以复现。
 */
export declare function readInjectedExperienceIds(ctx: ExperiencePortContext, input: {
    subjectId: string;
    experienceType: ExperienceType;
    experienceIds: string[];
}): string[];

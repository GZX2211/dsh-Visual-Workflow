import type { ExperienceEvaluationEntry, ExperienceEvaluationInsertInput, ExperienceStatsEntry } from "../shared/asset-types.js";
import { type ExperiencePortContext } from "./experiences.js";
/** 批量评价写入结果：写入的评价行与其后重算出的统计投影（统计顺序为经验首次出现顺序）。 */
export interface ExperienceEvaluationsCheckedResult {
    inserted: ExperienceEvaluationEntry[];
    stats: ExperienceStatsEntry[];
}
/**
 * 批量写入评价并重算对应经验的统计（同一笔事务，任一步失败整批回滚）。
 *
 * 为什么每个经验读**全部**历史再聚合，而不是在旧统计上做增量累加：统计定义是
 * 「历史的函数」（§26 的纯函数聚合器），累加会随参数调整失去可重放性（§25），
 * 也会让「同一批插入多条的中间结果」泄漏进最终投影。
 */
export declare function insertEvaluationsCheckedRows(ctx: ExperiencePortContext, input: ExperienceEvaluationInsertInput): ExperienceEvaluationsCheckedResult;

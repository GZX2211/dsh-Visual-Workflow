import type { ExperienceEvaluationScores, ExperienceStatsEntry, ExperienceStatsRebuildInput, NeutralStatsValues } from "../shared/asset-types.js";
import type { ExperiencePortContext } from "./experiences.js";
/** 经验行读路径的统计 JOIN（无统计行时全列为 NULL，条目据此省略 stats 字段）。 */
export declare const EXPERIENCE_STATS_JOIN_SQL = " LEFT JOIN experience_stats s ON s.experience_id = e.id";
/**
 * 与 JOIN 配套的投影列：统一加 `stats_` 前缀。
 * 必须加前缀——`updated_at` 等列名在两张表里同名，`SELECT *` 会让其中一个被另一个覆盖。
 */
export declare const EXPERIENCE_STATS_JOIN_COLUMNS_SQL: string;
/** 某经验的全部评价历史（按写入顺序，含同一次批量写入的多条）：增量重算的输入。 */
export declare function readEvaluationScores(ctx: ExperiencePortContext, experienceId: string): ExperienceEvaluationScores[];
/** 全库评价历史按经验分组：全量重建的输入。 */
export declare function readAllEvaluationScores(ctx: ExperiencePortContext): Map<string, ExperienceEvaluationScores[]>;
/** 使用事实按经验计数：重建的输入（被注入次数与评价次数是两个事实，不能互相推导）。 */
export declare function readUsageCounts(ctx: ExperiencePortContext): Map<string, number>;
/**
 * 统计行 → 契约投影；无统计行或数值列不可用时返回 null。
 *
 * 为什么损坏行按「无统计」降级而不是报错或补 0：统计本就可重建，重建即可恢复；
 * 而把缺值当成真实统计会直接污染召回排序，比暂时按中性值处理更危险。
 */
export declare function statsEntryFromRow(row: Record<string, unknown>, prefix?: string): ExperienceStatsEntry | null;
/** 按入参顺序读取统计行：缺行不返回（不补默认值），重复入参按首次出现去重。 */
export declare function readStatsRows(ctx: ExperiencePortContext, experienceIds: string[]): ExperienceStatsEntry[];
/** 已记录的被注入次数；无统计行按 0（统计建立前该经验确实没有被记录过注入）。 */
export declare function readRecalledCount(ctx: ExperiencePortContext, experienceId: string): number;
/** 统计行是否已存在（「首次建行」与「只累加计数」两条路径的分界）。 */
export declare function statsRowExists(ctx: ExperiencePortContext, experienceId: string): boolean;
/**
 * 首次建立统计行。
 *
 * 为什么用 INSERT 而不是 UPSERT：调用方已判定该经验没有统计行，此时覆盖写只会掩盖判定错误
 * （例如两次首建竞争），让不一致以主键冲突的形式暴露，而不是静默丢弃一次计数。
 */
export declare function createNeutralStatsRow(ctx: ExperiencePortContext, experienceId: string, neutralStats: NeutralStatsValues, recalledCount: number, updatedAt: number): ExperienceStatsEntry;
/**
 * 只累加被注入次数，其余**统计数值列**由评价路径维护（§24 的增量策略）。
 *
 * 为什么记账时间必须一起刷新：这次写入确实改动了这一行，而「最后更新时间」是行事实而非统计值；
 * 不刷新会让界面与排障看到「计数刚变、时间停在几天前」的自相矛盾（与资产侧 updated_at 同口径）。
 */
export declare function incrementRecalledCount(ctx: ExperiencePortContext, experienceId: string, delta: number, updatedAt: number): void;
/** 覆盖写整行统计（UPSERT）：重算结果即新的投影，无需保留旧值。 */
export declare function writeStatsRow(ctx: ExperiencePortContext, entry: ExperienceStatsEntry): void;
/**
 * 全量重建统计投影（§24 / §25）：读全部经验（含归档）、全部评价与使用计数，逐行聚合后整表覆盖写。
 *
 * 为什么先把结果全部算完再落盘：聚合器抛错时连覆盖写都还没开始，既有投影不会短暂缺失。
 * 为什么覆盖写要先删整表：这是统计表唯一被删除的路径，它同时清掉「经验已不存在」的陈留行。
 * 为什么没有评价历史的经验取 neutralStats 而不调聚合器：没有证据时口径由调用方给定（§33 冷启动），
 * 与首次记录使用建立统计行同源，两条路径因此天然给出同一份投影。
 */
export declare function rebuildStatsRows(ctx: ExperiencePortContext, input: ExperienceStatsRebuildInput): {
    experienceCount: number;
};

// src/host/assets/experience-stats.ts
//
// 统计投影（experience_stats）的读、写与全量重建，以及统计管道的输入读取（评价历史、使用计数）。
//
// 为什么这些事收敛在一处：§26 的管道是「Evaluation → Statistics」，输入的读法与结果的落盘必须
// 共用同一份列映射与同一条读取口径。增量路径（写入评价后重算一行）与重建路径（重放全部历史）
// 若各自维护读法，两者结果会分叉，而重建的全部意义正是「与增量结果一致」（§24 / §25）。
//
// 统计是**派生投影**：任何一行都能被「读全部历史 → 聚合 → 覆盖写」重放出来，
// 因此这里的写入不触碰经验本体，也不与「只增不改」的历史事实施加任何改写。
import { sqlPlaceholders } from "./db.js";
import { evaluationScoresFromRow } from "./experience-codec.js";
import { requireAssetId, toInteger, uniqueFilledIds } from "./role-check.js";
/**
 * 统计列与契约字段的唯一映射。
 *
 * 用 `Record<keyof ExperienceStatsValues, string>` 而不是数组：字段少一个或多一个都会编译失败，
 * 因此插入语句与读取解码不可能漏列。列序不承载语义（所有语句都显式列出列名）。
 */
const STATS_COLUMNS = {
    effectiveSampleCount: "effective_sample_count",
    recalledCount: "recalled_count",
    usedCount: "used_count",
    fitMean: "fit_mean",
    empiricalValue: "empirical_value",
    variance: "variance",
    stability: "stability",
    evidenceStrength: "evidence_strength",
    harmCount: "harm_count",
    harmRate: "harm_rate",
    harmSeverity: "harm_severity",
    qualitySignal: "quality_signal",
    trust: "trust",
};
/** 统计字段清单（对象字面量的键插入顺序稳定；插入语句与解码共用同一顺序）。 */
const STATS_KEYS = Object.keys(STATS_COLUMNS);
/** 经验行读路径的统计 JOIN（无统计行时全列为 NULL，条目据此省略 stats 字段）。 */
export const EXPERIENCE_STATS_JOIN_SQL = " LEFT JOIN experience_stats s ON s.experience_id = e.id";
/**
 * 与 JOIN 配套的投影列：统一加 `stats_` 前缀。
 * 必须加前缀——`updated_at` 等列名在两张表里同名，`SELECT *` 会让其中一个被另一个覆盖。
 */
export const EXPERIENCE_STATS_JOIN_COLUMNS_SQL = `, ${statsRowColumns()
    .map((column) => `s.${column} AS stats_${column}`)
    .join(", ")}`;
/** 某经验的全部评价历史（按写入顺序，含同一次批量写入的多条）：增量重算的输入。 */
export function readEvaluationScores(ctx, experienceId) {
    return ctx.tx
        .all(`SELECT fit_score, decision_effect, information_gain, causal_confidence
         FROM experience_evaluation
        WHERE experience_id = ?
        ORDER BY created_at ASC, id ASC`, [experienceId])
        .map(evaluationScoresFromRow);
}
/** 全库评价历史按经验分组：全量重建的输入。 */
export function readAllEvaluationScores(ctx) {
    const grouped = new Map();
    const rows = ctx.tx.all(`SELECT experience_id, fit_score, decision_effect, information_gain, causal_confidence
       FROM experience_evaluation
      ORDER BY created_at ASC, id ASC`);
    for (const row of rows) {
        const experienceId = String(row.experience_id ?? "");
        const scores = evaluationScoresFromRow(row);
        const history = grouped.get(experienceId);
        if (history)
            history.push(scores);
        else
            grouped.set(experienceId, [scores]);
    }
    return grouped;
}
/** 使用事实按经验计数：重建的输入（被注入次数与评价次数是两个事实，不能互相推导）。 */
export function readUsageCounts(ctx) {
    const counts = new Map();
    const rows = ctx.tx.all("SELECT experience_id, COUNT(*) AS total FROM experience_usage GROUP BY experience_id");
    for (const row of rows)
        counts.set(String(row.experience_id ?? ""), toInteger(row.total, 0));
    return counts;
}
/**
 * 统计行 → 契约投影；无统计行或数值列不可用时返回 null。
 *
 * 为什么损坏行按「无统计」降级而不是报错或补 0：统计本就可重建，重建即可恢复；
 * 而把缺值当成真实统计会直接污染召回排序，比暂时按中性值处理更危险。
 */
export function statsEntryFromRow(row, prefix = "") {
    const rawId = row[`${prefix}experience_id`];
    if (rawId === null || rawId === undefined)
        return null;
    // 循环填充需要一个可变的完整结构：键的完整性由 STATS_COLUMNS 的 Record 类型保证
    const values = {};
    for (const key of STATS_KEYS) {
        const value = finiteNumber(row[`${prefix}${STATS_COLUMNS[key]}`]);
        if (value === null)
            return null;
        values[key] = value;
    }
    return { experienceId: String(rawId), ...values, updatedAt: toInteger(row[`${prefix}updated_at`], 0) };
}
/** 按入参顺序读取统计行：缺行不返回（不补默认值），重复入参按首次出现去重。 */
export function readStatsRows(ctx, experienceIds) {
    const wanted = uniqueFilledIds(experienceIds);
    if (wanted.length === 0)
        return [];
    const rows = ctx.tx.all(`SELECT * FROM experience_stats WHERE experience_id IN (${sqlPlaceholders(wanted)})`, wanted);
    const byId = new Map();
    for (const row of rows) {
        const entry = statsEntryFromRow(row);
        if (entry)
            byId.set(entry.experienceId, entry);
    }
    return wanted.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
}
/** 已记录的被注入次数；无统计行按 0（统计建立前该经验确实没有被记录过注入）。 */
export function readRecalledCount(ctx, experienceId) {
    const row = ctx.tx.get("SELECT recalled_count FROM experience_stats WHERE experience_id = ?", [experienceId]);
    if (!row)
        return 0;
    const count = finiteNumber(row.recalled_count);
    return count === null ? 0 : Math.trunc(count);
}
/** 统计行是否已存在（「首次建行」与「只累加计数」两条路径的分界）。 */
export function statsRowExists(ctx, experienceId) {
    return ctx.tx.get("SELECT 1 AS present FROM experience_stats WHERE experience_id = ?", [experienceId]) !== null;
}
/**
 * 首次建立统计行。
 *
 * 为什么用 INSERT 而不是 UPSERT：调用方已判定该经验没有统计行，此时覆盖写只会掩盖判定错误
 * （例如两次首建竞争），让不一致以主键冲突的形式暴露，而不是静默丢弃一次计数。
 */
export function createNeutralStatsRow(ctx, experienceId, neutralStats, recalledCount, updatedAt) {
    const entry = { experienceId, ...neutralStats, recalledCount, updatedAt };
    ctx.tx.run(`INSERT INTO experience_stats (${statsRowColumns().join(", ")}) VALUES (${sqlPlaceholders(statsRowColumns())})`, statsRowValues(entry));
    return entry;
}
/**
 * 只累加被注入次数，其余**统计数值列**由评价路径维护（§24 的增量策略）。
 *
 * 为什么记账时间必须一起刷新：这次写入确实改动了这一行，而「最后更新时间」是行事实而非统计值；
 * 不刷新会让界面与排障看到「计数刚变、时间停在几天前」的自相矛盾（与资产侧 updated_at 同口径）。
 */
export function incrementRecalledCount(ctx, experienceId, delta, updatedAt) {
    ctx.tx.run("UPDATE experience_stats SET recalled_count = recalled_count + ?, updated_at = ? WHERE experience_id = ?", [delta, updatedAt, experienceId]);
}
/** 覆盖写整行统计（UPSERT）：重算结果即新的投影，无需保留旧值。 */
export function writeStatsRow(ctx, entry) {
    const columns = statsRowColumns();
    const assignments = [
        ...STATS_KEYS.map((key) => `${STATS_COLUMNS[key]} = excluded.${STATS_COLUMNS[key]}`),
        "updated_at = excluded.updated_at",
    ];
    ctx.tx.run(`INSERT INTO experience_stats (${columns.join(", ")}) VALUES (${sqlPlaceholders(columns)})
     ON CONFLICT(experience_id) DO UPDATE SET ${assignments.join(", ")}`, statsRowValues(entry));
}
/**
 * 全量重建统计投影（§24 / §25）：读全部经验（含归档）、全部评价与使用计数，逐行聚合后整表覆盖写。
 *
 * 为什么先把结果全部算完再落盘：聚合器抛错时连覆盖写都还没开始，既有投影不会短暂缺失。
 * 为什么覆盖写要先删整表：这是统计表唯一被删除的路径，它同时清掉「经验已不存在」的陈留行。
 * 为什么没有评价历史的经验取 neutralStats 而不调聚合器：没有证据时口径由调用方给定（§33 冷启动），
 * 与首次记录使用建立统计行同源，两条路径因此天然给出同一份投影。
 */
export function rebuildStatsRows(ctx, input) {
    const experienceIds = ctx.tx
        .all("SELECT id FROM experiences ORDER BY created_at ASC, id ASC")
        .map((row) => requireAssetId(row.id, "experiences.id"));
    const history = readAllEvaluationScores(ctx);
    const usageCounts = readUsageCounts(ctx);
    const rebuilt = experienceIds.map((experienceId) => {
        const evaluations = history.get(experienceId) ?? [];
        const recalledCount = usageCounts.get(experienceId) ?? 0;
        const values = evaluations.length === 0
            ? { ...input.neutralStats, recalledCount }
            : input.aggregate({ evaluations, recalledCount });
        return { experienceId, values };
    });
    ctx.tx.run("DELETE FROM experience_stats");
    // 一次重建视为一次写入事件：同一批统计行共享同一记账时间，便于判读「这批投影何时生成」
    const updatedAt = ctx.now();
    for (const row of rebuilt)
        writeStatsRow(ctx, { experienceId: row.experienceId, ...row.values, updatedAt });
    return { experienceCount: experienceIds.length };
}
/** 统计行的列序（插入与 UPSERT 共用一份，避免两处列错位）。 */
function statsRowColumns() {
    return ["experience_id", ...STATS_KEYS.map((key) => STATS_COLUMNS[key]), "updated_at"];
}
/** 统计行的取值（顺序与 statsRowColumns 严格对应）。 */
function statsRowValues(entry) {
    return [entry.experienceId, ...STATS_KEYS.map((key) => entry[key]), entry.updatedAt];
}
/** 有限数值列读取：驱动只给 number，非数值（含 NaN / 缺失）一律判为「该行不可用」。 */
function finiteNumber(value) {
    if (typeof value !== "number")
        return null;
    return Number.isFinite(value) ? value : null;
}
//# sourceMappingURL=experience-stats.js.map
// src/host/assets/experience-evaluations.ts
//
// 评价事实（experience_evaluation）的写入，以及随之触发的统计增量重算。
//
// 为什么「写评价」与「重算该经验统计」必须同事务：统计是评价历史的投影，拆开会出现
// 「评价已落库、统计还是旧的」的中间态，而期间召回排序已经在用旧的信任值。
// 为什么只增不改：评价历史是统计唯一的事实源，允许改写历史就等于放弃「改参数后重放」（§25）。
//
// 本文件不复刻四维评分的取值域：锚点校验的本体在经验域，磁盘层由 CHECK 约束兜底。
// 它只负责把「全部历史 + 被注入次数」交给调用方注入的聚合器，并把结果原子落盘。
import { experienceNotFound } from "./errors.js";
import { readExistingExperienceIds } from "./experiences.js";
import { readEvaluationScores, readRecalledCount, writeStatsRow } from "./experience-stats.js";
import { newExperienceEvaluationId } from "./ids.js";
import { requireExperienceText } from "./role-check.js";
/**
 * 批量写入评价并重算对应经验的统计（同一笔事务，任一步失败整批回滚）。
 *
 * 为什么每个经验读**全部**历史再聚合，而不是在旧统计上做增量累加：统计定义是
 * 「历史的函数」（§26 的纯函数聚合器），累加会随参数调整失去可重放性（§25），
 * 也会让「同一批插入多条的中间结果」泄漏进最终投影。
 */
export function insertEvaluationsCheckedRows(ctx, input) {
    if (input.rows.length === 0)
        return { inserted: [], stats: [] };
    const facts = input.rows.map(normalizeEvaluationRow);
    const affected = [];
    for (const fact of facts)
        if (!affected.includes(fact.experienceId))
            affected.push(fact.experienceId);
    // 先校验经验存在：外键报错只会说明「某行引用无效」，说不出是哪条经验，调用方无法行动
    const existing = readExistingExperienceIds(ctx.tx, affected);
    const missing = affected.filter((id) => !existing.has(id));
    if (missing.length > 0)
        throw experienceNotFound(missing.join("、"));
    const inserted = [];
    for (const fact of facts) {
        const id = newExperienceEvaluationId(ctx.ids);
        const createdAt = ctx.now();
        ctx.tx.run(`INSERT INTO experience_evaluation (
         id, experience_id, run_id, fit_score, decision_effect, information_gain, causal_confidence,
         evidence, evaluator_subject_id, evaluator_model, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            fact.experienceId,
            fact.runId,
            fact.fitScore,
            fact.decisionEffect,
            fact.informationGain,
            fact.causalConfidence,
            fact.evidence,
            fact.evaluatorSubjectId,
            fact.evaluatorModel,
            createdAt,
        ]);
        inserted.push({ id, ...fact, createdAt });
    }
    const stats = affected.map((experienceId) => {
        // 读的是含本批刚插入行的完整历史：INSERT 与 SELECT 在同一事务内，读到的就是事务内状态
        const evaluations = readEvaluationScores(ctx, experienceId);
        const values = input.aggregate({ evaluations, recalledCount: readRecalledCount(ctx, experienceId) });
        const entry = { experienceId, ...values, updatedAt: ctx.now() };
        writeStatsRow(ctx, entry);
        return entry;
    });
    return { inserted, stats };
}
/**
 * 评价行归一。
 * `runId` / `evidence` / `evaluatorModel` 允许空串（无运行来源、无证据、模型名未知都是真实事实，
 * 伪造默认值会让未来的评分者校准拿到假证据）；评分者主体身份与经验 id 必须非空。
 */
function normalizeEvaluationRow(row) {
    return {
        experienceId: requireExperienceText(row.experienceId, "experience_evaluation.experience_id"),
        runId: typeof row.runId === "string" ? row.runId : "",
        fitScore: row.fitScore,
        decisionEffect: row.decisionEffect,
        informationGain: row.informationGain,
        causalConfidence: row.causalConfidence,
        evidence: typeof row.evidence === "string" ? row.evidence : "",
        evaluatorSubjectId: requireExperienceText(row.evaluatorSubjectId, "experience_evaluation.evaluator_subject_id"),
        evaluatorModel: typeof row.evaluatorModel === "string" ? row.evaluatorModel : "",
    };
}
//# sourceMappingURL=experience-evaluations.js.map
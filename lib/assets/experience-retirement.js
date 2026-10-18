// src/host/assets/experience-retirement.ts
//
// 经验退役在资产库侧的读写端口：自动归档的条件更新，以及退役判定所需事实的读盘投影。
//
// 为什么自动归档单独一条写入路径：手动归档（setActive）与自动归档（有害/长期无用）的
// 状态触发点不同，但都必须只对**仍在活跃**的经验生效。把条件写进同一条 UPDATE，
// 才能避免扫描与界面操作并发时把已恢复的经验再次静默归档。
//
// 为什么读盘返回恢复前的全部历史而不是在这里过滤：恢复豁免的口径属于经验域判定公式
// （`reactivatedAt` 之后的证据才有效）。资产库只保证「读到的事实完整且按时间有序」，
// 不实现第二套判定；否则两处口径会漂移。
import { asExperienceType, evaluationScoresFromRow } from "./experience-codec.js";
import { experienceNotFound } from "./errors.js";
import { readExperienceRow } from "./experiences.js";
import { requireAssetId, toInteger } from "./role-check.js";
/**
 * 按策略自动归档一条经验（只对活跃行生效）。
 *
 * 返回是否真的发生了归档：已归档的经验返回 false（幂等），不存在则抛可行动错误。
 * 扫描与反馈即时归档共用本方法，因此两条路径的磁盘语义完全一致。
 */
export function retireExperienceRowForPolicy(ctx, id, reason) {
    const current = readExperienceRow(ctx.tx, id);
    if (!current)
        throw experienceNotFound(id);
    if (!current.active)
        return false;
    const now = ctx.now();
    ctx.tx.run(`UPDATE experiences
        SET is_active = 0, retired_at = ?, retired_reason = ?, updated_at = ?
      WHERE id = ? AND is_active = 1`, [now, reason, now, id]);
    return true;
}
/**
 * 读取全部活跃经验的退役判定事实。
 *
 * 使用事实与评价事实都通过 JOIN 限定在活跃经验上，避免把归档经验的整段历史搬进内存；
 * 返回顺序按经验创建时间（与界面列表一致），内部事实按写入时间升序（去重时「后者胜出」才可复现）。
 */
export function readRetirementFacts(ctx) {
    const experiences = ctx.tx.all(`SELECT id, experience_type, reactivated_at
       FROM experiences
      WHERE is_active = 1
      ORDER BY created_at ASC, id ASC`);
    if (experiences.length === 0)
        return [];
    const byId = new Map();
    for (const row of experiences) {
        const experienceId = requireAssetId(row.id, "experiences.id");
        byId.set(experienceId, {
            experienceId,
            experienceType: asExperienceType(row.experience_type),
            reactivatedAt: toInteger(row.reactivated_at, 0),
            usage: [],
            evaluations: [],
        });
    }
    const usageRows = ctx.tx.all(`SELECT u.experience_id, u.run_id, u.created_at
       FROM experience_usage u
       JOIN experiences e ON e.id = u.experience_id
      WHERE e.is_active = 1
      ORDER BY u.created_at ASC, u.id ASC`);
    for (const row of usageRows) {
        const fact = byId.get(String(row.experience_id ?? ""));
        if (!fact)
            continue;
        fact.usage.push({
            runId: String(row.run_id ?? ""),
            createdAt: toInteger(row.created_at, 0),
        });
    }
    const evaluationRows = ctx.tx.all(`SELECT ev.experience_id, ev.run_id, ev.role_key, ev.role_label,
            ev.fit_score, ev.decision_effect, ev.information_gain, ev.causal_confidence, ev.created_at
       FROM experience_evaluation ev
       JOIN experiences e ON e.id = ev.experience_id
      WHERE e.is_active = 1
      ORDER BY ev.created_at ASC, ev.id ASC`);
    for (const row of evaluationRows) {
        const fact = byId.get(String(row.experience_id ?? ""));
        if (!fact)
            continue;
        fact.evaluations.push({
            runId: String(row.run_id ?? ""),
            roleKey: String(row.role_key ?? "").trim(),
            roleLabel: String(row.role_label ?? "").trim(),
            scores: evaluationScoresFromRow(row),
            createdAt: toInteger(row.created_at, 0),
        });
    }
    return [...byId.values()];
}
//# sourceMappingURL=experience-retirement.js.map
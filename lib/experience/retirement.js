// src/host/experience/retirement.ts
//
// 经验退役（归档）的确定性判定：有害评价一次即归档；角色经验与编排经验分别判定长期无用。
//
// 为什么长期无用不用时间窗口：时间只能证明「没被用过」，不能证明「用过但没有价值」。
// 判定的是「被充分使用与评价、覆盖足够多的角色（或编排 run），却从未产生有效价值」。
// 角色经验必须跨多个角色，避免同一种任务反复使用失败就被判成所有场景无用；
// 编排经验不参与多样性——父代理只有编排与决策这一类全局任务，用不同编排 run 数即可。
//
// 为什么判定必须是纯函数：退役是不可逆的状态写入（经验退出召回面），阈值、去重与恢复豁免
// 任一细节都必须在离线可复现，不能藏在 SQL 或扫描循环里。事实由调用方传入即全部输入，
// 本文件不读时钟、不读数据库、不依赖调用顺序。
import { RETIREMENT_AGENT_MIN_EVALUATION_RUNS, RETIREMENT_AGENT_MIN_ROLE_TYPES, RETIREMENT_AGENT_MIN_USAGE_RUNS, RETIREMENT_MIN_EFFECTIVE_SAMPLES, RETIREMENT_MIN_TOTAL_RECALLS, RETIREMENT_ORCHESTRATOR_MIN_EVALUATION_RUNS, RETIREMENT_ORCHESTRATOR_MIN_USAGE_RUNS, } from "./constants.js";
import { buildEvaluationSamples, calculateEffectiveSampleCount, } from "./statistics.js";
/** 是否发生在最近一次恢复之后（reactivatedAt = 0 表示从未恢复，即全部历史都有效）。 */
function isAfterReactivation(reactivatedAt, createdAt) {
    return reactivatedAt <= 0 || createdAt > reactivatedAt;
}
/** 归一身份键：去首尾空白；空串表示「没有可识别身份」。 */
function normalizedKey(value) {
    return typeof value === "string" ? value.trim() : "";
}
/**
 * 按 run 去重评价（同一 run 取最后一条）。
 *
 * 为什么去重：同一任务内多次提交评价是合法历史，但「跨任务验证」必须按任务实例计数；
 * 不去重会让一个任务反复评价就把充分性刷到阈值。
 * 空 run 不属于任何可识别的任务实例，直接排除。
 */
function dedupeEvaluationsByRun(evaluations) {
    const byRun = new Map();
    for (const evaluation of evaluations) {
        const runId = normalizedKey(evaluation.runId);
        if (!runId)
            continue;
        const existing = byRun.get(runId);
        // createdAt 相同则后出现者胜出：输入顺序来自资产库的 created_at ASC, id ASC，结果稳定
        if (!existing || evaluation.createdAt >= existing.createdAt)
            byRun.set(runId, evaluation);
    }
    return byRun;
}
/** 不同非空 run 数。 */
function distinctRunCount(facts) {
    const runs = new Set();
    for (const fact of facts) {
        const runId = normalizedKey(fact.runId);
        if (runId)
            runs.add(runId);
    }
    return runs.size;
}
/** 不同非空角色数。 */
function distinctRoleCount(evaluations) {
    const roles = new Set();
    for (const evaluation of evaluations) {
        const roleKey = normalizedKey(evaluation.roleKey);
        if (roleKey)
            roles.add(roleKey);
    }
    return roles.size;
}
/** 去重后评价的有效样本量（沿用 §10.2 的权重口径）。 */
function effectiveSampleCountOf(evaluations) {
    const scores = [...evaluations].map((evaluation) => evaluation.scores);
    return calculateEffectiveSampleCount(buildEvaluationSamples(scores));
}
/** 长期无用的归档结论（原因固定，说明里带上判定所依据的计数，便于排障与后续统计）。 */
function longUnusedDecision(detail) {
    return { retire: true, reason: "long_unused", detail };
}
/**
 * 判定一条经验是否应退役。
 *
 * 顺序是硬约束：有害优先于长期无用。一次负向决策效果就是实际有害影响，即使这条经验
 * 同时满足长期无用的全部条件，也必须以 `harmful` 归档（原因决定界面解释与后续统计）。
 */
export function decideExperienceRetirement(facts) {
    const usage = facts.usage.filter((fact) => isAfterReactivation(facts.reactivatedAt, fact.createdAt));
    const evaluations = facts.evaluations.filter((fact) => isAfterReactivation(facts.reactivatedAt, fact.createdAt));
    // 有害：任意一次负向决策效果，不看 fit / 因果置信度（评价权重为 0 也照样归档）
    const harmful = evaluations.filter((evaluation) => evaluation.scores.decisionEffect < 0).length;
    if (harmful > 0) {
        return {
            retire: true,
            reason: "harmful",
            detail: `${harmful} evaluation(s) reported a negative decision effect`,
        };
    }
    // 长期无用：必须存在评价证据，且从未出现正向决策效果（全为 0）
    if (evaluations.length === 0)
        return { retire: false };
    if (!evaluations.every((evaluation) => evaluation.scores.decisionEffect === 0))
        return { retire: false };
    const deduped = dedupeEvaluationsByRun(evaluations);
    const evaluationRuns = deduped.size;
    const usageRuns = distinctRunCount(usage);
    const effectiveSamples = effectiveSampleCountOf(deduped.values());
    if (usage.length < RETIREMENT_MIN_TOTAL_RECALLS)
        return { retire: false };
    if (effectiveSamples < RETIREMENT_MIN_EFFECTIVE_SAMPLES)
        return { retire: false };
    if (facts.experienceType === "orchestrator") {
        if (usageRuns < RETIREMENT_ORCHESTRATOR_MIN_USAGE_RUNS)
            return { retire: false };
        if (evaluationRuns < RETIREMENT_ORCHESTRATOR_MIN_EVALUATION_RUNS)
            return { retire: false };
        return longUnusedDecision(`orchestrator experience: ${usageRuns} orchestration run(s), ${evaluationRuns} evaluated run(s), `
            + `effective sample count ${effectiveSamples.toFixed(3)}, no positive decision effect`);
    }
    if (facts.experienceType === "agent") {
        const roleTypes = distinctRoleCount(deduped.values());
        if (usageRuns < RETIREMENT_AGENT_MIN_USAGE_RUNS)
            return { retire: false };
        if (evaluationRuns < RETIREMENT_AGENT_MIN_EVALUATION_RUNS)
            return { retire: false };
        if (roleTypes < RETIREMENT_AGENT_MIN_ROLE_TYPES)
            return { retire: false };
        return longUnusedDecision(`agent experience: ${usageRuns} usage run(s), ${evaluationRuns} evaluated run(s), `
            + `${roleTypes} role type(s), effective sample count ${effectiveSamples.toFixed(3)}, no positive decision effect`);
    }
    return { retire: false };
}
//# sourceMappingURL=retirement.js.map